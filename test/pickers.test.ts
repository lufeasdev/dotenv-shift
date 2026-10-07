import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { parseConfig } from '../src/core/config';
import { Project } from '../src/project';
import type { EnvStatus } from '../src/services/validator';
import { ProjectSession, type SessionHost } from '../src/session';
import { ActiveEnvStore } from '../src/state';
import { type PickerUi, pickScopeAndEnv } from '../src/ui/pickers';

type Item = vscode.QuickPickItem & { title?: string; scope?: unknown };
/** One answer per QuickPick shown: an item label to pick, BACK, or undefined to dismiss. */
type Answer = string | typeof BACK_BUTTON | undefined;
const BACK_BUTTON = Symbol('back button');

/** A fake QuickPick UI that answers from a script and records what was shown. */
function fakeUi(answers: Answer[]) {
  const shown: { title?: string; items: Item[]; active?: Item[]; buttons?: readonly unknown[] }[] = [];
  const next = (items: Item[]) => {
    const answer = answers.shift();
    if (answer === BACK_BUTTON || answer === undefined) return answer;
    const item = items.find((i) => i.label === answer);
    if (!item) throw new Error(`no item "${answer}" in ${items.map((i) => i.label).join(', ')}`);
    return item;
  };

  const ui: PickerUi = {
    async showQuickPick<T extends vscode.QuickPickItem>(items: readonly T[], options?: vscode.QuickPickOptions) {
      shown.push({ title: options?.title, items: [...items] });
      const answer = next([...items]);
      return typeof answer === 'symbol' ? undefined : (answer as T | undefined);
    },
    createQuickPick<T extends vscode.QuickPickItem>() {
      const handlers: Record<string, (value?: unknown) => void> = {};
      const qp = {
        title: undefined as string | undefined,
        items: [] as T[],
        activeItems: [] as T[],
        selectedItems: [] as T[],
        buttons: [] as readonly vscode.QuickInputButton[],
        onDidTriggerButton(cb: (b: unknown) => void) {
          handlers.button = cb;
        },
        onDidAccept(cb: () => void) {
          handlers.accept = cb;
        },
        onDidHide(cb: () => void) {
          handlers.hide = cb;
        },
        show() {
          shown.push({ title: qp.title, items: [...qp.items], active: [...qp.activeItems], buttons: qp.buttons });
          const answer = next([...qp.items]);
          if (answer === BACK_BUTTON) handlers.button(vscode.QuickInputButtons.Back);
          else if (answer === undefined) handlers.hide();
          else {
            qp.selectedItems = [answer as T];
            handlers.accept();
          }
        },
        dispose() {},
      };
      return qp as unknown as vscode.QuickPick<T>;
    },
  };
  return { ui, shown };
}

function memento() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k),
    update: async (k: string, v: unknown) => void data.set(k, v),
    keys: () => [],
  };
}

const MONOREPO = `{
  "envs": [{ "title": "Local", "file": ".env.local" }, { "title": "Staging", "file": ".env.staging" }],
  "apps": [
    { "dir": "." },
    { "dir": "apps/web" },
    { "dir": "apps/api", "envs": [{ "title": "Staging", "file": null }, { "title": "Mock", "file": ".env.mock" }] }
  ]
}`;

function setup(json: string) {
  const project = new Project({ name: 'repo', index: 0, uri: vscode.Uri.file('/repo') }, parseConfig(json, 'repo'));
  const store = new ActiveEnvStore(memento() as never);
  const session = new ProjectSession(project, { store } as unknown as SessionHost);
  // Every env file exists and is complete, unless a test says otherwise.
  const statuses: EnvStatus[] = project.apps.flatMap((app) =>
    app.envs.map((env) => ({ app, env, uri: app.envUri(env), exists: true, diff: { missing: [], extra: [] } })),
  );
  return { project, store, session, statuses };
}

describe('pickScopeAndEnv (single repo)', () => {
  it('goes straight to the env list', async () => {
    const { session, statuses } = setup(
      '{"envs":[{"title":"Local","file":".env.local"},{"title":"Prod","file":".env.prod"}]}',
    );
    const { ui, shown } = fakeUi(['Prod']);
    expect(await pickScopeAndEnv(session, statuses, true, ui)).toEqual({ title: 'Prod' });
    expect(shown).toHaveLength(1);
    expect(shown[0].items.map((i) => i.label)).toEqual(['Local', 'Prod']);
    expect(shown[0].buttons).toEqual([]);
  });
});

describe('pickScopeAndEnv (monorepo)', () => {
  it('step 1 lists "All apps" then every app; step 2 the envs for all apps', async () => {
    const { session, statuses } = setup(MONOREPO);
    const { ui, shown } = fakeUi(['All apps', 'Local']);
    expect(await pickScopeAndEnv(session, statuses, true, ui)).toEqual({ title: 'Local', apps: undefined });

    expect(shown[0].items.map((i) => i.label)).toEqual(['All apps', 'Apps', 'root', 'web', 'api']);
    const envs = shown[1].items;
    expect(envs.map((i) => i.label)).toEqual(['Local', 'Staging', 'Mock']);
    // Envs only some apps have say which.
    expect(envs[1].description).toContain('only root, web');
    expect(envs[2].description).toContain('only api');
  });

  it('picking one app switches just that app, offering its own envs', async () => {
    const { project, session, statuses } = setup(MONOREPO);
    const { ui, shown } = fakeUi(['api', 'Mock']);
    const pick = await pickScopeAndEnv(session, statuses, true, ui);
    expect(pick).toEqual({ title: 'Mock', apps: [project.findApp('api')] });
    expect(shown[1].items.map((i) => i.label)).toEqual(['Local', 'Mock']);
    expect(shown[1].items[1].description).toContain('api only');
  });

  it('Back in step 2 returns to step 1', async () => {
    const { session, statuses } = setup(MONOREPO);
    const { ui, shown } = fakeUi(['web', BACK_BUTTON, 'root', 'Staging']);
    expect((await pickScopeAndEnv(session, statuses, true, ui))?.title).toBe('Staging');
    expect(shown.map((s) => s.items[0].label)).toEqual(['All apps', 'Local', 'All apps', 'Local']);
    expect(shown[1].buttons).toEqual([vscode.QuickInputButtons.Back]);
  });

  it('dismissing either step cancels', async () => {
    const { session, statuses } = setup(MONOREPO);
    expect(await pickScopeAndEnv(session, statuses, true, fakeUi([undefined]).ui)).toBeUndefined();
    expect(await pickScopeAndEnv(session, statuses, true, fakeUi(['web', undefined]).ui)).toBeUndefined();
  });

  it('without "All apps", step 1 lists only the apps', async () => {
    const { session, statuses } = setup(MONOREPO);
    const { ui, shown } = fakeUi(['web', 'Local']);
    await pickScopeAndEnv(session, statuses, false, ui);
    expect(shown[0].items.map((i) => i.label)).toEqual(['root', 'web', 'api']);
  });

  it('focuses the active env, and nothing when apps are on different envs', async () => {
    const { project, store, session, statuses } = setup(MONOREPO);
    await store.set(project, project.apps, 'Local');
    let run = fakeUi(['All apps', 'Local']);
    await pickScopeAndEnv(session, statuses, true, run.ui);
    expect(run.shown[1].active?.map((i) => i.label)).toEqual(['Local']);
    expect(run.shown[0].items[0].description).toBe('Local');

    await store.set(project, [project.findApp('api')!], 'Mock');
    run = fakeUi(['All apps', 'Local']);
    await pickScopeAndEnv(session, statuses, true, run.ui);
    expect(run.shown[0].items[0].description).toBe('Mixed');
    expect(run.shown[1].active).toEqual([]);
  });

  it('shows missing keys per app', async () => {
    const { session, statuses } = setup(MONOREPO);
    const web = statuses.find((s) => s.app.name === 'web' && s.env.title === 'Staging')!;
    web.diff = { missing: [{ key: 'DEBUG', value: '', raw: '', line: 0 }], extra: [] };
    const { ui, shown } = fakeUi(['All apps', 'Staging']);
    await pickScopeAndEnv(session, statuses, true, ui);
    expect(shown[1].items.find((i) => i.label === 'Staging')?.detail).toBe('1 key(s) missing (web: DEBUG)');
  });
});
