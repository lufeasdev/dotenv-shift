# Contributing to Dotenv Shift

## Development

Requirements for development: [mise](https://mise.jdx.dev) (installs the Node.js and pnpm versions
pinned in `mise.toml`) and VS Code 1.90+. Without mise: Node.js 22.12+ and pnpm 12.

```sh
mise install
pnpm install
pnpm compile             # bundle with rolldown (or: pnpm watch)
pnpm typecheck
pnpm test                # unit tests (vitest)
pnpm test:integration    # integration tests in a real VS Code
pnpm package             # build dotenv-shift-<version>.vsix
```

### Trying it out

| | Single repo | Monorepo |
| --- | --- | --- |
| Folder | `sample/` | `sample-monorepo/` |
| Debugger (F5) | "Run Extension (sample)" | "Run Extension (sample-monorepo)" |
| Without debugger | `pnpm dev` | `pnpm dev:monorepo` |

Other extensions are disabled in that window so they can't crash the debug host. Each sample has
a README listing what to try. Delete the generated `.env` files to see the default env applied
again.

### Tests

- **Unit tests** (`test/*.test.ts`, vitest) cover the env parser, config parsing, key and value
  comparison, port handling (including stopping a real process listening on a port), the
  project model, the active env store, the session's operation queue, and the pickers' two-step
  flow (driven by a fake QuickPick UI). Modules that import `vscode` get a small mock
  (`test/mocks/vscode.ts`, wired in `vitest.config.ts`).
- **Integration tests** (`test/integration/`) start VS Code on a temporary copy of
  `sample-monorepo` (without restarts, so nothing touches your ports) and run the commands with
  arguments, so they don't depend on keyboard timing. Set `VSCODE_EXECUTABLE` to use an installed VS Code, e.g.
  `VSCODE_EXECUTABLE=/usr/share/code/code pnpm test:integration`; otherwise one is downloaded.
- **CI** (`.github/workflows/ci.yml`) runs typecheck, both test suites and the build on Linux,
  macOS and Windows.

### Code quality

```sh
pnpm lint       # Biome: lint + formatting check (also run in CI)
pnpm format     # apply formatting and safe fixes
pnpm check      # typecheck + lint + unit tests
```

Recommended editor setup is in `.vscode/` (Biome formats on save), and `.editorconfig` covers
other editors.

### Architecture

Layers only depend on the layers below them:

```
extension.ts      wiring: creates the services, registers commands, returns the API
commands.ts       command handlers (each failure is logged and reported, never unhandled)
ui/               status bar, pickers, quick fixes, prompts for hand-edited targets
workspace.ts      one session per workspace folder with a config; reloads on change
session.ts        a loaded project: file watchers, hand-edit tracking, revalidation,
                  and a queue that serialises file-changing operations
state.ts          active env per app, kept in VS Code's workspace state
services/         switching, validation, restart, port killing, missing keys, Create Config
project.ts        Project and App models, path resolution, file reading
core/             pure logic with no VS Code dependency (config, env parser, diff, ports)
```

- `core/` must not import `vscode`, so it stays unit-testable with plain vitest.
- Per-project state lives in `ProjectSession`; disposing the session releases its watchers and
  timers, so reloading a config can't leak them.
- Operations that write files go through `session.exclusive()`, so overlapping commands (a
  double-clicked switch, a switch during a discard) run one after the other.
- Command IDs are in `constants.ts`; `package.json` declares the same IDs.

### Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org), short and plain:

```
feat: add per-app envs
fix: keep crlf when adding keys
docs: explain monorepo picker
refactor: split commands from extension
test: cover concurrent switches
chore: bump rolldown
ci: run lint on windows
```

- Format: `type: what changed`, lower case, at most 72 characters; add a body only when the
  why isn't obvious.
- Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `style`,
  `revert`.
- No AI co-author trailers.

`pnpm install` sets up a `commit-msg` hook that checks this with commitlint
(`commitlint.config.mjs`); pull requests are checked in CI too.

### Localization

User-facing text goes through `vscode.l10n.t()`, and `package.json` strings live in
`package.nls.json`. Log messages stay in English.

```sh
pnpm l10n      # regenerate l10n/bundle.l10n.json from the l10n.t() calls in src/
```

To add a language, copy `l10n/bundle.l10n.json` to `l10n/bundle.l10n.<locale>.json` and
`package.nls.json` to `package.nls.<locale>.json` (e.g. `id`, `de`), then translate the values.

### Adding a feature

- **A config option:** add it to the types and parsing in `src/core/config.ts` (with a unit test
  in `test/config.test.ts`), to `schemas/dotenv-shift.schema.json`, and to the README tables.
- **A command:** add the ID to `src/constants.ts`, to `package.json` (`contributes.commands`)
  with its title in `package.nls.json`, a method to `CommandHandlers`, and its registration in
  `registerCommands`.
- **User-facing text:** wrap it in `vscode.l10n.t()` and run `pnpm l10n`.
- **Behaviour across commands** (e.g. something on every switch): `CommandHandlers.doSwitch`.
