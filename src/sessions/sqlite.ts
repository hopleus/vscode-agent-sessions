export function loadSqlite(): typeof import('node:sqlite') | undefined {
  try {
    return require('node:sqlite');
  } catch {
    return undefined;
  }
}
