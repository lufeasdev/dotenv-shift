import * as vscode from 'vscode';
import { Commands, DISPLAY_NAME } from '../constants';
import type { EnvChanges } from '../core/diff';
import { relative } from '../project';
import { summarize, type Validator } from '../services/validator';
import type { ProjectSession } from '../session';
import { formatChanges } from './format';

export interface StatusBarState {
  projectName: string;
  monorepo: boolean;
  /** Env shared by every app that has an active env; undefined when none or mixed. */
  activeTitle?: string;
  activeDescription?: string;
  /** Apps are on different envs. */
  mixed: boolean;
  /** Active env per app, and how its target was edited by hand (if it was). */
  perApp: { name: string; title?: string; changes?: EnvChanges; target: string }[];
  /** Keys missing from the active env files. */
  activeMissing: number;
  /** Env files that are incomplete or missing. */
  problemFiles: number;
}

export class EnvStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'dotenvSwitcher.active',
    vscode.StatusBarAlignment.Left,
    100,
  );

  constructor() {
    this.item.name = DISPLAY_NAME;
    this.item.command = Commands.switch;
  }

  update(state: StatusBarState | undefined): void {
    if (!state) {
      this.item.hide();
      return;
    }
    const { projectName, activeTitle, mixed, activeMissing: missing, problemFiles: problems } = state;

    const edited = state.perApp.filter((app) => app.changes);
    const label = mixed ? vscode.l10n.t('Mixed') : (activeTitle ?? vscode.l10n.t('No env'));
    const modifiedLabel = vscode.l10n.t('(modified)');
    this.item.text = `$(symbol-variable) ${label}${edited.length ? ` ${modifiedLabel}` : ''}${missing ? ` $(warning) ${missing}` : ''}`;

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.isTrusted = { enabledCommands: [Commands.showChanges] };
    tooltip.appendMarkdown(`**${DISPLAY_NAME}** — ${projectName}\n\n`);
    if (state.monorepo) {
      for (const app of state.perApp) {
        tooltip.appendMarkdown(
          `- ${app.name}: **${app.title ?? vscode.l10n.t('none')}**${app.changes ? ` ${modifiedLabel}` : ''}\n`,
        );
      }
      tooltip.appendMarkdown('\n');
    } else {
      tooltip.appendMarkdown(
        activeTitle
          ? `${vscode.l10n.t('Active: {0}', `**${activeTitle}**`)}${edited.length ? ` ${modifiedLabel}` : ''}\n\n`
          : `${vscode.l10n.t('No active env')}\n\n`,
      );
    }
    if (edited.length) {
      tooltip.appendMarkdown(`$(edit) ${vscode.l10n.t('Edited by hand, not saved to the env file:')}\n\n`);
      for (const app of edited) tooltip.appendText(`${app.target}: ${formatChanges(app.changes!)}\n`);
      tooltip.appendMarkdown(`\n[${vscode.l10n.t('Review changes')}](command:${Commands.showChanges})\n\n`);
    }
    if (state.activeDescription && !mixed) tooltip.appendText(`${state.activeDescription}\n\n`);
    if (missing)
      tooltip.appendMarkdown(`$(warning) ${vscode.l10n.t('Active env files are missing {0} key(s)', missing)}\n\n`);
    if (problems) tooltip.appendMarkdown(`${vscode.l10n.t('{0} env file(s) incomplete or not found', problems)}\n\n`);
    tooltip.appendMarkdown(vscode.l10n.t('Click to switch'));
    this.item.tooltip = tooltip;

    this.item.backgroundColor =
      missing || edited.length ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}

/** What the status bar shows for a project. */
export function statusBarState(session: ProjectSession, validator: Validator): StatusBarState {
  const { project } = session;
  const active = session.active();
  const summary = session.activeSummary();
  const modified = session.modifiedApps();
  const statuses = validator.getStatuses(project);

  let activeMissing = 0;
  for (const app of project.apps) {
    const title = active.get(app.name);
    if (title) activeMissing += summarize(statuses, title, [app]).missingCount;
  }
  return {
    projectName: project.name,
    monorepo: project.config.monorepo,
    activeTitle: summary.title,
    activeDescription: summary.title ? project.findEnv(summary.title)?.description : undefined,
    mixed: summary.mixed,
    perApp: project.apps.map((app) => ({
      name: app.name,
      title: active.get(app.name),
      changes: modified.get(app.name),
      target: relative(project, app.targetUri),
    })),
    activeMissing,
    problemFiles: statuses.filter((s) => !s.exists || (s.diff?.missing.length ?? 0) > 0).length,
  };
}
