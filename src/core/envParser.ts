export interface EnvEntry {
  key: string;
  /** Unquoted value. */
  value: string;
  /** Value exactly as written after `=` (quotes kept, may span lines). */
  raw: string;
  /** 0-based line where the key is declared. */
  line: number;
}

const KEY_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s?(.*)$/;
const QUOTES = ['"', "'", '`'];

export function parseEnv(text: string): EnvEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: EnvEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = KEY_RE.exec(lines[i]);
    if (!match) continue;

    const key = match[1];
    const line = i;
    let raw = match[2].trimEnd();
    let value: string;

    const quote = QUOTES.find((q) => raw.startsWith(q));
    if (quote) {
      // Find the closing quote, possibly on a later line (multiline value).
      let body = raw.slice(1);
      let close = findClosingQuote(body, quote);
      while (close === -1 && i + 1 < lines.length) {
        i++;
        body += `\n${lines[i]}`;
        close = findClosingQuote(body, quote);
      }
      if (close === -1) close = body.length;
      value = body.slice(0, close);
      raw = quote + body.slice(0, close + 1);
    } else {
      // Unquoted: strip inline comment (" #...").
      const hash = raw.search(/\s#/);
      if (hash !== -1) raw = raw.slice(0, hash).trimEnd();
      value = raw;
    }

    entries.push({ key, value, raw, line });
  }

  return entries;
}

function findClosingQuote(body: string, quote: string): number {
  for (let j = 0; j < body.length; j++) {
    if (body[j] === '\\' && quote === '"') {
      j++;
      continue;
    }
    if (body[j] === quote) return j;
  }
  return -1;
}
