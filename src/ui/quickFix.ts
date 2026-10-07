import * as vscode from 'vscode';
import { Commands } from '../constants';
import { DIAGNOSTIC_SOURCE, MISSING_KEY_CODE } from '../services/validator';

export interface QuickFixHost {
  /** Keys the env file lacks compared with its example, or undefined if it isn't an env file. */
  missingKeys(uri: vscode.Uri, text: string): Promise<string[] | undefined>;
}

/**
 * "Add missing key" fixes for the missing-key diagnostics. The keys are recomputed from the
 * document, not read back from the (localised) diagnostic messages.
 */
export class MissingKeyQuickFix implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly host: QuickFixHost) {}

  async provideCodeActions(
    doc: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    const diags = context.diagnostics.filter((d) => d.source === DIAGNOSTIC_SOURCE && d.code === MISSING_KEY_CODE);
    if (diags.length === 0) return [];
    const keys = await this.host.missingKeys(doc.uri, doc.getText());
    if (!keys?.length) return [];

    const all = new vscode.CodeAction(
      vscode.l10n.t('Add all missing keys from example'),
      vscode.CodeActionKind.QuickFix,
    );
    all.diagnostics = diags;
    all.isPreferred = true;
    all.command = { command: Commands.addMissingKeys, title: all.title, arguments: [doc.uri] };

    const single = keys.map((key) => {
      const action = new vscode.CodeAction(vscode.l10n.t('Add missing key {0}', key), vscode.CodeActionKind.QuickFix);
      action.diagnostics = diags;
      action.command = { command: Commands.addMissingKeys, title: action.title, arguments: [doc.uri, [key]] };
      return action;
    });
    return [all, ...single];
  }
}
