# Dotenv Shift

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/lufeasdev/dotenv-shift/actions/workflows/ci.yml/badge.svg)](https://github.com/lufeasdev/dotenv-shift/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](package.json)

Switch `.env` files from the status bar, for a single project or every app of a monorepo. Dotenv
Shift keeps each env in sync with `.env.example`, notices when `.env` is edited by hand, and
restarts your app after a switch, freeing its port first.

Everything is configured in one `dotenv-shift.json` per project, so the setup can be committed
and shared with the team.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Monorepos](#monorepos)
- [How it works](#how-it-works)
- [Security](#security)
- [Platform support](#platform-support)
- [Commands](#commands)
- [Keybindings](#keybindings)
- [Settings](#settings)
- [API for other extensions](#api-for-other-extensions)
- [Contributing](#contributing)

## Features

- **Switch envs** from the status bar. The chosen file (e.g. `.env.staging`) is copied to the
  target (`.env`). Each env has a title, an optional description, and can require confirmation.
- **Validate against `.env.example`.** Missing keys appear in the Problems panel and the picker,
  with quick fixes that add them using the example's values. Keys that aren't in the example are
  reported too.
- **Restart the app** in a dedicated terminal after switching.
- **Kill the port** before starting again, so you never hit `EADDRINUSE`.
- **Default env** applied automatically when `.env` doesn't exist yet, e.g. after cloning.
- **Track hand edits.** If `.env` is edited directly, the status bar shows `(modified)` and you
  can diff, save the edits to the env file, or discard them.
- **Monorepos:** switch all apps at once or one at a time, including env files at the repo root,
  with per-app file names and app-only envs.
- **Windows, macOS and Linux**, locally and in Remote (WSL, SSH, Dev Containers).

## Quick start

1. Install the extension and open your project.
2. Run **Dotenv Shift: Create Config** from the Command Palette. It generates
   `dotenv-shift.json` from the `.env*` files it finds (and detects monorepos).
3. Adjust the file, then click the env name in the status bar to switch.

A minimal config:

```json
{
  "envs": [
    { "file": ".env.local" },
    { "file": ".env.production" }
  ]
}
```

## Configuration

`dotenv-shift.json` lives at the root of the workspace folder. VS Code offers autocomplete and
validation while you edit it.

### Single repo example

```jsonc
{
  "target": ".env",
  "example": ".env.example",
  "default": "Local",
  "envs": [
    { "title": "Local", "description": "Local Postgres, debug on", "file": ".env.local" },
    { "title": "Development", "description": "Shared dev database", "file": ".env.development" },
    { "title": "Staging", "description": "Shared with QA", "file": ".env.staging" },
    { "title": "Production", "description": "Live database", "file": ".env.production", "confirm": true }
  ],
  "restart": {
    "command": "pnpm dev",
    "killPorts": ["PORT"]
  }
}
```

### Top-level fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `target` | string | `".env"` | File the selected env is copied to. |
| `example` | string | none | Reference file. Every env is checked against its keys. Without it, validation is off. |
| `default` | string | none | Title or file of the env applied when the target doesn't exist. See [Default env](#default-env). |
| `envs` | array | required* | Envs to switch between, in picker order. *Optional in a monorepo when every app defines its own. |
| `restart` | object | none | Restarts the app after switching. In a monorepo, a command run from the root. |
| `apps` | array | none | Turns the project into a monorepo. See [Monorepos](#monorepos). |

### `envs[]`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `file` | string | required | Path of the env file. |
| `title` | string | file name | Name shown in the picker and status bar. Envs with the same title are switched together across apps. |
| `description` | string | none | Shown under the title in the picker and in the status bar tooltip. |
| `confirm` | boolean | `false` | Ask before switching. Such an env is never applied automatically as the default. |

### `restart`

Without `restart` (or without `command`), switching only copies files.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `command` | string | none | Command that starts the app, e.g. `pnpm dev`, `npm run dev`, `php artisan serve`. |
| `enabled` | boolean | `true` | Set to `false` to turn restarting off without removing the command. |
| `terminalName` | string | `Dotenv Shift: <app or folder name>` | Name of the app terminal. |
| `cwd` | string | project or app folder | Working directory of the command. |
| `startIfNotRunning` | boolean | `true` | Start the app when its terminal isn't open yet. With `false`, only running apps are restarted. |
| `killPorts` | array | `["PORT"]` | Ports to free before starting: port numbers, or env keys holding one (read from the old and the new env). `[]` turns it off. |
| `mode` | string | `"auto"` | How the app is stopped: `ctrlC` sends Ctrl+C and reuses the terminal (scrollback is kept); `recreate` closes the terminal and opens a new one; `auto` is `recreate` on Windows and `ctrlC` elsewhere. |

### Comments and trailing commas

The file is treated as JSON with comments (JSONC): `//` and `/* */` comments and trailing commas
are allowed, and syntax errors are reported with their line number.

### Paths

`target`, `example`, `file` and `cwd` are relative to the workspace folder, or to the app's `dir`
in a monorepo. Absolute paths work too, subfolders are fine (`"file": "envs/.env.staging"`), and
both `/` and `\` are accepted on every OS.

The active env is stored in VS Code's workspace state, not in the config.

## Monorepos

Add `"apps"` to switch several folders together. The top-level `envs` are shared: each `file` is
looked up inside every app's `dir`, and `target` and `example` are relative to each app.

```
my-monorepo/
├── dotenv-shift.json
├── .env.example  .env.local  .env.staging  .env.production          root
└── apps/
    ├── web/   .env.example  .env.local  .env.staging  .env.production
    └── api/   .env.example  .env.local  .env.staging  .env.production  .env.mock
```

```jsonc
{
  "example": ".env.example",
  "default": "Local",
  "envs": [
    { "title": "Local", "file": ".env.local" },
    { "title": "Staging", "file": ".env.staging" },
    { "title": "Production", "file": ".env.production", "confirm": true }
  ],
  "apps": [
    { "name": "root", "dir": "." },
    { "dir": "apps/web", "restart": { "command": "pnpm dev" } },
    {
      "dir": "apps/api",
      "restart": { "command": "pnpm start:dev", "killPorts": ["PORT", 9229] },
      "envs": [{ "title": "Mock", "description": "In-memory database", "file": ".env.mock" }]
    }
  ]
}
```

### `apps[]`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `dir` | string | required | App folder, relative to the workspace folder. `"."` is the repo root. |
| `name` | string | last folder of `dir` (`root` for `"."`) | Shown in the picker, messages and terminal title. |
| `target` | string | top-level `target` | Overrides the target for this app. |
| `example` | string | top-level `example` | Overrides the example for this app. |
| `restart` | object | none | Restarts this app in its own terminal. `cwd` defaults to `dir`. |
| `envs` | array | none | Per-app changes to the env list, see below. |

### Per-app envs

An app's `envs` only lists what differs from the shared envs:

```jsonc
{
  "dir": "apps/api",
  "envs": [
    { "title": "Staging", "file": ".env.stage" },     // same env, different file name
    { "title": "Development", "file": null },         // api is left out of Development
    { "title": "Mock", "file": ".env.mock" }           // only api has this env
  ]
}
```

- An entry with the **title of a shared env overrides it**: `file`, `description` or `confirm`.
- `"file": null` **leaves the app out** of that env. Switching all apps to it skips this app
  without a warning.
- Any **other title is an env only that app has**.

### Switching all apps or one

In a monorepo the picker has two steps: first the scope, then the env.

1. **All apps**, or one app (`root`, `web`, `api`, …). Each shows its current env.
2. The envs available for that scope. For **All apps** that's every env (one that only some apps
   have switches just those); for one app, its own list. **Back** returns to step 1.

**Dotenv Shift: Switch Environment for One App** skips the "All apps" entry.

- Only the switched apps are restarted: their own `restart`, plus the top-level `restart` if
  there is one.
- The active env is tracked per app. The status bar shows the env when all apps agree, otherwise
  **Mixed**, and the tooltip lists each app's env.
- A top-level `restart` such as `{ "command": "pnpm turbo dev" }` runs from the root, with ports
  read from every app's env.
- On restart, all affected apps are stopped first, then the ports are freed, then everything
  starts again, so apps can't hold each other's ports.

**Create Config** generates a monorepo config when it finds apps with `.env*` files under
`apps/`, `packages/` or `services/`, and includes the root as an app if it has `.env*` files too.

Alternatively, open each app as a folder of a multi-root workspace with its own
`dotenv-shift.json`. Switching then asks which folder first.

## How it works

### Switching

1. The env files are checked against the example. Missing keys open a dialog with **Add Missing
   & Switch** and **Switch Anyway**. Envs with `confirm: true` ask first.
2. If a target was edited by hand, you're asked to **Save & Switch** or **Discard & Switch**.
3. Unsaved edits in the source file are saved, and the file is copied to the target.
4. The app is restarted (see below).

### Validation

Each env file is compared with the example:

- **Missing keys** are warnings in the Problems panel. The quick fix (lightbulb) appends them
  with the example's values, under a `# added by Dotenv Shift` comment, keeping the file's line
  endings.
- **Extra keys** (not in the example) are informational.
- **Dotenv Shift: Validate Env Files** lists every file in the *Dotenv Shift* output channel as
  `[OK]`, `[MISSING]`, `[NOT FOUND]` or `[SKIPPED]`, and offers to add all missing keys.

Files are re-validated as you edit them.

### Detecting the active env and hand edits

The active env is the one whose file has the **same keys and values** as the target. Comments,
spacing, quoting and order don't matter, so a reformatted copy of `.env.staging` still counts as
Staging. If `.env` is replaced by another env's content, the active env follows it.

When `.env` is edited and saved so that it matches no env:

- The active env stays, and the status bar shows it as `Local (modified)` with a warning
  background. The tooltip lists the changes, e.g. `changed: PORT · added: EXTRA`.
- A notification offers **Show Diff**, **Save to `.env.local`** (keep the edits in the env file)
  and **Discard Changes** (restore `.env`). **Dotenv Shift: Show .env Changes** offers the same.
- Switching away asks before overwriting the edits.

Deleting `.env` clears the active env.

### Restarting and freeing ports

1. **Stop:** Ctrl+C in the app terminal (`ctrlC`), or close it, which ends its process tree
   (`recreate`).
2. **Free ports:** anything still listening on a port from `killPorts` is stopped, gracefully
   first and forcefully after a grace period, even if it runs outside VS Code. If a port stays
   busy you get a warning. With `PORT` in `killPorts`, switching from `PORT=3000` to `PORT=3001`
   frees both.
3. **Start:** the command runs in the app terminal, which is created if needed.

Freed ports are logged in the *Dotenv Shift* output channel, e.g. `port 3000: killed PID 12345`.

### Default env

When a target doesn't exist (e.g. right after cloning), the `default` env is copied to it as
soon as the project opens:

- Existing targets are never overwritten, and the app isn't started.
- An env with `confirm: true` is never applied automatically. You get a notification with a
  button to switch instead.
- In a monorepo, each app without a target gets the default.
- **Dotenv Shift: Reset to Default Environment** switches back to it at any time.

## Security

Restart commands come from the workspace's `dotenv-shift.json`. In
[Restricted Mode](https://code.visualstudio.com/docs/editor/workspace-trust) (an untrusted
workspace), restarting and freeing ports are disabled; switching and validating env files still
work. Env values are never written to the log or shown in messages, only key names.

## Platform support

The extension runs on the workspace side (`extensionKind: workspace`), so in WSL, SSH or a Dev
Container it switches files and frees ports on that machine.

| | Find the process on a port | Stop it | `mode: auto` |
| --- | --- | --- | --- |
| Windows | `netstat -ano` (any display language) | `taskkill /T`, then `/F` | `recreate`, avoiding the `Terminate batch job (Y/N)?` prompt of `.cmd` scripts |
| macOS | `lsof` | `SIGTERM`, then `SIGKILL` | `ctrlC` |
| Linux | `lsof`, else `ss`, else `/proc` (no tools needed) | `SIGTERM`, then `SIGKILL` | `ctrlC` |

Tools are also looked up in their usual locations (such as `/usr/sbin`), since editors launched
from a desktop often have a minimal `PATH`.

## Commands

| Command | Description |
| --- | --- |
| Dotenv Shift: Switch Environment | Pick an env (in a monorepo: the scope, then the env), copy it to the target, restart. Also on status bar click. |
| Dotenv Shift: Switch Environment for One App | Monorepo: switch a single app. |
| Dotenv Shift: Show .env Changes | Review hand edits to a target: diff, save to the env file, or discard. |
| Dotenv Shift: Validate Env Files | Check every env file against the example, and add missing keys. |
| Dotenv Shift: Restart App | Restart without switching. |
| Dotenv Shift: Reset to Default Environment | Switch to the `default` env. |
| Dotenv Shift: Create Config (dotenv-shift.json) | Generate a config from the `.env*` files found. |
| Dotenv Shift: Open Config | Open `dotenv-shift.json`. |
| Dotenv Shift: Add Missing Keys to Env File | Append missing keys to an env's file in every app. |

## Keybindings

`dotenvShift.switch` accepts an env title or file, or an object:

```jsonc
// keybindings.json
[
  { "key": "ctrl+alt+e", "command": "dotenvShift.switch" },
  { "key": "ctrl+alt+1", "command": "dotenvShift.switch", "args": "Local" },
  { "key": "ctrl+alt+m", "command": "dotenvShift.switch", "args": { "env": "Mock", "app": "api" } },
  { "key": "ctrl+alt+d", "command": "dotenvShift.showChanges", "args": { "action": "discard" } }
]
```

The object form takes `env` (title or file), `app` (monorepo: switch only that app) and `folder`
(a workspace folder URI, for multi-root workspaces).

`dotenvShift.showChanges` takes `{ "action": "diff" | "save" | "discard", "app", "folder" }` to act
on a hand-edited target without asking.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `dotenvShift.restartDelayMs` | `300` | Delay in ms between Ctrl+C and running the command again (`ctrlC` mode). |

## API for other extensions

```ts
const api = vscode.extensions.getExtension('lufeasdev.dotenv-shift')?.exports;
api?.getStatus();
// { project: 'my-app', apps: [{ name: 'web', env: 'Local', modified: false, changes: undefined }] }
```

`getStatus(folderUri?)` returns each app's active env and whether its target was edited by hand
(with the changed, added and removed keys).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, running tests, architecture overview, and commit conventions.

## License

MIT
