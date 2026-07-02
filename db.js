// ============================================================
// db.js — SQLite via sql.js (pure JS/WASM, no native build).
// Mimics the subset of better-sqlite3 API used by this app,
// and persists to disk on every write.
// ============================================================
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

let SQL = null;      // sql.js module
let dbFile = null;   // path on disk
let database = null; // sql.js Database instance
let dirty = false;
let saveTimer = null;

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 150);
}
function flush() {
  saveTimer = null;
  if (!dirty || !database || !dbFile) return;
  try {
    const data = database.export();
    fs.writeFileSync(dbFile, Buffer.from(data));
    dirty = false;
  } catch (e) { console.error('DB save error:', e.message); }
}
// flush on exit
process.on('exit', flush);
process.on('SIGINT', () => { flush(); process.exit(0); });
process.on('SIGTERM', () => { flush(); process.exit(0); });

// Detect if a SQL string writes (to trigger persistence)
function isWrite(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)/i.test(sql);
}

// Statement wrapper mimicking better-sqlite3 prepare().get/all/run
class Statement {
  constructor(sql) { this.sql = sql; this._write = isWrite(sql); }

  _bindRun(params) {
    const stmt = database.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      stmt.step();
    } finally { stmt.free(); }
  }

  get(...params) {
    const stmt = database.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally { stmt.free(); }
  }

  all(...params) {
    const stmt = database.prepare(this.sql);
    const out = [];
    try {
      if (params.length) stmt.bind(params);
      while (stmt.step()) out.push(stmt.getAsObject());
    } finally { stmt.free(); }
    return out;
  }

  run(...params) {
    this._bindRun(params);
    const changes = database.getRowsModified();
    let lastInsertRowid = 0;
    if (this._write) {
      const r = database.exec('SELECT last_insert_rowid() AS id');
      if (r && r[0] && r[0].values && r[0].values[0]) lastInsertRowid = r[0].values[0][0];
      scheduleSave();
    }
    return { changes, lastInsertRowid };
  }
}

// DB wrapper
class DB {
  prepare(sql) { return new Statement(sql); }
  exec(sql) { database.exec(sql); if (isWrite(sql)) scheduleSave(); return this; }
  pragma(p) { try { database.exec('PRAGMA ' + p); } catch (e) { } }
  close() { flush(); if (database) database.close(); }
}

// Async initializer — must be awaited before use
async function openDatabase(filePath) {
  dbFile = filePath;
  SQL = await initSqlJs();
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    database = new SQL.Database(new Uint8Array(buf));
  } else {
    database = new SQL.Database();
  }
  return new DB();
}

module.exports = { openDatabase };
