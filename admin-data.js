// ============================================================
// Admin console — real-data loaders + actions
// ============================================================
(function () {
  const { chip, esc, initials } = window.SoutUI;
  const API = window.SoutAPI;
  function art(l) { return `<div class="art">${esc(l)}</div>`; }
  function thumb(t) { return art(initials(t)); }
  const CAPS = ['upload_releases', 'edit_releases', 'deliver_releases', 'metadata_edits', 'takedowns', 'financial_access', 'rights_access', 'analytics_access', 'team_access'];
  const CAP_LABELS = { upload_releases: 'Upload releases', edit_releases: 'Edit releases', deliver_releases: 'Deliver releases', metadata_edits: 'Metadata edits', takedowns: 'Takedowns', financial_access: 'Financial access', rights_access: 'Rights access', analytics_access: 'Analytics access', team_access: 'Team access' };
  const ROLES = ['admin', 'client', 'label_manager', 'operations', 'finance', 'analyst'];

  // ---------- Review Queue (moderation) ----------
  async function loadModeration() {
    const d = await API.call('/releases');
    const queue = (d.releases || []).filter(r => ['submitted', 'review'].includes(r.status));
    const page = document.querySelector('.page[data-page="admin_moderation"]');
    if (!page) return;
    const tbody = page.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = queue.length ? queue.map(r => `<tr>
      <td><div class="cbx" onclick="toggleRow(this,event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div></td>
      <td><div class="row-flex">${thumb(r.title)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)} · ${esc(r.client_name || '')}</div></div></div></td>
      <td>${chip(r.status)}</td><td><span class="chip gray">${esc(r.type)}</span></td>
      <td style="text-align:right">
        <button class="btn btn-primary btn-sm" onclick="SoutAdmin.setStatus(${r.id},'approved')">Approve</button>
        <button class="btn btn-ghost btn-sm" onclick="SoutAdmin.correction(${r.id})">Correction</button>
        <button class="btn btn-danger btn-sm" onclick="SoutAdmin.reject(${r.id})">Reject</button>
      </td></tr>`).join('') : `<tr><td colspan="5"><div class="empty"><h4>Queue is empty</h4><div class="cell-sub">No releases awaiting review.</div></div></td></tr>`;
  }

  // ---------- Users ----------
  async function loadUsers() {
    const d = await API.call('/admin/users');
    const page = document.querySelector('.page[data-page="admin_users"]');
    if (!page) return; const tbody = page.querySelector('tbody'); if (!tbody) return;
    tbody.innerHTML = (d.users || []).map(u => {
      const sc = u.status === 'active' ? 'green' : 'gray';
      return `<tr>
        <td><div class="row-flex">${art(initials(u.name))}<div><div class="cell-main">${esc(u.name)}</div><div class="cell-sub">${esc(u.email)}</div></div></div></td>
        <td><span class="chip blue">${esc(u.role)}</span></td><td>${esc(u.client_name || '—')}</td><td><span class="chip ${sc}">${esc(u.status)}</span></td>
        <td style="text-align:right">
          <button class="btn btn-ghost btn-sm" onclick="SoutAdmin.resetPw(${u.id})">Reset Password</button>
          <button class="btn btn-ghost btn-sm" onclick="SoutAdmin.toggleUser(${u.id})">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-ghost btn-sm" onclick="SoutAdmin.editUser(${u.id},'${esc(u.role)}')">Edit</button>
        </td></tr>`;
    }).join('');
    // wire "Create User" button
    const btn = page.querySelector('.btn-primary');
    if (btn) btn.onclick = () => SoutAdmin.createUser();
  }

  // ---------- Clients ----------
  async function loadClients() {
    const d = await API.call('/admin/clients');
    const page = document.querySelector('.page[data-page="admin_clients"]');
    if (!page) return; const tbody = page.querySelector('tbody'); if (!tbody) return;
    tbody.innerHTML = (d.clients || []).map(c => `<tr>
      <td><div class="row-flex">${art(initials(c.name))}<div class="cell-main">${esc(c.name)}</div></div></td>
      <td class="cell-mono">${c.releases} releases</td><td><span class="chip blue">${esc(c.plan)}</span></td>
      <td><span class="chip ${c.status === 'active' ? 'green' : 'gray'}">${esc(c.status)}</span></td>
      <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="SoutAdmin.editClient(${c.id})">Manage</button></td></tr>`).join('');
    const btn = page.querySelector('.btn-primary');
    if (btn) btn.onclick = () => SoutAdmin.createClient();
  }

  // ---------- Permissions matrix ----------
  async function loadPermissions() {
    const d = await API.call('/admin/permissions');
    const grid = {};
    (d.permissions || []).forEach(p => { grid[p.role] = grid[p.role] || {}; grid[p.role][p.capability] = p.allowed; });
    const page = document.querySelector('.page[data-page="admin_permissions"]');
    if (!page) return; const table = page.querySelector('table'); if (!table) return;
    const roles = ROLES.filter(r => grid[r]); // only roles that exist
    table.querySelector('thead').innerHTML = `<tr><th>Capability</th>${roles.map(r => `<th style="text-align:center">${esc(r)}</th>`).join('')}</tr>`;
    table.querySelector('tbody').innerHTML = CAPS.map(cap => `<tr><td class="cell-main">${CAP_LABELS[cap]}</td>${roles.map(role => {
      const on = grid[role] && grid[role][cap] ? ' on' : '';
      return `<td style="text-align:center"><div class="cbx perm${on}" style="margin:0 auto" onclick="SoutAdmin.togglePerm(this,'${role}','${cap}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div></td>`;
    }).join('')}</tr>`).join('');
  }

  // ---------- Audit log ----------
  async function loadAudit() {
    const d = await API.call('/admin/audit');
    const page = document.querySelector('.page[data-page="admin_audit"]');
    if (!page) return; const tbody = page.querySelector('tbody'); if (!tbody) return;
    tbody.innerHTML = (d.logs || []).map(l => `<tr>
      <td class="cell-mono">${esc(l.created_at)}</td><td class="cell-mono">${esc(l.user_email)}</td>
      <td><span class="chip gray">${esc(l.action)}</span></td><td class="cell-main">${esc(l.target)}</td><td class="cell-mono">${esc(l.ip || '')}</td></tr>`).join('')
      || `<tr><td colspan="5"><div class="empty"><h4>No activity yet</h4></div></td></tr>`;
  }

  // ---------- Overview counts ----------
  async function loadAdminOverview() {
    try {
      const rd = await API.call('/releases');
      const rels = rd.releases || [];
      const cnt = st => rels.filter(r => (Array.isArray(st) ? st.includes(r.status) : r.status === st)).length;
      const page = document.querySelector('.page[data-page="admin_overview"]');
      if (!page) return;
      const vals = page.querySelectorAll('.stat .val');
      // Pending review / Awaiting delivery / Open rights / Payouts / Active users / Failed
      if (vals[0]) vals[0].textContent = cnt(['submitted', 'review']);
      if (vals[1]) vals[1].textContent = cnt('approved');
      // review queue preview table
      const tbody = page.querySelector('tbody');
      if (tbody) {
        const q = rels.filter(r => ['submitted', 'review'].includes(r.status)).slice(0, 5);
        tbody.innerHTML = q.length ? q.map(r => `<tr><td><div class="row-flex">${thumb(r.title)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div></div></div></td><td>${chip(r.status)}</td><td>${chip('review')}</td><td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="go('admin_moderation')">Review</button></td></tr>`).join('') : `<tr><td colspan="4"><div class="empty"><h4>Queue empty</h4></div></td></tr>`;
      }
    } catch { }
  }

  // ---------- actions ----------
  const SoutAdmin = {
    async setStatus(id, status, note) {
      try { await API.call('/admin/releases/' + id + '/status', { method: 'POST', body: { status, note } }); toast && toast('Release ' + status); await loadModeration(); await loadAdminOverview(); }
      catch (e) { toast && toast(e.message); }
    },
    reject(id) { const note = prompt('Rejection reason:'); if (note) this.setStatus(id, 'rejected', note); },
    correction(id) { const note = prompt('What needs correction?'); if (note) this.setStatus(id, 'correction', note); },
    async resetPw(id) { const p = prompt('New password (8+ chars):'); if (!p) return; try { await API.call('/admin/users/' + id + '/reset-password', { method: 'POST', body: { password: p } }); toast && toast('Password reset'); } catch (e) { toast && toast(e.message); } },
    async toggleUser(id) { try { const r = await API.call('/admin/users/' + id + '/disable', { method: 'POST' }); toast && toast('User ' + r.status); await loadUsers(); } catch (e) { toast && toast(e.message); } },
    async createUser() {
      const name = prompt('Full name:'); if (!name) return;
      const email = prompt('Email:'); if (!email) return;
      const password = prompt('Password (8+ chars):'); if (!password) return;
      const role = prompt('Role (admin/client/label_manager/operations/finance/analyst):', 'client') || 'client';
      let client_id = null;
      if (role !== 'admin') { const cid = prompt('Client ID (leave blank if none):'); client_id = cid ? Number(cid) : null; }
      try { await API.call('/admin/users', { method: 'POST', body: { name, email, password, role, client_id } }); toast && toast('User created'); await loadUsers(); } catch (e) { toast && toast(e.message); }
    },
    async editUser(id, role) {
      const newRole = prompt('New role (admin/client/label_manager/operations/finance/analyst):', role); if (!newRole) return;
      try { await API.call('/admin/users/' + id, { method: 'PUT', body: { role: newRole } }); toast && toast('User updated'); await loadUsers(); } catch (e) { toast && toast(e.message); }
    },
    async createClient() {
      const name = prompt('Client / label name:'); if (!name) return;
      const plan = prompt('Plan:', 'Label') || 'Label';
      try { await API.call('/admin/clients', { method: 'POST', body: { name, plan } }); toast && toast('Client created'); await loadClients(); } catch (e) { toast && toast(e.message); }
    },
    async editClient(id) {
      const name = prompt('New client name (blank = keep):');
      const plan = prompt('New plan (blank = keep):');
      const body = {}; if (name) body.name = name; if (plan) body.plan = plan;
      if (!Object.keys(body).length) return;
      try { await API.call('/admin/clients/' + id, { method: 'PUT', body }); toast && toast('Client updated'); await loadClients(); } catch (e) { toast && toast(e.message); }
    },
    async togglePerm(el, role, cap) {
      const on = !el.classList.contains('on'); el.classList.toggle('on', on);
      try { await API.call('/admin/permissions', { method: 'POST', body: { role, capability: cap, allowed: on } }); } catch (e) { toast && toast(e.message); el.classList.toggle('on', !on); }
    },
    exportCSV() { window.location.href = '/api/admin/export.csv'; }
  };
  window.SoutAdmin = SoutAdmin;


  // ============================================================
  // RIGHTS MANAGER (admin) — enter issues, track answers, execute claims
  // ============================================================
  const RA_CAT = { ownership_conflict: 'Ownership conflict', disputed_claim: 'Disputed claims', takedown_video: 'Takedown video', ugc_monetize: 'Claim UGC : monetize', ugc_block: 'Claim UGC : block', release_claim: 'Release claim', copyright_check: 'Copyright check' };
  const RA_PLAT = { youtube: 'YouTube', facebook: 'Facebook', tiktok: 'TikTok', other: 'Other' };
  const RA_ANS = { yes: 'YES — accepted', no: 'NO — refused', original_exclusive: 'Original / exclusive rights', non_exclusive_license: 'Non-exclusive license', contentid_exclusive: 'Content-ID exclusive license', soundalike: 'Soundalike / cover', public_domain: 'Public Domain', no_rights: "Doesn't own rights" };
  const RA_ACT = { ugc_monetize: 'Monetize', ugc_block: 'Block', takedown: 'Takedown' };
  let RA = { issues: [], claims: [], clients: [] };

  function raChip(st) { const M = { new: ['New', 'red'], answered: ['Answered', 'blue'], resolved: ['Resolved', 'green'], rejected: ['Rejected', 'gray'], pending: ['Pending', 'amber'], in_progress: ['In Progress', 'blue'], done: ['Done', 'green'] }; const [l, cl] = M[st] || [st, 'gray']; return `<span class="chip ${cl}">${l}</span>`; }
  function raAnswer(i) {
    if (!i.client_answer) return '<span class="cell-sub">—</span>';
    const good = i.client_answer === 'yes' ? 'green' : (i.client_answer === 'no' ? 'red' : 'blue');
    const note = i.client_answer_note ? `<div class="cell-sub">${esc(i.client_answer_note)}</div>` : '';
    return `<span class="chip ${good}">${esc(RA_ANS[i.client_answer] || i.client_answer)}</span>${note}`;
  }

  const SoutRightsAdmin = {
    async load() {
      try {
        const [ci, ii, cc] = await Promise.all([API.call('/clients-list'), API.call('/rights/issues'), API.call('/claims')]);
        RA.clients = ci.clients || []; RA.issues = ii.issues || []; RA.claims = cc.claims || [];
      } catch (e) { toast && toast(e.message); return; }
      this.buildFilters(); this.stats(); this.renderIssues(); this.renderClaims(); this.badge();
    },
    badge() {
      // needs admin action: answered issues + pending/in_progress claims
      const n = RA.issues.filter(i => i.status === 'answered').length + RA.claims.filter(c => ['pending', 'in_progress'].includes(c.status)).length;
      const b = document.getElementById('aRightsBadge'); if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
    },
    stats() {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('aStNew', RA.issues.filter(i => i.status === 'new').length);
      set('aStAnswered', RA.issues.filter(i => i.status === 'answered').length);
      set('aStClaims', RA.claims.filter(c => c.status === 'pending').length);
      set('aStResolved', RA.issues.filter(i => i.status === 'resolved').length);
    },
    buildFilters() {
      const cs = document.getElementById('aFltClient');
      if (cs) { const cur = cs.value || 'all'; cs.innerHTML = '<option value="all">All clients</option>' + RA.clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join(''); cs.value = cur; }
      const cat = document.getElementById('aFltCat');
      if (cat) { const cur = cat.value || 'all'; const counts = {}; RA.issues.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1); cat.innerHTML = `<option value="all">All categories (${RA.issues.length})</option>` + Object.keys(RA_CAT).map(k => counts[k] ? `<option value="${k}">${RA_CAT[k]} (${counts[k]})</option>` : '').join(''); cat.value = cur; }
      const af = document.getElementById('afClient');
      if (af) af.innerHTML = RA.clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    },
    tab(el, v) {
      el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); el.classList.add('active');
      document.getElementById('aIssuesView').style.display = v === 'issues' ? '' : 'none';
      document.getElementById('aClaimsView').style.display = v === 'claims' ? '' : 'none';
    },
    renderIssues() {
      const tbody = document.getElementById('aIssuesBody'); if (!tbody) return;
      const fc = (document.getElementById('aFltClient') || {}).value || 'all';
      const fk = (document.getElementById('aFltCat') || {}).value || 'all';
      const fs = (document.getElementById('aFltStatus') || {}).value || 'all';
      const rows = RA.issues.filter(i => (fc === 'all' || String(i.client_id) === fc) && (fk === 'all' || i.category === fk) && (fs === 'all' || i.status === fs));
      if (!rows.length) { tbody.innerHTML = `<tr><td colspan="10"><div class="empty"><h4>No rights issues</h4><div class="cell-sub">Use “Add Rights Issue” to enter one for a client.</div></div></td></tr>`; return; }
      tbody.innerHTML = rows.map(i => `<tr>
        <td><div class="cell-main">${esc(i.client_name || '')}</div></td>
        <td><span class="chip gray">${RA_PLAT[i.platform] || esc(i.platform)}</span></td>
        <td><div class="cell-main">${RA_CAT[i.category] || esc(i.category)}</div>${i.video_url ? `<a class="cell-sub" style="color:var(--accent)" href="${esc(i.video_url)}" target="_blank" rel="noopener">Video</a>` : ''}</td>
        <td><div class="cell-main">${esc(i.asset_title || '—')}</div><div class="cell-sub">${esc(i.artist || '')}</div></td>
        <td class="cell-mono">${esc(i.upc || '—')}<div class="cell-sub cell-mono">${esc(i.isrc || '')}</div></td>
        <td>${esc(i.other_party || '-')}</td>
        <td>${raAnswer(i)}</td>
        <td class="cell-mono">${esc(i.expiry_date || '—')}</td>
        <td>${raChip(i.status)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${i.status === 'answered' ? `<button class="btn btn-primary btn-sm" onclick="SoutRightsAdmin.resolve(${i.id})">Resolve</button>` : ''}
          ${i.status !== 'resolved' && i.status !== 'rejected' ? `<button class="btn btn-ghost btn-sm" onclick="SoutRightsAdmin.reject(${i.id})">Reject</button>` : ''}
          <button class="btn btn-danger btn-sm" onclick="SoutRightsAdmin.del(${i.id})">Delete</button>
        </td></tr>`).join('');
    },
    renderClaims() {
      const tbody = document.getElementById('aClaimsBody'); if (!tbody) return;
      const fs = (document.getElementById('aFltClaimSt') || {}).value || 'all';
      const rows = RA.claims.filter(c => fs === 'all' || c.status === fs);
      if (!rows.length) { tbody.innerHTML = `<tr><td colspan="9"><div class="empty"><h4>No claim requests</h4></div></td></tr>`; return; }
      tbody.innerHTML = rows.map(c => `<tr>
        <td><div class="cell-main">${esc(c.client_name || '')}</div></td>
        <td><div class="cell-main">${c.kind === 'manual_claim' ? 'Manual Claim' : 'Release Claim'}</div>${c.source_issue_id ? `<div class="cell-sub" style="color:var(--accent)">Auto — dispute #${c.source_issue_id}</div>` : ''}</td>
        <td><span class="chip gray">${RA_PLAT[c.platform] || esc(c.platform)}</span></td>
        <td>${c.action ? `<span class="chip blue">${RA_ACT[c.action] || esc(c.action)}</span>` : '—'}</td>
        <td><div class="cell-main">${esc(c.asset_title || '—')}</div><div class="cell-sub cell-mono">${esc(c.upc || c.isrc || '')}</div></td>
        <td>${c.video_url ? `<a class="cell-sub" style="color:var(--accent)" href="${esc(c.video_url)}" target="_blank" rel="noopener">Link</a>` : '—'}</td>
        <td><div class="cell-sub">${esc(c.note || '—')}</div></td>
        <td>${raChip(c.status)}</td>
        <td style="text-align:right;white-space:nowrap">
          ${c.status === 'pending' ? `<button class="btn btn-ghost btn-sm" onclick="SoutRightsAdmin.claimSt(${c.id},'in_progress')">Start</button>` : ''}
          ${['pending', 'in_progress'].includes(c.status) ? `<button class="btn btn-primary btn-sm" onclick="SoutRightsAdmin.claimSt(${c.id},'done')">Done</button>
          <button class="btn btn-danger btn-sm" onclick="SoutRightsAdmin.claimSt(${c.id},'rejected')">Reject</button>` : ''}
        </td></tr>`).join('');
    },
    openForm() {
      ['afAssetTitle', 'afAlbum', 'afTrack', 'afArtist', 'afAssetId', 'afIsrc', 'afUpc', 'afOther', 'afUrl', 'afViews', 'afExpiry'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      openModal('aIssueModal');
    },
    async submitForm() {
      const v = id => ((document.getElementById(id) || {}).value || '').trim();
      const body = {
        client_id: Number(v('afClient')), platform: v('afPlatform'), category: v('afCategory'),
        asset_title: v('afAssetTitle'), album_title: v('afAlbum'), track_title: v('afTrack'),
        artist: v('afArtist'), asset_id: v('afAssetId'), isrc: v('afIsrc'), upc: v('afUpc'),
        other_party: v('afOther'), video_url: v('afUrl'), daily_views: Number(v('afViews')) || 0, expiry_date: v('afExpiry')
      };
      if (!body.client_id) { toast && toast('Choose a client'); return; }
      try { await API.call('/admin/rights/issues', { method: 'POST', body }); closeModal('aIssueModal'); toast && toast('Rights issue added — visible to the client now'); await this.load(); }
      catch (e) { toast && toast(e.message); }
    },
    async resolve(id) {
      const note = prompt('Resolution note (optional):') || '';
      try { await API.call('/admin/rights/issues/' + id, { method: 'PUT', body: { status: 'resolved', resolution_note: note } }); toast && toast('Issue resolved'); await this.load(); }
      catch (e) { toast && toast(e.message); }
    },
    async reject(id) {
      const note = prompt('Rejection note (optional):') || '';
      try { await API.call('/admin/rights/issues/' + id, { method: 'PUT', body: { status: 'rejected', resolution_note: note } }); toast && toast('Issue rejected'); await this.load(); }
      catch (e) { toast && toast(e.message); }
    },
    async del(id) {
      if (!confirm('Delete this rights issue? Any auto-created release claim from it will be removed too.')) return;
      try { await API.call('/admin/rights/issues/' + id, { method: 'DELETE' }); toast && toast('Issue deleted'); await this.load(); }
      catch (e) { toast && toast(e.message); }
    },
    async claimSt(id, status) {
      let admin_note;
      if (status === 'rejected') { admin_note = prompt('Why is this request rejected?') || ''; }
      try { await API.call('/admin/claims/' + id + '/status', { method: 'POST', body: { status, admin_note } }); toast && toast('Request ' + status.replace('_', ' ')); await this.load(); }
      catch (e) { toast && toast(e.message); }
    },
    exportCSV() { window.location.href = '/api/admin/rights/export.csv'; }
  };
  window.SoutRightsAdmin = SoutRightsAdmin;

  // ---------- router hook ----------
  window.SoutPage = {
    onReady() {
      loadAdminOverview(); loadModeration(); SoutRightsAdmin.load();
      if (window.go && !window.__goWrapped) {
        const _go = window.go;
        window.go = function (p) {
          _go(p);
          ({ admin_overview: loadAdminOverview, admin_moderation: loadModeration, admin_users: loadUsers, admin_clients: loadClients, admin_permissions: loadPermissions, admin_audit: loadAudit, admin_rights: () => SoutRightsAdmin.load() }[p] || (() => { }))();
          // wire CSV export button on revenue/distribution pages
        };
        window.__goWrapped = true;
      }
      // wire any Export CSV buttons
      document.querySelectorAll('[data-action="export-csv"]').forEach(b => b.onclick = () => SoutAdmin.exportCSV());
    }
  };
})();
