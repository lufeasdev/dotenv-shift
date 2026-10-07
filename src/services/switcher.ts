import * as vscode from 'vscode';
import { compareEnv, type EnvChanges, hasChanges } from '../core/diff';
import { type App, findOpenDocument, type Project, readDisk, relative } from '../project';
import { addMissingKeys } from './fixer';
import type { Validator } from './validator';

export interface SwitchResult {
  switched: boolean;
  /** Each switched app's target content before the switch (undefined if it didn't exist). */
  previousTexts: Map<App, string | undefined>;
}

/**
 * Copies the env's file over the target (e.g. `.env`) in each of `apps` that has it (default:
 * every app with this env), after checking the files against each app's example.
 */
export async function switchEnv(
  project: Project,
  title: string,
  validator: Validator,
  apps: App[] = project.appsWithEnv(title),
): Promise<SwitchResult> {
  const cancelled: SwitchResult = { switched: false, previousTexts: new Map() };
  const monorepo = project.config.monorepo;

  await validator.validate(project);
  let summary = validator.summarize(project, title, apps);
  if (summary.statuses.length === 0 || summary.unavailable) {
    const where = apps.flatMap((app) => (app.env(title) ? [relative(project, app.envUri(app.env(title)!))] : []));
    void vscode.window.showErrorMessage(vscode.l10n.t('File not found: {0}', where.join(', ') || title));
    return cancelled;
  }

  const needsConfirm = summary.statuses.some((s) => s.env.confirm);
  if (summary.missingCount > 0 || summary.notFound.length > 0) {
    const ADD = vscode.l10n.t('Add Missing & Switch');
    const ANYWAY = vscode.l10n.t('Switch Anyway');
    const lines: string[] = [];
    for (const m of summary.missing) {
      const keys = m.keys.length > 20 ? [...m.keys.slice(0, 20), `…and ${m.keys.length - 20} more`] : m.keys;
      lines.push(monorepo ? `${m.app.name}: ${keys.join(', ')}` : keys.join('\n'));
    }
    if (summary.notFound.length) {
      lines.push(vscode.l10n.t('Skipped, file not found in: {0}', summary.notFound.map((a) => a.name).join(', ')));
    }
    const message = summary.missingCount
      ? vscode.l10n.t('"{0}" is missing {1} key(s) from the example.', title, summary.missingCount)
      : vscode.l10n.t('"{0}" doesn\'t exist in every app.', title);
    const buttons = summary.missingCount ? [ADD, ANYWAY] : [ANYWAY];
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail: lines.join('\n') },
      ...buttons,
    );
    if (!choice) return cancelled;
    if (choice === ADD) {
      for (const m of summary.missing) await addMissingKeys(m.app, m.app.envUri(m.app.env(title)!));
      await validator.validate(project);
      summary = validator.summarize(project, title, apps);
    }
  } else if (needsConfirm) {
    const detail = summary.statuses.map((s) => `${relative(project, s.uri)} → ${relative(project, s.app.targetUri)}`);
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Switch to "{0}"?', title),
      { modal: true, detail: detail.join('\n') },
      vscode.l10n.t('Switch'),
    );
    if (!choice) return cancelled;
  }

  const previousTexts = new Map<App, string | undefined>();
  for (const status of summary.statuses) {
    if (!status.exists) continue;
    // Make sure unsaved edits in the source are on disk before copying.
    const openDoc = findOpenDocument(status.uri);
    if (openDoc?.isDirty) await openDoc.save();

    previousTexts.set(status.app, await readDisk(status.app.targetUri));
    await vscode.workspace.fs.copy(status.uri, status.app.targetUri, { overwrite: true });
  }
  return { switched: true, previousTexts };
}

export type DefaultResult = 'applied' | 'targetsExist' | 'noDefault' | 'needsConfirm' | 'missingFile';

/**
 * Copies the default env to every app that has it and whose target doesn't exist yet (e.g. a
 * fresh clone). Never overwrites an existing target, and never auto-applies an env marked `confirm`.
 */
export async function applyDefaultEnv(project: Project): Promise<{ result: DefaultResult; apps: App[] }> {
  const title = project.config.defaultEnv;
  if (!title) return { result: 'noDefault', apps: [] };

  const missingTargets: App[] = [];
  for (const app of project.appsWithEnv(title)) {
    if ((await readDisk(app.targetUri)) === undefined) missingTargets.push(app);
  }
  if (missingTargets.length === 0) return { result: 'targetsExist', apps: [] };
  if (missingTargets.some((app) => app.env(title)!.confirm)) return { result: 'needsConfirm', apps: missingTargets };

  const applied: App[] = [];
  for (const app of missingTargets) {
    const source = app.envUri(app.env(title)!);
    if ((await readDisk(source)) === undefined) continue;
    await vscode.workspace.fs.copy(source, app.targetUri, { overwrite: false });
    applied.push(app);
  }
  return applied.length ? { result: 'applied', apps: applied } : { result: 'missingFile', apps: missingTargets };
}

/** Apps whose target doesn't exist. */
export async function appsWithoutTarget(project: Project): Promise<App[]> {
  const result: App[] = [];
  for (const app of project.apps) {
    if ((await readDisk(app.targetUri)) === undefined) result.push(app);
  }
  return result;
}

/** The env whose file has the same keys and values as the app's target (formatting aside). */
export async function detectAppEnv(app: App): Promise<string | undefined> {
  const target = await readDisk(app.targetUri);
  if (target === undefined) return undefined;
  for (const env of app.envs) {
    const source = await readDisk(app.envUri(env));
    if (source !== undefined && !hasChanges(compareEnv(source, target))) return env.title;
  }
  return undefined;
}

/**
 * How the app's target differs from the env it was switched to, or undefined when it doesn't
 * (or either file is missing).
 */
export async function targetChanges(app: App, title: string): Promise<EnvChanges | undefined> {
  const env = app.env(title);
  if (!env) return undefined;
  const [source, target] = [await readDisk(app.envUri(env)), await readDisk(app.targetUri)];
  if (source === undefined || target === undefined) return undefined;
  const changes = compareEnv(source, target);
  return hasChanges(changes) ? changes : undefined;
}
