# Sample: single repo

A tiny app (`server.js`) that prints the `.env` it was started with. Open it with F5,
"Run Extension (sample)", or `pnpm dev` from the extension folder.

| File | Title | PORT | Note |
| --- | --- | --- | --- |
| `.env.local` | Local | 3000 | default env |
| `.env.development` | Development | 3001 | |
| `.env.staging` | Staging | 3002 | missing `API_KEY` and `DEBUG` on purpose |
| `.env.production` | Production | 8080 | extra `SENTRY_DSN`, asks for confirmation |

## Things to try

1. Delete `.env` before opening: the default env (Local) is applied.
2. Click the env in the status bar and pick **Development**: the terminal
   "Dotenv Shift: sample" restarts `node server.js` on port 3001 and port 3000 is freed.
3. Pick **Staging**: you're warned about the missing keys. **Add Missing & Switch** appends them.
4. Pick **Production**: you're asked to confirm.
5. Edit `.env` (change `PORT`) and save: the status bar shows `(modified)`. Try **Show Diff**,
   **Save to ...** and **Discard Changes**, or switch to see the warning.
6. Open the *Dotenv Shift* output channel to see what happened.
