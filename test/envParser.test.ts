import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/core/envParser';

describe('parseEnv', () => {
  it('parses keys, skips comments and blank lines', () => {
    const entries = parseEnv('# comment\n\nA=1\nexport B = two\n  C=\n');
    expect(entries.map((e) => [e.key, e.value, e.line])).toEqual([
      ['A', '1', 2],
      ['B', 'two', 3],
      ['C', '', 4],
    ]);
  });

  it('strips inline comments from unquoted values only', () => {
    const [a, b] = parseEnv('A=foo # note\nB="foo # not a comment"');
    expect(a.value).toBe('foo');
    expect(b.value).toBe('foo # not a comment');
    expect(b.raw).toBe('"foo # not a comment"');
  });

  it('handles multiline quoted values', () => {
    const entries = parseEnv('KEY="-----BEGIN\nabc\n-----END"\nNEXT=1');
    expect(entries.map((e) => e.key)).toEqual(['KEY', 'NEXT']);
    expect(entries[0].value).toBe('-----BEGIN\nabc\n-----END');
    expect(entries[1].line).toBe(3);
  });

  it('handles escaped quotes and CRLF', () => {
    const entries = parseEnv('A="say \\"hi\\""\r\nB=2\r\n');
    expect(entries.map((e) => e.key)).toEqual(['A', 'B']);
    expect(entries[0].value).toBe('say \\"hi\\"');
  });
});
