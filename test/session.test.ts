import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { parseConfig } from '../src/core/config';
import { Project } from '../src/project';
import { ProjectSession, type SessionHost } from '../src/session';

function session() {
  const project = new Project(
    { name: 'repo', index: 0, uri: Uri.file('/repo') },
    parseConfig('{"envs":[{"file":".env.local"}]}'),
  );
  return new ProjectSession(project, {} as SessionHost);
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ProjectSession.exclusive', () => {
  it('runs tasks one after the other, in order', async () => {
    const s = session();
    const events: string[] = [];
    const task = (name: string, ms: number) => () =>
      (async () => {
        events.push(`start ${name}`);
        await tick(ms);
        events.push(`end ${name}`);
        return name;
      })();

    const results = await Promise.all([
      s.exclusive(task('a', 20)),
      s.exclusive(task('b', 1)),
      s.exclusive(task('c', 5)),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('keeps going after a task fails, and passes the failure to its caller', async () => {
    const s = session();
    const failed = s.exclusive(async () => {
      throw new Error('boom');
    });
    const next = s.exclusive(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
