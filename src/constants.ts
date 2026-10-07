/** Command IDs, matching `contributes.commands` in package.json. */
export const Commands = {
  switch: 'envSwitcher.switch',
  switchApp: 'envSwitcher.switchApp',
  showChanges: 'envSwitcher.showChanges',
  validate: 'envSwitcher.validate',
  restart: 'envSwitcher.restart',
  resetToDefault: 'envSwitcher.resetToDefault',
  init: 'envSwitcher.init',
  openConfig: 'envSwitcher.openConfig',
  addMissingKeys: 'envSwitcher.addMissingKeys',
} as const;

/** Prefix of `contributes.configuration` settings. */
export const SETTINGS_SECTION = 'envSwitcher';

/** Name of the output channel and prefix of user-facing messages. */
export const DISPLAY_NAME = 'Env Switcher';
