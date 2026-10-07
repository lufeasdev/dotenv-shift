import * as vscode from 'vscode';
import { SETTINGS_SECTION } from '../constants';
import type { RestartConfig } from '../core/config';
import { errorMessage } from '../core/errors';
import { resolvePorts } from '../core/ports';
import { type App, type Project, readDisk } from '../project';
import { killPorts } from './portKiller';

/** One command to (re)start: an app's own `restart`, or a monorepo's root `restart`. */
interface RestartTarget {
  key: string;
  config: RestartConfig & { command: string };
  terminalName: string;
  cwd: vscode.Uri;
  /** Apps whose env files hold this target's ports. */
  apps: App[];
}

export class Restarter implements vscode.Disposable {
  /** Terminals we created, keyed by restart target. */
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly closeListener = vscode.window.onDidCloseTerminal((closed) => {
    for (const [key, terminal] of this.terminals) {
      if (terminal === closed) this.terminals.delete(key);
    }
  });

  constructor(private readonly log: vscode.LogOutputChannel) {}

  canRestart(project: Project): boolean {
    return targetsOf(project).length > 0;
  }

  /**
   * Stops the running apps, frees their ports, then starts them again. With `onlyApps`, only
   * restarts commands that cover those apps (their own `restart`, and the root one).
   * `previousTexts` holds each app's target content before a switch, so old ports are freed too.
   */
  async restart(project: Project, previousTexts = new Map<App, string | undefined>(), onlyApps?: App[]): Promise<void> {
    const targets = targetsOf(project).filter((t) => !onlyApps || t.apps.some((app) => onlyApps.includes(app)));
    if (targets.length === 0) {
      void vscode.window.showWarningMessage(vscode.l10n.t('No "restart.command" is set in env-switcher.json.'));
      return;
    }
    // Restart commands come from the workspace, so don't run them (or kill processes) untrusted.
    if (!vscode.workspace.isTrusted) {
      this.log.warn(`[${project.name}] restart skipped: the workspace isn't trusted`);
      const MANAGE = vscode.l10n.t('Manage Workspace Trust');
      void vscode.window
        .showWarningMessage(vscode.l10n.t('Restarting is disabled in Restricted Mode.'), MANAGE)
        .then((choice) => choice === MANAGE && vscode.commands.executeCommand('workbench.trust.manage'));
      return;
    }

    // 1. Stop everything first, so apps can't hold each other's ports.
    const toStart: { target: RestartTarget; terminal?: vscode.Terminal }[] = [];
    const delayMs = vscode.workspace.getConfiguration(SETTINGS_SECTION).get<number>('restartDelayMs', 300);
    let sentCtrlC = false;
    for (const target of targets) {
      let terminal = this.findTerminal(target);
      if (terminal) {
        if (recreates(target.config)) {
          await closeTerminal(terminal);
          terminal = undefined;
        } else {
          terminal.sendText('\u0003', false);
          sentCtrlC = true;
        }
      } else if (!target.config.startIfNotRunning) {
        continue;
      }
      toStart.push({ target, terminal });
    }
    if (sentCtrlC) await delay(delayMs);

    // 2. Free ports still in use (Ctrl+C didn't stop it, or it runs in another terminal).
    await this.freePorts(
      project,
      toStart.map((t) => t.target),
      previousTexts,
    );

    // 3. Start.
    for (const { target, terminal: existing } of toStart) {
      const terminal = existing ?? vscode.window.createTerminal({ name: target.terminalName, cwd: target.cwd });
      this.terminals.set(target.key, terminal);
      terminal.sendText(target.config.command, true);
    }
    // Reveal the first one without stealing focus from the editor.
    if (toStart.length) this.terminals.get(toStart[0].target.key)?.show(true);
  }

  private findTerminal(target: RestartTarget): vscode.Terminal | undefined {
    return this.terminals.get(target.key) ?? vscode.window.terminals.find((t) => t.name === target.terminalName);
  }

  private async freePorts(
    project: Project,
    targets: RestartTarget[],
    previousTexts: Map<App, string | undefined>,
  ): Promise<void> {
    const ports = new Set<number>();
    for (const target of targets) {
      if (target.config.killPorts.length === 0) continue;
      const texts: (string | undefined)[] = [];
      for (const app of target.apps) texts.push(previousTexts.get(app), await readDisk(app.targetUri));
      for (const port of resolvePorts(target.config.killPorts, texts)) ports.add(port);
    }
    if (ports.size === 0) return;

    try {
      const results = await killPorts([...ports].sort((a, b) => a - b));
      for (const r of results) {
        const message = `[${project.name}] port ${r.port}: killed PID ${r.pids.join(', ')}`;
        if (!r.stillInUse) {
          this.log.info(message);
        } else {
          this.log.warn(`${message} (still in use)`);
          void vscode.window.showWarningMessage(
            vscode.l10n.t('Port {0} is still in use (PID {1}). The app may fail to start.', r.port, r.pids.join(', ')),
          );
        }
      }
    } catch (err) {
      this.log.error(`[${project.name}] failed to free ports ${[...ports].join(', ')}: ${errorMessage(err)}`);
    }
  }

  dispose(): void {
    this.closeListener.dispose();
  }
}

function targetsOf(project: Project): RestartTarget[] {
  const targets: RestartTarget[] = [];
  const folder = project.folder.uri.toString();

  for (const app of project.apps) {
    const config = app.config.restart;
    if (!config?.enabled || !config.command) continue;
    targets.push({
      key: `${folder}::app::${app.name}`,
      config: { ...config, command: config.command },
      terminalName: config.terminalName ?? `Env Switcher: ${app.name}`,
      cwd: config.cwd ? app.resolve(config.cwd) : app.dirUri,
      apps: [app],
    });
  }

  const root = project.config.rootRestart;
  if (root?.enabled && root.command) {
    targets.push({
      key: `${folder}::root`,
      config: { ...root, command: root.command },
      terminalName: root.terminalName ?? `Env Switcher: ${project.name}`,
      cwd: root.cwd ? project.resolve(root.cwd) : project.folder.uri,
      apps: project.apps,
    });
  }
  return targets;
}

function recreates(config: RestartConfig): boolean {
  return config.mode === 'recreate' || (config.mode === 'auto' && process.platform === 'win32');
}

/** Disposes a terminal (which kills its shell and children) and waits for it to close. */
function closeTerminal(terminal: vscode.Terminal, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    const listener = vscode.window.onDidCloseTerminal((closed) => closed === terminal && done());
    function done() {
      clearTimeout(timer);
      listener.dispose();
      resolve();
    }
    terminal.dispose();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
