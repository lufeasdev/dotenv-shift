import { describe, expect, it } from 'vitest';
import { buildAppendText, compareEnv, describeChanges, diffEnv, hasChanges } from '../src/core/diff';

describe('diffEnv', () => {
  it('finds missing and extra keys', () => {
    const diff = diffEnv('A=1\nB=2\nC=3', 'A=x\nD=y');
    expect(diff.missing.map((e) => e.key)).toEqual(['B', 'C']);
    expect(diff.extra.map((e) => e.key)).toEqual(['D']);
  });

  it('builds append text with example defaults', () => {
    const { missing } = diffEnv('A=1\nB="two words"', 'A=x');
    expect(buildAppendText('A=x', missing)).toBe('\n\n# added by Dotenv Switcher\nB="two words"\n');
    expect(buildAppendText('A=x\n', missing)).toBe('\n# added by Dotenv Switcher\nB="two words"\n');
    expect(buildAppendText('A=x', [])).toBe('');
  });

  it('keeps CRLF line endings', () => {
    const { missing } = diffEnv('A=1\r\nB=2\r\n', 'A=x\r\n');
    expect(buildAppendText('A=x\r\n', missing)).toBe('\r\n# added by Dotenv Switcher\r\nB=2\r\n');
  });
});

describe('compareEnv', () => {
  it('ignores comments, spacing, quotes style and order', () => {
    const base = '# db\nA=1\nB="two"\n';
    const same = 'B=two\n\n  A = 1   # inline\n';
    expect(hasChanges(compareEnv(base, same))).toBe(false);
  });

  it('reports changed, added and removed keys', () => {
    const changes = compareEnv('A=1\nB=2\nC=3', 'A=1\nB=20\nD=4');
    expect(changes).toEqual({ changed: ['B'], added: ['D'], removed: ['C'] });
    expect(describeChanges(changes)).toBe('changed: B  ·  added: D  ·  removed: C');
  });

  it('uses the last value of a duplicated key', () => {
    expect(hasChanges(compareEnv('A=2', 'A=1\nA=2'))).toBe(false);
  });
});
