# Changelog

## 0.1.0

First public release of Dotenv Shift for VS Code.

### Switching
- Switch env files from the status bar using `dotenv-shift.json`: title, description, and optional confirmation per env.
- Automatic `default` env fallback when `.env` is missing (respects `confirm` safeguards).
- Direct command and keybinding support with arguments (`env`, `app`, `folder`).

### Validation & Sync
- Validate `.env` files against `.env.example` with real-time feedback in Problems panel and pickers.
- Quick fixes to add missing keys using example default values while preserving line endings.
- Report unexpected keys not present in `.env.example`.

### Active Env & Manual Edits
- Content-based active env detection (ignores formatting/spacing differences).
- Real-time watcher tracking manual edits (`(modified)` indicator in status bar).
- `Show .env Changes` command supporting diff review, saving changes back to source, or discarding edits.
- Direct keybinding action arguments for `{ "action": "diff" | "save" | "discard" }`.

### Process Management & Ports
- Automated app restart in dedicated terminals upon switching.
- Automated port freeing (`killPorts`) before restarting to prevent `EADDRINUSE`.
- Cross-platform port detection (Linux `/proc` and `ss`, macOS `lsof`, Windows locale-independent `netstat`).

### Monorepo Support
- Manage root and multi-package workspaces (`apps/`, `packages/`, `services/`).
- Per-app `target`, `example`, and `restart` configurations with optional root-level restart.
- Per-app env overrides and opt-outs (`"file": null`).
- Interactive two-step pickers (scope selection, then environment).

### Developer Experience & Security
- Strict Conventional Commits enforcement with commitlint and git hooks.
- Workspace Trust integration: disables arbitrary restart commands and port termination in Restricted Mode.
- Full localization readiness (`vscode.l10n`).
- JSON schema for `dotenv-shift.json` validation and autocomplete.
- Public extension API (`getStatus()`).
