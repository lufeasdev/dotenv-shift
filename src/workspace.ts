import * as vscode from 'vscode';
import { CONFIG_FILES, ConfigError } from './core/config';
import { errorMessage } from './core/errors';
import { loadProject, sameUri } from './project';
import { ProjectSession, type SessionHost } from './session';

/**
 * Keeps one {@link ProjectSession} per workspace folder that has a `dotenv-switcher.json`, and
 * reloads it when the config or the workspace folders change.
 */
export class Workspace implements vscode.Disposable {
  private readonly sessions = new Map<string, ProjectSession>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly host: SessionHost) {
    const configWatcher = vscode.workspace.createFileSystemWatcher(`**/{${CONFIG_FILES.join(',')}}`);
    const reload = (uri: vscode.Uri) => void this.reloadFolderOf(uri);
    configWatcher.onDidCreate(reload);
    configWatcher.onDidChange(reload);
    configWatcher.onDidDelete(reload);

    this.disposables.push(
      configWatcher,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.loadAll()),
      // Revalidate while env files are being edited, before they're saved.
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        for (const session of this.sessions.values()) {
          if (session.project.isExample(document.uri) || session.project.findEnvFile(document.uri)) {
            session.scheduleRevalidate();
          }
        }
      }),
    );
  }

  /** Loads every workspace folder, dropping sessions of folders that were removed. */
  async loadAll(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const keep = new Set(folders.map((f) => f.uri.toString()));
    for (const key of [...this.sessions.keys()]) {
      if (!keep.has(key)) this.remove(key);
    }
    await Promise.all(folders.map((folder) => this.loadFolder(folder)));
    this.host.onDidChange();
  }

  /** (Re)loads one folder. An invalid config is reported and the previous session is kept. */
  async loadFolder(folder: vscode.WorkspaceFolder): Promise<void> {
    const key = folder.uri.toString();
    let project: Awaited<ReturnType<typeof loadProject>>;
    try {
      project = await loadProject(folder);
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      this.host.log.error(`[${folder.name}] ${err.message}`);
      void vscode.window.showErrorMessage(err.message);
      return;
    }

    this.remove(key);
    if (!project) return;

    const session = new ProjectSession(project, this.host);
    this.sessions.set(key, session);
    try {
      await session.initialize();
    } catch (err) {
      this.host.log.error(`[${folder.name}] failed to load: ${errorMessage(err)}`);
    }
  }

  all(): ProjectSession[] {
    return [...this.sessions.values()];
  }

  get(folderUri: string): ProjectSession | undefined {
    return this.sessions.get(folderUri);
  }

  /** The session of the active editor's folder, otherwise the first one. */
  current(): ProjectSession | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = uri && vscode.workspace.getWorkspaceFolder(uri);
    return (folder && this.sessions.get(folder.uri.toString())) ?? this.sessions.values().next().value;
  }

  /** The session owning an env file. */
  forEnvFile(uri: vscode.Uri): ProjectSession | undefined {
    return this.all().find((session) => session.project.findEnvFile(uri));
  }

  dispose(): void {
    for (const key of [...this.sessions.keys()]) this.remove(key);
    for (const d of this.disposables) d.dispose();
  }

  private async reloadFolderOf(uri: vscode.Uri): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return;
    const isConfig = CONFIG_FILES.some((name) => sameUri(vscode.Uri.joinPath(folder.uri, name), uri));
    if (!isConfig) return;
    await this.loadFolder(folder);
    this.host.onDidChange();
  }

  private remove(key: string): void {
    this.sessions.get(key)?.dispose();
    this.sessions.delete(key);
  }
}
