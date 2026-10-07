import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { parseConfig } from '../src/core/config';
import { Project } from '../src/project';
import { ActiveEnvStore } from '../src/state';

function memento() {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T,
    update: async (key: string, value: unknown) => void data.set(key, value),
    keys: () => [...data.keys()],
  };
}

function monorepo() {
  const config = parseConfig(
    '{"envs":[{"title":"Local","file":".env.local"},{"title":"Staging","file":".env.staging"}],' +
      '"apps":[{"dir":"apps/web"},{"dir":"apps/api","envs":[{"title":"Mock","file":".env.mock"}]}]}',
  );
  return new Project({ name: 'repo', index: 0, uri: Uri.file('/repo') }, config);
}

describe('ActiveEnvStore', () => {
  it('sets, reads and clears the active env per app', async () => {
    const store = new ActiveEnvStore(memento() as never);
    const project = monorepo();
    const [web, api] = project.apps;

    await store.set(project, [web, api], 'Local');
    expect(Object.fromEntries(store.get(project))).toEqual({ web: 'Local', api: 'Local' });
    expect(store.summary(project)).toEqual({ title: 'Local', mixed: false });

    await store.set(project, [api], 'Mock');
    expect(store.summary(project)).toEqual({ mixed: true });

    await store.set(project, [web, api], undefined);
    expect(store.get(project).size).toBe(0);
    expect(store.summary(project)).toEqual({ title: undefined, mixed: false });
  });

  it('ignores stored envs or apps that are no longer in the config', async () => {
    const m = memento();
    const project = monorepo();
    await m.update('dotenvSwitcher.active:file:///repo', { web: 'Removed', api: 'Mock', gone: 'Local' });
    expect(Object.fromEntries(new ActiveEnvStore(m as never).get(project))).toEqual({ api: 'Mock' });
  });

  it('falls back to legacy state key', async () => {
    const m = memento();
    const project = monorepo();
    await m.update('envSwitcher.active:file:///repo', { api: 'Mock' });
    expect(Object.fromEntries(new ActiveEnvStore(m as never).get(project))).toEqual({ api: 'Mock' });
  });

  it('keeps projects apart', async () => {
    const store = new ActiveEnvStore(memento() as never);
    const a = monorepo();
    const b = new Project({ name: 'other', index: 1, uri: Uri.file('/other') }, a.config);
    await store.set(a, a.apps, 'Staging');
    expect(store.get(b).size).toBe(0);
  });
});
