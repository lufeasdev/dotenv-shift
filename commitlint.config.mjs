// Conventional commits, short ("caveman") style: `type: what changed`, e.g. `fix: keep crlf on add`.
// https://www.conventionalcommits.org
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        // Commits are authored by people; no AI co-author trailers.
        'no-ai-attribution': ({ raw }) => [
          !/co-authored-by:.*(claude|anthropic)|generated with .*claude/i.test(raw ?? ''),
          'remove AI attribution (Co-Authored-By / "Generated with") from the commit message',
        ],
      },
    },
  ],
  rules: {
    'header-max-length': [2, 'always', 72],
    'subject-case': [2, 'always', 'lower-case'],
    'no-ai-attribution': [2, 'always'],
  },
};
