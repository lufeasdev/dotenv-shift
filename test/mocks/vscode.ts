// Minimal stand-in for the `vscode` module, enough for unit tests of code that imports it.
// Only what the tested modules touch at import time or in the tested paths is implemented.
import * as path from 'node:path';

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
  ) {}

  static file(fsPath: string): Uri {
    return new Uri('file', '', fsPath.replace(/\\/g, '/'));
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, base.authority, path.posix.join(base.path, ...segments));
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export const workspace = { textDocuments: [], fs: {} };
export const window = {};
export const l10n = {
  t: (message: string, ...args: unknown[]) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
};
