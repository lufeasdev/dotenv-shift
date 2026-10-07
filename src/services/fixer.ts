import * as vscode from 'vscode';
import { buildAppendText, diffEnv } from '../core/diff';
import { type App, readText } from '../project';

/**
 * Appends keys that exist in the app's example but not in the env file. When `keys` is given,
 * only those keys are added. Returns the number of keys added.
 */
/** Keys the app's example declares that `envText` lacks (empty when there's no example). */
export async function missingKeys(app: App, envText: string): Promise<string[]> {
  const exampleText = app.exampleUri ? await readText(app.exampleUri) : undefined;
  return exampleText === undefined ? [] : diffEnv(exampleText, envText).missing.map((e) => e.key);
}

export async function addMissingKeys(app: App, envUri: vscode.Uri, keys?: string[]): Promise<number> {
  const exampleUri = app.exampleUri;
  const exampleText = exampleUri ? await readText(exampleUri) : undefined;
  if (exampleText === undefined) return 0;

  const doc = await vscode.workspace.openTextDocument(envUri);
  const text = doc.getText();
  let missing = diffEnv(exampleText, text).missing;
  if (keys) missing = missing.filter((e) => keys.includes(e.key));
  if (missing.length === 0) return 0;

  const edit = new vscode.WorkspaceEdit();
  edit.insert(envUri, doc.positionAt(text.length), buildAppendText(text, missing));
  await vscode.workspace.applyEdit(edit);
  await doc.save();
  return missing.length;
}
