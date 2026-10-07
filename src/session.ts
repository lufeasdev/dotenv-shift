import * as vscode from 'vscode';
import type { EnvChanges } from './core/diff';
import { errorMessage } from './core/errors';
import { type App, type Project, relative } from './project';
import { applyDefaultEnv, appsWithoutTarget, detectAppEnv, targetChanges } from './services/switcher';
import type { Validator } from './services/validator';
import type { ActiveEnvStore, ActiveEnvs } from './state';

export interface SessionHost {
  store: ActiveEnvStore;
  validator: Validator;
  log: vscode.LogOutputChannel;
  /** Something the UI shows changed (active env, validation, edits). */
  onDidChange(): void;
  /** A target was just edited by hand so it no longer matches its active env. */
  onTargetModified(session: ProjectSession, app: App): void;
  /** The default env needs confirmation; the user asked to switch to it. */
  requestSwitch(session: ProjectSession, title: string, apps: App[]): Promise<void>;
}

/**
 * A loaded project and everything that lives as long as it does: file watchers, which targets
 * were edited by hand, pending revalidation, and a queue that serialises file-changing operations.
 */
export class ProjectSession implements vscode.Disposable {
  private readonly watchers: vscode.Disposable[] = [];
  private modified = new Map<string, EnvChanges>();
  private revalidateTimer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    readonly project: Project,
    private readonly host: SessionHost,
  ) {}

  get name(): string {
    return this.project.name;
  }

  get folderUri(): string {
    return this.project.folder.uri.toString();
  }

  // ---------------------------------------------------------------- lifecycle

  /** Validates, applies the default env where targets are missing, and recovers active envs. */
  async initialize(): Promise<void> {
    const { store, validator } = this.host;
    this.watch();
    await validator.validate(this.project);

    // A missing target means that app has no active env, whatever was recorded earlier.
    const active = store.get(this.project);
    for (const app of await appsWithoutTarget(this.project)) active.delete(app.name);
    await store.save(this.project, active);

    await this.applyDefault();

    // Recover active envs from file contents where nothing (valid) is recorded.
    const recovered = store.get(this.project);
    for (const app of this.project.apps) {
      if (recovered.has(app.name)) continue;
      const title = await detectAppEnv(app);
      if (title) recovered.set(app.name, title);
    }
    await store.save(this.project, recovered);
    await this.refreshModified();

    const apps = this.project.config.monorepo ? `, ${this.project.apps.length} app(s)` : '';
    this.log(`loaded ${this.project.allTitles().length} env(s)${apps}`);
  }

  /**
   * Runs `task` after any earlier one has finished, so two switches (or a switch and a discard)
   * never interleave their file writes.
   */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.revalidateTimer);
    for (const watcher of this.watchers) watcher.dispose();
    this.host.validator.clear(this.project);
  }

  // ---------------------------------------------------------------- active env

  active(): ActiveEnvs {
    return this.host.store.get(this.project);
  }

  activeSummary(): { title?: string; mixed: boolean } {
    return this.host.store.summary(this.project);
  }

  async setActive(apps: App[], title: string | undefined): Promise<void> {
    await this.host.store.set(this.project, apps, title);
    this.host.onDidChange();
  }

  // ---------------------------------------------------------------- hand edits

  /** Apps whose target was edited so it no longer matches their active env, with the changes. */
  modifiedApps(): ReadonlyMap<string, EnvChanges> {
    return this.modified;
  }

  /**
   * Recomputes which targets no longer match their active env. Apps in `notify` that just became
   * modified are reported through `onTargetModified`.
   */
  async refreshModified(notify: App[] = []): Promise<void> {
    const before = this.modified;
    const after = new Map<string, EnvChanges>();
    const active = this.active();
    for (const app of this.project.apps) {
      const title = active.get(app.name);
      const changes = title ? await targetChanges(app, title) : undefined;
      if (changes) after.set(app.name, changes);
    }
    this.modified = after;

    for (const app of notify) {
      if (after.has(app.name) && !before.has(app.name)) this.host.onTargetModified(this, app);
    }
  }

  log(message: string): void {
    this.host.log.info(`[${this.name}] ${message}`);
  }

  // ---------------------------------------------------------------- internals

  /** Copies the default env to apps with a missing target. Doesn't restart anything. */
  private async applyDefault(): Promise<void> {
    const title = this.project.config.defaultEnv;
    if (!title) return;

    const { result, apps } = await applyDefaultEnv(this.project);
    const targets = apps.map((app) => relative(this.project, app.targetUri)).join(', ');
    switch (result) {
      case 'applied':
        for (const app of apps) {
          const file = relative(this.project, app.envUri(app.env(title)!));
          this.log(`applied default env "${title}" (${file} → ${relative(this.project, app.targetUri)})`);
        }
        await this.host.store.set(this.project, apps, title);
        void vscode.window.showInformationMessage(
          vscode.l10n.t('{0} was missing, so the default env "{1}" was applied.', targets, title),
        );
        break;
      case 'needsConfirm': {
        // Don't block loading on the user's answer.
        const SWITCH = vscode.l10n.t('Switch to {0}', title);
        void vscode.window
          .showWarningMessage(
            vscode.l10n.t('The default env "{0}" requires confirmation, so it wasn\'t applied automatically.', title),
            SWITCH,
          )
          .then((choice) => (choice === SWITCH ? this.host.requestSwitch(this, title, apps) : undefined));
        break;
      }
      case 'missingFile': {
        const files = apps.map((a) => relative(this.project, a.envUri(a.env(title)!))).join(', ');
        void vscode.window.showWarningMessage(
          vscode.l10n.t('The default env "{0}" has no file for {1}: {2}', title, targets, files),
        );
        break;
      }
    }
  }

  private watch(): void {
    const watch = (uri: vscode.Uri) => {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.joinPath(uri, '..'), uri.path.split('/').pop()!),
      );
      this.watchers.push(watcher);
      return watcher;
    };

    for (const app of this.project.apps) {
      for (const uri of [app.exampleUri, ...app.envs.map((env) => app.envUri(env))]) {
        if (!uri) continue;
        const watcher = watch(uri);
        const onEvent = () => this.scheduleRevalidate();
        watcher.onDidChange(onEvent);
        watcher.onDidCreate(onEvent);
        watcher.onDidDelete(onEvent);
      }

      // A target replaced from outside follows the env it now matches; one edited by hand so it
      // matches none keeps its active env and is marked modified.
      const target = watch(app.targetUri);
      const onTargetEvent = () =>
        this.guard(async () => {
          const title = await detectAppEnv(app);
          if (title && title !== this.active().get(app.name)) await this.setActive([app], title);
          await this.refreshModified([app]);
          this.host.onDidChange();
        });
      target.onDidChange(onTargetEvent);
      target.onDidCreate(onTargetEvent);
      target.onDidDelete(() =>
        this.guard(async () => {
          await this.setActive([app], undefined);
          await this.refreshModified();
          this.host.onDidChange();
        }),
      );
    }
  }

  /** Revalidates shortly after env files change (debounced, e.g. while typing). */
  scheduleRevalidate(): void {
    clearTimeout(this.revalidateTimer);
    this.revalidateTimer = setTimeout(
      () =>
        this.guard(async () => {
          await this.host.validator.validate(this.project);
          await this.refreshModified();
          this.host.onDidChange();
        }),
      250,
    );
  }

  /** Runs a watcher callback, skipping it after disposal and logging instead of rejecting. */
  private guard(task: () => Promise<void>): void {
    if (this.disposed) return;
    task().catch((err: unknown) => this.host.log.error(`[${this.name}] ${errorMessage(err)}`));
  }
}
