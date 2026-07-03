// ============================================================
// Sout Network — Rights Manager migration
// Adds rights_issues + claim_requests tables to the EXISTING db.
// Safe to run more than once (IF NOT EXISTS everywhere).
// IMPORTANT: stop the app first →  pm2 stop sout-app
// Run:  node migrate-rights.js
// ============================================================
const { openDatabase } = require('./db');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'sout.db');
if (!fs.existsSync(DB_PATH)) {
  console.error('✗ Database not found at', DB_PATH, '— run init-db.js first.');
  process.exit(1);
}

async function main() {
  const db = await openDatabase(DB_PATH);
  db.pragma('foreign_keys = ON');

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
    asset_id      TEXT,                              -- e.g. A724776324629729
    isrc          TEXT,
    upc           TEXT,
    other_party   TEXT,                              -- e.g. Warner Music Group / Injaz Teqani
    video_url     TEXT,                              -- "Link to the video"
    daily_views   INTEGER DEFAULT 0,
    expiry_date   TEXT,                              -- deadline (YYYY-MM-DD)
    status        TEXT NOT NULL DEFAULT 'new',       -- new | answered | resolved | rejected
    client_answer TEXT,                              -- dispute: yes|no  /  ownership: original_exclusive|non_exclusive_license|contentid_exclusive|soundalike|public_domain|no_rights
    client_answer_note TEXT,                         -- optional free text from client
    answered_at   TEXT,
    resolved_at   TEXT,
    resolution_note TEXT,                            -- admin note when resolving in Believe
    created_by    TEXT,                              -- admin email who entered it
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
    user_id       INTEGER,                           -- which user submitted it
    kind          TEXT NOT NULL,                     -- manual_claim | release_claim
    platform      TEXT NOT NULL DEFAULT 'youtube',   -- youtube | facebook | tiktok
    action        TEXT,                              -- for manual_claim: ugc_monetize | ugc_block | takedown
    video_url     TEXT,
    release_id    INTEGER,                           -- optional link to a release
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

  // ---------- indexes (for fast filtering + 90-day analytics) ----------
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_client   ON rights_issues (client_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_status   ON rights_issues (status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_category ON rights_issues (category);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ri_created  ON rights_issues (created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_client   ON claim_requests (client_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_status   ON claim_requests (status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cr_created  ON claim_requests (created_at);`);

  // ---------- verify ----------
  const t1 = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='rights_issues'`).get().n;
  const t2 = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='claim_requests'`).get().n;
  if (t1 && t2) {
    console.log('✓ rights_issues table ready');
    console.log('✓ claim_requests table ready');
    console.log('✓ Migration complete — existing data untouched.');
  } else {
    console.error('✗ Something went wrong, tables missing.');
    process.exit(1);
  }
  db.close();
}

main().catch(e => { console.error('migration error:', e); process.exit(1); });
