import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
  },
  resolve: {
    // Unit tests run outside VS Code; modules importing `vscode` get a small mock.
    alias: { vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)) },
  },
});
