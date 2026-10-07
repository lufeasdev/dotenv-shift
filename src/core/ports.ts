import { parseEnv } from './envParser';

/** A port number, or the name of an env key that holds one (e.g. "PORT"). */
export type PortSpec = number | string;

/**
 * Resolves port specs to concrete ports. Key names are looked up in every given env text
 * (e.g. the previous and the new `.env`), since switching may change the port.
 */
export function resolvePorts(specs: PortSpec[], envTexts: (string | undefined)[]): number[] {
  const envs = envTexts.filter((t): t is string => t !== undefined).map(parseEnv);
  const ports = new Set<number>();

  for (const spec of specs) {
    if (typeof spec === 'number') {
      if (isValidPort(spec)) ports.add(spec);
      continue;
    }
    for (const entries of envs) {
      const value = entries.find((e) => e.key === spec)?.value.trim();
      const port = value ? Number(value) : NaN;
      if (isValidPort(port)) ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536;
}

/** `lsof -nP -t -iTCP:<port> -sTCP:LISTEN` prints one PID per line. */
export function parseLsofPids(output: string): number[] {
  return uniquePids(output.split(/\s+/).map(Number));
}

/** `ss -Hltnp "sport = :<port>"` lines contain `users:(("node",pid=1234,fd=20))`. */
export function parseSsPids(output: string): number[] {
  return uniquePids([...output.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])));
}

/**
 * `netstat -ano -p tcp` (Windows) lines look like
 * `  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234`.
 * The state column is localised (e.g. "ABHÖREN"), so a listening socket is recognised by its
 * foreign address instead, which is always `0.0.0.0:0` / `[::]:0` (or `*:*`).
 */
export function parseNetstatPids(output: string, port: number): number[] {
  const pids: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue;
    const foreign = cols[2];
    if (!/^(0\.0\.0\.0:0|\[::\]:0|\*:\*)$/.test(foreign)) continue;
    const localPort = Number(cols[1].slice(cols[1].lastIndexOf(':') + 1));
    // PIDs 0 (Idle) and 4 (System, e.g. http.sys) can't be killed.
    const pid = Number(cols[cols.length - 1]);
    if (localPort === port && pid > 4) pids.push(pid);
  }
  return uniquePids(pids);
}

/**
 * Socket inodes listening on `port`, from Linux `/proc/net/tcp` or `/proc/net/tcp6`.
 * Line format: `sl local_address rem_address st ... uid timeout inode`, with the port in hex
 * and state `0A` meaning LISTEN.
 */
export function parseProcNetTcp(content: string, port: number): string[] {
  const inodes: string[] = [];
  for (const line of content.split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 10 || cols[3] !== '0A') continue;
    const localPort = parseInt(cols[1].split(':')[1] ?? '', 16);
    if (localPort === port && cols[9] !== '0') inodes.push(cols[9]);
  }
  return inodes;
}

function uniquePids(pids: number[]): number[] {
  return [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
}
