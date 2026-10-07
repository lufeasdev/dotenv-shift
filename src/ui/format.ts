import * as vscode from 'vscode';
import { describeChanges, type EnvChanges } from '../core/diff';

/** {@link describeChanges} with localised labels, for messages shown to the user. */
export function formatChanges(changes: EnvChanges): string {
  return describeChanges(changes, {
    changed: vscode.l10n.t('changed'),
    added: vscode.l10n.t('added'),
    removed: vscode.l10n.t('removed'),
  });
}
