import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/core/config';

describe('parseConfig', () => {
  it('applies defaults and allows comments', () => {
    const config = parseConfig(`{
      // comment
      "envs": [{ "file": ".env.local" }, { "title": "Prod", "file": ".env.prod", "confirm": true }],
      "restart": { "command": "pnpm dev" }
    }`);
    expect(config.monorepo).toBe(false);
    expect(config.apps).toHaveLength(1);
    expect(config.apps[0]).toMatchObject({ dir: '.', target: '.env' });
    expect(config.envs[0].title).toBe('.env.local');
    expect(config.envs[1].confirm).toBe(true);
    expect(config.envs[0].description).toBeUndefined();
    expect(config.apps[0].restart).toMatchObject({ enabled: true, command: 'pnpm dev', startIfNotRunning: true });
  });

  it('reads an optional description', () => {
    const config = parseConfig('{"envs":[{"title":"Staging","description":"  Shared with QA ","file":"a"}]}');
    expect(config.envs[0].description).toBe('Shared with QA');
  });

  it('resolves "default" by title or file', () => {
    const envs = '"envs":[{"title":"Local","file":".env.local"},{"title":"Prod","file":".env.prod"}]';
    expect(parseConfig(`{${envs},"default":"Local"}`).defaultEnv).toBe('Local');
    expect(parseConfig(`{${envs},"default":".env.prod"}`).defaultEnv).toBe('Prod');
    expect(parseConfig(`{${envs}}`).defaultEnv).toBeUndefined();
    expect(() => parseConfig(`{${envs},"default":"Nope"}`)).toThrow(/"default"/);
  });

  it('keeps // inside strings', () => {
    const config = parseConfig('{"envs":[{"file":"a"}],"restart":{"command":"curl http://x"}}');
    expect(config.apps[0].restart?.command).toBe('curl http://x');
  });

  it('rejects invalid configs', () => {
    expect(() => parseConfig('{')).toThrow(/Invalid JSON/);
    expect(() => parseConfig('{"envs":[]}')).toThrow(/non-empty/);
    expect(() => parseConfig('{"envs":[{}]}')).toThrow(/file is required/);
  });

  it('has no restart without a restart section, and disables it without a command', () => {
    expect(parseConfig('{"envs":[{"file":"a"}]}').apps[0].restart).toBeUndefined();
    expect(parseConfig('{"envs":[{"file":"a"}],"restart":{}}').apps[0].restart?.enabled).toBe(false);
  });

  it('names the implicit single-repo app after the folder', () => {
    expect(parseConfig('{"envs":[{"file":"a"}]}', 'my-app').apps[0].name).toBe('my-app');
  });
});

describe('parseConfig (monorepo)', () => {
  const envs = '"envs":[{"title":"Local","file":".env.local"}]';

  it('parses apps with inherited and overridden target/example', () => {
    const config = parseConfig(`{
      ${envs},
      "example": ".env.example",
      "apps": [
        { "dir": "apps/web", "restart": { "command": "pnpm dev" } },
        { "name": "backend", "dir": "apps/api", "target": ".env.runtime", "example": ".env.sample" }
      ],
      "restart": { "command": "pnpm turbo dev", "killPorts": [] }
    }`);
    expect(config.monorepo).toBe(true);
    expect(config.apps).toEqual([
      expect.objectContaining({ name: 'web', dir: 'apps/web', target: '.env', example: '.env.example' }),
      expect.objectContaining({ name: 'backend', dir: 'apps/api', target: '.env.runtime', example: '.env.sample' }),
    ]);
    expect(config.apps[0].restart?.command).toBe('pnpm dev');
    expect(config.apps[1].restart).toBeUndefined();
    expect(config.rootRestart).toMatchObject({ command: 'pnpm turbo dev', killPorts: [] });
  });

  it('derives the app name from a Windows-style dir', () => {
    expect(parseConfig(`{${envs},"apps":[{"dir":"apps\\\\api"}]}`).apps[0].name).toBe('api');
  });

  it('names an app at the repo root "root"', () => {
    expect(parseConfig(`{${envs},"apps":[{"dir":"."},{"dir":"apps/web"}]}`).apps.map((a) => a.name)).toEqual([
      'root',
      'web',
    ]);
  });

  it('merges per-app envs: override file, opt out, app-only env', () => {
    const config = parseConfig(`{
      "envs": [
        { "title": "Local", "file": ".env.local" },
        { "title": "Staging", "file": ".env.staging", "confirm": false },
        { "title": "Development", "file": ".env.development" }
      ],
      "apps": [
        { "dir": "apps/web" },
        { "dir": "apps/api", "envs": [
          { "title": "Staging", "file": ".env.stage", "confirm": true },
          { "title": "Development", "file": null },
          { "title": "Mock", "file": ".env.mock", "description": "Mocked services" }
        ] }
      ]
    }`);
    const [web, api] = config.apps;
    expect(web.envs.map((e) => [e.title, e.file, e.shared])).toEqual([
      ['Local', '.env.local', true],
      ['Staging', '.env.staging', true],
      ['Development', '.env.development', true],
    ]);
    expect(api.envs.map((e) => [e.title, e.file, e.shared])).toEqual([
      ['Local', '.env.local', true],
      ['Staging', '.env.stage', true],
      ['Mock', '.env.mock', false],
    ]);
    expect(api.envs[1].confirm).toBe(true);
    expect(api.envs[2].description).toBe('Mocked services');
    // Overrides don't leak into the shared definition.
    expect(config.envs[1].file).toBe('.env.staging');
  });

  it('allows a monorepo with only per-app envs, and a default from one app', () => {
    const config = parseConfig(`{
      "default": "Mock",
      "apps": [{ "dir": "apps/api", "envs": [{ "title": "Mock", "file": ".env.mock" }] }, { "dir": "apps/web" }]
    }`);
    expect(config.envs).toEqual([]);
    expect(config.apps[1].envs).toEqual([]);
    expect(config.defaultEnv).toBe('Mock');
  });

  it('rejects invalid per-app envs', () => {
    expect(() => parseConfig('{"apps":[{"dir":"a"}]}')).toThrow(/at least one env/);
    expect(() => parseConfig(`{${envs},"apps":[{"dir":"a","envs":[{"file":".x"}]}]}`)).toThrow(
      /apps\[0\]\.envs\[0\]\.title/,
    );
    expect(() => parseConfig(`{${envs},"apps":[{"dir":"a","envs":[{"title":"Mock"}]}]}`)).toThrow(
      /apps\[0\]\.envs\[0\]\.file/,
    );
    expect(() => parseConfig('{"envs":[{"title":"A","file":"1"},{"title":"A","file":"2"}]}')).toThrow(
      /duplicate env title "A"/,
    );
  });

  it('rejects invalid apps', () => {
    expect(() => parseConfig(`{${envs},"apps":[]}`)).toThrow(/non-empty/);
    expect(() => parseConfig(`{${envs},"apps":[{}]}`)).toThrow(/apps\[0\]\.dir/);
    expect(() => parseConfig(`{${envs},"apps":[{"dir":"a/web"},{"dir":"b/web"}]}`)).toThrow(/duplicate app name "web"/);
    expect(() => parseConfig(`{${envs},"apps":[{"dir":"a","restart":{"killPorts":[0]}}]}`)).toThrow(
      /apps\[0\]\.restart\.killPorts\[0\]/,
    );
  });
});

describe('parseConfig (JSON with comments)', () => {
  it('accepts comments and trailing commas', () => {
    const config = parseConfig(`{
      // line comment
      "envs": [
        { "file": ".env.local", }, /* block comment */
      ],
    }`);
    expect(config.envs.map((e) => e.file)).toEqual(['.env.local']);
  });

  it('reports the line of a syntax error', () => {
    expect(() => parseConfig('{\n  "envs": [\n    { "file": ".env.local" }\n  \n')).toThrow(/line \d+/);
    expect(() => parseConfig('{\n  "envs": [ { "file" ".env" } ]\n}')).toThrow(
      /Invalid JSON in env-switcher\.json \(line 2\)/,
    );
  });
});
