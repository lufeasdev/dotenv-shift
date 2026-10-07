import * as vscode from 'vscode';
import { CONFIG_FILE, type EnvDefinition } from '../core/config';
import type { App } from '../project';
import { describeProblems, type EnvStatus, type EnvSummary, summarize } from '../services/validator';
import type { ProjectSession } from '../session';
import type { Workspace } from '../workspace';

/** Returned by a picker step when the user pressed Back. */
export const BACK = Symbol('back');

type EnvPickItem = vscode.QuickPickItem & { title: string; description: string };
export type Scope = 'all' | App;

/**
 * The project to act on: the only one, or one the user picks. Without any, offers `onCreate`
 * (creating a config).
 */
export async function pickSession(
  workspace: Workspace,
  onCreate: () => Promise<void>,
): Promise<ProjectSession | undefined> {
  const sessions = workspace.all();
  if (sessions.length === 0) {
    const CREATE = vscode.l10n.t('Create {0}', CONFIG_FILE);
    const choice = await vscode.window.showInformationMessage(
      vscode.l10n.t('No {0} found in this workspace.', CONFIG_FILE),
      CREATE,
    );
    if (choice === CREATE) await onCreate();
    return undefined;
  }
  if (sessions.length === 1) return sessions[0];

  const current = workspace.current();
  const pick = await vscode.window.showQuickPick(
    sessions.map((session) => ({
      label: session.name,
      description: session === current ? vscode.l10n.t('current') : undefined,
      session,
    })),
    { placeHolder: vscode.l10n.t('Select project') },
  );
  return pick?.session;
}

/**
 * Single repo: picks an env. Monorepo: step 1 picks the scope (all apps, or one app such as
 * root), step 2 one of the envs available for it, with Back returning to step 1. `allowAll`
 * offers "All apps" in step 1.
 */
export async function pickScopeAndEnv(
  session: ProjectSession,
  statuses: EnvStatus[],
  allowAll: boolean,
): Promise<{ title: string; apps?: App[] } | undefined> {
  const { project } = session;
  if (!project.config.monorepo) {
    const title = await pickEnv(session, statuses, 'all', false);
    return title === undefined || title === BACK ? undefined : { title };
  }
  for (;;) {
    const scope = project.apps.length === 1 && !allowAll ? project.apps[0] : await pickScope(session, allowAll);
    if (!scope) return undefined;
    const title = await pickEnv(session, statuses, scope, project.apps.length > 1 || allowAll);
    if (title === BACK) continue;
    if (title === undefined) return undefined;
    return { title, apps: scope === 'all' ? undefined : [scope] };
  }
}

/** Step 1 (monorepo): all apps, or one app. */
async function pickScope(session: ProjectSession, allowAll: boolean): Promise<Scope | undefined> {
  const { project } = session;
  const active = session.active();
  const summary = session.activeSummary();
  type ScopeItem = vscode.QuickPickItem & { scope?: Scope };

  const items: ScopeItem[] = [];
  if (allowAll) {
    items.push(
      {
        label: vscode.l10n.t('All apps'),
        description: summary.mixed ? vscode.l10n.t('Mixed') : (summary.title ?? vscode.l10n.t('no env')),
        detail: vscode.l10n.t('Switch {0} together', project.apps.map((a) => a.name).join(', ')),
        iconPath: new vscode.ThemeIcon('layers'),
        scope: 'all',
      },
      { label: vscode.l10n.t('Apps'), kind: vscode.QuickPickItemKind.Separator },
    );
  }
  for (const app of project.apps) {
    const isRoot = app.config.dir === '.';
    items.push({
      label: app.name,
      description: `${isRoot ? vscode.l10n.t('repo root') : app.config.dir}  ·  ${active.get(app.name) ?? vscode.l10n.t('no env')}`,
      iconPath: new vscode.ThemeIcon(isRoot ? 'root-folder' : 'folder'),
      scope: app,
    });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Switch Environment ({0}): 1/2', project.name),
    placeHolder: vscode.l10n.t('Switch all apps, or pick one app'),
    matchOnDescription: true,
  });
  return pick?.scope;
}

/**
 * Picks an env of `scope` (also used directly for a known app). For all apps that's every env
 * title (one only some apps have switches just those); for one app, its own list.
 */
export async function pickEnv(
  session: ProjectSession,
  statuses: EnvStatus[],
  scope: Scope,
  withBack: boolean,
): Promise<string | typeof BACK | undefined> {
  const { project } = session;
  const monorepo = project.config.monorepo;

  let items: EnvPickItem[];
  let heading: string;
  if (scope === 'all') {
    const active = session.activeSummary();
    items = project.allTitles().map((title) => {
      const item = envItem(
        session,
        project.findEnv(title)!,
        summarize(statuses, title),
        !active.mixed && active.title === title,
      );
      const apps = project.appsWithEnv(title);
      if (monorepo && apps.length < project.apps.length) {
        item.description += `  ·  ${vscode.l10n.t('only {0}', apps.map((a) => a.name).join(', '))}`;
      }
      return item;
    });
    heading = monorepo ? vscode.l10n.t('All apps') : project.name;
  } else {
    const active = session.active().get(scope.name);
    items = scope.envs.map((env) => {
      const item = envItem(session, env, summarize(statuses, env.title, [scope]), env.title === active);
      if (!env.shared) item.description += `  ·  ${vscode.l10n.t('{0} only', scope.name)}`;
      return item;
    });
    heading = scope.name;
  }

  const quickPick = vscode.window.createQuickPick<EnvPickItem>();
  quickPick.title = monorepo
    ? vscode.l10n.t('Switch Environment ({0}): 2/2, {1}', project.name, heading)
    : vscode.l10n.t('Switch Environment ({0})', project.name);
  quickPick.placeholder = vscode.l10n.t('Pick an environment');
  quickPick.matchOnDescription = true;
  quickPick.items = items;
  // Focus the active env. An empty activeItems would leave nothing focused (e.g. when apps are mixed).
  const current = items.find((i) => i.picked);
  if (current) quickPick.activeItems = [current];
  if (withBack) quickPick.buttons = [vscode.QuickInputButtons.Back];

  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string | typeof BACK | undefined) => {
      if (done) return;
      done = true;
      resolve(value);
      quickPick.dispose();
    };
    quickPick.onDidTriggerButton((button) => button === vscode.QuickInputButtons.Back && finish(BACK));
    quickPick.onDidAccept(() => finish(quickPick.selectedItems[0]?.title));
    quickPick.onDidHide(() => finish(undefined));
    quickPick.show();
  });
}

function envItem(session: ProjectSession, env: EnvDefinition, summary: EnvSummary, isActive: boolean): EnvPickItem {
  const { project } = session;
  const problem = describeProblems(summary, project.config.monorepo);
  let iconPath: vscode.ThemeIcon;
  if (summary.unavailable) {
    iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
  } else if (summary.missingCount || summary.notFound.length) {
    iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
  } else if (isActive) {
    iconPath = new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
  } else {
    iconPath = new vscode.ThemeIcon(env.confirm ? 'shield' : 'circle-large-outline');
  }

  // A shared env may use different file names per app; show the file only when it's uniform.
  const files = new Set(summary.statuses.map((s) => s.env.file));
  const file = files.size > 1 ? vscode.l10n.t('per-app files') : files.size === 1 ? [...files][0] : env.file;
  return {
    label: env.title,
    description: [
      file,
      isActive ? vscode.l10n.t('active') : '',
      env.title === project.config.defaultEnv ? vscode.l10n.t('default') : '',
      env.confirm ? vscode.l10n.t('requires confirmation') : '',
    ]
      .filter(Boolean)
      .join('  ·  '),
    detail: [env.description, problem].filter(Boolean).join('  ·  ') || undefined,
    iconPath,
    picked: isActive,
    title: env.title,
  };
}
