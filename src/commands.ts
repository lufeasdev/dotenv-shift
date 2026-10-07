import * as vscode from 'vscode';
import { Commands } from './constants';
import { CONFIG_FILE } from './core/config';
import { errorMessage } from './core/errors';
import { type App, relative } from './project';
import { createConfig } from './services/configGenerator';
import { addMissingKeys } from './services/fixer';
import type { Restarter } from './services/restarter';
import { switchEnv } from './services/switcher';
import { describeProblems, summarize, type Validator } from './services/validator';
import type { ProjectSession } from './session';
import { formatChanges } from './ui/format';
import { BACK, pickEnv, pickScopeAndEnv, pickSession } from './ui/pickers';
import { confirmUnsavedTargets, offerTargetActions } from './ui/targetActions';
import type { Workspace } from './workspace';

export interface CommandDeps {
  workspace: Workspace;
  validator: Validator;
  restarter: Restarter;
  log: vscode.LogOutputChannel;
  /** Refreshes the status bar. */
  refreshUi(): void;
}

/** Arguments of `envSwitcher.switch` when bound to a key: `{ "env", "app", "folder" }`. */
interface SwitchArgs {
  env?: string;
  app?: string;
  folder?: string;
}

/**
 * Registers every command; the returned disposables unregister them. A failing command is logged
 * and reported instead of surfacing as an unhandled rejection.
 */
export function registerCommands(handlers: CommandHandlers, log: vscode.LogOutputChannel): vscode.Disposable[] {
  const register = <A extends unknown[]>(id: string, handler: (...args: A) => Promise<void>) =>
    vscode.commands.registerCommand(id, async (...args: A) => {
      try {
        await handler(...args);
      } catch (err) {
        log.error(`${id}: ${errorMessage(err)}`);
        void vscode.window.showErrorMessage(errorMessage(err));
      }
    });

  return [
    // Optional args: (env, folderUri, app) positionally, or one object as keybindings pass it.
    register(Commands.switch, (env?: string | SwitchArgs, folderUri?: string, app?: string) =>
      typeof env === 'object' && env !== null
        ? handlers.switch(env.env, env.folder, env.app)
        : handlers.switch(env, folderUri, app),
    ),
    register(Commands.switchApp, () => handlers.switchApp()),
    register(Commands.showChanges, () => handlers.showChanges()),
    register(Commands.validate, () => handlers.validate()),
    register(Commands.restart, (folderUri?: string) => handlers.restart(folderUri)),
    register(Commands.resetToDefault, () => handlers.resetToDefault()),
    register(Commands.init, () => handlers.init()),
    register(Commands.openConfig, () => handlers.openConfig()),
    register(Commands.addMissingKeys, (uri?: vscode.Uri, keys?: string[]) => handlers.addMissingKeys(uri, keys)),
  ];
}

export class CommandHandlers {
  constructor(private readonly deps: CommandDeps) {}

  async switch(ref?: string, folderUri?: string, appName?: string): Promise<void> {
    const session = folderUri ? this.deps.workspace.get(folderUri) : await this.pickSession();
    if (!session) return;
    const { project } = session;

    let title: string | undefined;
    let apps: App[] | undefined;
    if (appName) {
      const app = project.findApp(appName);
      if (!app) throw new Error(vscode.l10n.t('There is no app named "{0}" in {1}.', appName, CONFIG_FILE));
      apps = [app];
      if (ref) {
        title = app.envs.find((e) => e.title === ref || e.file === ref)?.title;
      } else {
        const picked = await pickEnv(session, await this.deps.validator.validate(project), app, false);
        title = picked === BACK ? undefined : picked;
      }
    } else if (ref) {
      title = project.findEnvTitle(ref);
    } else {
      const pick = await pickScopeAndEnv(session, await this.deps.validator.validate(project), true);
      if (!pick) return;
      ({ title, apps } = pick);
    }
    if (ref && !title) throw new Error(vscode.l10n.t('There is no env "{0}" in {1}.', ref, CONFIG_FILE));
    if (title) await this.doSwitch(session, title, apps);
  }

  async switchApp(): Promise<void> {
    const session = await this.pickSession();
    if (!session) return;
    const pick = await pickScopeAndEnv(session, await this.deps.validator.validate(session.project), false);
    if (pick) await this.doSwitch(session, pick.title, pick.apps);
  }

  /** Switches `apps` (default: every app with this env) to `title`, then restarts them. */
  doSwitch(session: ProjectSession, title: string, apps?: App[]): Promise<void> {
    const { project } = session;
    return session.exclusive(async () => {
      if (!(await confirmUnsavedTargets(session, apps ?? project.appsWithEnv(title)))) return;

      const { switched, previousTexts } = await switchEnv(project, title, this.deps.validator, apps);
      if (!switched) return;

      const switchedApps = [...previousTexts.keys()];
      await session.setActive(switchedApps, title);
      for (const app of switchedApps) {
        const where = project.config.monorepo ? `${app.name}: ` : '';
        const file = relative(project, app.envUri(app.env(title)!));
        session.log(`switched to "${title}" (${where}${file} → ${relative(project, app.targetUri)})`);
      }
      await session.refreshModified();
      this.deps.refreshUi();

      const env = project.config.monorepo && switchedApps.length === 1 ? `${title} (${switchedApps[0].name})` : title;
      if (this.deps.restarter.canRestart(project)) {
        await this.deps.restarter.restart(project, previousTexts, switchedApps);
        vscode.window.setStatusBarMessage(`$(check) ${vscode.l10n.t('Switched to {0} and restarted', env)}`, 4000);
      } else {
        vscode.window.setStatusBarMessage(`$(check) ${vscode.l10n.t('Switched to {0}', env)}`, 4000);
      }
    });
  }

  async showChanges(): Promise<void> {
    const session = await this.pickSession();
    if (!session) return;
    await session.refreshModified();
    const modified = session.modifiedApps();
    if (modified.size === 0) {
      void vscode.window.showInformationMessage(vscode.l10n.t('Every target matches its active env file.'));
      return;
    }

    const apps = session.project.apps.filter((app) => modified.has(app.name));
    let app: App | undefined = apps[0];
    if (apps.length > 1) {
      const pick = await vscode.window.showQuickPick(
        apps.map((a) => ({
          label: a.name,
          description: relative(session.project, a.targetUri),
          detail: formatChanges(modified.get(a.name)!),
          app: a,
        })),
        { placeHolder: vscode.l10n.t('Which app?') },
      );
      app = pick?.app;
    }
    if (app) await offerTargetActions(session, app, true);
    this.deps.refreshUi();
  }

  async validate(): Promise<void> {
    const session = await this.pickSession();
    if (!session) return;
    const { project } = session;
    const { log, validator } = this.deps;

    if (!project.apps.some((app) => app.exampleUri)) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Set "example" in {0} to validate env files.', CONFIG_FILE));
      return;
    }

    const statuses = await validator.validate(project);
    this.deps.refreshUi();

    log.info(`[${project.name}] validation against the example file(s)`);
    let problems = 0;
    for (const s of statuses) {
      const label = `${s.env.title} (${relative(project, s.uri)})`;
      if (!s.exists) {
        problems++;
        log.warn(`  [NOT FOUND] ${label}`);
      } else if (!s.diff) {
        problems++;
        log.warn(`  [SKIPPED]   ${label}: example file not found`);
      } else if (s.diff.missing.length) {
        problems++;
        log.warn(`  [MISSING]   ${label}: ${s.diff.missing.map((e) => e.key).join(', ')}`);
      } else {
        log.info(`  [OK]        ${label}`);
      }
      if (s.diff?.extra.length) {
        log.info(`              not in example: ${s.diff.extra.map((e) => e.key).join(', ')}`);
      }
    }

    if (problems === 0) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t('All {0} env file(s) match the example.', statuses.length),
      );
      return;
    }
    const FIX = vscode.l10n.t('Add All Missing Keys');
    const SHOW = vscode.l10n.t('Show Details');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('{0} of {1} env file(s) have problems.', problems, statuses.length),
      FIX,
      SHOW,
    );
    if (choice === SHOW) log.show(true);
    if (choice === FIX) {
      const added = await session.exclusive(async () => {
        let count = 0;
        for (const s of statuses) {
          if (s.exists && s.diff?.missing.length) count += await addMissingKeys(s.app, s.uri);
        }
        return count;
      });
      await validator.validate(project);
      this.deps.refreshUi();
      void vscode.window.showInformationMessage(vscode.l10n.t('Added {0} missing key(s).', added));
    }
  }

  async resetToDefault(): Promise<void> {
    const session = await this.pickSession();
    if (!session) return;
    const title = session.project.config.defaultEnv;
    if (!title) {
      const OPEN = vscode.l10n.t('Open Config');
      const choice = await vscode.window.showInformationMessage(
        vscode.l10n.t('No "default" env is set in {0}.', CONFIG_FILE),
        OPEN,
      );
      if (choice === OPEN) await vscode.window.showTextDocument(session.project.configUri);
      return;
    }
    await this.doSwitch(session, title);
  }

  async restart(folderUri?: string): Promise<void> {
    const session = folderUri ? this.deps.workspace.get(folderUri) : await this.pickSession();
    if (session) await session.exclusive(() => this.deps.restarter.restart(session.project));
  }

  async init(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Open a folder first.'));
      return;
    }
    const folder =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({ placeHolder: vscode.l10n.t('Create {0} in…', CONFIG_FILE) });
    if (!folder) return;

    const uri = await createConfig(folder);
    await vscode.window.showTextDocument(uri);
    await this.deps.workspace.loadFolder(folder);
    this.deps.refreshUi();
  }

  async openConfig(): Promise<void> {
    const session = await this.pickSession();
    if (session) await vscode.window.showTextDocument(session.project.configUri);
  }

  /** Adds missing keys to one env file (`uri`), or to a picked env's file in every app. */
  async addMissingKeys(uri?: vscode.Uri, keys?: string[]): Promise<void> {
    const { validator } = this.deps;
    let session: ProjectSession | undefined;
    let files: { app: App; uri: vscode.Uri }[] = [];
    if (uri) {
      session = this.deps.workspace.forEnvFile(uri);
      const found = session?.project.findEnvFile(uri);
      if (found) files = [{ app: found.app, uri }];
    } else {
      session = await this.pickSession();
      if (!session) return;
      const { project } = session;
      const statuses = await validator.validate(project);
      const pick = await vscode.window.showQuickPick(
        project.allTitles().map((title) => ({
          label: title,
          detail: describeProblems(summarize(statuses, title), project.config.monorepo),
          title,
        })),
        { placeHolder: vscode.l10n.t('Add missing keys to…') },
      );
      if (!pick) return;
      files = statuses.filter((s) => s.env.title === pick.title && s.exists).map((s) => ({ app: s.app, uri: s.uri }));
    }
    if (!session || files.length === 0) return;
    const { project } = session;

    const added = await session.exclusive(async () => {
      let count = 0;
      for (const file of files) count += await addMissingKeys(file.app, file.uri, keys);
      return count;
    });
    await validator.validate(project);
    this.deps.refreshUi();
    const where = files.length === 1 ? relative(project, files[0].uri) : vscode.l10n.t('{0} files', files.length);
    vscode.window.setStatusBarMessage(
      added ? `$(check) ${vscode.l10n.t('Added {0} key(s) to {1}', added, where)}` : vscode.l10n.t('No missing keys'),
      3000,
    );
  }

  private pickSession(): Promise<ProjectSession | undefined> {
    return pickSession(this.deps.workspace, () => this.init());
  }
}
