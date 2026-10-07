/** Command IDs, matching `contributes.commands` in package.json. */
export const Commands = {
  switch: 'dotenvSwitcher.switch',
  switchApp: 'dotenvSwitcher.switchApp',
  showChanges: 'dotenvSwitcher.showChanges',
  validate: 'dotenvSwitcher.validate',
  restart: 'dotenvSwitcher.restart',
  resetToDefault: 'dotenvSwitcher.resetToDefault',
  init: 'dotenvSwitcher.init',
  openConfig: 'dotenvSwitcher.openConfig',
  addMissingKeys: 'dotenvSwitcher.addMissingKeys',
} as const;

/** Prefix of `contributes.configuration` settings. */
export const SETTINGS_SECTION = 'dotenvSwitcher';

/** Name of the output channel and prefix of user-facing messages. */
export const DISPLAY_NAME = 'Dotenv Switcher';
