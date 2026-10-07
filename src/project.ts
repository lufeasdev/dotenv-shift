import * as path from 'node:path';
import * as vscode from 'vscode';
import { type AppConfig, CONFIG_FILE, type EnvDefinition, type EnvSwitcherConfig, parseConfig } from './core/config';

/** A workspace folder that has an `env-switcher.json`. */
export class Project {
  readonly apps: App[];

  constructor(
    readonly folder: vscode.WorkspaceFolder,
    readonly config: EnvSwitcherConfig,
  ) {
    this.apps = config.apps.map((app) => new App(this, app));
  }

  get name(): string {
    return this.folder.name;
  }

  get configUri(): vscode.Uri {
    return configUri(this.folder);
  }

  /** Finds the app and env an env file belongs to. */
  findEnvFile(uri: vscode.Uri): { app: App; env: EnvDefinition } | undefined {
    for (const app of this.apps) {
      const env = app.envs.find((e) => sameUri(app.envUri(e), uri));
      if (env) return { app, env };
    }
    return undefined;
  }

  findApp(name: string): App | undefined {
    return this.apps.find((app) => app.name === name);
  }

  /** Apps that have an env with this title. */
  appsWithEnv(title: string): App[] {
    return this.apps.filter((app) => app.env(title));
  }

  /** Looks an env up by title or file, in any app. */
  findEnvTitle(ref: string): string | undefined {
    const all = this.apps.flatMap((app) => app.envs);
    return (all.find((e) => e.title === ref) ?? all.find((e) => e.file === ref))?.title;
  }

  /** Every env title: shared ones first, then app-only ones, without duplicates. */
  allTitles(): string[] {
    const titles = [...this.config.envs, ...this.apps.flatMap((a) => a.envs)].map((e) => e.title);
    return [...new Set(titles)];
  }

  /** An env definition by title: the shared one if there is one, else the first app's. */
  findEnv(title: string): EnvDefinition | undefined {
    return (
      this.config.envs.find((e) => e.title === title) ?? this.apps.flatMap((a) => a.envs).find((e) => e.title === title)
    );
  }

  isExample(uri: vscode.Uri): boolean {
    return this.apps.some((app) => app.exampleUri !== undefined && sameUri(app.exampleUri, uri));
  }

  /** Resolves a path relative to the workspace folder. */
  resolve(file: string): vscode.Uri {
    return resolveFrom(this.folder.uri, file);
  }
}

/** One app of a project: the repo root for a single repo, or an entry of `"apps"`. */
export class App {
  readonly dirUri: vscode.Uri;

  constructor(
    readonly project: Project,
    readonly config: AppConfig,
  ) {
    this.dirUri = project.resolve(config.dir);
  }

  get name(): string {
    return this.config.name;
  }

  get targetUri(): vscode.Uri {
    return this.resolve(this.config.target);
  }

  get exampleUri(): vscode.Uri | undefined {
    return this.config.example ? this.resolve(this.config.example) : undefined;
  }

  /** Envs available for this app (shared ones with overrides, then its own). */
  get envs(): EnvDefinition[] {
    return this.config.envs;
  }

  env(title: string): EnvDefinition | undefined {
    return this.config.envs.find((e) => e.title === title);
  }

  envUri(env: EnvDefinition): vscode.Uri {
    return this.resolve(env.file);
  }

  /** Resolves a path relative to the app folder. */
  resolve(file: string): vscode.Uri {
    return resolveFrom(this.dirUri, file);
  }
}

/** Resolves a config path; accepts `/` or `\` separators on every OS. */
function resolveFrom(base: vscode.Uri, file: string): vscode.Uri {
  if (path.isAbsolute(file) || path.win32.isAbsolute(file)) return vscode.Uri.file(file);
  const segments = file.split(/[\\/]+/).filter((s) => s && s !== '.');
  return segments.length ? vscode.Uri.joinPath(base, ...segments) : base;
}

export function configUri(folder: vscode.WorkspaceFolder): vscode.Uri {
  return vscode.Uri.joinPath(folder.uri, CONFIG_FILE);
}

/** Returns undefined when the folder has no config; throws ConfigError when it is invalid. */
export async function loadProject(folder: vscode.WorkspaceFolder): Promise<Project | undefined> {
  const text = await readText(configUri(folder));
  if (text === undefined) return undefined;
  return new Project(folder, parseConfig(text, folder.name));
}

/**
 * Compares two URIs. File paths are case-insensitive on Windows (and drive letters may differ
 * in case between sources), so compare those by lower-cased fsPath.
 */
export function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
  if (a.scheme !== b.scheme || a.authority !== b.authority) return false;
  if (a.scheme === 'file' && process.platform === 'win32') {
    return path.normalize(a.fsPath).toLowerCase() === path.normalize(b.fsPath).toLowerCase();
  }
  return a.path === b.path;
}

export function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => sameUri(d.uri, uri));
}

/** Reads a file, preferring the (possibly unsaved) open editor content. */
export async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const doc = findOpenDocument(uri);
  if (doc) return doc.getText();
  return readDisk(uri);
}

/** Reads a file from disk, ignoring unsaved editor content. */
export async function readDisk(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

export function relative(project: Project, uri: vscode.Uri): string {
  return path.relative(project.folder.uri.fsPath, uri.fsPath).split(path.sep).join('/') || uri.fsPath;
}
