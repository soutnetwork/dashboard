// ============================================================
// Admin console — real-data loaders + actions
// ============================================================
(function () {
  const { chip, esc, initials } = window.SoutUI;
  const API = window.SoutAPI;
  function art(l) { return `<div class="art">${esc(l)}</div>`; }
  function thumb(t, artwork) {
    if (artwork) return `<img class="art" src="/uploads/${esc(artwork)}" style="object-fit:cover" onerror="this.outerHTML='<div class=&quot;art&quot;>${esc(initials(t))}</div>'">`;
    return art(initials(t));
  }
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
      <td><div class="row-flex" style="cursor:pointer" onclick="SoutAdmin.viewRelease(${r.id})">${thumb(r.title, r.artwork)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)} · ${esc(r.client_name || '')}</div></div></div></td>
      <td>${chip(r.status)}</td><td><span class="chip gray">${esc(r.type)}</span></td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="SoutAdmin.viewRelease(${r.id})">Details</button>
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

  // ---------- Clients (real management, no prompts) ----------
  async function loadClients() {
    const d = await API.call('/admin/clients');
    const tbody = document.getElementById('aClientsBody'); if (!tbody) return;
    const rows = d.clients || [];
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6"><div class="empty"><h4>No clients yet</h4></div></td></tr>`; return; }
    tbody.innerHTML = rows.map(cl => `<tr>
      <td><div class="row-flex">${art(initials(cl.name))}<div class="cell-main">${esc(cl.name)}</div></div></td>
      <td class="cell-mono">${cl.releases} releases</td>
      <td class="cell-mono">${cl.users} user${cl.users == 1 ? '' : 's'}</td>
      <td><span class="chip blue">${esc(cl.plan)}</span></td>
      <td><span class="chip ${cl.status === 'active' ? 'green' : 'gray'}">${esc(cl.status)}</span></td>
      <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="SoutClients.manage(${cl.id})">Manage</button></td></tr>`).join('');
  }

  const MC_CAPS = { upload_releases: 'Upload releases', edit_releases: 'Edit releases', deliver_releases: 'Deliver releases', metadata_edits: 'Metadata edits', takedowns: 'Takedowns', financial_access: 'Financial access', rights_access: 'Rights access', analytics_access: 'Analytics access', team_access: 'Team access' };

  const SoutClients = {
    _id: null,
    openCreate() {
      this._id = null;
      document.getElementById('cmTitle2').textContent = 'Add Client';
      document.getElementById('cfName').value = '';
      document.getElementById('cfPlan').value = 'Label';
      document.getElementById('cfStatus').value = 'active';
      openModal('clientModal');
    },
    async submitCreate() {
      const name = document.getElementById('cfName').value.trim();
      const plan = document.getElementById('cfPlan').value, status = document.getElementById('cfStatus').value;
      if (!name) { toast && toast('Client name is required'); return; }
      try {
        if (this._id) { await API.call('/admin/clients/' + this._id, { method: 'PUT', body: { name, plan, status } }); toast && toast('Client updated'); }
        else { await API.call('/admin/clients', { method: 'POST', body: { name, plan } }); toast && toast('Client created'); }
        closeModal('clientModal'); await loadClients();
        if (this._id) await this.manage(this._id);
      } catch (e) { toast && toast(e.message); }
    },

    // ---------- full manage modal ----------
    async manage(id) {
      this._id = id;
      let d; try { d = await API.call('/admin/clients/' + id); } catch (e) { toast && toast(e.message); return; }
      const cl = d.client, users = d.users || [], st = d.stats || {};
      document.getElementById('mcTitle').textContent = cl.name;
      const userRows = users.map(u => `
        <tr>
          <td><div class="row-flex">${art(initials(u.name))}<div><div class="cell-main">${esc(u.name)}</div><div class="cell-sub">${esc(u.email)}</div></div></div></td>
          <td><span class="chip ${u.status === 'active' ? 'green' : 'gray'}">${esc(u.status)}</span>${u.must_change_password ? '<div class="cell-sub">must change password</div>' : ''}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick="SoutClients.togglePerms(${u.id},this)">Permissions</button>
            <button class="btn btn-ghost btn-sm" onclick="SoutClients.resetPwRow(${u.id},this)">Reset password</button>
            <button class="btn btn-ghost btn-sm" onclick="SoutClients.toggleUser(${u.id})">${u.status === 'active' ? 'Disable' : 'Enable'}</button>
          </td>
        </tr>
        <tr class="permsRow" data-u="${u.id}" style="display:none"><td colspan="3"><div class="permsBox" style="display:flex;flex-wrap:wrap;gap:8px;padding:6px 4px"></div></td></tr>
        <tr class="pwRow" data-u="${u.id}" style="display:none"><td colspan="3"><div class="row-flex" style="gap:8px;padding:4px"><input class="input" type="text" placeholder="New password (8+ chars)" style="max-width:280px"><button class="btn btn-primary btn-sm" onclick="SoutClients.resetPwSave(${u.id},this)">Save</button></div></td></tr>`).join('');
      document.getElementById('mcBody').innerHTML = `
        <div class="stat-grid" style="margin-bottom:16px">
          <div class="stat"><div class="lbl">Releases</div><div class="val">${st.releases || 0}</div></div>
          <div class="stat"><div class="lbl">Live</div><div class="val">${st.live || 0}</div></div>
          <div class="stat"><div class="lbl">Pending review</div><div class="val">${st.pending || 0}</div></div>
          <div class="stat"><div class="lbl">Open rights issues</div><div class="val">${st.rights_open || 0}</div></div>
        </div>
        <div class="sec-title" style="margin-bottom:8px">Client info</div>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end;margin-bottom:18px">
          <div class="field" style="margin:0"><label>Name</label><input class="input" id="mcName" value="${esc(cl.name)}"></div>
          <div class="field" style="margin:0"><label>Plan</label><select class="ctrl" id="mcPlan" style="width:100%"><option${cl.plan === 'Label' ? ' selected' : ''}>Label</option><option${cl.plan === 'Artist' ? ' selected' : ''}>Artist</option><option${cl.plan === 'Partner' ? ' selected' : ''}>Partner</option><option${cl.plan === 'Pro' ? ' selected' : ''}>Pro</option></select></div>
          <div class="field" style="margin:0"><label>Status</label><select class="ctrl" id="mcStatus" style="width:100%"><option value="active"${cl.status === 'active' ? ' selected' : ''}>Active</option><option value="disabled"${cl.status === 'disabled' ? ' selected' : ''}>Disabled</option></select></div>
          <button class="btn btn-primary" onclick="SoutClients.saveInfo()">Save</button>
        </div>
        <div class="row-flex" style="justify-content:space-between;margin-bottom:8px">
          <div class="sec-title" style="margin:0">Users (${users.length})</div>
          <button class="btn btn-ghost btn-sm" onclick="SoutClients.toggleAddUser()">+ Add user</button>
        </div>
        <div id="mcAddUser" style="display:none;margin-bottom:10px"><div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px">
          <input class="input" id="nuName" placeholder="Full name">
          <input class="input" id="nuEmail" placeholder="Email">
          <input class="input" id="nuPass" type="text" placeholder="Password (8+)">
          <button class="btn btn-primary btn-sm" onclick="SoutClients.addUser()">Create</button>
        </div></div>
        <div class="table-wrap"><div class="table-scroll"><table><tbody>${userRows || '<tr><td><div class="empty"><h4>No users yet — add the first one</h4></div></td></tr>'}</tbody></table></div></div>`;
      openModal('manageClientModal');
    },
    async saveInfo() {
      const body = { name: document.getElementById('mcName').value.trim(), plan: document.getElementById('mcPlan').value, status: document.getElementById('mcStatus').value };
      if (!body.name) { toast && toast('Name required'); return; }
      try { await API.call('/admin/clients/' + this._id, { method: 'PUT', body }); toast && toast('Client updated — applied to the client account'); await loadClients(); }
      catch (e) { toast && toast(e.message); }
    },
    toggleAddUser() { const el = document.getElementById('mcAddUser'); el.style.display = el.style.display === 'none' ? '' : 'none'; },
    async addUser() {
      const name = document.getElementById('nuName').value.trim(), email = document.getElementById('nuEmail').value.trim(), password = document.getElementById('nuPass').value;
      if (!name || !email || !password || password.length < 8) { toast && toast('Name, email and 8+ char password required'); return; }
      try { await API.call('/admin/users', { method: 'POST', body: { name, email, password, role: 'client', client_id: this._id } }); toast && toast('User created — they can sign in now'); await this.manage(this._id); await loadUsers().catch(() => { }); }
      catch (e) { toast && toast(e.message); }
    },
    resetPwRow(uid, btn) {
      const row = btn.closest('tr').parentElement.querySelector(`.pwRow[data-u="${uid}"]`);
      if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
    },
    async resetPwSave(uid, btn) {
      const inp = btn.previousElementSibling; const p = inp.value;
      if (!p || p.length < 8) { toast && toast('Password must be 8+ characters'); return; }
      try { await API.call('/admin/users/' + uid + '/reset-password', { method: 'POST', body: { password: p } }); toast && toast('Password reset — user can sign in with it now'); inp.value = ''; btn.closest('tr').style.display = 'none'; }
      catch (e) { toast && toast(e.message); }
    },
    async toggleUser(uid) {
      try { const r = await API.call('/admin/users/' + uid + '/disable', { method: 'POST' }); toast && toast('User ' + r.status); await this.manage(this._id); }
      catch (e) { toast && toast(e.message); }
    },
    async togglePerms(uid, btn) {
      const row = btn.closest('tr').parentElement.querySelector(`.permsRow[data-u="${uid}"]`);
      if (!row) return;
      if (row.style.display !== 'none') { row.style.display = 'none'; return; }
      row.style.display = '';
      const box = row.querySelector('.permsBox');
      box.innerHTML = '<span class="cell-sub">Loading…</span>';
      try {
        const d = await API.call('/admin/users/' + uid + '/permissions');
        box.innerHTML = Object.keys(MC_CAPS).map(cap => {
          const on = d.capabilities[cap] && d.capabilities[cap].allowed;
          return `<label class="chip ${on ? 'green' : 'gray'}" style="cursor:pointer;user-select:none"><input type="checkbox"${on ? ' checked' : ''} style="margin-right:5px" onchange="SoutClients.setPerm(${uid},'${cap}',this)">${MC_CAPS[cap]}</label>`;
        }).join('');
      } catch (e) { box.innerHTML = `<span class="cell-sub" style="color:var(--red)">${esc(e.message)}</span>`; }
    },
    async setPerm(uid, cap, cb) {
      try {
        await API.call('/admin/users/' + uid + '/permission', { method: 'POST', body: { capability: cap, allowed: cb.checked } });
        cb.parentElement.className = 'chip ' + (cb.checked ? 'green' : 'gray');
        toast && toast('Permission saved — applied to the user immediately');
      } catch (e) { toast && toast(e.message); cb.checked = !cb.checked; }
    }
  };
  window.SoutClients = SoutClients;

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
      try {
        const ri = (await API.call('/rights/issues')).issues || [];
        if (vals[2]) vals[2].textContent = ri.filter(i => ['new', 'answered'].includes(i.status)).length;
      } catch { }
      try {
        const cl = (await API.call('/claims')).claims || [];
        if (vals[3]) { vals[3].textContent = cl.filter(x => x.status === 'pending').length; const lbl = vals[3].parentElement.querySelector('.lbl'); if (lbl) lbl.textContent = 'Claim requests pending'; }
      } catch { }
      try {
        const us = (await API.call('/admin/users')).users || [];
        if (vals[4]) vals[4].textContent = us.filter(u => u.status === 'active').length;
      } catch { }
      if (vals[5]) { vals[5].textContent = cnt('rejected'); const lbl = vals[5].parentElement.querySelector('.lbl'); if (lbl) lbl.textContent = 'Rejected'; }
      // review queue preview table
      const tbody = page.querySelector('tbody');
      if (tbody) {
        const q = rels.filter(r => ['submitted', 'review'].includes(r.status)).slice(0, 5);
        tbody.innerHTML = q.length ? q.map(r => `<tr><td><div class="row-flex" style="cursor:pointer" onclick="SoutAdmin.viewRelease(${r.id})">${thumb(r.title, r.artwork)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div></div></div></td><td>${chip(r.status)}</td><td>${chip('review')}</td><td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="go('admin_moderation')">Review</button></td></tr>`).join('') : `<tr><td colspan="4"><div class="empty"><h4>Queue empty</h4></div></td></tr>`;
      }
    } catch { }
  }

  // ---------- actions ----------
  const SoutAdmin = {
    // ---------- full release details (data + tracks + artwork + audio) ----------
    async viewRelease(id) {
      let d; try { d = await API.call('/releases/' + id); } catch (e) { toast && toast(e.message); return; }
      const r = d.release, tracks = d.tracks || [];
      document.getElementById('arTitle').textContent = r.title;
      const artSrc = r.artwork ? '/uploads/' + esc(r.artwork) : '';
      const info = (l, val) => `<div><div class="cell-sub">${l}</div><div class="cell-main">${esc(val || '—')}</div></div>`;
      const trackRows = tracks.map(t => {
        const contribs = (t.contributors || []).map(x => `${esc(x.name)} <span class="cell-sub">(${esc(x.role)})</span>`).join(', ');
        const audio = t.audio_file
          ? `<audio controls preload="none" style="height:30px;max-width:210px" src="/uploads/${esc(t.audio_file)}"></audio><div><a class="dl" href="/uploads/${esc(t.audio_file)}" download>⤓ Download WAV</a></div>`
          : `<span class="chip amber">No audio</span>`;
        return `<tr>
          <td class="cell-mono">${t.track_no}</td>
          <td><div class="cell-main">${esc(t.title)}</div><div class="cell-sub">${contribs || ''}</div><div class="cell-sub cell-mono">${esc(t.c_line || '')}${t.p_line ? ' · ' + esc(t.p_line) : ''}</div></td>
          <td class="cell-mono">${esc(t.isrc || '—')}</td>
          <td><span class="chip gray">${esc(t.version || 'Original')}</span><div class="cell-sub">${esc(t.content_type || '')}</div></td>
          <td>${audio}</td></tr>`;
      }).join('');
      const artBlock = artSrc
        ? `<img src="${artSrc}" onclick="SoutAdmin.zoom('${artSrc}')" style="width:150px;height:150px;border-radius:14px;object-fit:cover;border:1px solid var(--line);cursor:zoom-in" title="Click to enlarge"><div><a class="dl" href="${artSrc}" download>⤓ Download JPG</a></div>`
        : `<div class="art" style="width:150px;height:150px;font-size:2rem;border-radius:14px">${esc(initials(r.title))}</div><div class="cell-sub" style="margin-top:6px;color:var(--red)">No artwork</div>`;
      document.getElementById('arBody').innerHTML = `
        <div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:14px">
          <div style="text-align:center">${artBlock}</div>
          <div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            ${info('Client', r.client_name)}
            ${info('Artist', r.artist)}
            ${info('Label', r.label)}
            ${info('Type', r.type)}
            ${info('Genre', r.genre)}
            ${info('UPC', r.upc || 'Generated on approval')}
            ${info('Digital date', r.digital_date)}
            ${info('Territories', r.territories)}
            ${info('Stores', r.stores)}
          </div>
        </div>
        <div class="row-flex" style="gap:8px;margin-bottom:12px">${chip(r.status)}<span class="cell-sub">Created ${esc((r.created_at || '').slice(0, 10))}</span></div>
        <div class="sec-title" style="margin:10px 0 8px">Tracks (${tracks.length})</div>
        <div class="table-wrap"><div class="table-scroll"><table>
          <thead><tr><th>#</th><th>Title / Contributors / Lines</th><th>ISRC</th><th>Version</th><th>Audio</th></tr></thead>
          <tbody>${trackRows || '<tr><td colspan="5"><div class="empty"><h4>No tracks</h4></div></td></tr>'}</tbody>
        </table></div></div>`;
      const canAct = ['submitted', 'review'].includes(r.status);
      const missingCodes = !r.upc || tracks.some(t => !t.isrc);
      document.getElementById('arFoot').innerHTML = `
        <button class="btn btn-ghost" onclick="closeModal('aRelModal')">Close</button>
        ${missingCodes ? `<button class="btn btn-ghost" onclick="SoutAdmin.generateCodes(${r.id})">Generate UPC &amp; ISRC</button>` : ''}
        ${canAct ? `<button class="btn btn-ghost" onclick="closeModal('aRelModal');SoutAdmin.correction(${r.id})">Correction</button>
        <button class="btn btn-danger" onclick="closeModal('aRelModal');SoutAdmin.reject(${r.id})">Reject</button>
        <button class="btn btn-primary" onclick="closeModal('aRelModal');SoutAdmin.setStatus(${r.id},'approved')">Approve</button>` : ''}`;
      openModal('aRelModal');
    },
    zoom(src) { const lb = document.getElementById('aLightbox'); document.getElementById('aLightboxImg').src = src; lb.style.display = 'grid'; },

    async setStatus(id, status, note) {
      try {
        const r = await API.call('/admin/releases/' + id + '/status', { method: 'POST', body: { status, note } });
        if (r.codes && r.codes.upc) toast && toast('Approved ✓ — UPC ' + r.codes.upc + ' & ISRC generated, files renamed');
        else toast && toast('Release ' + status);
        await loadModeration(); await loadAdminOverview();
        if (window.SoutDist) SoutDist.load().catch(() => { });
      }
      catch (e) { toast && toast(e.message); }
    },
    async generateCodes(id) {
      try {
        const r = await API.call('/admin/releases/' + id + '/generate-codes', { method: 'POST' });
        toast && toast('Generated — UPC ' + r.upc + ' + ' + r.isrcs.length + ' ISRC(s), files renamed');
        await this.viewRelease(id);
        if (window.SoutDist) SoutDist.load().catch(() => { });
      } catch (e) { toast && toast(e.message); }
    },
    reject(id) { ask('Reject release', [{ id: 'note', label: 'Rejection reason (the client will see this)', type: 'textarea' }], 'Reject', v => { if (!v.note.trim()) { toast && toast('Write the reason'); return; } closeModal('askModal'); this.setStatus(id, 'rejected', v.note.trim()); }); },
    correction(id) { ask('Request correction', [{ id: 'note', label: 'What needs correction? (the client will see this)', type: 'textarea' }], 'Send', v => { if (!v.note.trim()) { toast && toast('Write what needs correction'); return; } closeModal('askModal'); this.setStatus(id, 'correction', v.note.trim()); }); },
    resetPw(id) { ask('Reset password', [{ id: 'pw', label: 'New password (8+ characters)', type: 'text' }], 'Reset', async v => { if (!v.pw || v.pw.length < 8) { toast && toast('8+ characters required'); return; } try { await API.call('/admin/users/' + id + '/reset-password', { method: 'POST', body: { password: v.pw } }); closeModal('askModal'); toast && toast('Password reset'); } catch (e) { toast && toast(e.message); } }); },
    async toggleUser(id) { try { const r = await API.call('/admin/users/' + id + '/disable', { method: 'POST' }); toast && toast('User ' + r.status); await loadUsers(); } catch (e) { toast && toast(e.message); } },
    async createUser() {
      let clients = []; try { clients = (await API.call('/clients-list')).clients || []; } catch { }
      const roleOpts = ['client', 'admin', 'label_manager', 'operations', 'finance', 'analyst'].map(r => ({ v: r, l: r }));
      const clientOpts = [{ v: '', l: '— none —' }].concat(clients.map(cl => ({ v: String(cl.id), l: cl.name })));
      ask('Create user', [
        { id: 'name', label: 'Full name' },
        { id: 'email', label: 'Email' },
        { id: 'pw', label: 'Password (8+ characters)' },
        { id: 'role', label: 'Role', type: 'select', options: roleOpts, value: 'client' },
        { id: 'cid', label: 'Client account', type: 'select', options: clientOpts }
      ], 'Create', async v => {
        if (!v.name.trim() || !v.email.trim() || v.pw.length < 8) { toast && toast('Name, email and 8+ char password required'); return; }
        try { await API.call('/admin/users', { method: 'POST', body: { name: v.name.trim(), email: v.email.trim(), password: v.pw, role: v.role, client_id: v.cid ? Number(v.cid) : null } }); closeModal('askModal'); toast && toast('User created'); await loadUsers(); } catch (e) { toast && toast(e.message); }
      });
    },
    editUser(id, role) {
      const roleOpts = ['client', 'admin', 'label_manager', 'operations', 'finance', 'analyst'].map(r => ({ v: r, l: r }));
      ask('Change role', [{ id: 'role', label: 'Role', type: 'select', options: roleOpts, value: role }], 'Save', async v => {
        try { await API.call('/admin/users/' + id, { method: 'PUT', body: { role: v.role } }); closeModal('askModal'); toast && toast('User updated'); await loadUsers(); } catch (e) { toast && toast(e.message); }
      });
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
    resolve(id) {
      ask('Resolve rights issue', [{ id: 'note', label: 'Resolution note (optional, visible to the client)', type: 'textarea' }], 'Resolve', async v => {
        try { await API.call('/admin/rights/issues/' + id, { method: 'PUT', body: { status: 'resolved', resolution_note: v.note.trim() } }); closeModal('askModal'); toast && toast('Issue resolved'); await this.load(); } catch (e) { toast && toast(e.message); }
      });
    },
    reject(id) {
      ask('Reject rights issue', [{ id: 'note', label: 'Rejection note (optional)', type: 'textarea' }], 'Reject', async v => {
        try { await API.call('/admin/rights/issues/' + id, { method: 'PUT', body: { status: 'rejected', resolution_note: v.note.trim() } }); closeModal('askModal'); toast && toast('Issue rejected'); await this.load(); } catch (e) { toast && toast(e.message); }
      });
    },
    async del(id) {
      if (!confirm('Delete this rights issue? Any auto-created release claim from it will be removed too.')) return;
      try { await API.call('/admin/rights/issues/' + id, { method: 'DELETE' }); toast && toast('Issue deleted'); await this.load(); }
      catch (e) { toast && toast(e.message); }
    },
    async claimSt(id, status) {
      const doIt = async admin_note => {
        try { await API.call('/admin/claims/' + id + '/status', { method: 'POST', body: { status, admin_note } }); closeModal('askModal'); toast && toast('Request ' + status.replace('_', ' ')); await this.load(); }
        catch (e) { toast && toast(e.message); }
      };
      if (status === 'rejected') ask('Reject claim request', [{ id: 'note', label: 'Why is this request rejected? (visible to the client)', type: 'textarea' }], 'Reject', v => doIt(v.note.trim()));
      else doIt(undefined);
    },
    exportCSV() { window.location.href = '/api/admin/rights/export.csv'; }
  };
  window.SoutRightsAdmin = SoutRightsAdmin;


  // ============================================================
  // ACCOUNT APPLICATIONS (admin)
  // ============================================================
  const SoutApps = {
    async load() {
      let apps = [];
      try { apps = (await API.call('/admin/applications')).applications || []; } catch (e) { toast && toast(e.message); return; }
      const tbody = document.getElementById('aAppsBody');
      const pend = apps.filter(a => a.status === 'pending').length;
      const b = document.getElementById('aAppsBadge'); if (b) { b.textContent = pend; b.style.display = pend ? '' : 'none'; }
      if (!tbody) return;
      if (!apps.length) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><h4>No applications yet</h4><div class="cell-sub">New applications from apply.soutnetwork appear here.</div></div></td></tr>`; return; }
      const st = s => ({ pending: ['Pending', 'amber'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'] }[s] || [s, 'gray']);
      tbody.innerHTML = apps.map(a => {
        const [l, cl] = st(a.status);
        return `<tr>
          <td><div class="row-flex">${art(initials(a.company))}<div class="cell-main">${esc(a.company)}</div></div></td>
          <td><div class="cell-main">${esc(a.name)}</div><div class="cell-sub">${esc(a.email)}</div></td>
          <td class="cell-mono">${esc(a.phone || '—')}</td>
          <td><span class="chip gray">${esc(a.catalog_size || '—')}</span></td>
          <td><div class="cell-sub" style="max-width:220px">${esc(a.message || '—')}</div></td>
          <td class="cell-mono">${esc((a.created_at || '').slice(0, 10))}</td>
          <td><span class="chip ${cl}">${l}</span>${a.note ? `<div class="cell-sub">${esc(a.note)}</div>` : ''}</td>
          <td style="text-align:right;white-space:nowrap">${a.status === 'pending' ? `
            <button class="btn btn-primary btn-sm" onclick="SoutApps.approve(${a.id})">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="SoutApps.reject(${a.id})">Reject</button>` : ''}
          </td></tr>`;
      }).join('');
    },
    async approve(id) {
      if (!confirm('Approve this application? An account will be created and the login details emailed to the applicant.')) return;
      try {
        const r = await API.call('/admin/applications/' + id + '/approve', { method: 'POST' });
        if (r.emailed) toast && toast('Approved — login details emailed to ' + r.email);
        else alert('Approved \u2714\n\nEmail is not configured yet, so send these details to the client manually:\n\nEmail: ' + r.email + '\nTemporary password: ' + r.temp_password + '\n\nThey will be asked to change it on first sign-in.');
        await this.load();
      } catch (e) { toast && toast(e.message); }
    },
    reject(id) {
      ask('Reject application', [{ id: 'note', label: 'Rejection reason (optional, saved internally)', type: 'textarea' }], 'Reject', async v => {
        try { await API.call('/admin/applications/' + id + '/reject', { method: 'POST', body: { note: v.note.trim() } }); closeModal('askModal'); toast && toast('Application rejected'); await this.load(); } catch (e) { toast && toast(e.message); }
      });
    }
  };
  window.SoutApps = SoutApps;


  // ============================================================
  // In-dashboard input modal — replaces every browser prompt()
  // ============================================================
  function ask(title, fields, okLabel, onOk) {
    document.getElementById('akTitle').textContent = title;
    document.getElementById('akBody').innerHTML = fields.map(f => {
      if (f.type === 'select') return `<div class="field"><label>${esc(f.label)}</label><select class="ctrl" id="ak_${f.id}" style="width:100%">${f.options.map(o => `<option value="${esc(o.v)}"${o.v === f.value ? ' selected' : ''}>${esc(o.l)}</option>`).join('')}</select></div>`;
      if (f.type === 'textarea') return `<div class="field"><label>${esc(f.label)}</label><textarea class="input" id="ak_${f.id}" style="min-height:90px;padding:10px 13px" placeholder="${esc(f.placeholder || '')}"></textarea></div>`;
      return `<div class="field"><label>${esc(f.label)}</label><input class="input" id="ak_${f.id}" type="${f.type || 'text'}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.value || '')}"></div>`;
    }).join('');
    const okBtn = document.getElementById('akOk');
    okBtn.textContent = okLabel || 'OK';
    okBtn.onclick = () => {
      const vals = {}; fields.forEach(f => vals[f.id] = (document.getElementById('ak_' + f.id) || {}).value || '');
      onOk(vals);
    };
    openModal('askModal');
    setTimeout(() => { const first = document.querySelector('#akBody input, #akBody textarea, #akBody select'); if (first) first.focus(); }, 60);
  }

  // ============================================================
  // DISTRIBUTION — approved releases collected for bulk export
  // ============================================================
  const SoutDist = {
    _view: 'approved', _rows: [],
    async load() {
      const d = await API.call('/releases');
      const all = d.releases || [];
      const approved = all.filter(r => r.status === 'approved');
      const badge = document.getElementById('aDistBadge');
      if (badge) { badge.textContent = approved.length; badge.style.display = approved.length ? '' : 'none'; }
      const cnt = document.getElementById('distReadyCount');
      if (cnt) cnt.textContent = approved.length ? `(${approved.length})` : '';
      this._rows = this._view === 'approved' ? approved : all.filter(r => ['delivered', 'live'].includes(r.status));
      this.render();
    },
    tab(el, v) {
      el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); el.classList.add('active');
      this._view = v; this.load();
      document.getElementById('distBulkBar').style.display = v === 'approved' ? '' : 'none';
    },
    render() {
      const tbody = document.getElementById('distBody'); if (!tbody) return;
      const rows = this._rows;
      if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><h4>${this._view === 'approved' ? 'Nothing waiting for delivery' : 'Nothing delivered yet'}</h4><div class="cell-sub">${this._view === 'approved' ? 'Approve releases from the Review Queue and they collect here.' : ''}</div></div></td></tr>`; this.selCount(); return; }
      tbody.innerHTML = rows.map(r => `<tr>
        <td>${this._view === 'approved' ? `<input type="checkbox" class="distSel" value="${r.id}" onchange="SoutDist.selCount()">` : ''}</td>
        <td><div class="row-flex" style="cursor:pointer" onclick="SoutAdmin.viewRelease(${r.id})">${thumb(r.title, r.artwork)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist || '')}</div></div></div></td>
        <td>${esc(r.client_name || '')}</td>
        <td><span class="chip gray">${esc(r.type)}</span></td>
        <td class="cell-mono">${esc(r.upc || '—')}</td>
        <td class="cell-mono">${esc(r.digital_date || '—')}</td>
        <td>${chip(r.status)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="SoutAdmin.viewRelease(${r.id})">Details</button>
          ${r.status === 'approved' ? `<button class="btn btn-primary btn-sm" onclick="SoutDist.mark(${r.id},'delivered')">Delivered</button>` : ''}
          ${r.status === 'delivered' ? `<button class="btn btn-primary btn-sm" onclick="SoutDist.mark(${r.id},'live')">Mark Live</button>` : ''}
        </td></tr>`).join('');
      this.selCount();
    },
    selAll(cb) { document.querySelectorAll('.distSel').forEach(x => x.checked = cb.checked); this.selCount(); },
    selCount() { const n = document.querySelectorAll('.distSel:checked').length; const el = document.getElementById('distSelCount'); if (el) el.textContent = n + ' selected'; },
    async mark(id, status) {
      try { await API.call('/admin/releases/' + id + '/status', { method: 'POST', body: { status } }); toast && toast('Release marked ' + status + ' — the client sees it now'); await this.load(); }
      catch (e) { toast && toast(e.message); }
    },
    async bulk(status) {
      const ids = [...document.querySelectorAll('.distSel:checked')].map(x => Number(x.value));
      if (!ids.length) { toast && toast('Select releases first'); return; }
      for (const id of ids) { try { await API.call('/admin/releases/' + id + '/status', { method: 'POST', body: { status } }); } catch (e) { toast && toast('#' + id + ': ' + e.message); } }
      toast && toast(ids.length + ' release(s) marked ' + status);
      await this.load();
    },
    exportCSV() { window.location.href = '/api/admin/export.csv?status=approved'; }
  };
  window.SoutDist = SoutDist;


  // ============================================================
  // CODES REGISTRY (UPC / ISRC)
  // ============================================================
  const SoutCodes = {
    async load() {
      const v = id => ((document.getElementById(id) || {}).value || '').trim();
      const qs = new URLSearchParams();
      if (v('cdFltKind')) qs.set('kind', v('cdFltKind'));
      if (v('cdFltSource')) qs.set('source', v('cdFltSource'));
      if (v('cdSearch')) qs.set('q', v('cdSearch'));
      let d; try { d = await API.call('/admin/codes?' + qs.toString()); } catch (e) { toast && toast(e.message); return; }
      const s = d.stats || {};
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      set('cdUpc', s.upc_total || 0); set('cdIsrc', s.isrc_total || 0); set('cdExt', s.external || 0);
      set('cdNext', 'UPC #' + (s.next_upc_seq || 1) + ' · ISRC #' + (s.next_isrc_seq || 1));
      const tbody = document.getElementById('cdBody'); if (!tbody) return;
      const rows = d.codes || [];
      if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><h4>No codes yet</h4><div class="cell-sub">Codes appear here automatically when releases are approved, or generate a batch for external use.</div></div></td></tr>`; return; }
      tbody.innerHTML = rows.map(r => `<tr>
        <td class="cell-mono" style="font-weight:600">${esc(r.code)}</td>
        <td><span class="chip ${r.kind === 'upc' ? 'blue' : 'green'}">${r.kind.toUpperCase()}</span></td>
        <td><span class="chip ${r.source === 'external' ? 'amber' : 'gray'}">${esc(r.source)}</span></td>
        <td><div class="cell-main">${esc(r.assigned_to || r.release_title || '—')}</div>${r.client_name ? `<div class="cell-sub">${esc(r.client_name)}</div>` : ''}</td>
        <td><div class="cell-sub">${esc(r.note || '')}</div>${r.batch_id ? `<a class="dl" style="margin-top:3px" href="/api/admin/codes/export.csv?batch=${esc(r.batch_id)}">⤓ ${esc(r.batch_id)}</a>` : ''}</td>
        <td class="cell-sub">${esc((r.created_by || '').split('@')[0])}</td>
        <td class="cell-mono">${esc((r.created_at || '').slice(0, 10))}</td></tr>`).join('');
    },
    openGen() {
      document.getElementById('gcResult').innerHTML = '';
      document.getElementById('gcNote').value = '';
      openModal('genCodesModal');
    },
    async generate() {
      const kind = document.getElementById('gcKind').value;
      const count = Number(document.getElementById('gcCount').value) || 1;
      const note = document.getElementById('gcNote').value.trim();
      if (!note) { toast && toast('Write a note — who is this batch for?'); return; }
      const btn = document.getElementById('gcGo'); btn.disabled = true; btn.textContent = 'Generating…';
      try {
        const r = await API.call('/admin/codes/generate', { method: 'POST', body: { kind, count, note } });
        document.getElementById('gcResult').innerHTML = `
          <div class="card card-pad" style="border-color:var(--accent)">
            <div class="row-flex" style="justify-content:space-between;margin-bottom:8px">
              <b>${r.codes.length} × ${kind.toUpperCase()} generated ✓</b>
              <div class="row-flex" style="gap:6px">
                <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('gcList').textContent).then(()=>toast('Copied'))">Copy all</button>
                <a class="btn btn-primary btn-sm" href="/api/admin/codes/export.csv?batch=${esc(r.batch_id)}">Download CSV</a>
              </div>
            </div>
            <pre id="gcList" class="cell-mono" style="max-height:220px;overflow:auto;background:var(--surface-2);padding:10px;border-radius:10px;margin:0;font-size:.8rem">${r.codes.join('\n')}</pre>
          </div>`;
        toast && toast('Batch saved in the registry — collision-proof');
        await this.load();
      } catch (e) { toast && toast(e.message); }
      btn.disabled = false; btn.textContent = 'Generate';
    },
    async check() {
      const code = (document.getElementById('cdCheckInput').value || '').trim();
      const out = document.getElementById('cdCheckResult');
      if (!code) { out.innerHTML = ''; return; }
      out.innerHTML = '<span class="cell-sub">Checking…</span>';
      try {
        const d = await API.call('/admin/codes/check?code=' + encodeURIComponent(code));
        if (!d.found) {
          out.innerHTML = `<div class="card card-pad" style="border-color:var(--line)"><span class="chip gray">Not ours</span> <span class="cell-sub" style="margin-right:8px">This code was never issued by our system and is not attached to any release here.</span></div>`;
        } else {
          const usage = d.assigned_to || d.release_title || (d.source === 'external' ? 'External batch — not attached to a release here' : '—');
          out.innerHTML = `<div class="card card-pad" style="border-color:var(--accent)">
            <div class="row-flex" style="gap:8px;flex-wrap:wrap">
              <span class="chip green">Ours ✓</span>
              <span class="chip ${d.source === 'external' ? 'amber' : 'blue'}">${esc(d.source || d.where)}</span>
              <span class="cell-main">${esc(usage)}</span>
              ${d.client_name ? `<span class="cell-sub">· ${esc(d.client_name)}</span>` : ''}
              ${d.note ? `<span class="cell-sub">· ${esc(d.note)}</span>` : ''}
            </div></div>`;
        }
      } catch (e) { out.innerHTML = `<span class="cell-sub" style="color:var(--red)">${esc(e.message)}</span>`; }
    }
  };
  window.SoutCodes = SoutCodes;

  // ---------- router hook ----------
  window.SoutPage = {
    onReady() {
      loadAdminOverview(); loadModeration(); SoutRightsAdmin.load(); SoutApps.load(); SoutDist.load();
      if (window.go && !window.__goWrapped) {
        const _go = window.go;
        window.go = function (p) {
          _go(p);
          ({ admin_overview: loadAdminOverview, admin_moderation: loadModeration, admin_users: loadUsers, admin_clients: loadClients, admin_permissions: loadPermissions, admin_audit: loadAudit, admin_rights: () => SoutRightsAdmin.load(), admin_applications: () => SoutApps.load(), admin_distribution: () => SoutDist.load(), admin_codes: () => SoutCodes.load() }[p] || (() => { }))();
          // wire CSV export button on revenue/distribution pages
        };
        window.__goWrapped = true;
      }
      // wire any Export CSV buttons
      document.querySelectorAll('[data-action="export-csv"]').forEach(b => b.onclick = () => SoutAdmin.exportCSV());
    }
  };
})();
