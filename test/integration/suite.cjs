// Integration suite, executed inside the VS Code extension host by runTest.mjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const ws = process.env.DOTENV_SWITCHER_IT_WORKSPACE;
const read = (rel) => fs.readFileSync(path.join(ws, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ws, rel));

/** Polls until `fn` stops throwing (file writes and watchers are asynchronous). */
async function eventually(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return fn();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('applies the default env to every app without a target', async () => {
  await eventually(() => {
    assert.equal(read('.env'), read('.env.local'));
    assert.equal(read('apps/web/.env'), read('apps/web/.env.local'));
    assert.equal(read('apps/api/.env'), read('apps/api/.env.local'));
  });
});

test('switches every app at once, using per-app file overrides', async () => {
  await vscode.commands.executeCommand('dotenvSwitcher.switch', 'Staging', folderUri());
  await eventually(() => {
    assert.equal(read('.env'), read('.env.staging'));
    assert.equal(read('apps/web/.env'), read('apps/web/.env.staging'));
    assert.equal(read('apps/api/.env'), read('apps/api/.env.stage'));
  });
});

test('switches one app to its own env, leaving the others alone', async () => {
  await vscode.commands.executeCommand('dotenvSwitcher.switch', 'Mock', folderUri(), 'api');
  await eventually(() => assert.equal(read('apps/api/.env'), read('apps/api/.env.mock')));
  assert.equal(read('apps/web/.env'), read('apps/web/.env.staging'));
  assert.equal(read('.env'), read('.env.staging'));
});

test('accepts keybinding-style object args', async () => {
  await vscode.commands.executeCommand('dotenvSwitcher.switch', { env: 'Local', app: 'web' });
  await eventually(() => assert.equal(read('apps/web/.env'), read('apps/web/.env.local')));
  assert.equal(read('apps/api/.env'), read('apps/api/.env.mock'));
  await vscode.commands.executeCommand('dotenvSwitcher.switch', { env: 'Staging', app: 'web' });
  await eventually(() => assert.equal(read('apps/web/.env'), read('apps/web/.env.staging')));
});

test('skips apps that opted out of a shared env', async () => {
  await vscode.commands.executeCommand('dotenvSwitcher.switch', 'Development', folderUri());
  await eventually(() => assert.equal(read('apps/web/.env'), read('apps/web/.env.development')));
  assert.equal(read('apps/api/.env'), read('apps/api/.env.mock'), 'api opted out of Development');
  assert.equal(read('.env'), read('.env.staging'), 'root opted out of Development');
  assert.ok(!exists('apps/api/.env.development'));
});

test('adds missing keys from the example', async () => {
  const file = path.join(ws, 'apps/web/.env.local');
  fs.writeFileSync(file, 'APP_NAME=Web\nPORT=3000\n');
  await vscode.commands.executeCommand('dotenvSwitcher.addMissingKeys', vscode.Uri.file(file));
  await eventually(() => {
    const text = read('apps/web/.env.local');
    assert.match(text, /^API_URL=/m);
    assert.match(text, /^DEBUG=false$/m);
  });
});

test('concurrent switches run one after the other', async () => {
  // Fired together: without serialising, their copies could interleave app by app.
  await Promise.all([
    vscode.commands.executeCommand('dotenvSwitcher.switch', 'Local', folderUri()),
    vscode.commands.executeCommand('dotenvSwitcher.switch', 'Staging', folderUri()),
  ]);
  assert.equal(read('.env'), read('.env.staging'));
  assert.equal(read('apps/web/.env'), read('apps/web/.env.staging'));
  assert.equal(read('apps/api/.env'), read('apps/api/.env.stage'));
  assert.deepEqual(
    api.getStatus(folderUri()).apps.map((a) => a.env),
    ['Staging', 'Staging', 'Staging'],
  );
});

const status = (app) => api.getStatus(folderUri()).apps.find((a) => a.name === app);

test('a reformatted copy of another env is detected as that env', async () => {
  // Same keys and values as web's .env.production, but reordered with comments and spacing.
  write(
    'apps/web/.env',
    '# copied by hand\nDEBUG=false\n\nAPI_URL = https://api.example.invalid\nPORT=8080\nAPP_NAME="Web (production)"\n',
  );
  await eventually(() =>
    assert.deepEqual(pick(status('web'), 'env', 'modified'), { env: 'Production', modified: false }),
  );
});

test('a hand edit keeps the active env and marks the target modified', async () => {
  write('apps/web/.env', `${read('apps/web/.env.production').replace('PORT=8080', 'PORT=9999')}EXTRA=1\n`);
  await eventually(() => {
    const web = status('web');
    assert.equal(web.env, 'Production');
    assert.equal(web.modified, true);
    assert.deepEqual(web.changes, { changed: ['PORT'], added: ['EXTRA'], removed: [] });
  });
});

test('Show .env Changes with action "discard" restores the target', async () => {
  await vscode.commands.executeCommand('dotenvSwitcher.showChanges', { app: 'web', action: 'discard' });
  await eventually(() => {
    assert.equal(read('apps/web/.env'), read('apps/web/.env.production'));
    assert.equal(status('web').modified, false);
  });
});

test('Show .env Changes with action "save" copies the edits to the env file', async () => {
  write('apps/web/.env', read('apps/web/.env.production').replace('PORT=8080', 'PORT=8181'));
  await eventually(() => assert.equal(status('web').modified, true));
  await vscode.commands.executeCommand('dotenvSwitcher.showChanges', { app: 'web', action: 'save' });
  await eventually(() => {
    assert.match(read('apps/web/.env.production'), /^PORT=8181$/m);
    assert.equal(status('web').modified, false);
    assert.equal(status('web').env, 'Production');
  });
});

function write(rel, text) {
  fs.writeFileSync(path.join(ws, rel), text);
}

function pick(obj, ...keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

function folderUri() {
  return vscode.workspace.workspaceFolders[0].uri.toString();
}

let api;

exports.run = async function run() {
  api = await vscode.extensions.getExtension('lufeasdev.dotenv-switcher').activate();
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${name}\n${err.stack ?? err}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} integration tests passed`);
  if (failed) throw new Error(`${failed} integration test(s) failed`);
};
