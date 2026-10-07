import { type ParseError, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser';
import { isValidPort, type PortSpec } from './ports';

export const CONFIG_FILE = 'dotenv-shift.json';
export const LEGACY_CONFIG_FILES = ['dotenv-switcher.json', 'env-switcher.json'] as const;
export const CONFIG_FILES = [CONFIG_FILE, ...LEGACY_CONFIG_FILES] as const;

export interface EnvDefinition {
  /** Identifies the env; envs with the same title are switched together across apps. */
  title: string;
  /** Free text shown under the title in the picker and in the status bar tooltip. */
  description?: string;
  file: string;
  /** Ask for confirmation before switching (e.g. production). */
  confirm?: boolean;
  /** True for envs from the top-level `envs` (switchable for all apps at once). */
  shared: boolean;
}

/**
 * How a running app is stopped before restarting:
 * - `ctrlC`: send Ctrl+C to the app terminal and reuse it (keeps scrollback).
 * - `recreate`: close the terminal (kills its process tree) and open a fresh one. Avoids the
 *   "Terminate batch job (Y/N)?" prompt of `.cmd` shims on Windows.
 * - `auto`: `recreate` on Windows, `ctrlC` elsewhere.
 */
export type RestartMode = 'auto' | 'ctrlC' | 'recreate';

export interface RestartConfig {
  enabled: boolean;
  command?: string;
  /** Defaults to `Dotenv Shift: <app or folder name>` so projects don't share one terminal. */
  terminalName?: string;
  cwd?: string;
  /** Start the command even if the app terminal isn't open yet. */
  startIfNotRunning: boolean;
  /** Ports to free before starting: numbers, or env keys holding a port (default ["PORT"]). */
  killPorts: PortSpec[];
  mode: RestartMode;
}

/**
 * One app whose env files are switched. A single repo has one implicit app at the root; a
 * monorepo lists them under `"apps"` (use `"dir": "."` to include the repo root).
 */
export interface AppConfig {
  name: string;
  /** App folder, relative to the workspace folder (`.` for the root). */
  dir: string;
  /** Relative to `dir`. */
  target: string;
  /** Relative to `dir`. */
  example?: string;
  /** Restarts this app on its own; `cwd` is relative to `dir`. */
  restart?: RestartConfig;
  /**
   * Envs available for this app: the shared envs (with this app's overrides, minus the ones it
   * opts out of) followed by its own envs. Files are relative to `dir`.
   */
  envs: EnvDefinition[];
}

export interface EnvSwitcherConfig {
  /** True when `"apps"` is set. */
  monorepo: boolean;
  /** Always at least one. */
  apps: AppConfig[];
  /** Shared envs: picking one switches every app that has it. May be empty in a monorepo. */
  envs: EnvDefinition[];
  /** Title of the env applied automatically when a target doesn't exist yet. */
  defaultEnv?: string;
  /** Monorepo only: a command run from the root (e.g. `turbo dev`); `cwd` is relative to the root. */
  rootRestart?: RestartConfig;
}

export class ConfigError extends Error {}

/**
 * Parse and normalise the raw JSON text of `dotenv-shift.json`. `rootName` names the implicit
 * app of a single repo (the workspace folder name).
 */
export function parseConfig(text: string, rootName = 'app'): EnvSwitcherConfig {
  const errors: ParseError[] = [];
  const json: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length) {
    const { error, offset } = errors[0];
    const line = text.slice(0, offset).split('\n').length;
    throw new ConfigError(`Invalid JSON in ${CONFIG_FILE} (line ${line}): ${printParseErrorCode(error)}`);
  }
  if (!isObject(json)) throw new ConfigError(`${CONFIG_FILE} must contain a JSON object`);

  const monorepo = json.apps !== undefined;
  if (json.envs !== undefined && !Array.isArray(json.envs)) {
    throw new ConfigError(`${CONFIG_FILE}: "envs" must be an array`);
  }
  const shared = ((json.envs as unknown[] | undefined) ?? []).map((env, i) => parseEnv(env, `envs[${i}]`, true));
  if (!monorepo && shared.length === 0) {
    throw new ConfigError(`${CONFIG_FILE}: "envs" must be a non-empty array`);
  }
  assertUniqueTitles(shared, 'envs');

  const target = nonEmptyString(json.target) ?? '.env';
  const example = nonEmptyString(json.example);
  const restart = parseRestart(json.restart, 'restart');

  let apps: AppConfig[];
  if (!monorepo) {
    apps = [{ name: rootName, dir: '.', target, example, restart, envs: shared }];
  } else {
    if (!Array.isArray(json.apps) || json.apps.length === 0) {
      throw new ConfigError(`${CONFIG_FILE}: "apps" must be a non-empty array`);
    }
    const names = new Set<string>();
    apps = json.apps.map((app, i): AppConfig => {
      const at = `apps[${i}]`;
      if (!isObject(app) || !nonEmptyString(app.dir)) throw new ConfigError(`${CONFIG_FILE}: ${at}.dir is required`);
      const dir = app.dir as string;
      const name = nonEmptyString(app.name) ?? defaultAppName(dir);
      if (names.has(name)) throw new ConfigError(`${CONFIG_FILE}: duplicate app name "${name}"`);
      names.add(name);
      return {
        name,
        dir,
        // Apps inherit the top-level target/example names unless they override them.
        target: nonEmptyString(app.target) ?? target,
        example: nonEmptyString(app.example) ?? example,
        restart: parseRestart(app.restart, `${at}.restart`),
        envs: appEnvs(shared, app.envs, at),
      };
    });
    if (apps.every((app) => app.envs.length === 0)) {
      throw new ConfigError(`${CONFIG_FILE}: define at least one env in "envs" or in an app's "envs"`);
    }
  }

  let defaultEnv: string | undefined;
  if (json.default !== undefined) {
    const ref = json.default;
    const all = apps.flatMap((app) => app.envs);
    const match =
      typeof ref === 'string' ? (all.find((e) => e.title === ref) ?? all.find((e) => e.file === ref)) : undefined;
    if (!match) throw new ConfigError(`${CONFIG_FILE}: "default" must be the title or file of an env`);
    defaultEnv = match.title;
  }

  return { monorepo, apps, envs: shared, defaultEnv, rootRestart: monorepo ? restart : undefined };
}

/**
 * Merges an app's `envs` into the shared ones. An entry whose title matches a shared env
 * overrides it (`"file": null` opts the app out); any other entry is an app-only env.
 */
function appEnvs(shared: EnvDefinition[], value: unknown, at: string): EnvDefinition[] {
  if (value === undefined) return shared.map((env) => ({ ...env }));
  if (!Array.isArray(value)) throw new ConfigError(`${CONFIG_FILE}: ${at}.envs must be an array`);

  const result = shared.map((env): EnvDefinition | null => ({ ...env }));
  const own: EnvDefinition[] = [];
  value.forEach((entry, i) => {
    const where = `${at}.envs[${i}]`;
    if (!isObject(entry) || !nonEmptyString(entry.title))
      throw new ConfigError(`${CONFIG_FILE}: ${where}.title is required`);
    const index = shared.findIndex((env) => env.title === entry.title);
    if (index === -1) {
      own.push(parseEnv(entry, where, false));
      return;
    }
    if (entry.file === null) {
      result[index] = null;
      return;
    }
    const base = shared[index];
    result[index] = {
      ...base,
      file: nonEmptyString(entry.file) ?? base.file,
      description: nonEmptyString(entry.description)?.trim() ?? base.description,
      confirm: typeof entry.confirm === 'boolean' ? entry.confirm : base.confirm,
    };
  });

  const envs = [...result.filter((env): env is EnvDefinition => env !== null), ...own];
  assertUniqueTitles(envs, `${at}.envs`);
  return envs;
}

function parseEnv(env: unknown, at: string, shared: boolean): EnvDefinition {
  if (!isObject(env) || !nonEmptyString(env.file)) {
    throw new ConfigError(`${CONFIG_FILE}: ${at}.file is required`);
  }
  const file = env.file as string;
  return {
    title: nonEmptyString(env.title) ?? file,
    description: nonEmptyString(env.description)?.trim(),
    file,
    confirm: env.confirm === true,
    shared,
  };
}

function assertUniqueTitles(envs: EnvDefinition[], at: string): void {
  const seen = new Set<string>();
  for (const env of envs) {
    if (seen.has(env.title)) throw new ConfigError(`${CONFIG_FILE}: duplicate env title "${env.title}" in ${at}`);
    seen.add(env.title);
  }
}

function defaultAppName(dir: string): string {
  const last = dir
    .split(/[\\/]/)
    .filter((s) => s && s !== '.')
    .pop();
  return last ?? 'root';
}

function parseRestart(value: unknown, at: string): RestartConfig | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new ConfigError(`${CONFIG_FILE}: "${at}" must be an object`);
  return {
    enabled: value.enabled !== false && typeof value.command === 'string',
    command: typeof value.command === 'string' ? value.command : undefined,
    terminalName: nonEmptyString(value.terminalName),
    cwd: typeof value.cwd === 'string' ? value.cwd : undefined,
    startIfNotRunning: value.startIfNotRunning !== false,
    killPorts: parseKillPorts(value.killPorts, at),
    mode: value.mode === 'ctrlC' || value.mode === 'recreate' ? value.mode : 'auto',
  };
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function parseKillPorts(value: unknown, at: string): PortSpec[] {
  if (value === undefined) return ['PORT'];
  if (value === false || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((spec, i): PortSpec => {
    if (typeof spec === 'number' && isValidPort(spec)) return spec;
    if (typeof spec === 'string' && /^\d+$/.test(spec) && isValidPort(Number(spec))) return Number(spec);
    if (typeof spec === 'string' && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(spec)) return spec;
    throw new ConfigError(`${CONFIG_FILE}: ${at}.killPorts[${i}] must be a port number or an env key name`);
  });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
