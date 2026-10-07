import type * as vscode from 'vscode';
import type { App, Project } from './project';

/** Active env title per app name. */
export type ActiveEnvs = Map<string, string>;

const STATE_KEY = 'dotenvSwitcher.active';
const LEGACY_STATE_KEY = 'envSwitcher.active';

/**
 * Remembers each app's active env in the workspace state, so `dotenv-switcher.json` stays free of
 * per-developer state and can be committed.
 */
export class ActiveEnvStore {
  constructor(private readonly memento: vscode.Memento) {}

  /** Active env title per app, ignoring entries that no longer match the config. */
  get(project: Project): ActiveEnvs {
    const stored = this.memento.get<unknown>(this.key(project)) ?? this.memento.get<unknown>(this.legacyKey(project));
    const active: ActiveEnvs = new Map();
    if (!stored || typeof stored !== 'object') return active;
    for (const app of project.apps) {
      const title = (stored as Record<string, unknown>)[app.name];
      if (typeof title === 'string' && app.env(title)) active.set(app.name, title);
    }
    return active;
  }

  async save(project: Project, active: ActiveEnvs): Promise<void> {
    await this.memento.update(this.key(project), Object.fromEntries(active));
  }

  /** Sets (or clears, with `undefined`) the active env of `apps`. */
  async set(project: Project, apps: App[], title: string | undefined): Promise<void> {
    const active = this.get(project);
    for (const app of apps) {
      if (title) active.set(app.name, title);
      else active.delete(app.name);
    }
    await this.save(project, active);
  }

  /** The env shared by every app that has one, or `mixed` when apps are on different envs. */
  summary(project: Project): { title?: string; mixed: boolean } {
    const titles = new Set(this.get(project).values());
    if (titles.size > 1) return { mixed: true };
    return { title: titles.values().next().value, mixed: false };
  }

  private key(project: Project): string {
    return `${STATE_KEY}:${project.folder.uri.toString()}`;
  }

  private legacyKey(project: Project): string {
    return `${LEGACY_STATE_KEY}:${project.folder.uri.toString()}`;
  }
}
