// Local SQLite + migration runner. Uses better-sqlite3 (sync API, prebuilt
// Windows binaries). The DB file lives at data/parasti.db (gitignored).

import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlockProps } from './shared/blockProps';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = process.env.PARASTI_DB_PATH || path.join(DATA_DIR, 'parasti.db');
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Row types returned by db.prepare(...).all(). Kept loose because each table
// has its own shape; services use `any` and normalize at the shared layer.
export type Row = Record<string, any>;

// Apply ALL migrations in lexicographic order. Each file runs in a
// transaction. Idempotent at the file level (CREATE TABLE/INDEX use IF NOT
// EXISTS; ALTER TABLE on existing columns fails silently because D1 doesn't
// have DROP COLUMN, so re-running them is a no-op).
export function runMigrations(): { applied: string[]; skipped: string[] } {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`[db] missing ${MIGRATIONS_DIR}, skipping migrations`);
    return { applied: [], skipped: [] };
  }
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Bookkeeping table to avoid re-applying migrations.
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations_applied (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied: string[] = [];
  const skipped: string[] = [];
  const alreadyApplied = new Set(
    db.prepare('SELECT name FROM _migrations_applied').all().map((r: any) => r.name)
  );

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations_applied (name) VALUES (?)').run(file);
    });
    try {
      tx();
      applied.push(file);
    } catch (e: any) {
      // If the error is for duplicate columns/indexes, log it but keep going.
      // For anything else, propagate.
      const msg = String(e?.message || e);
      if (/duplicate column|already exists/i.test(msg)) {
        db.prepare('INSERT OR IGNORE INTO _migrations_applied (name) VALUES (?)').run(file);
        skipped.push(file);
      } else {
        throw e;
      }
    }
  }
  healSchema();
  return { applied, skipped };
}

// Columns that later migrations added to existing tables, with the exact
// definition each one uses. SQLite has no ADD COLUMN IF NOT EXISTS and the
// runner above marks a whole file applied on the first "duplicate column", so
// a local DB can end up with a migration recorded but only partly applied (or
// created by an older build). Re-adding what is missing keeps such a DB usable
// instead of failing at query time with "no such column".
const EXPECTED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  // Local uploads live on disk (see POST /api/files/upload in server/index.ts).
  { table: 'files', column: 'storage', ddl: "storage TEXT NOT NULL DEFAULT 'disk'" },
  { table: 'pages', column: 'deleted_at', ddl: 'deleted_at TEXT' },
  { table: 'pages', column: 'is_favorite', ddl: 'is_favorite INTEGER NOT NULL DEFAULT 0' },
  { table: 'pages', column: 'full_width', ddl: 'full_width INTEGER NOT NULL DEFAULT 0' },
  { table: 'pages', column: 'is_project', ddl: 'is_project INTEGER NOT NULL DEFAULT 0' },
  { table: 'pages', column: 'cover', ddl: 'cover TEXT' },
  { table: 'blocks', column: 'props', ddl: "props TEXT NOT NULL DEFAULT '{}'" },
  // Phase 1: every row belongs to an account. Filled by ensureSeedAdmin.
  { table: 'pages', column: 'owner_user_id', ddl: 'owner_user_id TEXT' },
  { table: 'events', column: 'owner_user_id', ddl: 'owner_user_id TEXT' },
  { table: 'files', column: 'owner_user_id', ddl: 'owner_user_id TEXT' },
  { table: 'api_tokens', column: 'user_id', ddl: 'user_id TEXT' },
  { table: 'tasks', column: 'priority', ddl: "priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low'))" },
];

function healSchema(): void {
  for (const { table, column, ddl } of EXPECTED_COLUMNS) {
    // Table names come from the constant above, never from user input.
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.length === 0) continue; // table itself missing: nothing to heal
    if (cols.some(c => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.warn(`[db] healed schema: added ${table}.${column}`);
  }
  // The index from 0006 is lost if that file was skipped on a duplicate column.
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_deleted_at ON pages(deleted_at)');
  // Owner indexes from 0009, same reason.
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_owner ON pages(owner_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)');
  // Task index from 0010.
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_owner_due ON tasks(owner_user_id, due_date)');
  // Label indexes from 0012.
  // healSchema runs after a migration file may have been skipped on a
  // duplicate-column error, so the tables are re-created first: otherwise the
  // indexes below would fail on a DB where 0012 stopped at the ALTER TABLE.
  db.exec(`CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(owner_user_id, name),
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS page_labels (
    page_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (page_id, label_id),
    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS task_labels (
    task_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (task_id, label_id),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS event_labels (
    event_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (event_id, label_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_labels_owner ON labels(owner_user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_page_labels_label ON page_labels(label_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_event_labels_label ON event_labels(label_id)');
}

// Helper: converts the 0/1 flags SQLite stores on a page into booleans, so the
// API returns the same shape as the Hono backend.
export function normalizePage(p: Row | undefined): Row | undefined {
  if (!p) return p;
  return {
    ...p,
    is_favorite: Boolean(p.is_favorite),
    full_width: Boolean(p.full_width),
    is_project: Boolean(p.is_project),
  };
}

// Helper: converts `checked` (which SQLite stores as 0/1) to boolean and
// parses `props` (JSON text) into an object. Used by every endpoint that
// returns blocks.
export function normalizeBlock(b: Row | undefined): Row | undefined {
  if (!b) return b;
  return { ...b, checked: Boolean(b.checked), collapsed: Boolean(b.collapsed), props: parseBlockProps(b.props) };
}
