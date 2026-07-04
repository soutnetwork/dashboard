// ============================================================
// Sout Network — Backend API server
// Node.js + Express + SQLite (sql.js). Secure auth, client isolation.
// Rights Manager: admin enters issues → client answers → admin resolves.
// ============================================================
const express = require('express');
const { openDatabase } = require('./db');
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
  try { fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true }); } catch { }
  fs.writeFileSync(SECRET_PATH, JWT_SECRET, { mode: 0o600 });
}

let db; // assigned in main() before listen

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// ---------- static files (block sensitive paths) ----------
app.use((req, res, next) => {
  const p = req.path;
  if (p.startsWith('/data') || p.startsWith('/node_modules') || p.includes('.db') || p.includes('.jwt')) {
    return res.status(404).end();
  }
  next();
});
// admin.html is served ONLY to logged-in admins (server-side protection)
app.get('/admin.html', (req, res, next) => {
  try {
    const u = jwt.verify(req.cookies.token, JWT_SECRET);
    if (u.role === 'admin') return next();
  } catch { }
  res.redirect('/login.html');
});
app.use(express.static(__dirname, { dotfiles: 'deny', index: 'login.html' }));

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
  res.json({ ok: true, user: { name: user.name, email: user.email, role: user.role, client_id: user.client_id, must_change: user.must_change_password === 1 } });
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
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(newPass, 12), req.user.id);
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
  const r = db.prepare('SELECT r.*, c.name AS client_name FROM releases r JOIN clients c ON c.id = r.client_id WHERE r.id = ?').get(req.params.id);
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
    b.genre || '', 'draft',
    b.digital_date || '', b.original_date || '', b.territories || 'Worldwide', b.stores || 'All');
  const relId = info.lastInsertRowid;
  // attach pre-uploaded (staged) artwork
  if (validStaged(b.artwork_staged, 'art', req)) {
    db.prepare('UPDATE releases SET artwork = ? WHERE id = ?').run(b.artwork_staged, relId);
  }
  // tracks
  (b.tracks || []).forEach((t, i) => {
    const stagedAudio = validStaged(t.audio_staged, 'aud', req) ? t.audio_staged : null;
    const tInfo = db.prepare(`INSERT INTO tracks (release_id,title,c_line,p_line,isrc,version,lyrics_lang,content_type,production_year,track_no,audio_file)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(relId, t.title || '', t.c_line || '', t.p_line || '', t.isrc || '',
      t.version || 'Original', t.lyrics_lang || '', t.content_type || 'Not Explicit', t.production_year || '', i + 1, stagedAudio);
    const trackId = tInfo.lastInsertRowid;
    (t.contributors || []).forEach(c => {
      db.prepare(`INSERT INTO contributors (track_id,role,name,is_composer,is_author,spotify_url,apple_url) VALUES (?,?,?,?,?,?,?)`)
        .run(trackId, c.role || 'Main Artist', c.name || '', c.is_composer ? 1 : 0, c.is_author ? 1 : 0, c.spotify_url || '', c.apple_url || '');
    });
  });
  // save label for autocomplete
  if (b.label) { try { db.prepare('INSERT OR IGNORE INTO labels (client_id,name) VALUES (?,?)').run(clientId, b.label); } catch { } }
  audit(req, 'release.create', b.title || ('#' + relId));
  const createdTracks = db.prepare('SELECT id, title, track_no FROM tracks WHERE release_id = ? ORDER BY track_no').all(relId);
  res.json({ ok: true, id: relId, tracks: createdTracks });
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
  if (validStaged(b.artwork_staged, 'art', req)) {
    db.prepare('UPDATE releases SET artwork = ? WHERE id = ?').run(b.artwork_staged, r.id);
  }
  audit(req, 'release.edit', r.title);
  res.json({ ok: true });
});

// submit for review (client)
app.post('/api/releases/:id/submit', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && r.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' });
  if (!['draft', 'rejected', 'correction'].includes(r.status)) return res.status(400).json({ error: 'Cannot submit in current status' });

  // ----- completeness gate: NOTHING incomplete reaches the review queue -----
  const missing = [];
  if (!r.title) missing.push('Release title');
  if (!r.label) missing.push('Label');
  if (!r.genre) missing.push('Genre');
  if (!r.digital_date) missing.push('Digital release date');
  if (!r.artwork) missing.push('Cover artwork (JPG 3000×3000)');
  const tracks = db.prepare('SELECT * FROM tracks WHERE release_id = ? ORDER BY track_no').all(r.id);
  if (!tracks.length) missing.push('At least one track');
  tracks.forEach(t => {
    const n = `Track ${t.track_no} (${t.title || 'untitled'}): `;
    if (!t.title) missing.push(n + 'title');
    if (!t.c_line) missing.push(n + 'C Line');
    if (!t.p_line) missing.push(n + 'P Line');
    if (!t.audio_file) missing.push(n + 'WAV audio file');
    const hasMain = db.prepare(`SELECT COUNT(*) AS n FROM contributors WHERE track_id = ? AND role LIKE '%Main%'`).get(t.id).n;
    if (!hasMain) missing.push(n + 'Main Artist');
  });
  if (missing.length) {
    return res.status(400).json({ error: 'Release is not complete — missing:\n• ' + missing.join('\n• ') });
  }

  db.prepare(`UPDATE releases SET status='submitted', note=NULL, updated_at=datetime('now') WHERE id=?`).run(r.id);
  audit(req, 'release.submit', r.title);
  res.json({ ok: true });
});

// delete — only draft, only owner/admin
app.delete('/api/releases/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && r.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role !== 'admin' && r.status !== 'draft') return res.status(403).json({ error: 'Only drafts can be deleted. Contact support.' });
  // remove files from disk too
  try { if (r.artwork) fs.unlinkSync(path.join(__dirname, 'uploads', r.artwork)); } catch { }
  db.prepare('SELECT audio_file FROM tracks WHERE release_id = ?').all(r.id).forEach(t => {
    try { if (t.audio_file) fs.unlinkSync(path.join(__dirname, 'uploads', t.audio_file)); } catch { }
  });
  db.prepare('DELETE FROM tracks WHERE release_id = ?').run(r.id);
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
  db.prepare(`UPDATE releases SET status=?, note=?, delivered_at=${status === 'delivered' ? "datetime('now')" : 'delivered_at'}, updated_at=datetime('now') WHERE id=?`)
    .run(status, note || null, r.id);
  // approving a release automatically generates its UPC/ISRC and renames files
  let codes = null;
  if (status === 'approved') {
    try { codes = generateCodesFor(r.id); audit(req, 'codes.generate', `#${r.id} UPC ${codes.upc}`); }
    catch (e) { console.error('auto-generate codes:', e.message); }
  }
  audit(req, 'release.' + status, r.title);
  res.json({ ok: true, codes });
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
  const rows = db.prepare(`SELECT c.*,
    (SELECT COUNT(*) FROM releases WHERE client_id=c.id) AS releases,
    (SELECT COUNT(*) FROM users WHERE client_id=c.id) AS users
    FROM clients c ORDER BY c.created_at DESC`).all();
  res.json({ clients: rows });
});

app.post('/api/admin/clients', auth, adminOnly, (req, res) => {
  const { name, plan } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  const info = db.prepare('INSERT INTO clients (name, plan) VALUES (?,?)').run(name, plan || 'Label');
  audit(req, 'client.create', name);
  res.json({ ok: true, id: info.lastInsertRowid });
});


// client full details (info + users + stats) for the Manage modal
app.get('/api/admin/clients/:id', auth, adminOnly, (req, res) => {
  const cli = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!cli) return res.status(404).json({ error: 'Not found' });
  const users = db.prepare(`SELECT id, email, name, role, status, must_change_password, created_at FROM users WHERE client_id = ? ORDER BY created_at`).all(cli.id);
  const stats = {
    releases: db.prepare('SELECT COUNT(*) AS n FROM releases WHERE client_id = ?').get(cli.id).n,
    live: db.prepare(`SELECT COUNT(*) AS n FROM releases WHERE client_id = ? AND status IN ('delivered','live')`).get(cli.id).n,
    pending: db.prepare(`SELECT COUNT(*) AS n FROM releases WHERE client_id = ? AND status IN ('submitted','review')`).get(cli.id).n,
    rights_open: db.prepare(`SELECT COUNT(*) AS n FROM rights_issues WHERE client_id = ? AND status IN ('new','answered')`).get(cli.id).n
  };
  res.json({ client: cli, users, stats });
});

// effective capabilities of a user (role defaults + per-user overrides)
app.get('/api/admin/users/:id/permissions', auth, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const caps = {};
  db.prepare('SELECT capability, allowed FROM role_permissions WHERE role = ?').all(u.role)
    .forEach(p => caps[p.capability] = { allowed: !!p.allowed, override: false });
  db.prepare('SELECT capability, allowed FROM user_permissions WHERE user_id = ?').all(u.id)
    .forEach(p => caps[p.capability] = { allowed: !!p.allowed, override: true });
  res.json({ user: { id: u.id, email: u.email, role: u.role }, capabilities: caps });
});

// ============================================================
// AUDIT LOG (admin)
// ============================================================
app.get('/api/admin/audit', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500').all();
  res.json({ logs: rows });
});

// ============================================================
// FILE VALIDATION HELPERS
// ============================================================
// WAV check: RIFF....WAVE magic bytes
function isWav(buf) {
  return buf && buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE';
}
// JPEG check + dimensions (parses SOF segment)
function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // not JPEG
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
    // SOF markers carry dimensions (C0-C3, C5-C7, C9-CB, CD-CF)
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}
function removeFile(f) { try { if (f && f.path) fs.unlinkSync(f.path); } catch { } }

// ============================================================
// UPLOADS — audio (WAV only) + artwork (JPG 3000x3000 only)
// ============================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB

app.post('/api/tracks/:id/audio', auth, upload.single('audio'), (req, res) => {
  const t = db.prepare('SELECT t.*, r.client_id FROM tracks t JOIN releases r ON r.id=t.release_id WHERE t.id=?').get(req.params.id);
  if (!t) { removeFile(req.file); return res.status(404).json({ error: 'Track not found' }); }
  if (req.user.role !== 'admin' && t.client_id !== req.user.client_id) { removeFile(req.file); return res.status(403).json({ error: 'Forbidden' }); }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // WAV only — check extension AND file signature
  const ext = path.extname(req.file.originalname).toLowerCase();
  const head = Buffer.alloc(12);
  try { const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd); } catch { }
  if (ext !== '.wav' || !isWav(head)) {
    removeFile(req.file);
    return res.status(400).json({ error: 'Audio must be a WAV file. Other formats are not accepted.' });
  }
  db.prepare('UPDATE tracks SET audio_file = ? WHERE id = ?').run(req.file.filename, t.id);
  audit(req, 'track.audio_upload', req.file.filename);
  res.json({ ok: true, file: req.file.filename });
});

// cover artwork — JPG/JPEG only, exactly 3000x3000
const artUpload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB
app.post('/api/releases/:id/artwork', auth, artUpload.single('artwork'), (req, res) => {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(req.params.id);
  if (!r) { removeFile(req.file); return res.status(404).json({ error: 'Not found' }); }
  if (req.user.role !== 'admin' && r.client_id !== req.user.client_id) { removeFile(req.file); return res.status(403).json({ error: 'Forbidden' }); }
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg') {
    removeFile(req.file);
    return res.status(400).json({ error: 'Artwork must be JPG or JPEG. Other formats are not accepted.' });
  }
  let dims = null;
  try { dims = jpegSize(fs.readFileSync(req.file.path)); } catch { }
  if (!dims) { removeFile(req.file); return res.status(400).json({ error: 'Invalid JPG file.' }); }
  if (dims.width !== 3000 || dims.height !== 3000) {
    removeFile(req.file);
    return res.status(400).json({ error: `Artwork must be exactly 3000x3000. Your image is ${dims.width}x${dims.height}.` });
  }
  db.prepare(`UPDATE releases SET artwork=?, updated_at=datetime('now') WHERE id=?`).run(req.file.filename, r.id);
  audit(req, 'release.artwork_upload', req.file.filename);
  res.json({ ok: true, file: req.file.filename });
});

// ============================================================
// STAGED UPLOADS — start uploading the moment the client picks a file.
// Files are validated immediately, stored with an owner-bound name,
// then attached to the release when it is saved.
// ============================================================
function stageName(kind, req, ext) {
  const owner = req.user.role === 'admin' ? 'adm' : String(req.user.client_id);
  return `stg-${kind}-${owner}-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
}
function validStaged(name, kind, req) {
  if (!name || typeof name !== 'string' || name.includes('/') || name.includes('..')) return false;
  const owner = req.user.role === 'admin' ? 'adm' : String(req.user.client_id);
  if (!name.startsWith(`stg-${kind}-${owner}-`)) return false;
  return fs.existsSync(path.join(__dirname, 'uploads', name));
}

app.post('/api/stage/artwork', auth, artUpload.single('artwork'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg') { removeFile(req.file); return res.status(400).json({ error: 'Artwork must be JPG or JPEG. Other formats are not accepted.' }); }
  let dims = null;
  try { dims = jpegSize(fs.readFileSync(req.file.path)); } catch { }
  if (!dims) { removeFile(req.file); return res.status(400).json({ error: 'Invalid JPG file.' }); }
  if (dims.width !== 3000 || dims.height !== 3000) {
    removeFile(req.file);
    return res.status(400).json({ error: `Artwork must be exactly 3000x3000. Your image is ${dims.width}x${dims.height}.` });
  }
  const newName = stageName('art', req, '.jpg');
  fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newName));
  res.json({ ok: true, file: newName });
});

app.post('/api/stage/audio', auth, upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const head = Buffer.alloc(12);
  try { const fd = fs.openSync(req.file.path, 'r'); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd); } catch { }
  if (ext !== '.wav' || !isWav(head)) {
    removeFile(req.file);
    return res.status(400).json({ error: 'Audio must be a WAV file. Other formats are not accepted.' });
  }
  const newName = stageName('aud', req, '.wav');
  fs.renameSync(req.file.path, path.join(__dirname, 'uploads', newName));
  res.json({ ok: true, file: newName });
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
app.put('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE users SET name=?, role=?, client_id=?, status=? WHERE id=?`)
    .run(b.name ?? u.name, b.role ?? u.role, b.client_id ?? u.client_id, b.status ?? u.status, u.id);
  audit(req, 'user.edit', u.email);
  res.json({ ok: true });
});

app.put('/api/admin/clients/:id', auth, adminOnly, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  db.prepare(`UPDATE clients SET name=?, plan=?, status=?, balance=? WHERE id=?`)
    .run(b.name ?? c.name, b.plan ?? c.plan, b.status ?? c.status, b.balance ?? c.balance, c.id);
  audit(req, 'client.edit', c.name);
  res.json({ ok: true });
});

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

app.post('/api/admin/users/:id/permission', auth, adminOnly, (req, res) => {
  const { capability, allowed } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare(`INSERT INTO user_permissions (user_id,capability,allowed) VALUES (?,?,?)
    ON CONFLICT(user_id,capability) DO UPDATE SET allowed=excluded.allowed`).run(u.id, capability, allowed ? 1 : 0);
  audit(req, 'user.permission', `${u.email}:${capability}=${allowed ? 1 : 0}`);
  res.json({ ok: true });
});

app.get('/api/permissions', auth, (req, res) => {
  const rolePerms = db.prepare('SELECT capability, allowed FROM role_permissions WHERE role = ?').all(req.user.role);
  const overrides = db.prepare('SELECT capability, allowed FROM user_permissions WHERE user_id = ?').all(req.user.id);
  const caps = {};
  rolePerms.forEach(p => caps[p.capability] = !!p.allowed);
  overrides.forEach(p => caps[p.capability] = !!p.allowed);
  res.json({ capabilities: caps });
});

// ============================================================
// CSV EXPORT — approved/delivered releases (for bulk upload)
// ============================================================
function csvCell(v) {
  v = (v == null ? '' : String(v));
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
app.get('/api/admin/export.csv', auth, adminOnly, (req, res) => {
  const status = (req.query.status || 'approved,delivered').split(',');
  const placeholders = status.map(() => '?').join(',');
  const releases = db.prepare(`SELECT r.*, c.name AS client_name FROM releases r JOIN clients c ON c.id=r.client_id WHERE r.status IN (${placeholders}) ORDER BY r.created_at DESC`).all(...status);
  const header = ['Release Title', 'Artist', 'Label', 'UPC', 'Type', 'Genre', 'Status', 'Digital Date', 'Original Date', 'Territories', 'Stores',
    'Track Title', 'ISRC', 'Version', 'C-Line', 'P-Line', 'Content Type', 'Production Year', 'Client'];
  const lines = [header.join(',')];
  for (const r of releases) {
    const tracks = db.prepare('SELECT * FROM tracks WHERE release_id = ? ORDER BY track_no').all(r.id);
    if (tracks.length === 0) {
      lines.push([r.title, r.artist, r.label, r.upc, r.type, r.genre, r.status, r.digital_date, r.original_date, r.territories, r.stores, '', '', '', '', '', '', '', r.client_name].map(csvCell).join(','));
    } else {
      for (const t of tracks) {
        lines.push([r.title, r.artist, r.label, r.upc, r.type, r.genre, r.status, r.digital_date, r.original_date, r.territories, r.stores,
          t.title, t.isrc, t.version, t.c_line, t.p_line, t.content_type, t.production_year, r.client_name].map(csvCell).join(','));
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

// roster: real artists (from contributors) + labels (from releases)
app.get('/api/roster', auth, (req, res) => {
  const cid = req.user.role === 'admin' ? Number(req.query.client_id || 0) : req.user.client_id;
  const W = cid ? 'AND r.client_id = ' + cid : '';
  const artists = db.prepare(`SELECT co.name, COUNT(DISTINCT r.id) AS releases
    FROM contributors co JOIN tracks t ON t.id = co.track_id JOIN releases r ON r.id = t.release_id
    WHERE co.role LIKE '%Main%' ${W} GROUP BY co.name ORDER BY releases DESC, co.name`).all();
  const labels = db.prepare(`SELECT r.label AS name, COUNT(*) AS releases
    FROM releases r WHERE r.label IS NOT NULL AND r.label != ''
    ${cid ? 'AND r.client_id = ' + cid : ''} GROUP BY r.label ORDER BY releases DESC`).all();
  res.json({ artists, labels });
});

app.get('/api/clients-list', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT id, name FROM clients ORDER BY name').all();
  res.json({ clients: rows });
});

// ============================================================
// UPC / ISRC GENERATOR — sequential, never repeats, platform-valid
//   ISRC: EGSUT + YY + 5-digit counter   (EG country + SUT registrant)
//   UPC : 12-digit UPC-A with a valid check digit + sequential counter
//   Counters live in the settings table; DB is double-checked for
//   collisions so a code can NEVER be issued twice.
// ============================================================
function getSetting(k) { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; }
function setSetting(k, v) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, String(v));
}
function ean13CheckDigit(d12) { // EAN-13 check digit
  let sum = 0;
  for (let i = 0; i < 12; i++) { const n = Number(d12[i]); sum += (i % 2 === 0) ? n : n * 3; }
  return String((10 - (sum % 10)) % 10);
}
// Sout Network series: 62298 (622 GS1 Egypt range + high unallocated block) + 7-digit counter + check digit = 13-digit EAN.
// Changeable anytime via settings key 'upc_prefix'.
function upcPrefix() { return (getSetting('upc_prefix') || '62298').replace(/[^0-9]/g, '') || '62298'; }
function codeExists(code, kind) {
  if (db.prepare('SELECT 1 FROM codes_registry WHERE code = ?').get(code)) return true;
  if (kind === 'upc') return !!db.prepare('SELECT 1 FROM releases WHERE upc = ?').get(code);
  return !!db.prepare('SELECT 1 FROM tracks WHERE UPPER(isrc) = ?').get(code);
}
function registerCode(code, kind, meta) {
  db.prepare(`INSERT INTO codes_registry (code, kind, source, batch_id, note, release_id, track_id, assigned_to, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(code, kind, meta.source || 'dashboard', meta.batch_id || null,
    meta.note || null, meta.release_id || null, meta.track_id || null, meta.assigned_to || null, meta.created_by || 'system');
}
function nextUPC(meta) {
  const prefix = upcPrefix();
  const pad = 12 - prefix.length; // body = 12 digits, then EAN-13 check digit → 13 total
  for (let guard = 0; guard < 100000; guard++) {
    const seq = Number(getSetting('upc_seq') || '0') + 1;
    setSetting('upc_seq', seq);
    const body = prefix + String(seq).padStart(pad, '0');
    const code = body + ean13CheckDigit(body);
    if (!codeExists(code, 'upc')) { registerCode(code, 'upc', meta || {}); return code; }
  }
  throw new Error('UPC generator exhausted');
}
function nextISRC(meta) {
  const yy = String(new Date().getFullYear() % 100).padStart(2, '0');
  const key = 'isrc_seq_' + yy;
  for (let guard = 0; guard < 100000; guard++) {
    const seq = Number(getSetting(key) || '0') + 1;
    if (seq > 99999) throw new Error('ISRC yearly capacity reached');
    setSetting(key, seq);
    const code = 'EGSUT' + yy + String(seq).padStart(5, '0');
    if (!codeExists(code, 'isrc')) { registerCode(code, 'isrc', meta || {}); return code; }
  }
  throw new Error('ISRC generator exhausted');
}
// generate missing codes for a release + rename files to UPC-based names
function generateCodesFor(relId) {
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(relId);
  if (!r) throw new Error('Release not found');
  let upc = (r.upc || '').trim();
  if (!upc) {
    upc = nextUPC({ source: 'dashboard', release_id: relId, assigned_to: r.title });
    db.prepare(`UPDATE releases SET upc = ?, updated_at = datetime('now') WHERE id = ?`).run(upc, relId);
  }
  // artwork → UPC.jpeg
  if (r.artwork) {
    const target = upc + '.jpeg';
    if (r.artwork !== target) {
      const from = path.join(__dirname, 'uploads', r.artwork);
      const to = path.join(__dirname, 'uploads', target);
      try {
        if (fs.existsSync(from)) { try { fs.unlinkSync(to); } catch { } fs.renameSync(from, to); }
        db.prepare('UPDATE releases SET artwork = ? WHERE id = ?').run(target, relId);
      } catch (e) { console.error('artwork rename:', e.message); }
    }
  }
  // tracks → ISRC + audio UPC_N.wav
  const isrcs = [];
  const tracks = db.prepare('SELECT * FROM tracks WHERE release_id = ? ORDER BY track_no').all(relId);
  for (const t of tracks) {
    let isrc = (t.isrc || '').trim();
    if (!isrc) {
      isrc = nextISRC({ source: 'dashboard', release_id: relId, track_id: t.id, assigned_to: (r.title || '') + ' — ' + (t.title || '') });
      db.prepare('UPDATE tracks SET isrc = ? WHERE id = ?').run(isrc, t.id);
    }
    isrcs.push({ track_no: t.track_no, title: t.title, isrc });
    if (t.audio_file) {
      const target = upc + '_' + t.track_no + '.wav';
      if (t.audio_file !== target) {
        const from = path.join(__dirname, 'uploads', t.audio_file);
        const to = path.join(__dirname, 'uploads', target);
        try {
          if (fs.existsSync(from)) { try { fs.unlinkSync(to); } catch { } fs.renameSync(from, to); }
          db.prepare('UPDATE tracks SET audio_file = ? WHERE id = ?').run(target, t.id);
        } catch (e) { console.error('audio rename:', e.message); }
      }
    }
  }
  return { upc, isrcs };
}

// ---------- CODES REGISTRY (admin) ----------
// list latest codes with filters
app.get('/api/admin/codes', auth, adminOnly, (req, res) => {
  const kind = ['upc', 'isrc'].includes(req.query.kind) ? req.query.kind : null;
  const source = ['dashboard', 'external'].includes(req.query.source) ? req.query.source : null;
  const q = (req.query.q || '').trim();
  let sql = `SELECT cr.*, r.title AS release_title, c.name AS client_name
    FROM codes_registry cr
    LEFT JOIN releases r ON r.id = cr.release_id
    LEFT JOIN clients c ON c.id = r.client_id WHERE 1=1`;
  const params = [];
  if (kind) { sql += ' AND cr.kind = ?'; params.push(kind); }
  if (source) { sql += ' AND cr.source = ?'; params.push(source); }
  if (q) { sql += ' AND (cr.code LIKE ? OR cr.note LIKE ? OR cr.assigned_to LIKE ?)'; params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  sql += ' ORDER BY cr.id DESC LIMIT 1000';
  const rows = db.prepare(sql).all(...params);
  const stats = {
    upc_total: db.prepare(`SELECT COUNT(*) AS n FROM codes_registry WHERE kind='upc'`).get().n,
    isrc_total: db.prepare(`SELECT COUNT(*) AS n FROM codes_registry WHERE kind='isrc'`).get().n,
    external: db.prepare(`SELECT COUNT(*) AS n FROM codes_registry WHERE source='external'`).get().n,
    next_upc_seq: Number(getSetting('upc_seq') || '0') + 1,
    next_isrc_seq: Number(getSetting('isrc_seq_' + String(new Date().getFullYear() % 100).padStart(2, '0')) || '0') + 1
  };
  res.json({ codes: rows, stats });
});

// generate a batch for EXTERNAL use (tracker sheets / manual team) — same counters, zero collision
app.post('/api/admin/codes/generate', auth, adminOnly, (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'isrc' ? 'isrc' : 'upc';
  const count = Math.max(1, Math.min(500, Number(b.count) || 1));
  const note = (b.note || '').trim();
  const batch_id = 'B' + Date.now();
  const meta = { source: 'external', batch_id, note, created_by: req.user.email };
  const codes = [];
  try {
    for (let i = 0; i < count; i++) codes.push(kind === 'upc' ? nextUPC(meta) : nextISRC(meta));
  } catch (e) { return res.status(400).json({ error: e.message, codes }); }
  audit(req, 'codes.batch', `${count} ${kind} — ${note || batch_id}`);
  res.json({ ok: true, kind, batch_id, codes });
});

// check any code: is it ours? used where?
app.get('/api/admin/codes/check', auth, adminOnly, (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Enter a code' });
  const reg = db.prepare(`SELECT cr.*, r.title AS release_title, c.name AS client_name
    FROM codes_registry cr LEFT JOIN releases r ON r.id = cr.release_id
    LEFT JOIN clients c ON c.id = r.client_id WHERE UPPER(cr.code) = ?`).get(code);
  if (reg) return res.json({ found: true, where: 'registry', ...reg });
  const rel = db.prepare(`SELECT r.id, r.title, c.name AS client_name FROM releases r JOIN clients c ON c.id=r.client_id WHERE UPPER(r.upc) = ?`).get(code);
  if (rel) return res.json({ found: true, where: 'release', release_title: rel.title, client_name: rel.client_name, source: 'manual' });
  const trk = db.prepare(`SELECT t.title, r.title AS release_title, c.name AS client_name FROM tracks t JOIN releases r ON r.id=t.release_id JOIN clients c ON c.id=r.client_id WHERE UPPER(t.isrc) = ?`).get(code);
  if (trk) return res.json({ found: true, where: 'track', assigned_to: trk.release_title + ' — ' + trk.title, client_name: trk.client_name, source: 'manual' });
  res.json({ found: false });
});

// export registry (or one batch) as CSV for tracker sheets
app.get('/api/admin/codes/export.csv', auth, adminOnly, (req, res) => {
  let sql = `SELECT cr.*, r.title AS release_title, c.name AS client_name FROM codes_registry cr
    LEFT JOIN releases r ON r.id = cr.release_id LEFT JOIN clients c ON c.id = r.client_id`;
  const params = [];
  if (req.query.batch) { sql += ' WHERE cr.batch_id = ?'; params.push(req.query.batch); }
  sql += ' ORDER BY cr.id';
  const rows = db.prepare(sql).all(...params);
  const lines = ['Code,Type,Source,Batch,Note,Assigned To,Client,Created At'];
  rows.forEach(r => lines.push([r.code, r.kind.toUpperCase(), r.source, r.batch_id, r.note, r.assigned_to || r.release_title, r.client_name, r.created_at].map(csvCell).join(',')));
  audit(req, 'codes.export', `${rows.length} codes`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sout-codes-${req.query.batch || 'all'}.csv"`);
  res.send('\uFEFF' + lines.join('\n'));
});

// manual trigger (admin) — only fills what is missing, never overwrites
app.post('/api/admin/releases/:id/generate-codes', auth, adminOnly, (req, res) => {
  try {
    const out = generateCodesFor(Number(req.params.id));
    audit(req, 'codes.generate', `#${req.params.id} UPC ${out.upc}`);
    res.json({ ok: true, ...out });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ============================================================
// ============================================================
//                     RIGHTS MANAGER
//   Admin enters issues (from the rights source, manually)
//   → client sees & answers → answer returns to admin
//   → dispute YES creates a Release Claim automatically.
// ============================================================
// ============================================================
const RI_PLATFORMS = ['youtube', 'facebook', 'tiktok', 'other'];
const RI_CATEGORIES = ['ownership_conflict', 'disputed_claim', 'takedown_video', 'ugc_monetize', 'ugc_block', 'release_claim', 'copyright_check'];
const RI_OWNERSHIP_ANSWERS = ['original_exclusive', 'non_exclusive_license', 'contentid_exclusive', 'soundalike', 'public_domain', 'no_rights'];

// ---------- catalog lookup: find a client's track by UPC or ISRC ----------
function catalogLookup(clientId, upc, isrc) {
  upc = (upc || '').trim(); isrc = (isrc || '').trim();
  if (isrc) {
    const t = db.prepare(`SELECT t.title AS track_title, t.isrc, r.title AS release_title, r.artist, r.upc
      FROM tracks t JOIN releases r ON r.id = t.release_id
      WHERE r.client_id = ? AND UPPER(t.isrc) = UPPER(?) LIMIT 1`).get(clientId, isrc);
    if (t) return { asset_title: t.track_title || t.release_title, artist: t.artist, upc: t.upc || upc, isrc: t.isrc };
  }
  if (upc) {
    const r = db.prepare(`SELECT title, artist, upc FROM releases WHERE client_id = ? AND upc = ? LIMIT 1`).get(clientId, upc);
    if (r) return { asset_title: r.title, artist: r.artist, upc: r.upc, isrc: isrc || '' };
  }
  return null;
}

// ============================================================
// RIGHTS — CLIENT SIDE
// ============================================================

// list issues (client: own only; admin: all, optional ?client_id=)
app.get('/api/rights/issues', auth, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    if (req.query.client_id) {
      rows = db.prepare(`SELECT ri.*, c.name AS client_name FROM rights_issues ri JOIN clients c ON c.id=ri.client_id
        WHERE ri.client_id = ? ORDER BY ri.created_at DESC`).all(Number(req.query.client_id));
    } else {
      rows = db.prepare(`SELECT ri.*, c.name AS client_name FROM rights_issues ri JOIN clients c ON c.id=ri.client_id
        ORDER BY ri.created_at DESC`).all();
    }
  } else {
    rows = db.prepare(`SELECT * FROM rights_issues WHERE client_id = ? ORDER BY created_at DESC`).all(req.user.client_id);
  }
  res.json({ issues: rows });
});

// client answers an issue (dispute yes/no OR ownership-conflict option)
app.post('/api/rights/issues/:id/answer', auth, (req, res) => {
  const i = db.prepare('SELECT * FROM rights_issues WHERE id = ?').get(req.params.id);
  if (!i) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && i.client_id !== req.user.client_id) return res.status(403).json({ error: 'Forbidden' });
  if (i.status !== 'new') return res.status(400).json({ error: 'This issue was already answered.' });

  const { answer, note } = req.body || {};
  let valid = false;
  if (i.category === 'disputed_claim') valid = ['yes', 'no'].includes(answer);
  else if (i.category === 'ownership_conflict') valid = RI_OWNERSHIP_ANSWERS.includes(answer);
  if (!valid) return res.status(400).json({ error: 'Invalid answer for this issue type.' });

  db.prepare(`UPDATE rights_issues SET client_answer=?, client_answer_note=?, status='answered',
    answered_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(answer, note || '', i.id);

  // dispute accepted → auto Release Claim
  let autoRelease = false;
  if (i.category === 'disputed_claim' && answer === 'yes') {
    db.prepare(`INSERT INTO claim_requests (client_id, user_id, kind, platform, video_url, upc, isrc, asset_title, artist, note, source_issue_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      i.client_id, req.user.id, 'release_claim', i.platform, i.video_url || '', i.upc || '', i.isrc || '',
      i.asset_title || '', i.artist || '', 'Auto-created: dispute accepted (Yes)', i.id);
    autoRelease = true;
  }
  audit(req, 'rights.answer', `issue #${i.id}: ${answer}`);
  res.json({ ok: true, auto_release_claim: autoRelease });
});

// 90-day analytics (client: own; admin: ?client_id= required for per-client view)
app.get('/api/rights/analytics', auth, (req, res) => {
  let cid;
  if (req.user.role === 'admin') {
    cid = Number(req.query.client_id || 0);
    if (!cid) return res.status(400).json({ error: 'client_id required' });
  } else cid = req.user.client_id;
  const W = `client_id = ? AND created_at >= datetime('now','-90 day')`;
  const q = sql => db.prepare(sql).get(cid).n;
  res.json({
    days: 90,
    conflicts: q(`SELECT COUNT(*) AS n FROM rights_issues WHERE ${W} AND category='ownership_conflict'`),
    disputes: q(`SELECT COUNT(*) AS n FROM rights_issues WHERE ${W} AND category='disputed_claim'`),
    release_claims: q(`SELECT COUNT(*) AS n FROM claim_requests WHERE ${W} AND kind='release_claim'`),
    dispute_yes: q(`SELECT COUNT(*) AS n FROM rights_issues WHERE ${W} AND category='disputed_claim' AND client_answer='yes'`)
  });
});

// ============================================================
// CLAIM REQUESTS (client creates; admin executes)
// ============================================================

// list own claim requests (admin: all)
app.get('/api/claims', auth, (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`SELECT cr.*, c.name AS client_name FROM claim_requests cr JOIN clients c ON c.id=cr.client_id
      ORDER BY cr.created_at DESC`).all();
  } else {
    rows = db.prepare(`SELECT * FROM claim_requests WHERE client_id = ? ORDER BY created_at DESC`).all(req.user.client_id);
  }
  res.json({ claims: rows });
});

// create claim request (manual_claim needs an action; UPC/ISRC must exist in the client's own catalog)
app.post('/api/claims', auth, (req, res) => {
  const b = req.body || {};
  const clientId = req.user.role === 'admin' ? Number(b.client_id) : req.user.client_id;
  if (!clientId) return res.status(400).json({ error: 'Client required' });

  const kind = b.kind === 'manual_claim' ? 'manual_claim' : (b.kind === 'release_claim' ? 'release_claim' : null);
  if (!kind) return res.status(400).json({ error: 'Invalid request kind' });

  const platform = RI_PLATFORMS.includes(b.platform) ? b.platform : 'youtube';
  const video_url = (b.video_url || '').trim();
  if (!video_url || !/^https?:\/\/.+/.test(video_url)) return res.status(400).json({ error: 'A valid video URL is required' });

  let action = null;
  if (kind === 'manual_claim') {
    action = ['ugc_monetize', 'ugc_block', 'takedown'].includes(b.action) ? b.action : null;
    if (!action) return res.status(400).json({ error: 'Select an action: monetize, block, or takedown' });
  }

  const upc = (b.upc || '').trim(), isrc = (b.isrc || '').trim();
  if (!upc && !isrc) return res.status(400).json({ error: 'Enter the UPC or ISRC of your track' });

  // must exist in the client's own catalog → pulls title & artist automatically
  const hit = catalogLookup(clientId, upc, isrc);
  if (!hit) return res.status(400).json({ error: 'This UPC/ISRC was not found in your catalog. Check the code and try again.' });

  const info = db.prepare(`INSERT INTO claim_requests (client_id, user_id, kind, platform, action, video_url, upc, isrc, asset_title, artist, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    clientId, req.user.id, kind, platform, action, video_url, hit.upc || upc, hit.isrc || isrc,
    hit.asset_title || '', hit.artist || '', (b.note || '').trim());
  audit(req, 'claims.create', `${kind} #${info.lastInsertRowid}`);
  res.json({ ok: true, id: info.lastInsertRowid, asset_title: hit.asset_title, artist: hit.artist });
});

// verify a UPC/ISRC against the client's catalog (used by the form before submit)
app.get('/api/claims/lookup', auth, (req, res) => {
  const clientId = req.user.role === 'admin' ? Number(req.query.client_id || 0) : req.user.client_id;
  const hit = catalogLookup(clientId, req.query.upc, req.query.isrc);
  if (!hit) return res.status(404).json({ error: 'Not found in your catalog' });
  res.json({ ok: true, ...hit });
});

// ============================================================
// RIGHTS — ADMIN SIDE
// ============================================================

// create an issue for a client (admin enters data from the rights source manually)
app.post('/api/admin/rights/issues', auth, adminOnly, (req, res) => {
  const b = req.body || {};
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(Number(b.client_id));
  if (!client) return res.status(400).json({ error: 'Choose a valid client' });
  if (!RI_CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Invalid category' });
  const platform = RI_PLATFORMS.includes(b.platform) ? b.platform : 'youtube';
  const info = db.prepare(`INSERT INTO rights_issues
    (client_id, platform, category, asset_title, album_title, track_title, artist, asset_id, isrc, upc, other_party, video_url, daily_views, expiry_date, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    client.id, platform, b.category,
    (b.asset_title || '').trim(), (b.album_title || '').trim(), (b.track_title || '').trim(),
    (b.artist || '').trim(), (b.asset_id || '').trim(), (b.isrc || '').trim(), (b.upc || '').trim(),
    (b.other_party || '').trim(), (b.video_url || '').trim(),
    Number(b.daily_views) || 0, (b.expiry_date || '').trim(), req.user.email);
  audit(req, 'rights.issue_create', `#${info.lastInsertRowid} ${b.category} → client ${client.id}`);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// update / resolve an issue
app.put('/api/admin/rights/issues/:id', auth, adminOnly, (req, res) => {
  const i = db.prepare('SELECT * FROM rights_issues WHERE id = ?').get(req.params.id);
  if (!i) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const status = ['new', 'answered', 'resolved', 'rejected'].includes(b.status) ? b.status : i.status;
  db.prepare(`UPDATE rights_issues SET
    platform=?, category=?, asset_title=?, album_title=?, track_title=?, artist=?, asset_id=?, isrc=?, upc=?,
    other_party=?, video_url=?, daily_views=?, expiry_date=?, status=?, resolution_note=?,
    resolved_at = CASE WHEN ? IN ('resolved','rejected') AND resolved_at IS NULL THEN datetime('now') ELSE resolved_at END,
    updated_at=datetime('now') WHERE id=?`).run(
    b.platform ?? i.platform, b.category ?? i.category, b.asset_title ?? i.asset_title, b.album_title ?? i.album_title,
    b.track_title ?? i.track_title, b.artist ?? i.artist, b.asset_id ?? i.asset_id, b.isrc ?? i.isrc, b.upc ?? i.upc,
    b.other_party ?? i.other_party, b.video_url ?? i.video_url,
    b.daily_views ?? i.daily_views, b.expiry_date ?? i.expiry_date, status, b.resolution_note ?? i.resolution_note,
    status, i.id);
  audit(req, 'rights.issue_update', `#${i.id} → ${status}`);
  res.json({ ok: true });
});

// delete a wrongly-entered issue
app.delete('/api/admin/rights/issues/:id', auth, adminOnly, (req, res) => {
  const i = db.prepare('SELECT * FROM rights_issues WHERE id = ?').get(req.params.id);
  if (!i) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM claim_requests WHERE source_issue_id = ?').run(i.id);
  db.prepare('DELETE FROM rights_issues WHERE id = ?').run(i.id);
  audit(req, 'rights.issue_delete', '#' + i.id);
  res.json({ ok: true });
});

// admin updates a claim request status (after executing it at the rights source)
app.post('/api/admin/claims/:id/status', auth, adminOnly, (req, res) => {
  const { status, admin_note } = req.body || {};
  if (!['pending', 'in_progress', 'done', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const c = db.prepare('SELECT * FROM claim_requests WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE claim_requests SET status=?, admin_note=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, admin_note ?? c.admin_note, c.id);
  // if this claim came from a dispute-yes, mark the source issue resolved when done
  if (status === 'done' && c.source_issue_id) {
    db.prepare(`UPDATE rights_issues SET status='resolved', resolved_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='answered'`).run(c.source_issue_id);
  }
  audit(req, 'claims.status', `#${c.id} → ${status}`);
  res.json({ ok: true });
});

// rights CSV export (issues + answers) for the rights team
app.get('/api/admin/rights/export.csv', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT ri.*, c.name AS client_name FROM rights_issues ri JOIN clients c ON c.id=ri.client_id ORDER BY ri.created_at DESC`).all();
  const header = ['ID', 'Client', 'Platform', 'Category', 'Asset Title', 'Artist', 'Asset ID', 'ISRC', 'UPC', 'Other Party', 'Video URL', 'Daily Views', 'Expiry', 'Status', 'Client Answer', 'Answer Note', 'Answered At', 'Created At'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.id, r.client_name, r.platform, r.category, r.asset_title, r.artist, r.asset_id, r.isrc, r.upc, r.other_party, r.video_url, r.daily_views, r.expiry_date, r.status, r.client_answer, r.client_answer_note, r.answered_at, r.created_at].map(csvCell).join(','));
  }
  audit(req, 'rights.export', `${rows.length} issues`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sout-rights-${Date.now()}.csv"`);
  res.send('\uFEFF' + lines.join('\n'));
});


// ============================================================
// ACCOUNT APPLICATIONS (public apply → admin approve → email)
// ============================================================
function smtpConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'smtp.json'), 'utf8')); }
  catch { return null; }
}
async function sendWelcomeEmail(to, name, tempPass) {
  const cfg = smtpConfig(); if (!cfg || !cfg.host || !cfg.user) return false;
  let nodemailer; try { nodemailer = require('nodemailer'); } catch { return false; }
  try {
    const port = Number(cfg.port) || 465;
    const t = nodemailer.createTransport({ host: cfg.host, port, secure: port === 465, auth: { user: cfg.user, pass: cfg.pass } });
    await t.sendMail({
      from: cfg.from || `"Sout Network" <${cfg.user}>`,
      to,
      subject: 'Your Sout Network account is ready',
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #eaecef;border-radius:12px">
        <h2 style="color:#4f46e5;margin:0 0 12px">Welcome to Sout Network</h2>
        <p>Hi ${name},</p>
        <p>Your account application has been <b>approved</b>. Here are your login details:</p>
        <table style="background:#f6f7f9;border-radius:8px;padding:8px;width:100%" cellpadding="8">
          <tr><td><b>Login page</b></td><td><a href="https://app.soutnetwork.com">app.soutnetwork.com</a></td></tr>
          <tr><td><b>Email</b></td><td>${to}</td></tr>
          <tr><td><b>Temporary password</b></td><td><code>${tempPass}</code></td></tr>
        </table>
        <p>For your security, you will be asked to <b>set a new password</b> on your first sign-in.</p>
        <p style="color:#939aa8;font-size:12px">Sout Network — Distribution &amp; Rights Management</p>
      </div>`
    });
    return true;
  } catch (e) { console.error('mail error:', e.message); return false; }
}
function genTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = ''; const rb = require('crypto').randomBytes(12);
  for (let i = 0; i < 12; i++) p += chars[rb[i] % chars.length];
  return p;
}

// public application form (rate-limited)
const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Too many applications, try later' } });
app.post('/api/apply', applyLimiter, (req, res) => {
  const b = req.body || {};
  const company = (b.company || '').trim(), name = (b.name || '').trim(), email = (b.email || '').trim().toLowerCase();
  if (!company || !name || !email) return res.status(400).json({ error: 'Company, contact name and email are required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const dupUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const dupApp = db.prepare(`SELECT id FROM applications WHERE email = ? AND status = 'pending'`).get(email);
  if (dupUser) return res.status(400).json({ error: 'This email already has an account. Try signing in.' });
  if (dupApp) return res.status(400).json({ error: 'An application with this email is already under review.' });
  db.prepare(`INSERT INTO applications (company, name, email, phone, catalog_size, message) VALUES (?,?,?,?,?,?)`)
    .run(company, name, email, (b.phone || '').trim(), (b.catalog_size || '').trim(), (b.message || '').trim());
  audit({ user: null, ip: req.ip }, 'application.submit', email);
  res.json({ ok: true });
});

// admin: list applications
app.get('/api/admin/applications', auth, adminOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  res.json({ applications: rows });
});

// admin: approve → creates client + user with temp password + must_change flag, tries to email
app.post('/api/admin/applications/:id/approve', auth, adminOnly, async (req, res) => {
  const a = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(a.email)) return res.status(400).json({ error: 'A user with this email already exists' });
  const info = db.prepare('INSERT INTO clients (name, plan) VALUES (?,?)').run(a.company, 'Label');
  const clientId = info.lastInsertRowid;
  const temp = genTempPassword();
  db.prepare(`INSERT INTO users (email, password_hash, name, role, client_id, must_change_password) VALUES (?,?,?,?,?,1)`)
    .run(a.email, bcrypt.hashSync(temp, 12), a.name, 'client', clientId);
  db.prepare(`UPDATE applications SET status='approved', processed_at=datetime('now'), processed_by=? WHERE id=?`).run(req.user.email, a.id);
  const emailed = await sendWelcomeEmail(a.email, a.name, temp);
  audit(req, 'application.approve', a.email);
  res.json({ ok: true, email: a.email, temp_password: temp, emailed });
});

// admin: reject
app.post('/api/admin/applications/:id/reject', auth, adminOnly, (req, res) => {
  const a = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
  db.prepare(`UPDATE applications SET status='rejected', note=?, processed_at=datetime('now'), processed_by=? WHERE id=?`)
    .run((req.body || {}).note || '', req.user.email, a.id);
  audit(req, 'application.reject', a.email);
  res.json({ ok: true });
});

// ---------- health ----------
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ============================================================
// STARTUP (sql.js is async — open DB, run tiny migrations, listen)
// ============================================================
async function main() {
  db = await openDatabase(DB_PATH);
  db.pragma('foreign_keys = ON');
  // tiny idempotent migrations
  try { db.exec('ALTER TABLE releases ADD COLUMN artwork TEXT'); } catch { }
  try { db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0'); } catch { }
  db.exec(`CREATE TABLE IF NOT EXISTS codes_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL,                 -- upc | isrc
    source TEXT NOT NULL,               -- dashboard | external
    batch_id TEXT,
    note TEXT,
    release_id INTEGER,
    track_id INTEGER,
    assigned_to TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_codes_kind ON codes_registry (kind, source);`);
  // backfill: register previously generated dashboard codes so the ledger is complete
  try {
    db.prepare(`INSERT OR IGNORE INTO codes_registry (code, kind, source, release_id, assigned_to, created_by)
      SELECT upc, 'upc', 'dashboard', id, title, 'backfill' FROM releases WHERE upc LIKE '82997%'`).run();
    db.prepare(`INSERT OR IGNORE INTO codes_registry (code, kind, source, track_id, release_id, assigned_to, created_by)
      SELECT UPPER(t.isrc), 'isrc', 'dashboard', t.id, t.release_id, t.title, 'backfill'
      FROM tracks t WHERE UPPER(t.isrc) LIKE 'EGSUT%'`).run();
  } catch { }
  db.exec(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
    phone TEXT, catalog_size TEXT, message TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT, processed_at TEXT, processed_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  app.listen(PORT, '127.0.0.1', () => console.log(`Sout backend running on 127.0.0.1:${PORT}`));
}
main().catch(e => { console.error('startup error:', e); process.exit(1); });
