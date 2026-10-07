import * as vscode from 'vscode';
import { type App, relative } from '../project';
import type { ProjectSession } from '../session';
import { formatChanges } from './format';

/**
 * Before overwriting targets that were edited by hand, offers to save the edits to the active
 * env's file first. Returns false when the user cancels.
 */
export async function confirmUnsavedTargets(session: ProjectSession, apps: App[]): Promise<boolean> {
  const { project } = session;
  await session.refreshModified();
  const modified = session.modifiedApps();
  const dirty = apps.filter((app) => modified.has(app.name));
  if (dirty.length === 0) return true;

  const active = session.active();
  const SAVE = vscode.l10n.t('Save & Switch');
  const DISCARD = vscode.l10n.t('Discard & Switch');
  const files = dirty.map((app) => relative(project, app.targetUri)).join(', ');
  const detail = dirty
    .map((app) => {
      const source = relative(project, app.envUri(app.env(active.get(app.name)!)!));
      return `${relative(project, app.targetUri)} vs ${source}: ${formatChanges(modified.get(app.name)!)}`;
    })
    .join('\n');
  const choice = await vscode.window.showWarningMessage(
    dirty.length === 1
      ? vscode.l10n.t("{0} has changes that aren't saved to the env file.", files)
      : vscode.l10n.t("{0} have changes that aren't saved to the env file.", files),
    { modal: true, detail },
    SAVE,
    DISCARD,
  );
  if (!choice) return false;
  if (choice === SAVE) for (const app of dirty) await saveTargetToSource(session, app);
  return true;
}

/**
 * Show Diff / Save to the env file / Discard for a target edited by hand: as a notification
 * (right after the edit) or, with `asPicker`, as a QuickPick (from the command).
 */
export async function offerTargetActions(session: ProjectSession, app: App, asPicker: boolean): Promise<void> {
  const { project } = session;
  const title = session.active().get(app.name);
  const changes = session.modifiedApps().get(app.name);
  const env = title ? app.env(title) : undefined;
  if (!title || !env || !changes) return;
  const sourceUri = app.envUri(env);
  const source = relative(project, sourceUri);
  const target = relative(project, app.targetUri);

  const DIFF = vscode.l10n.t('Show Diff');
  const SAVE = vscode.l10n.t('Save to {0}', source);
  const DISCARD = vscode.l10n.t('Discard Changes');
  let choice: string | undefined;
  if (asPicker) {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: DIFF,
          detail: vscode.l10n.t('Compare {0} with {1}', source, target),
          iconPath: new vscode.ThemeIcon('diff'),
        },
        {
          label: SAVE,
          detail: vscode.l10n.t('Keep the edits: copy {0} over {1}', target, source),
          iconPath: new vscode.ThemeIcon('save'),
        },
        {
          label: DISCARD,
          detail: vscode.l10n.t('Restore {0} from {1}', target, source),
          iconPath: new vscode.ThemeIcon('discard'),
        },
      ],
      { placeHolder: vscode.l10n.t('{0} differs from {1}: {2}', target, title, formatChanges(changes)) },
    );
    choice = pick?.label;
  } else {
    choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('{0} differs from {1} ({2}). {3}', target, title, source, formatChanges(changes)),
      DIFF,
      SAVE,
      DISCARD,
    );
  }

  if (choice === DIFF) {
    await vscode.commands.executeCommand('vscode.diff', sourceUri, app.targetUri, `${source} vs ${target}`);
    return;
  }
  if (choice !== SAVE && choice !== DISCARD) return;

  await session.exclusive(async () => {
    if (choice === SAVE) {
      await saveTargetToSource(session, app);
    } else {
      await vscode.workspace.fs.copy(sourceUri, app.targetUri, { overwrite: true });
      session.log(`discarded edits in ${target} (restored from ${source})`);
    }
    await session.refreshModified();
  });
}

/** Copies a target edited by hand over its active env's file. */
async function saveTargetToSource(session: ProjectSession, app: App): Promise<void> {
  const title = session.active().get(app.name);
  const env = title ? app.env(title) : undefined;
  if (!env) return;
  await vscode.workspace.fs.copy(app.targetUri, app.envUri(env), { overwrite: true });
  session.log(
    `saved edits in ${relative(session.project, app.targetUri)} to ${relative(session.project, app.envUri(env))}`,
  );
}
