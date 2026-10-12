import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Uri, workspace } from 'vscode';
import { parseConfig } from '../src/core/config';
import { isInside } from '../src/core/paths';
import { Project } from '../src/project';
import { canWrite } from '../src/services/writeGuard';

describe('isInside', () => {
  it('accepts the folder itself and paths below it', () => {
    expect(isInside('/repo', '/repo', path.posix)).toBe(true);
    expect(isInside('/repo', '/repo/apps/web/.env', path.posix)).toBe(true);
    expect(isInside('/repo', '/repo/..env', path.posix)).toBe(true);
  });

  it('rejects paths outside, including via ..', () => {
    expect(isInside('/repo', '/repo-other/.env', path.posix)).toBe(false);
    expect(isInside('/repo', '/repo/../home/.bashrc', path.posix)).toBe(false);
    expect(isInside('/repo', '/etc/passwd', path.posix)).toBe(false);
  });

  it('compares Windows paths case-insensitively and across drives', () => {
    expect(isInside('C:\\Repo', 'c:\\repo\\apps\\.env', path.win32)).toBe(true);
    expect(isInside('C:\\Repo', 'C:\\Users\\me\\.env', path.win32)).toBe(false);
    expect(isInside('C:\\Repo', 'D:\\Repo\\.env', path.win32)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('canWrite', () => {
  let root: string;
  let project: Project;
  const ws = workspace as unknown as { isTrusted?: boolean };

  beforeAll(async () => {
    const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dotenv-shift-')));
    root = path.join(base, 'repo');
    await fs.mkdir(root);
    await fs.writeFile(path.join(base, 'outside'), 'x');
    await fs.symlink(path.join(base, 'outside'), path.join(root, 'link'));
    await fs.symlink(path.join(base, 'missing'), path.join(root, 'dangling'));
    project = new Project({ name: 'repo', index: 0, uri: Uri.file(root) }, parseConfig('{"envs":[{"file":"a"}]}'));
  });
  afterAll(() => {
    ws.isTrusted = undefined;
  });

  it('allows anything when the workspace is trusted', async () => {
    ws.isTrusted = true;
    expect(await canWrite(project, Uri.file('/etc/passwd'))).toBe(true);
  });

  it('only allows files inside the folder when untrusted', async () => {
    ws.isTrusted = false;
    expect(await canWrite(project, Uri.file(path.join(root, '.env')))).toBe(true);
    expect(await canWrite(project, Uri.file(path.join(root, 'new/dir/.env')))).toBe(true);
    expect(await canWrite(project, Uri.file(path.join(root, '../outside')))).toBe(false);
    expect(await canWrite(project, Uri.file('/etc/passwd'))).toBe(false);
  });

  it('follows symlinks, and refuses dangling ones', async () => {
    ws.isTrusted = false;
    expect(await canWrite(project, Uri.file(path.join(root, 'link')))).toBe(false);
    expect(await canWrite(project, Uri.file(path.join(root, 'dangling')))).toBe(false);
  });
});
