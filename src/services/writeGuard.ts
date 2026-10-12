import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { isInside } from '../core/paths';
import type { Project } from '../project';

/**
 * Paths come from the workspace's `dotenv-shift.json`, so in Restricted Mode only files inside
 * the workspace folder are written: an untrusted config must not be able to create or overwrite
 * files elsewhere (e.g. `"target": "/home/me/.bashrc"`, or a symlinked `.env`).
 */
export async function canWrite(project: Project, uri: vscode.Uri): Promise<boolean> {
  if (vscode.workspace.isTrusted) return true;
  const folder = project.folder.uri;
  if (uri.scheme !== folder.scheme || uri.authority !== folder.authority) return false;
  if (uri.scheme !== 'file') return isInside(folder.path, uri.path, path.posix);

  // Resolve symlinks on both sides, so a link inside the folder can't point outside it.
  const pathApi = process.platform === 'win32' ? path.win32 : path;
  const [root, target] = await Promise.all([realPath(folder.fsPath), realPath(uri.fsPath)]);
  return root !== undefined && target !== undefined && isInside(root, target, pathApi);
}

/** Throws when {@link canWrite} refuses `uri`. */
export async function assertWritable(project: Project, uri: vscode.Uri): Promise<void> {
  if (await canWrite(project, uri)) return;
  throw new Error(
    vscode.l10n.t(
      "{0} is outside the workspace folder, so it isn't written in Restricted Mode. Trust the workspace to allow it.",
      uri.fsPath,
    ),
  );
}

/**
 * The real path of `p`, also for a file that doesn't exist yet (its closest existing ancestor
 * is resolved). Undefined for a dangling symlink, whose destination can't be vouched for.
 */
async function realPath(p: string): Promise<string | undefined> {
  try {
    return await fs.realpath(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
  }
  try {
    await fs.lstat(p);
    return undefined; // exists, but realpath failed: a dangling symlink
  } catch {
    // doesn't exist yet
  }
  const parent = path.dirname(p);
  if (parent === p) return undefined;
  const real = await realPath(parent);
  return real && path.join(real, path.basename(p));
}
