import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { parseLsofPids, parseNetstatPids, parseProcNetTcp, parseSsPids } from '../core/ports';

export interface KillResult {
  port: number;
  pids: number[];
  /** Still in use after killing. */
  stillInUse: boolean;
}

// GUI-launched editors (Dock, desktop launchers) often have a minimal PATH without /usr/sbin,
// so fall back to the usual absolute locations.
const LSOF = ['lsof', '/usr/sbin/lsof', '/usr/bin/lsof', '/sbin/lsof', '/bin/lsof'];
const SS = ['ss', '/usr/sbin/ss', '/usr/bin/ss', '/sbin/ss', '/bin/ss'];

/** Finds PIDs listening on a TCP port. Returns [] when nothing listens or no method works. */
export async function findListeningPids(port: number): Promise<number[]> {
  const pids = await findPidsRaw(port);
  return pids.filter((pid) => pid !== process.pid);
}

async function findPidsRaw(port: number): Promise<number[]> {
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const out = await runFirst(['netstat', `${systemRoot}\\System32\\netstat.exe`], ['-ano', '-p', 'tcp']);
    return out === undefined ? [] : parseNetstatPids(out, port);
  }

  // macOS, Linux, BSD.
  const lsof = await runFirst(LSOF, ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
  if (lsof !== undefined) return parseLsofPids(lsof);

  if (process.platform === 'linux') {
    const ss = await runFirst(SS, ['-Hltnp', `sport = :${port}`]);
    if (ss !== undefined) return parseSsPids(ss);
    return findPidsViaProc(port);
  }
  return [];
}

/**
 * Kills whatever listens on the given ports and waits until they are free: a graceful stop
 * first, then a forced one after a grace period. Never kills the extension host itself.
 */
export async function killPorts(ports: number[], timeoutMs = 3000): Promise<KillResult[]> {
  const results: KillResult[] = [];

  for (const port of ports) {
    const pids = await findListeningPids(port);
    if (pids.length === 0) continue;

    await Promise.all(pids.map((pid) => terminate(pid, false)));
    let free = await waitUntilFree(port, Math.min(1000, timeoutMs));
    if (!free) {
      const remaining = await findListeningPids(port);
      await Promise.all(remaining.map((pid) => terminate(pid, true)));
      free = await waitUntilFree(port, timeoutMs);
    }
    results.push({ port, pids, stillInUse: !free });
  }
  return results;
}

async function terminate(pid: number, force: boolean): Promise<void> {
  if (process.platform === 'win32') {
    // /T also stops the process tree (e.g. node spawned by pnpm.cmd). Console apps ignore the
    // graceful request, so the forced pass (/F) is what usually ends them.
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
    await runFirst(['taskkill', `${systemRoot}\\System32\\taskkill.exe`], args);
    return;
  }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // Already gone, or not ours to kill.
  }
}

async function waitUntilFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await findListeningPids(port)).length === 0) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return (await findListeningPids(port)).length === 0;
}

/**
 * Linux fallback without lsof/ss (minimal containers): map listening socket inodes from
 * /proc/net/tcp{,6} to processes via /proc/<pid>/fd. Only sees processes we may inspect,
 * which are also the only ones we could kill.
 */
export async function findPidsViaProc(port: number): Promise<number[]> {
  const inodes = new Set<string>();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      for (const inode of parseProcNetTcp(await fs.readFile(file, 'utf8'), port)) inodes.add(inode);
    } catch {
      // tcp6 may not exist
    }
  }
  if (inodes.size === 0) return [];

  const pids: number[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir('/proc');
  } catch {
    return [];
  }
  await Promise.all(
    entries
      .filter((name) => /^\d+$/.test(name))
      .map(async (name) => {
        let fds: string[];
        try {
          fds = await fs.readdir(`/proc/${name}/fd`);
        } catch {
          return;
        }
        for (const fd of fds) {
          try {
            const match = /^socket:\[(\d+)\]$/.exec(await fs.readlink(`/proc/${name}/fd/${fd}`));
            if (match && inodes.has(match[1])) {
              pids.push(Number(name));
              return;
            }
          } catch {
            // fd closed meanwhile
          }
        }
      }),
  );
  return [...new Set(pids)];
}

/**
 * Runs the first available binary from `candidates` and returns stdout. A non-zero exit
 * (e.g. lsof finding nothing) still yields stdout; undefined means no candidate exists.
 */
async function runFirst(candidates: string[], args: string[]): Promise<string | undefined> {
  for (const cmd of candidates) {
    const out = await run(cmd, args);
    if (out !== undefined) return out;
  }
  return undefined;
}

function run(cmd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === 'ENOENT' || code === 'EACCES') resolve(undefined);
      else resolve(stdout ?? '');
    });
  });
}
