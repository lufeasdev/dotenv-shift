import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/core/config';
import { parseLsofPids, parseNetstatPids, parseProcNetTcp, parseSsPids, resolvePorts } from '../src/core/ports';
import { findListeningPids, findPidsViaProc, killPorts } from '../src/services/portKiller';

describe('resolvePorts', () => {
  it('resolves numbers and env keys from old and new env', () => {
    expect(resolvePorts(['PORT', 9229], ['PORT=3000', 'PORT=3001\nOTHER=1'])).toEqual([3000, 3001, 9229]);
  });

  it('ignores missing keys and invalid values', () => {
    expect(resolvePorts(['PORT', 'API_PORT', 70000], ['PORT=abc', undefined])).toEqual([]);
  });
});

describe('tool output parsers', () => {
  it('parses lsof', () => {
    expect(parseLsofPids('123\n456\n123\n')).toEqual([123, 456]);
  });

  it('parses ss', () => {
    const out = 'LISTEN 0 511 *:3000 *:* users:(("node",pid=4242,fd=21),("node",pid=4243,fd=21))';
    expect(parseSsPids(out)).toEqual([4242, 4243]);
  });

  it('parses netstat', () => {
    const out = [
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1111',
      '  TCP    [::]:3000              [::]:0                 LISTENING       1111',
      '  TCP    0.0.0.0:30001          0.0.0.0:0              LISTENING       2222',
      '  TCP    127.0.0.1:3000         127.0.0.1:5555         ESTABLISHED     3333',
    ].join('\r\n');
    expect(parseNetstatPids(out, 3000)).toEqual([1111]);
  });

  it('parses localised netstat output (state column is translated)', () => {
    const out = [
      '  Proto  Lokale Adresse         Remoteadresse          Status           PID',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              ABH\u00d6REN          5555',
      '  TCP    [::1]:3000             [::]:0                 ABH\u00d6REN          5556',
      '  TCP    127.0.0.1:3000         127.0.0.1:61000        HERGESTELLT      7777',
    ].join('\r\n');
    expect(parseNetstatPids(out, 3000)).toEqual([5555, 5556]);
  });

  it('skips Windows system PIDs', () => {
    expect(parseNetstatPids('  TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    4', 80)).toEqual([]);
  });

  it('parses /proc/net/tcp', () => {
    const content = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 123456 1 0000000000000000 100 0 0 10 0',
      '   1: 0100007F:0BB8 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 654321 1 0000000000000000 20 4 30 10 -1',
      '   2: 00000000:0BB9 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111111 1 0000000000000000 100 0 0 10 0',
    ].join('\n');
    expect(parseProcNetTcp(content, 3000)).toEqual(['123456']);
  });
});

describe('restart.killPorts config', () => {
  const base = '{"envs":[{"file":"a"}],"restart":{"command":"x"';
  it('defaults to PORT', () => {
    expect(parseConfig(`${base}}}`).apps[0].restart!.killPorts).toEqual(['PORT']);
  });
  it('accepts numbers, numeric strings and keys', () => {
    expect(parseConfig(`${base},"killPorts":[3000,"8080","VITE_PORT"]}}`).apps[0].restart!.killPorts).toEqual([
      3000,
      8080,
      'VITE_PORT',
    ]);
  });
  it('can be disabled', () => {
    expect(parseConfig(`${base},"killPorts":[]}}`).apps[0].restart!.killPorts).toEqual([]);
  });
  it('rejects invalid entries', () => {
    expect(() => parseConfig(`${base},"killPorts":[0]}}`)).toThrow(/killPorts\[0\]/);
  });
  it('reads the restart mode', () => {
    expect(parseConfig(`${base}}}`).apps[0].restart!.mode).toBe('auto');
    expect(parseConfig(`${base},"mode":"recreate"}}`).apps[0].restart!.mode).toBe('recreate');
    expect(parseConfig(`${base},"mode":"bogus"}}`).apps[0].restart!.mode).toBe('auto');
  });
});

describe('killPorts (real process)', () => {
  it('kills a server listening on a port', async () => {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [
      '-e',
      `require('http').createServer(()=>{}).listen(${port}, () => console.log('ready'))`,
    ]);
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
    });

    expect(await findListeningPids(port)).toContain(child.pid);

    const exited = new Promise((resolve) => child.once('exit', resolve));
    const results = await killPorts([port]);
    expect(results).toEqual([{ port, pids: [child.pid], stillInUse: false }]);
    await exited;
    expect(await findListeningPids(port)).toEqual([]);
  }, 15000);

  it.runIf(process.platform === 'linux')(
    'finds the listener via /proc without lsof/ss',
    async () => {
      const port = 40000 + Math.floor(Math.random() * 20000);
      const child = spawn(process.execPath, [
        '-e',
        `require('net').createServer().listen(${port}, () => console.log('ready'))`,
      ]);
      await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
      try {
        expect(await findPidsViaProc(port)).toContain(child.pid);
      } finally {
        child.kill();
      }
    },
    15000,
  );

  it('does nothing for a free port', async () => {
    expect(await killPorts([1])).toEqual([]);
  });
});
