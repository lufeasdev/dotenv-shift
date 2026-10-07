# Changelog

## 0.1.0

First release.

### Switching
- Switch env files from the status bar using `env-switcher.json`: a title, optional description
  and optional confirmation per env.
- `default` env, applied automatically when the target doesn't exist (never for envs with
  `confirm`); `Reset to Default Environment` command.
- Keybinding arguments: an env title or file, or `{ "env", "app", "folder" }`.

### Validation
- Env files are checked against an example file; missing keys appear in the Problems panel and
  the picker, with quick fixes that add them using the example's values (keeping line endings).
- `Validate Env Files` and `Add Missing Keys to Env File` commands.

### Active env and hand edits
- The active env is detected by keys and values, so formatting differences don't matter.
- Hand edits to a target mark it `(modified)` with the changed keys; `Show .env Changes` offers
  a diff, saving the edits to the env file, or discarding them (also as a keybinding with
  `{ "action": "diff" | "save" | "discard" }`); switching asks before overwriting edits.

### Restart and ports
- Restart the app in a dedicated terminal after switching (`restart`), stopping it with Ctrl+C
  or by recreating the terminal (`mode`, `recreate` by default on Windows).
- Free the app's ports before starting (`killPorts`, default `["PORT"]`), reading ports from the
  old and the new env.

### Monorepos
- `apps`: switch every app's env files together, with per-app `target`, `example` and `restart`,
  plus an optional root `restart`. All apps are stopped before ports are freed and apps start.
- Root env files via `"dir": "."`.
- Per-app `envs`: override a shared env's file, leave an app out (`"file": null`), or add
  app-only envs.
- Two-step picker (scope, then env) and `Switch Environment for One App`; the active env is
  tracked per app ("Mixed" in the status bar).
- `Create Config` detects monorepos under `apps/`, `packages/` and `services/`.

### Platforms
- Windows, macOS and Linux: locale-independent `netstat` parsing on Windows, fallbacks for
  `lsof`/`ss` outside `PATH`, a `/proc` fallback on Linux, `/` or `\` in config paths.
- Runs on the workspace side in Remote (WSL, SSH, Dev Containers).

### Security
- Workspace Trust: restarting and freeing ports are disabled in Restricted Mode.

### Other
- Ready for localization: UI text uses `vscode.l10n`, manifest strings are in `package.nls.json`.
- `env-switcher.json` is JSON with comments: comments and trailing commas are allowed, and syntax
  errors report their line.
- JSON schema for `env-switcher.json` (autocomplete and validation).
- `getStatus()` API for other extensions.
- Unit and integration tests, CI on Linux, macOS and Windows.
