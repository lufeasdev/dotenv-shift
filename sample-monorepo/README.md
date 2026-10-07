# Sample: monorepo

Three apps switched by one `dotenv-switcher.json`: the repo root (`.`), `apps/web` and `apps/api`.
`web` and `api` each run a tiny `server.js` that prints its env. Open it with F5,
"Run Extension (sample-monorepo)", or `pnpm dev:monorepo` from the extension folder.

| App | Envs | Ports (Local / Development / Staging / Production) |
| --- | --- | --- |
| root | Local, Development, Staging, Production | none (no restart) |
| web | Local, Development, Staging, Production | 3000 / 3001 / 3002 / 8080 |
| api | Local, Development, Staging, Production, **Mock** (api only) | 4000 / 4001 / 4002 / 9090, Mock 4100 |

`web/.env.staging` is missing `DEBUG` on purpose.

## Things to try

1. Delete `.env`, `apps/web/.env` and `apps/api/.env` before opening: Local is applied to all
   three.
2. Click the status bar, pick **root**, then **Staging**: only the root `.env` changes and the
   status bar shows **Mixed**. Hover it to see each app's env.
3. Pick **api**, then **Mock**: only `apps/api/.env` changes and only the api terminal restarts.
4. Pick **All apps**, then **Staging**: every app switches; you're warned about web's missing key.
5. Use **Back** in step 2 to return to step 1.
6. Run **Dotenv Switcher: Switch Environment for One App**: step 1 lists only the apps.
7. Edit `apps/web/.env` and save: the status bar shows `(modified)`; try
   **Dotenv Switcher: Show .env Changes**.
