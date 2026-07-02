// ============================================================
// Sout Network — Backend API server
// Node.js + Express + SQLite. Secure auth, client isolation.
// ============================================================
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;
const DB_PATH = path.join(__dirname, 'data', 'sout.db');

// JWT secret: read from file or generate one and persist it
const SECRET_PATH = path.join(__dirname, 'data', '.jwt_secret');
let JWT_SECRET;
if (fs.existsSync(SECRET_PATH)) {
  JWT_SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
} else {
  JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_PATH, JWT_SECRET, { mode: 0o600 });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ---------- helpers ----------
function audit(req, action, target) {
  try {
    db.prepare('INSERT INTO audit_log (user_email, action, target, ip) VALUES (?,?,?,?)')
      .run(req.user ? req.user.email : 'anonymous', action, target || '', req.ip);
  } catch (e) { /* non-fatal */ }
}

function sign(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, client_id: user.client_id, name: user.name },
    JWT_SECRET, { expiresIn: '7d' }
  );
}

// auth middleware — verifies cookie token
function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}
// admin-only middleware
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ---------- rate limiter on login ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts, try later' } });

// ============================================================
// AUTH
// ============================================================
app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!user || user.status !== 'active' || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = sign(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 7 * 864e5 });
  audit({ user: { email: user.email }, ip: req.ip }, 'auth.login', user.email);
  res.json({ ok: true, user: { name: user.name, email: user.email, role: user.role, client_id: user.client_id } });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: { name: req.user.name, email: req.user.email, role: req.user.role, client_id: req.user.client_id } });
});

// change own password
app.post('/api/change-password', auth, (req, res) => {
  const { current, next: newPass } = req.body || {};
  if (!newPass || newPass.length < 8) return res.status(400).json({ error: 'New password must be 8+ characters' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current || '', user.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPass, 12), req.user.id);
  audit(req, 'auth.password_change', req.user.email);
  res.json({ ok: true });
});

// ============================================================
// RELEASES  (client sees only theirs; admin sees all)
// ============================================================
app.get('/api/releases', auth, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`SELECT r.*, c.name AS client_name FROM releases r JOIN clients c ON c.id=r.client_id ORDER BY r.created_at DESC`).all();
  } else {
    rows = db.prepare(`SELECT * FROM releases WHERE client_id = ? ORDER BY created_at DESC`).all(req.user.client_id);
  }
  res.json({ releases: rows });
});

app.get('/api/releases/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && r.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' });
  const tracks = db.prepare('SELECT * FROM tracks WHERE release_id = ? ORDER BY track_no').all(r.id);
  for (const t of tracks) t.contributors = db.prepare('SELECT * FROM contributors WHERE track_id = ?').all(t.id);
  res.json({ release: r, tracks });
});

// create release (client)
app.post('/api/releases', auth, (req, res) => {
  const clientId = req.user.role === 'admin' ? (req.body.client_id) : req.user.client_id;
  if (!clientId) return res.status(400).json({ error: 'Client required' });
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO releases (client_id,title,artist,label,upc,type,genre,status,digital_date,original_date,territories,stores)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    clientId, b.title || 'Untitled', b.artist || '', b.label || '', b.upc || '', b.type || 'Single',
    b.genre || '', b.status === 'submitted' ? 'submitted' : 'draft',
    b.digital_date || '', b.original_date || '', b.territories || 'Worldwide', b.stores || 'All');
  const relId = info.lastInsertRowid;
  // tracks
  (b.tracks || []).forEach((t, i) => {
    const tInfo = db.prepare(`INSERT INTO tracks (release_id,title,c_line,p_line,isrc,version,lyrics_lang,content_type,production_year,track_no)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(relId, t.title || '', t.c_line || '', t.p_line || '', t.isrc || '',
      t.version || 'Original', t.lyrics_lang || '', t.content_type || 'Not Explicit', t.production_year || '', i + 1);
    const trackId = tInfo.lastInsertRowid;
    (t.contributors || []).forEach(c => {
      db.prepare(`INSERT INTO contributors (track_id,role,name,is_composer,is_author,spotify_url,apple_url) VALUES (?,?,?,?,?,?,?)`)
        .run(trackId, c.role || 'Main Artist', c.name || '', c.is_composer ? 1 : 0, c.is_author ? 1 : 0, c.spotify_url || '', c.apple_url || '');
    });
  });
  // save label for autocomplete
  if (b.label) { try { db.prepare('INSERT OR IGNORE INTO labels (client_id,name) VALUES (?,?)').run(clientId, b.label); } catch {} }
  audit(req, 'release.create', b.title || ('#' + relId));
  res.json({ ok: true, id: relId });
});

// edit release — only if editable (draft/rejected/correction) unless admin
app.put('/api/releases/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const isOwner = r.client_id === req.user.client_id;
  if (req.user.role !== 'admin' && !isOwner) return res.status(403).json({ error: 'Forbidden' });
  const editable = ['draft', 'rejected', 'correction'].includes(r.status);
  if (req.user.role !== 'admin' && !editable) return res.status(403).json({ error: 'This release is locked. Contact support.' });
  const b = req.body || {};
  db.prepare(`UPDATE releases SET title=?,artist=?,label=?,upc=?,type=?,genre=?,digital_date=?,original_date=?,territories=?,stores=?,updated_at=datetime('now') WHERE id=?`)
    .run(b.title ?? r.title, b.artist ?? r.artist, b.label ?? r.label, b.upc ?? r.upc, b.type ?? r.type,
      b.genre ?? r.genre, b.digital_date ?? r.digital_date, b.original_date ?? r.original_date,
      b.territories ?? r.territories, b.stores ?? r.stores, r.id);
  audit(req, 'release.edit', r.title);
  res.json({ ok: true });
});

// submit for review (client)
app.post('/api/releases/:id/submit', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && r.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' });
  if (!['draft', 'rejected', 'correction'].includes(r.status)) return res.status(400).json({ error: 'Cannot submit in current status' });
  db.prepare(`UPDATE releases SET status='submitted', updated_at=datetime('now') WHERE id=?`).run(r.id);
  audit(req, 'release.submit', r.title);
  res.json({ ok: true });
});

// delete — only draft, only owner/admin
app.delete('/api/releases/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && r.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role !== 'admin' && r.status !== 'draft') return res.status(403).json({ error: 'Only drafts can be deleted. Contact support.' });
  db.prepare('DELETE FROM releases WHERE id = ?').run(r.id);
  audit(req, 'release.delete', r.title);
  res.json({ ok: true });
});

// ============================================================
// ADMIN — moderation (approve / reject / correction / deliver)
// ============================================================
app.post('/api/admin/releases/:id/status', auth, adminOnly, (req, res) => {
  const { status, note } = req.body || {};
  const allowed = ['review', 'approved', 'delivered', 'live', 'rejected', 'correction'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const deliveredAt = status === 'delivered' ? `datetime('now')` : 'delivered_at';
  db.prepare(`UPDATE releases SET status=?, note=?, delivered_at=${status === 'delivered' ? "datetime('now')" : 'delivered_at'}, updated_at=datetime('now') WHERE id=?`)
    .run(status, note || null, r.id);
  audit(req, 'release.' + status, r.title);
  res.json({ ok: true });
});

// ============================================================
// ADMIN — users & clients
// ============================================================
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.email,u.name,u.role,u.status,u.created_at,c.name AS client_name
    FROM users u LEFT JOIN clients c ON c.id=u.client_id ORDER BY u.created_at DESC`).all();
  res.json({ users: rows });
});

app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const { email, name, password, role, client_id } = req.body || {};
  if (!email || !name || !password || password.length < 8) return res.status(400).json({ error: 'Valid email, name, and 8+ char password required' });
  try {
    db.prepare(`INSERT INTO users (email,password_hash,name,role,client_id) VALUES (?,?,?,?,?)`)
      .run(email.toLowerCase().trim(), bcrypt.hashSync(password, 12), name, role === 'admin' ? 'admin' : 'client', client_id || null);
    audit(req, 'user.create', email);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.post('/api/admin/users/:id/disable', auth, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const newStatus = u.status === 'active' ? 'disabled' : 'active';
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(newStatus, u.id);
  audit(req, 'user.' + newStatus, u.email);
  res.json({ ok: true, status: newStatus });
});

app.post('/api/admin/users/:id/reset-password', auth, adminOnly, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 8) return res.status(400).json({ error: '8+ char password required' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), u.id);
  audit(req, 'user.password_reset', u.email);
  res.json({ ok: true });
});

app.get('/api/admin/clients', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM releases WHERE client_id=c.id) AS releases FROM clients c ORDER BY c.created_at DESC`).all();
  res.json({ clients: rows });
});

app.post('/api/admin/clients', auth, adminOnly, (req, res) => {
  const { name, plan } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare('INSERT INTO clients (name, plan) VALUES (?,?)').run(name, plan || 'Label');
  audit(req, 'client.create', name);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ============================================================
// AUDIT LOG (admin)
// ============================================================
app.get('/api/admin/audit', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500').all();
  res.json({ logs: rows });
});

// ============================================================
// AUDIO UPLOAD
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB

app.post('/api/tracks/:id/audio', auth, upload.single('audio'), (req, res) => {
  const t = db.prepare('SELECT t.*, r.client_id FROM tracks t JOIN releases r ON r.id=t.release_id WHERE t.id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Track not found' });
  if (req.user.role !== 'admin' && t.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('UPDATE tracks SET audio_file = ? WHERE id = ?').run(req.file.filename, t.id);
  audit(req, 'track.audio_upload', req.file.filename);
  res.json({ ok: true, file: req.file.filename });
});

// ============================================================
// LABELS autocomplete
// ============================================================
app.get('/api/labels', auth, (req, res) => {
  const cid = req.user.role === 'admin' ? (req.query.client_id || 0) : req.user.client_id;
  const rows = db.prepare('SELECT name FROM labels WHERE client_id = ? ORDER BY name').all(cid);
  res.json({ labels: rows.map(r => r.name) });
});

// ============================================================
// OVERVIEW stats (client dashboard)
// ============================================================
app.get('/api/overview', auth, (req, res) => {
  const where = req.user.role === 'admin' ? '' : 'WHERE client_id = ' + Number(req.user.client_id);
  const count = (st) => db.prepare(`SELECT COUNT(*) AS n FROM releases ${where ? where + ' AND' : 'WHERE'} status = ?`).get(st).n;
  const delivered = db.prepare(`SELECT * FROM releases ${where ? where + ' AND' : 'WHERE'} status IN ('delivered','live') ORDER BY delivered_at DESC LIMIT 6`).all();
  res.json({
    stats: {
      draft: count('draft'), submitted: count('submitted'), review: count('review'),
      approved: count('approved'), delivered: count('delivered'), live: count('live'),
      rejected: count('rejected'), correction: count('correction')
    },
    latest_delivered: delivered
  });
});

// ============================================================
// ADMIN — full edit powers (edit any user, client, release)
// ============================================================

// edit any user (name, role, client, status)
app.put('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE users SET name=?, role=?, client_id=?, status=? WHERE id=?`)
    .run(b.name ?? u.name, b.role ?? u.role, b.client_id ?? u.client_id, b.status ?? u.status, u.id);
  audit(req, 'user.edit', u.email);
  res.json({ ok: true });
});

// edit any client
app.put('/api/admin/clients/:id', auth, adminOnly, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE clients SET name=?, plan=?, status=?, balance=? WHERE id=?`)
    .run(b.name ?? c.name, b.plan ?? c.plan, b.status ?? c.status, b.balance ?? c.balance, c.id);
  audit(req, 'client.edit', c.name);
  res.json({ ok: true });
});

// admin edit any release fully (any field, any status)
app.put('/api/admin/releases/:id', auth, adminOnly, (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE releases SET title=?,artist=?,label=?,upc=?,type=?,genre=?,status=?,note=?,digital_date=?,original_date=?,territories=?,stores=?,updated_at=datetime('now') WHERE id=?`)
    .run(b.title ?? r.title, b.artist ?? r.artist, b.label ?? r.label, b.upc ?? r.upc, b.type ?? r.type,
      b.genre ?? r.genre, b.status ?? r.status, b.note ?? r.note, b.digital_date ?? r.digital_date,
      b.original_date ?? r.original_date, b.territories ?? r.territories, b.stores ?? r.stores, r.id);
  audit(req, 'release.admin_edit', r.title);
  res.json({ ok: true });
});

// ============================================================
// PERMISSIONS (RBAC matrix + per-user overrides)
// ============================================================
app.get('/api/admin/permissions', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM role_permissions ORDER BY role, capability').all();
  res.json({ permissions: rows });
});

app.post('/api/admin/permissions', auth, adminOnly, (req, res) => {
  const { role, capability, allowed } = req.body || {};
  if (!role || !capability) return res.status(400).json({ error: 'role and capability required' });
  db.prepare(`INSERT INTO role_permissions (role,capability,allowed) VALUES (?,?,?)
    ON CONFLICT(role,capability) DO UPDATE SET allowed=excluded.allowed`).run(role, capability, allowed ? 1 : 0);
  audit(req, 'permission.update', `${role}.${capability}=${allowed ? 1 : 0}`);
  res.json({ ok: true });
});

// grant/revoke a capability for a specific user (admin can give any permission to anyone)
app.post('/api/admin/users/:id/permission', auth, adminOnly, (req, res) => {
  const { capability, allowed } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare(`INSERT INTO user_permissions (user_id,capability,allowed) VALUES (?,?,?)
    ON CONFLICT(user_id,capability) DO UPDATE SET allowed=excluded.allowed`).run(u.id, capability, allowed ? 1 : 0);
  audit(req, 'user.permission', `${u.email}:${capability}=${allowed ? 1 : 0}`);
  res.json({ ok: true });
});

// what can the logged-in user do? (role perms + overrides)
app.get('/api/permissions', auth, (req, res) => {
  const rolePerms = db.prepare('SELECT capability, allowed FROM role_permissions WHERE role = ?').all(req.user.role);
  const overrides = db.prepare('SELECT capability, allowed FROM user_permissions WHERE user_id = ?').all(req.user.id);
  const caps = {};
  rolePerms.forEach(p => caps[p.capability] = !!p.allowed);
  overrides.forEach(p => caps[p.capability] = !!p.allowed);
  res.json({ capabilities: caps });
});

// ============================================================
// CSV EXPORT — approved/delivered releases for Believe bulk
// ============================================================
function csvCell(v) {
  v = (v == null ? '' : String(v));
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
app.get('/api/admin/export.csv', auth, adminOnly, (req, res) => {
  // which statuses to export (default: approved + delivered)
  const status = (req.query.status || 'approved,delivered').split(',');
  const placeholders = status.map(() => '?').join(',');
  const releases = db.prepare(`SELECT r.*, c.name AS client_name FROM releases r JOIN clients c ON c.id=r.client_id WHERE r.status IN (${placeholders}) ORDER BY r.created_at DESC`).all(...status);
  const header = ['Release Title','Artist','Label','UPC','Type','Genre','Status','Digital Date','Original Date','Territories','Stores',
    'Track Title','ISRC','Version','C-Line','P-Line','Content Type','Production Year','Client'];
  const lines = [header.join(',')];
  for (const r of releases) {
    const tracks = db.prepare('SELECT * FROM tracks WHERE release_id = ? ORDER BY track_no').all(r.id);
    if (tracks.length === 0) {
      lines.push([r.title,r.artist,r.label,r.upc,r.type,r.genre,r.status,r.digital_date,r.original_date,r.territories,r.stores,'','','','','','','',r.client_name].map(csvCell).join(','));
    } else {
      for (const t of tracks) {
        lines.push([r.title,r.artist,r.label,r.upc,r.type,r.genre,r.status,r.digital_date,r.original_date,r.territories,r.stores,
          t.title,t.isrc,t.version,t.c_line,t.p_line,t.content_type,t.production_year,r.client_name].map(csvCell).join(','));
      }
    }
  }
  audit(req, 'export.csv', `${releases.length} releases`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sout-export-${Date.now()}.csv"`);
  res.send('\uFEFF' + lines.join('\n')); // BOM for Excel Arabic support
});

// ============================================================
// TRACKS / ARTISTS / FINANCE data (client-scoped)
// ============================================================
app.get('/api/tracks', auth, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`SELECT t.*, r.title AS release_title, r.artist, c.name AS client_name
      FROM tracks t JOIN releases r ON r.id=t.release_id JOIN clients c ON c.id=r.client_id ORDER BY t.id DESC`).all();
  } else {
    rows = db.prepare(`SELECT t.*, r.title AS release_title, r.artist FROM tracks t JOIN releases r ON r.id=t.release_id
      WHERE r.client_id = ? ORDER BY t.id DESC`).all(req.user.client_id);
  }
  res.json({ tracks: rows });
});

app.get('/api/clients-list', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT id, name FROM clients ORDER BY name').all();
  res.json({ clients: rows });
});

// ---------- health ----------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, '127.0.0.1', () => console.log(`Sout backend running on 127.0.0.1:${PORT}`));
