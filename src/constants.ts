/** Command IDs, matching `contributes.commands` in package.json. */
export const Commands = {
  switch: 'dotenvShift.switch',
  switchApp: 'dotenvShift.switchApp',
  showChanges: 'dotenvShift.showChanges',
  validate: 'dotenvShift.validate',
  restart: 'dotenvShift.restart',
  resetToDefault: 'dotenvShift.resetToDefault',
  init: 'dotenvShift.init',
  openConfig: 'dotenvShift.openConfig',
  addMissingKeys: 'dotenvShift.addMissingKeys',
} as const;

/** Prefix of `contributes.configuration` settings. */
export const SETTINGS_SECTION = 'dotenvShift';

/** Name of the output channel and prefix of user-facing messages. */
export const DISPLAY_NAME = 'Dotenv Shift';
