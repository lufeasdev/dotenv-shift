import { type EnvEntry, parseEnv } from './envParser';

export interface EnvDiff {
  /** Keys present in the example but missing from the env file (example order). */
  missing: EnvEntry[];
  /** Keys present in the env file but not in the example. */
  extra: EnvEntry[];
}

export function diffEnv(exampleText: string, envText: string): EnvDiff {
  const example = parseEnv(exampleText);
  const env = parseEnv(envText);
  const exampleKeys = new Set(example.map((e) => e.key));
  const envKeys = new Set(env.map((e) => e.key));

  return {
    missing: dedupe(example.filter((e) => !envKeys.has(e.key))),
    extra: dedupe(env.filter((e) => !exampleKeys.has(e.key))),
  };
}

/**
 * Text to append to `envText` so it contains `entries`, using the example's raw values
 * as defaults.
 */
export function buildAppendText(envText: string, entries: EnvEntry[]): string {
  if (entries.length === 0) return '';
  // Keep the file's line endings (CRLF on many Windows checkouts).
  const eol = envText.includes('\r\n') ? '\r\n' : '\n';
  const prefix = envText.length === 0 || envText.endsWith('\n') ? '' : eol;
  const lines = entries.map((e) => `${e.key}=${e.raw.replace(/\r?\n/g, eol)}`);
  return `${prefix}${eol}# added by Env Switcher${eol}${lines.join(eol)}${eol}`;
}

function dedupe(entries: EnvEntry[]): EnvEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.key) && seen.add(e.key));
}

/** How an env file differs from a base, by key and value (comments, spacing and order don't count). */
export interface EnvChanges {
  /** Keys whose value differs. */
  changed: string[];
  /** Keys only in the compared file. */
  added: string[];
  /** Keys only in the base. */
  removed: string[];
}

export function compareEnv(baseText: string, text: string): EnvChanges {
  const base = toMap(baseText);
  const other = toMap(text);
  return {
    changed: [...other].filter(([k, v]) => base.has(k) && base.get(k) !== v).map(([k]) => k),
    added: [...other.keys()].filter((k) => !base.has(k)),
    removed: [...base.keys()].filter((k) => !other.has(k)),
  };
}

export function hasChanges(changes: EnvChanges): boolean {
  return changes.changed.length + changes.added.length + changes.removed.length > 0;
}

export interface ChangeLabels {
  changed: string;
  added: string;
  removed: string;
}

/** e.g. `changed: DATABASE_URL · added: FEATURE_X · removed: DEBUG` (labels can be localised). */
export function describeChanges(
  changes: EnvChanges,
  labels: ChangeLabels = { changed: 'changed', added: 'added', removed: 'removed' },
): string {
  return [
    changes.changed.length ? `${labels.changed}: ${changes.changed.join(', ')}` : '',
    changes.added.length ? `${labels.added}: ${changes.added.join(', ')}` : '',
    changes.removed.length ? `${labels.removed}: ${changes.removed.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
}

/** Key → value; a key declared twice keeps its last value, like dotenv loaders. */
function toMap(text: string): Map<string, string> {
  return new Map(parseEnv(text).map((e) => [e.key, e.value]));
}
