import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig, type AnyMySqlTable } from 'drizzle-orm/mysql-core';
import * as schema from '../../core/database/schema';

/**
 * A column declared in the Drizzle schema that no migration creates breaks
 * every insert into its table, because Drizzle builds the column list from the
 * schema and emits `default` for whatever the caller omitted — the statement
 * names the column whether or not the code sets it.
 *
 * That is not hypothetical. The feed-forecast/main merge (b2be0a03) added
 * `transfer_receipt_line.remarks`, which neither parent declared and no
 * migration creates, and it made every Common Requisition and Feed Requisition
 * receipt fail with "Unknown column 'remarks' in 'field list'". 2,690 unit
 * tests passed over it because they mock the database; it only showed up when
 * a receipt was posted against real MySQL.
 *
 * This guard reads the migrations the way the migrator does — in journal order
 * — and fails when the schema declares a column they never produce.
 */

const TENANT_DIR = __dirname;

function migratedColumns(): Map<string, Set<string>> {
  const journal = JSON.parse(readFileSync(join(TENANT_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const tables = new Map<string, Set<string>>();
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of ordered) {
    const sql = readFileSync(join(TENANT_DIR, `${entry.tag}.sql`), 'utf8');

    // CREATE TABLE `t` ( `c` type, ... ) — take the backticked name of every
    // line that starts a column definition, skipping CONSTRAINT/KEY lines.
    for (const create of sql.matchAll(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`([^`]+)`\s*\(([\s\S]*?)\n\s*\)/gi,
    )) {
      const [, table, body] = create;
      const cols = tables.get(table) ?? new Set<string>();
      for (const line of body.split('\n')) {
        const trimmed = line.trim();
        if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|KEY|INDEX|FOREIGN KEY)\b/i.test(trimmed)) continue;
        const m = /^`([^`]+)`/.exec(trimmed);
        if (m) cols.add(m[1]);
      }
      tables.set(table, cols);
    }

    // ALTER TABLE statements span lines and carry several comma-separated
    // clauses, so take the whole statement and scan it for column clauses.
    for (const alter of sql.matchAll(/ALTER TABLE\s+`([^`]+)`([\s\S]*?);/gi)) {
      const [, table, body] = alter;
      if (!tables.has(table)) tables.set(table, new Set());
      const cols = tables.get(table)!;

      for (const add of body.matchAll(/\bADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?`([^`]+)`/gi)) {
        cols.add(add[1]);
      }
      for (const rename of body.matchAll(/\bRENAME COLUMN\s+`([^`]+)`\s+TO\s+`([^`]+)`/gi)) {
        if (cols.delete(rename[1])) cols.add(rename[2]);
      }
      for (const change of body.matchAll(/\bCHANGE\s+(?:COLUMN\s+)?`([^`]+)`\s+`([^`]+)`/gi)) {
        if (cols.delete(change[1])) cols.add(change[2]);
      }
      for (const drop of body.matchAll(/\bDROP\s+COLUMN\s+(?:IF EXISTS\s+)?`([^`]+)`/gi)) {
        cols.delete(drop[1]);
      }
    }

    for (const dropped of sql.matchAll(/DROP TABLE\s+(?:IF EXISTS\s+)?`([^`]+)`/gi)) {
      tables.delete(dropped[1]);
    }
  }
  return tables;
}

describe('tenant schema matches the tenant migrations', () => {
  const migrated = migratedColumns();

  const declared = (Object.values(schema) as unknown[]).flatMap((value) => {
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as AnyMySqlTable);
    } catch {
      return [];
    }
    return config?.name ? [config] : [];
  });

  it('parses the migrations into tables', () => {
    expect(migrated.size).toBeGreaterThan(100);
  });

  it('declares no column the migrations never create', () => {
    const drift = declared.flatMap((table) => {
      const cols = migrated.get(table.name);
      if (!cols) return [];
      return table.columns
        .filter((column) => !cols.has(column.name))
        .map((column) => `${table.name}.${column.name}`);
    });

    expect(drift).toEqual([]);
  });

  it('declares no table the migrations never create', () => {
    const missing = declared.filter((table) => !migrated.has(table.name)).map((t) => t.name);

    expect(missing).toEqual([]);
  });
});
