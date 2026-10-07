import * as vscode from 'vscode';
import { CommandHandlers, registerCommands } from './commands';
import { DISPLAY_NAME } from './constants';
import type { EnvChanges } from './core/diff';
import { missingKeys } from './services/fixer';
import { Restarter } from './services/restarter';
import { Validator } from './services/validator';
import { ActiveEnvStore } from './state';
import { MissingKeyQuickFix } from './ui/quickFix';
import { EnvStatusBar, statusBarState } from './ui/statusBar';
import { offerTargetActions } from './ui/targetActions';
import { Workspace } from './workspace';

export interface DotenvShiftStatus {
  project: string;
  apps: { name: string; env?: string; modified: boolean; changes?: EnvChanges }[];
}
export type DotenvSwitcherStatus = DotenvShiftStatus;
export type EnvSwitcherStatus = DotenvShiftStatus;

/** Returned from `activate`, available to other extensions via `getExtension(...).exports`. */
export interface DotenvShiftApi {
  /** Each app's active env and whether its target was edited by hand. */
  getStatus(folderUri?: string): DotenvShiftStatus | undefined;
}
export type DotenvSwitcherApi = DotenvShiftApi;
export type EnvSwitcherApi = DotenvShiftApi;

export async function activate(context: vscode.ExtensionContext): Promise<DotenvShiftApi> {
  const log = vscode.window.createOutputChannel(DISPLAY_NAME, { log: true });
  const validator = new Validator();
  const restarter = new Restarter(log);
  const statusBar = new EnvStatusBar();
  const store = new ActiveEnvStore(context.workspaceState);

  const refreshUi = () => {
    const session = workspace.current();
    statusBar.update(session && statusBarState(session, validator));
  };
  // Commands are created after the workspace, but the workspace can ask for a switch while loading.
  let handlers: CommandHandlers | undefined;

  const workspace = new Workspace({
    store,
    validator,
    log,
    onDidChange: refreshUi,
    onTargetModified: (session, app) => void offerTargetActions(session, app, 'notify').then(refreshUi),
    requestSwitch: async (session, title, apps) => handlers?.doSwitch(session, title, apps),
  });
  handlers = new CommandHandlers({ workspace, validator, restarter, log, refreshUi });

  context.subscriptions.push(
    log,
    validator,
    restarter,
    statusBar,
    workspace,
    ...registerCommands(handlers, log),
    vscode.window.onDidChangeActiveTextEditor(refreshUi),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new MissingKeyQuickFix({
        missingKeys: async (uri, text) => {
          const found = workspace.forEnvFile(uri)?.project.findEnvFile(uri);
          return found && missingKeys(found.app, text);
        },
      }),
      { providedCodeActionKinds: MissingKeyQuickFix.kinds },
    ),
  );

  await workspace.loadAll();

  return {
    getStatus(folderUri) {
      const session = folderUri ? workspace.get(folderUri) : workspace.current();
      if (!session) return undefined;
      const active = session.active();
      const modified = session.modifiedApps();
      return {
        project: session.name,
        apps: session.project.apps.map((app) => ({
          name: app.name,
          env: active.get(app.name),
          modified: modified.has(app.name),
          changes: modified.get(app.name),
        })),
      };
    },
  };
}

export function deactivate(): void {}
