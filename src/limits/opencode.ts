import * as fs from 'fs';
import { defaultOpenCodeDatabase } from '../sessions/opencode';
import { loadSqlite } from '../sessions/sqlite';
import { TokenUsage } from './types';

const TOKENS_SQL = `
  SELECT tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, cost
  FROM session WHERE id = ?`;

export function readOpenCodeTokens(
  sessionId: string,
  databasePath: string = defaultOpenCodeDatabase(),
): TokenUsage | undefined {
  const sqlite = fs.existsSync(databasePath) ? loadSqlite() : undefined;
  if (!sqlite) { return undefined; }
  try {
    const db = new sqlite.DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db.prepare(TOKENS_SQL).get(sessionId) as Record<string, number> | undefined;
      return row && {
        input: row.tokens_input ?? 0,
        output: row.tokens_output ?? 0,
        reasoning: row.tokens_reasoning ?? 0,
        cacheRead: row.tokens_cache_read ?? 0,
        cacheWrite: row.tokens_cache_write ?? 0,
        cost: row.cost ?? 0,
      };
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}
