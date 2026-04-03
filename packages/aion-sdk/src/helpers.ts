/**
 * ADF helpers — utility functions for plugin and stack development.
 */

/**
 * Build a command.action format ID for deduplication across stacks.
 *
 * @example
 * actionId("composer", "require", "laravel/laravel") → "composer.require.laravel/laravel"
 * actionId("npm", "install") → "npm.install"
 * actionId("artisan", "migrate") → "artisan.migrate"
 */
export function actionId(tool: string, command: string, target?: string): string {
  return target ? `${tool}.${command}.${target}` : `${tool}.${command}`;
}
