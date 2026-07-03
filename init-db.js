// ============================================================
// Sout Network — Database schema & seed
// Creates SQLite database with all tables and a default admin.
// Run once: node init-db.js
// (Safe to re-run: uses IF NOT EXISTS, seeds only when empty)
// ============================================================
const { openDatabase } = require('./db');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'sout.db');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

async function main() {
const db = await openDatabase(DB_PATH);
db.pragma('foreign_keys = ON');

// ---------- USERS (admins + client users) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'client',   -- 'admin' or 'client'
  client_id     INTEGER,                          -- which client account this user belongs to (NULL for admins)
  status        TEXT NOT NULL DEFAULT 'active',    -- 'active' or 'disabled'
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);`);

// ---------- CLIENTS (label / company accounts) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'Label',
  status        TEXT NOT NULL DEFAULT 'active',
  balance       REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);`);

// ---------- RELEASES ----------
db.exec(`
CREATE TABLE IF NOT EXISTS releases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  title         TEXT NOT NULL,
  artist        TEXT,
  label         TEXT,
  upc           TEXT,
  type          TEXT DEFAULT 'Single',
  genre         TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',     -- draft, submitted, review, approved, delivered, live, rejected, correction
  note          TEXT,                               -- rejection / correction reason
  digital_date  TEXT,
  original_date TEXT,
  territories   TEXT DEFAULT 'Worldwide',
  stores        TEXT DEFAULT 'All',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at  TEXT,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);`);

// ---------- TRACKS ----------
db.exec(`
CREATE TABLE IF NOT EXISTS tracks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id    INTEGER NOT NULL,
  title         TEXT NOT NULL,
  c_line        TEXT,
  p_line        TEXT,
  isrc          TEXT,
  version       TEXT DEFAULT 'Original',
  lyrics_lang   TEXT,
  content_type  TEXT DEFAULT 'Not Explicit',
  production_year TEXT,
  audio_file    TEXT,                               -- stored filename
  track_no      INTEGER DEFAULT 1,
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
);`);

// ---------- CONTRIBUTORS ----------
db.exec(`
CREATE TABLE IF NOT EXISTS contributors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id      INTEGER NOT NULL,
  role          TEXT NOT NULL,                      -- Main Artist, Featured, Composer, Author
  name          TEXT NOT NULL,
  is_composer   INTEGER DEFAULT 0,
  is_author     INTEGER DEFAULT 0,
  spotify_url   TEXT,
  apple_url     TEXT,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);`);

// ---------- AUDIT LOG ----------
db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email    TEXT,
  action        TEXT NOT NULL,
  target        TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);`);

// ---------- SAVED LABELS (autocomplete) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS labels (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL,
  name       TEXT NOT NULL,
  UNIQUE(client_id, name)
);`);

// ---------- ROLE PERMISSIONS (RBAC matrix) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS role_permissions (
  role        TEXT NOT NULL,
  capability  TEXT NOT NULL,
  allowed     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role, capability)
);`);

// ---------- PER-USER PERMISSION OVERRIDES ----------
db.exec(`
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id     INTEGER NOT NULL,
  capability  TEXT NOT NULL,
  allowed     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, capability),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);`);

// ---------- SETTINGS (key/value) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);`);

// ============================================================
// RIGHTS MANAGER — rights issues + claim requests
// ============================================================

// ---------- RIGHTS ISSUES ----------
// Admin enters these daily (from Believe) per client.
// Client sees them, answers, answer goes back to admin.
db.exec(`
CREATE TABLE IF NOT EXISTS rights_issues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  platform      TEXT NOT NULL DEFAULT 'youtube',   -- youtube | facebook | tiktok | other
  category      TEXT NOT NULL,                     -- ownership_conflict | disputed_claim | takedown_video | ugc_monetize | ugc_block | release_claim | copyright_check
  asset_title   TEXT,
  album_title   TEXT,
  track_title   TEXT,
  artist        TEXT,
  asset_id      TEXT,
  isrc          TEXT,
  upc           TEXT,
  other_party   TEXT,
  video_url     TEXT,
  daily_views   INTEGER DEFAULT 0,
  expiry_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'new',       -- new | answered | resolved | rejected
  client_answer TEXT,                              -- dispute: yes|no  /  ownership: original_exclusive|non_exclusive_license|contentid_exclusive|soundalike|public_domain|no_rights
  client_answer_note TEXT,
  answered_at   TEXT,
  resolved_at   TEXT,
  resolution_note TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);`);

// ---------- CLAIM REQUESTS ----------
// Client-initiated: manual_claim (monetize/block/takedown) or release_claim.
// Also auto-created when client answers YES on a dispute.
db.exec(`
CREATE TABLE IF NOT EXISTS claim_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  user_id       INTEGER,
  kind          TEXT NOT NULL,                     -- manual_claim | release_claim
  platform      TEXT NOT NULL DEFAULT 'youtube',   -- youtube | facebook | tiktok
  action        TEXT,                              -- for manual_claim: ugc_monetize | ugc_block | takedown
  video_url     TEXT,
  release_id    INTEGER,
  upc           TEXT,
  isrc          TEXT,
  asset_title   TEXT,
  artist        TEXT,
  note          TEXT,
  source_issue_id INTEGER,                         -- filled automatically when created from a dispute YES
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | in_progress | done | rejected
  admin_note    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (source_issue_id) REFERENCES rights_issues(id)
);`);

// ---------- indexes ----------
db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_client   ON rights_issues (client_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_status   ON rights_issues (status);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_category ON rights_issues (category);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_created  ON rights_issues (created_at);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_client   ON claim_requests (client_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_status   ON claim_requests (status);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_created  ON claim_requests (created_at);`);

// seed default role permissions if empty
const capList = ['upload_releases','edit_releases','deliver_releases','metadata_edits','takedowns','financial_access','rights_access','analytics_access','team_access'];
const roleDefaults = {
  admin:   capList,                                   // admin: all
  client:  ['upload_releases','edit_releases','metadata_edits','rights_access','analytics_access'],
};
const permCount = db.prepare('SELECT COUNT(*) AS n FROM role_permissions').get().n;
if (permCount === 0) {
  const ins = db.prepare('INSERT INTO role_permissions (role,capability,allowed) VALUES (?,?,?)');
  for (const role of ['admin','client','label_manager','operations','finance','analyst']) {
    for (const cap of capList) {
      const allowed = (roleDefaults[role] || []).includes(cap) ? 1 : 0;
      ins.run(role, cap, allowed);
    }
  }
  console.log('✓ Seeded default role permissions');
}

// ============================================================
// SEED: default admin + one demo client (only if empty)
// ============================================================
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const adminPass = 'ChangeMe123!';   // CHANGE THIS after first login
  const hash = bcrypt.hashSync(adminPass, 12);
  db.prepare(`INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?,?)`)
    .run('admin@soutnetwork.com', hash, 'Sout Admin', 'admin');

  // demo client
  const info = db.prepare(`INSERT INTO clients (name, plan) VALUES (?,?)`).run('ELshamrany', 'Label');
  const clientId = info.lastInsertRowid;
  const cpass = bcrypt.hashSync('Client123!', 12);
  db.prepare(`INSERT INTO users (email, password_hash, name, role, client_id) VALUES (?,?,?,?,?)`)
    .run('client@soutnetwork.com', cpass, 'ELshamrany Manager', 'client', clientId);

  console.log('✓ Seeded default admin: admin@soutnetwork.com / ' + adminPass);
  console.log('✓ Seeded demo client:  client@soutnetwork.com / Client123!');
  console.log('  IMPORTANT: change these passwords after first login.');
}

console.log('✓ Database ready at', DB_PATH);
db.close();
}

main().catch(e => { console.error('init-db error:', e); process.exit(1); });
