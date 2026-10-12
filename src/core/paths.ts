import * as path from 'node:path';

/**
 * Whether `child` is `parent` or lies inside it, after normalising `..` segments. Pass
 * `path.win32` to compare Windows paths (case-insensitive, either separator).
 */
export function isInside(parent: string, child: string, platformPath: typeof path.posix = path): boolean {
  const rel = platformPath.relative(parent, child);
  if (rel === '') return true;
  if (platformPath.isAbsolute(rel)) return false; // another drive on Windows
  return rel !== '..' && !rel.startsWith(`..${platformPath.sep}`) && !rel.startsWith('../');
}
