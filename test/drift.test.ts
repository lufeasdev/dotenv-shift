import { beforeEach, describe, expect, it } from 'vitest';
import { Uri, workspace } from 'vscode';
import { parseConfig } from '../src/core/config';
import { Project } from '../src/project';
import { detectAppEnv } from '../src/services/switcher';
import { ProjectSession, type SessionHost } from '../src/session';

/** In-memory files for `vscode.workspace.fs.readFile`, by path. */
let files: Record<string, string>;
(workspace as unknown as { fs: unknown }).fs = {
  readFile: async (uri: Uri) => {
    if (!(uri.path in files)) throw new Error('ENOENT');
    return new TextEncoder().encode(files[uri.path]);
  },
};

const project = new Project(
  { name: 'repo', index: 0, uri: Uri.file('/repo') },
  parseConfig(
    '{"envs":[{"title":"Local","file":".env.local"},{"title":"Dev","file":".env.dev"},{"title":"Staging","file":".env.staging"}]}',
  ),
);
const app = project.apps[0];

beforeEach(() => {
  files = {
    '/repo/.env.local': 'A=1\n',
    '/repo/.env.dev': 'A=1\n', // same as Local
    '/repo/.env.staging': 'A=2\n',
  };
});

describe('detectAppEnv', () => {
  it('prefers the given env when several envs match', async () => {
    files['/repo/.env'] = 'A=1\n';
    expect(await detectAppEnv(app)).toBe('Local');
    expect(await detectAppEnv(app, 'Dev')).toBe('Dev');
  });

  it('ignores the preferred env when it does not match', async () => {
    files['/repo/.env'] = 'A=2\n';
    expect(await detectAppEnv(app, 'Dev')).toBe('Staging');
  });
});

describe('ProjectSession drift', () => {
  function session(active: string) {
    const events: string[] = [];
    const state = new Map([[app.name, active]]);
    const host = {
      store: { get: () => new Map(state) },
      log: { info() {}, error() {} },
      onDidChange() {},
      onTargetModified: () => events.push('modified'),
      onTargetDrifted: (_s: unknown, _a: unknown, detected: string) => events.push(`drifted ${detected}`),
    } as unknown as SessionHost;
    const s = new ProjectSession(project, host);
    const sync = () => (s as unknown as { syncTarget(a: typeof app): Promise<void> }).syncTarget(app);
    return { s, events, sync };
  }

  it('does not report an identical env as drift', async () => {
    files['/repo/.env'] = 'A=1\n';
    const { s, events, sync } = session('Dev');
    await sync();
    expect(s.driftedApps().size).toBe(0);
    expect(events).toEqual([]);
  });

  it('reports a target replaced by another env as drifted once, not as modified', async () => {
    files['/repo/.env'] = 'A=2\n';
    const { s, events, sync } = session('Local');
    await sync();
    await sync();
    expect(s.driftedApps().get(app.name)).toBe('Staging');
    expect(s.modifiedApps().size).toBe(0);
    expect(events).toEqual(['drifted Staging']);
  });

  it('reports a hand edit as modified', async () => {
    files['/repo/.env'] = 'A=3\n';
    const { s, events, sync } = session('Local');
    await sync();
    expect(s.driftedApps().size).toBe(0);
    expect(s.modifiedApps().get(app.name)?.changed).toEqual(['A']);
    expect(events).toEqual(['modified']);
  });
});
