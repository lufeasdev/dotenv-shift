// Runs the integration suite in a real VS Code against a temporary copy of sample-monorepo.
// Uses VSCODE_EXECUTABLE when set (a locally installed VS Code), otherwise downloads one.

import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = await mkdtemp(join(tmpdir(), 'dotenv-switcher-it-'));
const workspace = join(tmp, 'workspace');

try {
  await cp(join(root, 'sample-monorepo'), workspace, {
    recursive: true,
    // Start without any active env so the default gets applied.
    filter: (src) => !/[\\/]\.env$/.test(src),
  });

  const configPath = join(workspace, 'dotenv-switcher.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const app = (name) => config.apps.find((a) => (a.name ?? a.dir.split('/').pop()) === name);

  // No restarts: the suite must not start servers or kill processes on the developer's ports.
  for (const a of config.apps) delete a.restart;
  delete config.restart;

  // Per-app overrides on top of the sample: api names its Staging file differently, and root and
  // api opt out of Development.
  await rename(join(workspace, 'apps/api/.env.staging'), join(workspace, 'apps/api/.env.stage'));
  await rm(join(workspace, '.env.development'));
  await rm(join(workspace, 'apps/api/.env.development'));
  app('root').envs = [{ title: 'Development', file: null }];
  app('api').envs = [
    { title: 'Staging', file: '.env.stage' },
    { title: 'Development', file: null },
    ...app('api').envs,
  ];
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // Make Staging complete so switching to it doesn't open a (blocking) modal.
  await writeFile(
    join(workspace, 'apps/web/.env.staging'),
    'APP_NAME=Web (staging)\nPORT=3002\nAPI_URL=x\nDEBUG=false\n',
  );

  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || undefined,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'test/integration/suite.cjs'),
    extensionTestsEnv: { DOTENV_SWITCHER_IT_WORKSPACE: workspace },
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--user-data-dir',
      join(tmp, 'user-data'),
      '--disable-workspace-trust',
    ],
  });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
