import * as vscode from 'vscode';
import type { EnvDefinition } from '../core/config';
import { diffEnv, type EnvDiff } from '../core/diff';
import { type App, type Project, readText, relative } from '../project';

export const DIAGNOSTIC_SOURCE = 'Env Switcher';
export const MISSING_KEY_CODE = 'missing-key';

/** Status of one env file: one env in one app. */
export interface EnvStatus {
  app: App;
  env: EnvDefinition;
  uri: vscode.Uri;
  exists: boolean;
  /** Undefined when the env file or the app's example file doesn't exist. */
  diff?: EnvDiff;
}

/** An env's status across all apps. */
export interface EnvSummary {
  statuses: EnvStatus[];
  /** Apps where this env's file doesn't exist. */
  notFound: App[];
  /** Apps with missing keys, and which. */
  missing: { app: App; keys: string[] }[];
  missingCount: number;
  /** True when no app has the file. */
  unavailable: boolean;
}

export class Validator implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('envSwitcher');
  private readonly statuses = new Map<string, EnvStatus[]>();

  /** Validates every env file of every app against that app's example file. */
  async validate(project: Project): Promise<EnvStatus[]> {
    this.clearDiagnostics(project);

    const statuses: EnvStatus[] = [];
    for (const app of project.apps) {
      const exampleUri = app.exampleUri;
      const exampleText = exampleUri ? await readText(exampleUri) : undefined;
      for (const env of app.envs) {
        const uri = app.envUri(env);
        const text = await readText(uri);
        const status: EnvStatus = { app, env, uri, exists: text !== undefined };
        if (text !== undefined && exampleText !== undefined) {
          status.diff = diffEnv(exampleText, text);
          this.diagnostics.set(uri, toDiagnostics(status.diff, project, exampleUri!));
        }
        statuses.push(status);
      }
    }

    this.statuses.set(project.folder.uri.toString(), statuses);
    return statuses;
  }

  getStatuses(project: Project): EnvStatus[] {
    return this.statuses.get(project.folder.uri.toString()) ?? [];
  }

  /** Status of an env (by title) across `apps`, or every app that has it. */
  summarize(project: Project, title: string, apps?: App[]): EnvSummary {
    return summarize(this.getStatuses(project), title, apps);
  }

  clear(project: Project): void {
    this.clearDiagnostics(project);
    this.statuses.delete(project.folder.uri.toString());
  }

  private clearDiagnostics(project: Project): void {
    for (const status of this.getStatuses(project)) this.diagnostics.delete(status.uri);
  }

  dispose(): void {
    this.diagnostics.dispose();
  }
}

export function summarize(all: EnvStatus[], title: string, apps?: App[]): EnvSummary {
  const statuses = all.filter((s) => s.env.title === title && (!apps || apps.includes(s.app)));
  const notFound = statuses.filter((s) => !s.exists).map((s) => s.app);
  const missing = statuses
    .filter((s) => s.exists && s.diff && s.diff.missing.length > 0)
    .map((s) => ({ app: s.app, keys: s.diff!.missing.map((e) => e.key) }));
  return {
    statuses,
    notFound,
    missing,
    missingCount: missing.reduce((n, m) => n + m.keys.length, 0),
    unavailable: statuses.length > 0 && notFound.length === statuses.length,
  };
}

/**
 * One-line description of an env's problems, e.g. `2 key(s) missing: A, B` for a single repo
 * or `3 key(s) missing (web: A; api: B, C) · not found in: worker` for a monorepo.
 */
export function describeProblems(summary: EnvSummary, monorepo: boolean): string | undefined {
  const parts: string[] = [];
  if (summary.unavailable) return vscode.l10n.t('File not found');
  if (summary.missingCount) {
    parts.push(
      monorepo
        ? vscode.l10n.t(
            '{0} key(s) missing ({1})',
            summary.missingCount,
            summary.missing.map((m) => `${m.app.name}: ${m.keys.join(', ')}`).join('; '),
          )
        : vscode.l10n.t('{0} key(s) missing: {1}', summary.missingCount, summary.missing[0].keys.join(', ')),
    );
  }
  if (summary.notFound.length)
    parts.push(vscode.l10n.t('not found in: {0}', summary.notFound.map((a) => a.name).join(', ')));
  return parts.length ? parts.join('  ·  ') : undefined;
}

function toDiagnostics(diff: EnvDiff, project: Project, exampleUri: vscode.Uri): vscode.Diagnostic[] {
  const exampleName = relative(project, exampleUri);
  const result: vscode.Diagnostic[] = [];

  for (const entry of diff.missing) {
    // The key doesn't exist in this file, so anchor on the first line.
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1000),
      vscode.l10n.t('Missing key {0} (defined in {1})', entry.key, exampleName),
      vscode.DiagnosticSeverity.Warning,
    );
    diag.source = DIAGNOSTIC_SOURCE;
    diag.code = MISSING_KEY_CODE;
    diag.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(exampleUri, new vscode.Position(entry.line, 0)),
        vscode.l10n.t('{0} is declared here', entry.key),
      ),
    ];
    result.push(diag);
  }

  for (const entry of diff.extra) {
    const diag = new vscode.Diagnostic(
      new vscode.Range(entry.line, 0, entry.line, entry.key.length),
      vscode.l10n.t('Key {0} is not defined in {1}', entry.key, exampleName),
      vscode.DiagnosticSeverity.Information,
    );
    diag.source = DIAGNOSTIC_SOURCE;
    result.push(diag);
  }

  return result;
}
