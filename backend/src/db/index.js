import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

/**
 * Persistence uses node:sqlite, the SQLite binding built into Node itself.
 *
 * This was chosen over better-sqlite3 deliberately: better-sqlite3 is a native
 * addon that must either download a prebuilt binary or compile from source
 * with Python and a C++ toolchain. On a locked-down institutional network
 * neither is reliable. node:sqlite ships with the runtime, so `npm install`
 * never needs a compiler and the project runs anywhere Node 22.5+ runs.
 *
 * The trade-off is that node:sqlite is still marked experimental, so its API
 * may change between Node majors. Because all SQL is confined to the
 * repository layer and this module is the only place the driver is
 * constructed, replacing it is a contained change.
 */

/** Rows arrive as null-prototype objects; normalise them so the rest of the
 *  application can treat them as ordinary objects (spread, JSON, hasOwn). */
function plain(row) {
  return row == null ? row : { ...row };
}

function wrapStatement(statement) {
  return {
    get: (...args) => plain(statement.get(...args)),
    all: (...args) => statement.all(...args).map(plain),
    run: (...args) => statement.run(...args),
  };
}

/**
 * Brings a database created by an earlier version up to the current users
 * definition (MODERATOR role, active flag). SQLite cannot alter a CHECK
 * constraint in place, so the table is rebuilt using the documented
 * create-copy-drop-rename procedure, with foreign key enforcement suspended
 * for the duration so that rows in other tables keep pointing at the same ids.
 * Runs once; on a current database it is a no-op.
 */
function migrateUsersTable(handle) {
  const existing = handle
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get();
  if (!existing) return; // fresh database: schema.sql creates the current shape
  if (existing.sql.includes('MODERATOR') && /\bactive\b/.test(existing.sql)) return;

  const hasActive = /\bactive\b/.test(existing.sql);

  handle.exec('PRAGMA foreign_keys = OFF');
  handle.exec('BEGIN');
  try {
    handle.exec(`
      CREATE TABLE users_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        email           TEXT    NOT NULL UNIQUE,
        password_hash   TEXT    NOT NULL,
        first_name      TEXT    NOT NULL,
        surname         TEXT    NOT NULL,
        role            TEXT    NOT NULL DEFAULT 'APPLICANT'
                                CHECK (role IN ('APPLICANT','ASSESSOR','MODERATOR','ADMINISTRATOR')),
        active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users_new (id, email, password_hash, first_name, surname, role, active, created_at)
        SELECT id, email, password_hash, first_name, surname, role,
               ${hasActive ? 'active' : '1'}, created_at
        FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    // An older database could hold several administrators. Keep the first
    // active one so the single-administrator index can be created.
    handle.exec(`
      UPDATE users SET active = 0
      WHERE role = 'ADMINISTRATOR' AND active = 1
        AND id <> (SELECT MIN(id) FROM users WHERE role = 'ADMINISTRATOR' AND active = 1)
    `);
    handle.exec('COMMIT');
  } catch (err) {
    try { handle.exec('ROLLBACK'); } catch { /* already unwound */ }
    throw err;
  } finally {
    handle.exec('PRAGMA foreign_keys = ON');
  }
}

export function getDb() {
  if (db) return db;

  const dbPath = config.dbPath;
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const handle = new DatabaseSync(dbPath);

  // Foreign keys are off by default in SQLite and must be enabled per
  // connection. The identifying relationship on evidence depends on this.
  handle.exec('PRAGMA foreign_keys = ON');
  // WAL improves read concurrency, which matters because this workload is
  // strongly read-dominated (status views and evidence retrieval).
  if (dbPath !== ':memory:') handle.exec('PRAGMA journal_mode = WAL');

  migrateUsersTable(handle);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  handle.exec(schema);

  db = {
    prepare: (sql) => wrapStatement(handle.prepare(sql)),
    exec: (sql) => handle.exec(sql),
    close: () => handle.close(),

    /**
     * Returns a function that runs `fn` inside a transaction.
     *
     * This is the mechanism by which the invariant "no status change exists
     * without its audit row" is guaranteed: the status update and the audit
     * insert run together and either both commit or neither does.
     *
     * SQLite does not support nested transactions, so a call made while one
     * is already open joins the outer transaction rather than starting a new
     * one — the outermost call owns the commit.
     */
    transaction(fn) {
      return (...args) => {
        if (db._inTransaction) return fn(...args);

        db._inTransaction = true;
        handle.exec('BEGIN');
        try {
          const result = fn(...args);
          handle.exec('COMMIT');
          return result;
        } catch (err) {
          try { handle.exec('ROLLBACK'); } catch { /* already unwound */ }
          throw err;
        } finally {
          db._inTransaction = false;
        }
      };
    },

    _inTransaction: false,
  };

  return db;
}

export function transaction(fn) {
  return getDb().transaction(fn);
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

export function resetDbForTests() {
  closeDb();
}
