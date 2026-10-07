import * as vscode from 'vscode';
import { configUri } from '../project';

const EXAMPLE_NAMES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];
/** Usual monorepo layouts; each direct subfolder with `.env*` files becomes an app. */
const MONOREPO_ROOTS = ['apps', 'packages', 'services'];

/**
 * Creates a starter `dotenv-switcher.json`: a monorepo config when apps with `.env*` files are
 * found under apps/, packages/ or services/, otherwise a single-repo config from the root.
 */
export async function createConfig(folder: vscode.WorkspaceFolder): Promise<vscode.Uri> {
  const uri = configUri(folder);
  try {
    await vscode.workspace.fs.stat(uri);
    return uri; // already exists
  } catch {
    // create below
  }

  const pm = await detectPackageManager(folder.uri);
  const apps = await findMonorepoApps(folder.uri);
  // Env files at the root of a monorepo (e.g. for docker compose) are switched as the "root" app.
  const rootFiles = await envFilesIn(folder.uri);
  if (apps.length && rootFiles.length) apps.unshift({ dir: '.', uri: folder.uri, files: rootFiles });
  const config = apps.length ? await monorepoConfig(apps, pm) : await singleConfig(folder.uri, pm);

  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${JSON.stringify(config, null, 2)}\n`));
  return uri;
}

async function singleConfig(root: vscode.Uri, pm: string) {
  const files = await envFilesIn(root);
  const example = EXAMPLE_NAMES.find((n) => files.includes(n));
  return {
    target: '.env',
    example: example ?? '.env.example',
    envs: envsFrom(files.filter((n) => n !== '.env' && n !== example)),
    restart: { enabled: true, command: await detectDevCommand(root, pm) },
  };
}

async function monorepoConfig(apps: { dir: string; uri: vscode.Uri; files: string[] }[], pm: string) {
  const allFiles = [...new Set(apps.flatMap((a) => a.files))].sort();
  const example = EXAMPLE_NAMES.find((n) => allFiles.includes(n));
  return {
    target: '.env',
    example: example ?? '.env.example',
    envs: envsFrom(allFiles.filter((n) => n !== '.env' && n !== example)),
    apps: await Promise.all(
      apps.map(async (app) =>
        app.dir === '.'
          ? { name: 'root', dir: '.' }
          : { name: app.dir.split('/').pop(), dir: app.dir, restart: { command: await detectDevCommand(app.uri, pm) } },
      ),
    ),
  };
}

async function findMonorepoApps(root: vscode.Uri): Promise<{ dir: string; uri: vscode.Uri; files: string[] }[]> {
  const apps: { dir: string; uri: vscode.Uri; files: string[] }[] = [];
  for (const base of MONOREPO_ROOTS) {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, base));
    } catch {
      continue;
    }
    for (const [name, type] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      if (type !== vscode.FileType.Directory) continue;
      const uri = vscode.Uri.joinPath(root, base, name);
      const files = await envFilesIn(uri);
      if (files.length) apps.push({ dir: `${base}/${name}`, uri, files });
    }
  }
  return apps;
}

async function envFilesIn(dir: vscode.Uri): Promise<string[]> {
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.startsWith('.env'))
      .map(([name]) => name)
      .sort();
  } catch {
    return [];
  }
}

function envsFrom(files: string[]) {
  return files.length
    ? files.map((file) => ({ title: titleFromFile(file), file, ...(/prod/i.test(file) ? { confirm: true } : {}) }))
    : [
        { title: 'Local', file: '.env.local' },
        { title: 'Production', file: '.env.production', confirm: true },
      ];
}

function titleFromFile(file: string): string {
  const suffix = file.replace(/^\.env\.?/, '') || 'default';
  return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

async function detectPackageManager(root: vscode.Uri): Promise<string> {
  const exists = async (name: string) => {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, name));
      return true;
    } catch {
      return false;
    }
  };
  if (await exists('pnpm-lock.yaml')) return 'pnpm';
  if (await exists('yarn.lock')) return 'yarn';
  if ((await exists('bun.lockb')) || (await exists('bun.lock'))) return 'bun';
  return 'npm run';
}

/** `<pm> dev|start|serve` from the folder's package.json scripts. */
async function detectDevCommand(dir: vscode.Uri, pm: string): Promise<string> {
  try {
    const pkg = JSON.parse(
      new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, 'package.json'))),
    );
    const script = ['dev', 'start', 'serve'].find((s) => pkg?.scripts?.[s]);
    if (script) return `${pm} ${script}`;
  } catch {
    // no package.json
  }
  return `${pm} dev`;
}
