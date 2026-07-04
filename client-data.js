// ============================================================
// Client dashboard — real-data loaders
// Manage Music (unified tabs) + Rights Manager (Believe-style)
// ============================================================
(function () {
  const { chip, esc, initials } = window.SoutUI;
  const API = window.SoutAPI;
  let CACHE = { releases: [], issues: [], claims: [], rightsApiMissing: false };

  function art(label) { return `<div class="art">${esc(label)}</div>`; }
  function thumb(title, artwork) {
    if (artwork) return `<img class="art" src="/uploads/${esc(artwork)}" style="object-fit:cover" onerror="this.outerHTML='<div class=&quot;art&quot;>${esc(initials(title))}</div>'">`;
    return art(initials(title));
  }
  // file upload helper with REAL progress (XHR — fetch has no upload progress)
  function uploadFile(path, fieldName, file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData(); fd.append(fieldName, file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api' + path);
      xhr.withCredentials = true;
      xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = () => {
        let d = {}; try { d = JSON.parse(xhr.responseText); } catch { }
        if (xhr.status >= 200 && xhr.status < 300) resolve(d);
        else reject(new Error(d.error || 'Upload failed'));
      };
      xhr.onerror = () => reject(new Error('Connection error during upload'));
      xhr.send(fd);
    });
  }
  // picker feedback (used by the builder markup)
  window.artPicked = function (input) {
    const f = input.files[0]; if (!f) return;
    const nameEl = document.getElementById('nrArtName');
    if (!/\.jpe?g$/i.test(f.name)) { toast && toast('Artwork must be JPG or JPEG'); input.value = ''; if (nameEl) nameEl.textContent = 'JPG only · exactly 3000×3000 px · click to browse'; return; }
    if (nameEl) nameEl.textContent = f.name + ' — will be checked (3000×3000) on save';
    const img = document.getElementById('nrArtPreview');
    if (img) { img.src = URL.createObjectURL(f); img.style.display = ''; }
  };
  window.audioPicked = function (input) {
    const f = input.files[0]; if (!f) return;
    const nameEl = input.parentElement.querySelector('.audioName');
    if (!/\.wav$/i.test(f.name)) { toast && toast('Audio must be a WAV file'); input.value = ''; if (nameEl) nameEl.textContent = 'WAV only · click to browse'; return; }
    if (nameEl) nameEl.textContent = f.name + ' ✓';
  };

  // ============================================================
  // MANAGE MUSIC — one page, tabs: All / Drafts / Pending /
  // Approved / Delivered / Needs Correction / Rejected
  // ============================================================
  const PENDING = ['submitted', 'review'];

  async function loadReleases() {
    const d = await API.call('/releases');
    CACHE.releases = d.releases || [];
    const active = document.querySelector('.page[data-page="releases"] .tab.active');
    renderReleaseTab(active ? active.dataset.cat : 'all');
    updateCorrBadge();
  }

  function updateCorrBadge() {
    const n = CACHE.releases.filter(r => r.status === 'correction').length;
    const el = document.getElementById('corrTabBadge');
    if (el) el.textContent = n ? ` (${n})` : '';
  }

  function renderReleaseTab(filter) {
    const rows = CACHE.releases.filter(r => {
      if (filter === 'all') return true;
      if (filter === 'pending') return PENDING.includes(r.status);
      if (filter === 'delivered') return ['delivered', 'live'].includes(r.status);
      return r.status === filter;
    });
    const tbody = document.getElementById('relAll');
    if (!tbody) return;
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><h4>No releases in this view</h4></div></td></tr>`; return; }
    tbody.innerHTML = rows.map(r => {
      const note = (r.note && ['rejected', 'correction'].includes(r.status)) ? `<div class="cell-sub" style="color:var(--red);margin-top:2px">${esc(r.note)}</div>` : '';
      let actions;
      if (r.status === 'draft')
        actions = `<button class="btn btn-ghost btn-sm" onclick="SoutClient.editRelease(${r.id})">Edit</button> <button class="btn btn-danger btn-sm" onclick="SoutClient.deleteRelease(${r.id})">Delete</button>`;
      else if (r.status === 'correction' || r.status === 'rejected')
        actions = `<button class="btn btn-primary btn-sm" onclick="SoutClient.editRelease(${r.id})">Fix &amp; Resubmit</button>`;
      else
        actions = `<span class="cell-sub">Contact support</span>`;
      return `<tr>
        <td><div class="cbx" onclick="toggleRow(this,event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div></td>
        <td><div class="row-flex" style="cursor:pointer" onclick="SoutClient.viewRelease(${r.id})">${thumb(r.title, r.artwork)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div>${note}</div></div></td>
        <td class="cell-mono">${esc(r.label)}</td><td>${chip(r.status)}</td><td><span class="chip gray">${esc(r.type)}</span></td>
        <td class="cell-mono">${esc(r.upc || '—')}</td><td class="cell-mono">${esc((r.created_at || '').slice(0, 10))}</td>
        <td style="text-align:right;white-space:nowrap">${actions}</td></tr>`;
    }).join('');
  }

  window.catTab = function (el, cat) {
    el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderReleaseTab(cat);
  };

  // ============================================================
  // RIGHTS MANAGER
  // ============================================================
  const CAT_LABELS = {
    ownership_conflict: 'Ownership conflict',
    disputed_claim: 'Disputed claims',
    takedown_video: 'Takedown video',
    ugc_monetize: 'Claim UGC video : monetize',
    ugc_block: 'Claim UGC video : block',
    release_claim: 'Release claim',
    copyright_check: 'Copyright check'
  };
  const PLAT_LABELS = { youtube: 'YouTube', facebook: 'Facebook', tiktok: 'TikTok', other: 'Other' };
  const ACT_LABELS = { ugc_monetize: 'Claim UGC : monetize', ugc_block: 'Claim UGC : block', takedown: 'Takedown video' };
  const ANSWER_LABELS = {
    yes: 'Accepted (Yes)', no: 'Refused (No)',
    original_exclusive: 'Original content — exclusive rights',
    non_exclusive_license: 'Non-exclusive rights (third-party license)',
    contentid_exclusive: 'Exclusive license for Content-ID stores only',
    soundalike: 'Soundalike (cover / remix)',
    public_domain: 'Public Domain recording',
    no_rights: "Doesn't own rights"
  };

  const PLAT_ICONS = {
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor" style="color:#f00"><path d="M23 12s0-3.9-.5-5.6c-.3-1-1.1-1.8-2.1-2C18.6 4 12 4 12 4s-6.6 0-8.4.4c-1 .2-1.8 1-2.1 2C1 8.1 1 12 1 12s0 3.9.5 5.6c.3 1 1.1 1.8 2.1 2 1.8.4 8.4.4 8.4.4s6.6 0 8.4-.4c1-.2 1.8-1 2.1-2 .5-1.7.5-5.6.5-5.6zM9.8 15.5v-7l6.2 3.5-6.2 3.5z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor" style="color:#1877f2"><path d="M24 12a12 12 0 10-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0024 12z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 2h3.1c.2 1.8 1.3 3.4 2.9 4.2.9.5 1.9.7 2.9.7v3.2c-1.8 0-3.6-.6-5-1.6v7.3A6.4 6.4 0 019.9 22 6.4 6.4 0 013.5 15.6c0-3.5 2.9-6.4 6.4-6.4.4 0 .7 0 1.1.1v3.3c-.3-.1-.7-.2-1.1-.2a3.2 3.2 0 100 6.4c1.8 0 3.2-1.5 3.2-3.2V2z"/></svg>',
    other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/></svg>'
  };
  function storeIcon(p) { return `<div class="art" style="width:32px;height:32px;background:var(--surface-3)">${PLAT_ICONS[p] || PLAT_ICONS.other}</div>`; }

  function issueChip(st) {
    const M = { new: ['New', 'red'], answered: ['Answered', 'blue'], resolved: ['Resolved', 'green'], rejected: ['Rejected', 'gray'] };
    const [l, c] = M[st] || [st, 'gray'];
    return `<span class="chip ${c}">${l}</span>`;
  }
  function expiryChip(d) {
    if (!d) return '<span class="cell-sub">—</span>';
    const days = Math.ceil((new Date(d) - new Date()) / 86400000);
    if (isNaN(days)) return '<span class="cell-sub">—</span>';
    if (days < 0) return `<span class="chip red">expired</span>`;
    return `<span class="chip ${days <= 5 ? 'red' : 'amber'}">${days} d</span>`;
  }
  function radioCard(name, value, title, sub, checked) {
    return `<label class="card card-pad" style="display:flex;align-items:flex-start;gap:12px;cursor:pointer"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''} style="margin-top:3px"> <div><b>${title}</b>${sub ? `<div class="cell-sub" style="margin-top:2px">${sub}</div>` : ''}</div></label>`;
  }
  function issueSummary(i) {
    return `<div class="card card-pad" style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
      ${storeIcon(i.platform)}
      <div style="flex:1;min-width:0">
        <div class="cell-main">${esc(i.asset_title || i.track_title || '—')}</div>
        <div class="cell-sub">${esc(i.artist || '')} · ${PLAT_LABELS[i.platform] || esc(i.platform)}${i.other_party ? ' · VS. ' + esc(i.other_party) : ''}</div>
        <div class="cell-sub cell-mono" style="margin-top:2px">${i.isrc ? 'ISRC: ' + esc(i.isrc) + ' · ' : ''}${i.upc ? 'UPC: ' + esc(i.upc) : ''}</div>
      </div>
      ${i.video_url ? `<a class="btn btn-ghost btn-sm" href="${esc(i.video_url)}" target="_blank" rel="noopener">Video</a>` : ''}
    </div>`;
  }

  const SoutRights = {
    _current: null,
    _reqKind: 'manual_claim',

    async load() {
      try {
        const d = await API.call('/rights/issues');
        CACHE.issues = d.issues || [];
        CACHE.rightsApiMissing = false;
      } catch (e) { CACHE.issues = []; CACHE.rightsApiMissing = true; }
      this.buildCatFilter(); this.renderCards(); this.render(); this.badge();
      this.loadRequests(); this.loadAnalytics();
    },

    badge() {
      const n = CACHE.issues.filter(i => i.status === 'new').length;
      const b = document.getElementById('rightsBadge');
      if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
    },

    buildCatFilter() {
      const sel = document.getElementById('rFltCat'); if (!sel) return;
      const cur = sel.value || 'all';
      const counts = {};
      CACHE.issues.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1);
      let html = `<option value="all">Category: All (${CACHE.issues.length})</option>`;
      Object.keys(CAT_LABELS).forEach(c => { if (counts[c]) html += `<option value="${c}">${CAT_LABELS[c]} (${counts[c]})</option>`; });
      sel.innerHTML = html; sel.value = (counts[cur] || cur === "all") ? cur : "all";
    },

    renderCards() {
      const wrap = document.getElementById('rPlatCards'); if (!wrap) return;
      wrap.innerHTML = ['youtube', 'facebook', 'tiktok'].map(p => {
        const mine = CACHE.issues.filter(i => i.platform === p);
        const fresh = mine.filter(i => i.status === 'new').length;
        return `<div class="card card-pad" style="display:flex;align-items:center;gap:12px;min-width:180px;cursor:pointer" onclick="document.getElementById('rFltPlat').value='${p}';SoutRights.render()">
          ${storeIcon(p)}
          <div><div class="cell-sub">${PLAT_LABELS[p]}</div>
          <div style="display:flex;gap:8px;margin-top:2px"><span class="chip ${fresh ? 'red' : 'gray'}">${fresh} new</span><span class="chip gray">${mine.length} total</span></div></div>
        </div>`;
      }).join('');
    },

    render() {
      const tbody = document.getElementById('rIssuesBody'); if (!tbody) return;
      const fa = (document.getElementById('rFltAction') || {}).value || 'all';
      const fc = (document.getElementById('rFltCat') || {}).value || 'all';
      const fp = (document.getElementById('rFltPlat') || {}).value || 'all';
      const rows = CACHE.issues.filter(i =>
        (fa === 'all' || i.status === fa) && (fc === 'all' || i.category === fc) && (fp === 'all' || i.platform === fp));
      if (!rows.length) {
        const msg = CACHE.rightsApiMissing
          ? '<h4>Rights service is being updated</h4><div class="cell-sub">New rights issues will appear here shortly.</div>'
          : '<h4>No rights issues</h4><div class="cell-sub">Nothing matches the current filters.</div>';
        tbody.innerHTML = `<tr><td colspan="11"><div class="empty">${msg}</div></td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(i => {
        const resolvable = i.status === 'new' && ['disputed_claim', 'ownership_conflict'].includes(i.category);
        const action = resolvable
          ? `<button class="btn btn-primary btn-sm" onclick="SoutRights.openIssue(${i.id})">Resolve</button>`
          : `<button class="btn btn-ghost btn-sm" onclick="SoutRights.openIssue(${i.id})">View</button>`;
        const answered = i.client_answer ? `<div class="cell-sub" style="color:var(--accent);margin-top:2px">${esc(ANSWER_LABELS[i.client_answer] || i.client_answer)}</div>` : '';
        return `<tr>
          <td>${storeIcon(i.platform)}</td>
          <td><div class="cell-main">${CAT_LABELS[i.category] || esc(i.category)}</div>${i.video_url ? `<a class="cell-sub" style="color:var(--accent)" href="${esc(i.video_url)}" target="_blank" rel="noopener">Link to the video</a>` : ''}${answered}</td>
          <td><div class="cell-main">${esc(i.asset_title || '—')}</div></td>
          <td><div class="cell-sub">${esc(i.album_title || '-')}</div><div class="cell-sub">${esc(i.track_title || '')}</div></td>
          <td><div class="cell-main">${esc(i.artist || '—')}</div><div class="cell-sub cell-mono">${esc(i.asset_id || '')}</div></td>
          <td class="cell-mono">${esc(i.upc || '—')}</td>
          <td>${esc(i.other_party || '-')}</td>
          <td class="cell-mono">${i.daily_views || 0}</td>
          <td>${expiryChip(i.expiry_date)}</td>
          <td>${issueChip(i.status)}</td>
          <td style="text-align:right">${action}</td></tr>`;
      }).join('');
    },

    tab(el, view) {
      el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      document.getElementById('rightsIssuesView').style.display = view === 'issues' ? '' : 'none';
      document.getElementById('rightsRequestsView').style.display = view === 'requests' ? '' : 'none';
      document.getElementById('rightsAnalyticsView').style.display = view === 'analytics' ? '' : 'none';
    },

    // ---------- resolve / view issue ----------
    openIssue(id) {
      const i = CACHE.issues.find(x => x.id === id); if (!i) return;
      this._current = i;
      const body = document.getElementById('imBody');
      const submit = document.getElementById('imSubmit');
      document.getElementById('imTitle').textContent = CAT_LABELS[i.category] || 'Rights issue';
      let html = issueSummary(i);
      if (i.status === 'new' && i.category === 'disputed_claim') {
        html += `<div class="cell-sub" style="margin-bottom:12px">A dispute was received on this claim${i.other_party ? ' from <b>' + esc(i.other_party) + '</b>' : ''}. Choose how to resolve it:</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${radioCard('imAns', 'yes', 'Yes — accept the dispute', 'A <b>Release Claim</b> will be created automatically for this video.', true)}
            ${radioCard('imAns', 'no', 'No — keep our claim', 'The dispute will be refused and the disputing party rejected.')}
          </div>
          <div class="field" style="margin-top:14px"><label>Note (optional)</label><input class="input" id="imNote" placeholder="Anything the rights team should know"></div>`;
        submit.style.display = '';
      } else if (i.status === 'new' && i.category === 'ownership_conflict') {
        html += `<div class="card card-pad" style="background:var(--accent-soft);border:none;margin-bottom:14px;font-size:.85rem">A fingerprint match has been detected with the content of a 3rd party over your asset(s). Please confirm the type of rights owned.</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${radioCard('imAns', 'original_exclusive', 'My content is Original and I own exclusive rights', 'On all or part of the territories. I confirm I have not granted exclusive license to any other parties.', true)}
            ${radioCard('imAns', 'non_exclusive_license', 'I own non-exclusive rights only', 'License granted by a third party on an Original content.')}
            ${radioCard('imAns', 'contentid_exclusive', 'I have granted exclusive license for Content-ID stores only', '')}
            ${radioCard('imAns', 'soundalike', 'It is a soundalike recording', 'e.g., cover or remix of an original content.')}
            ${radioCard('imAns', 'public_domain', 'It is a Public Domain recording', '')}
            ${radioCard('imAns', 'no_rights', "I don't own rights for the selected content", '')}
          </div>
          <div class="field" style="margin-top:14px"><label>Note (optional)</label><input class="input" id="imNote" placeholder="Anything the rights team should know"></div>`;
        submit.style.display = '';
      } else {
        html += `<div class="cell-sub">Status: ${issueChip(i.status)}${i.client_answer ? ' · Your answer: <b>' + esc(ANSWER_LABELS[i.client_answer] || i.client_answer) + '</b>' : ''}</div>
          ${i.client_answer_note ? `<div class="cell-sub" style="margin-top:8px">Note: ${esc(i.client_answer_note)}</div>` : ''}
          ${i.resolution_note ? `<div class="cell-sub" style="margin-top:8px;color:var(--accent)">Rights team: ${esc(i.resolution_note)}</div>` : ''}`;
        submit.style.display = 'none';
      }
      body.innerHTML = html;
      openModal('issueModal');
    },

    async submitAnswer() {
      const i = this._current; if (!i) return;
      const sel = document.querySelector('input[name="imAns"]:checked');
      if (!sel) { toast && toast('Choose an answer first'); return; }
      const note = (document.getElementById('imNote') || {}).value || '';
      try {
        const r = await API.call('/rights/issues/' + i.id + '/answer', { method: 'POST', body: { answer: sel.value, note } });
        closeModal('issueModal');
        toast && toast(r.auto_release_claim ? 'Answer saved — Release Claim created automatically' : 'Answer sent to the rights team');
        await this.load();
      } catch (e) { toast && toast(e.message); }
    },

    // ---------- manual claim / release claim ----------
    openRequest(kind) {
      this._reqKind = kind;
      document.getElementById('rqTitle').textContent = kind === 'manual_claim' ? 'Manual Claim' : 'Release Claim';
      document.getElementById('rqActions').style.display = kind === 'manual_claim' ? '' : 'none';
      ['rqUrl', 'rqIsrc', 'rqUpc', 'rqNote'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      const m = document.getElementById('rqMatch'); if (m) m.innerHTML = '';
      openModal('requestModal');
    },

    async lookup() {
      const val = id => ((document.getElementById(id) || {}).value || '').trim();
      const upc = val('rqUpc'), isrc = val('rqIsrc');
      const m = document.getElementById('rqMatch'); if (!m) return;
      if (!upc && !isrc) { m.innerHTML = ''; return; }
      try {
        const r = await API.call('/claims/lookup?upc=' + encodeURIComponent(upc) + '&isrc=' + encodeURIComponent(isrc));
        m.innerHTML = `<div class="card card-pad" style="display:flex;gap:10px;align-items:center;border-color:var(--accent)">${art(initials(r.asset_title))}<div><div class="cell-main">${esc(r.asset_title)}</div><div class="cell-sub">${esc(r.artist || '')} · matched from your catalog ✓</div></div></div>`;
      } catch (e) {
        m.innerHTML = `<div class="cell-sub" style="color:var(--red)">This UPC/ISRC was not found in your catalog. Check the code and try again.</div>`;
      }
    },

    async submitRequest() {
      const kind = this._reqKind;
      const val = id => ((document.getElementById(id) || {}).value || '').trim();
      const video_url = val('rqUrl'), upc = val('rqUpc'), isrc = val('rqIsrc');
      if (!video_url) { toast && toast('Video URL is required'); return; }
      if (!upc && !isrc) { toast && toast('Enter the UPC or ISRC of your track'); return; }
      const body = {
        kind, platform: val('rqPlat') || 'youtube',
        action: kind === 'manual_claim' ? (document.querySelector('input[name="rqAct"]:checked') || {}).value : null,
        video_url, upc, isrc, note: val('rqNote')
      };
      try {
        const r = await API.call('/claims', { method: 'POST', body });
        closeModal('requestModal');
        toast && toast('Request sent — ' + (r.asset_title || 'track matched'));
        await this.loadRequests();
      } catch (e) { toast && toast(e.message); }
    },

    async loadRequests() {
      const tbody = document.getElementById('rReqBody'); if (!tbody) return;
      let claims = [];
      try { claims = (await API.call('/claims')).claims || []; } catch (e) { }
      CACHE.claims = claims;
      if (!claims.length) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty"><h4>No requests yet</h4><div class="cell-sub">Manual claims and release claims you submit will appear here.</div></div></td></tr>`; return; }
      const stChip = s => ({ pending: ['Pending', 'amber'], in_progress: ['In Progress', 'blue'], done: ['Done', 'green'], rejected: ['Rejected', 'red'] }[s] || [s, 'gray']);
      tbody.innerHTML = claims.map(c => {
        const [l, col] = stChip(c.status);
        const auto = c.source_issue_id ? `<div class="cell-sub" style="color:var(--accent)">Auto — from dispute</div>` : '';
        return `<tr>
          <td><div class="cell-main">${c.kind === 'manual_claim' ? 'Manual Claim' : 'Release Claim'}</div>${auto}</td>
          <td><div class="row-flex">${storeIcon(c.platform)}<span>${PLAT_LABELS[c.platform] || esc(c.platform)}</span></div></td>
          <td>${c.action ? `<span class="chip gray">${ACT_LABELS[c.action] || esc(c.action)}</span>` : '—'}</td>
          <td><div class="cell-main">${esc(c.asset_title || '—')}</div><div class="cell-sub">${esc(c.artist || '')}</div></td>
          <td>${c.video_url ? `<a class="cell-sub" style="color:var(--accent)" href="${esc(c.video_url)}" target="_blank" rel="noopener">Link</a>` : '—'}</td>
          <td><span class="chip ${col}">${l}</span></td>
          <td class="cell-mono">${esc((c.created_at || '').slice(0, 10))}</td></tr>`;
      }).join('');
    },

    async loadAnalytics() {
      let a;
      try { a = await API.call('/rights/analytics'); } catch (e) { return; }
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('anConf', a.conflicts ?? 0); set('anDisp', a.disputes ?? 0);
      set('anRel', a.release_claims ?? 0); set('anYes', a.dispute_yes ?? 0);
    }
  };
  window.SoutRights = SoutRights;

  // ============================================================
  // Overview (latest delivered + stats)
  // ============================================================
  async function loadOverview() {
    let ov; try { ov = await API.call('/overview'); } catch { return; }
    const delivered = ov.latest_delivered || [];
    const page = document.querySelector('.page[data-page="overview"]');
    if (!page) return;
    const tables = page.querySelectorAll('.table-wrap tbody');
    if (tables[0]) {
      tables[0].innerHTML = delivered.length ? delivered.map(r => {
        const when = r.delivered_at ? esc(r.delivered_at.slice(0, 10)) : '';
        return `<tr><td><div class="row-flex">${thumb(r.title)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div></div></div></td>
          <td class="cell-mono">${esc(r.label)}</td><td>${chip(r.status)}</td><td class="cell-mono">${when}</td><td class="cell-mono">${esc(r.stores || '')} </td></tr>`;
      }).join('') : `<tr><td colspan="5"><div class="empty"><h4>No delivered releases yet</h4></div></td></tr>`;
    }
  }

  // ============================================================
  // Actions
  // ============================================================
  const CATALOG_EDITABLE = ['draft', 'rejected', 'correction'];
  const SoutClient = {
    async editRelease(id) { window.__editId = id; if (window.go) go('newrelease'); toast && toast('Loading release...'); await fillBuilder(id); },

    // ---------- collect the builder + save (create or edit) ----------
    async saveRelease(status) {
      const v = id => ((document.getElementById(id) || {}).value || '').trim();
      const title = v('nrTitle');
      if (!title) { toast && toast('Release title is required'); return; }
      let upc = v('nrUpc'); if (/^generated/i.test(upc)) upc = '';
      // tracks from the builder
      const tracks = [];
      document.querySelectorAll('#assetList .asset').forEach(asset => {
        const f = sel => { const el = asset.querySelector(`[data-f="${sel}"]`); return el ? el.value.trim() : ''; };
        const t = {
          title: f('t_title'), c_line: f('c_line'), p_line: f('p_line'),
          isrc: /^auto/i.test(f('isrc')) ? '' : f('isrc'),
          version: f('version') || 'Original', lyrics_lang: f('lyrics_lang'),
          content_type: f('content_type') || 'Not Explicit', production_year: f('prod_year'),
          contributors: []
        };
        asset.querySelectorAll('.contrib-row').forEach(row => {
          const role = (row.querySelector('.chip') || {}).textContent || 'Main Artist';
          const name = (row.querySelector('input') || {}).value || '';
          if (name.trim()) t.contributors.push({ role: role.trim(), name: name.trim(), is_composer: /composer/i.test(role) ? 1 : 0, is_author: /author/i.test(role) ? 1 : 0 });
        });
        if (t.title) tracks.push(t);
      });
      if (!tracks.length) { toast && toast('Add at least one track with a title'); return; }
      const firstArtist = (tracks[0].contributors.find(x => /main/i.test(x.role)) || tracks[0].contributors[0] || {}).name || '';
      const body = {
        title, artist: firstArtist, label: v('nrLabel'), upc,
        type: v('nrType') || 'Single', genre: v('nrGenre'), status,
        digital_date: v('nrDigital'), original_date: v('nrOriginal'),
        territories: v('nrTerr') || 'Worldwide', stores: v('nrStores') || 'All', tracks
      };
      const btnSave = document.getElementById('nrSaveBtn'), btnSubmit = document.getElementById('nrSubmitBtn');
      const btn = status === 'draft' ? btnSave : btnSubmit;
      const btnHTML = btn ? btn.innerHTML : '';
      const setBtn = t => { if (btn) btn.textContent = t; };
      if (btnSave) btnSave.disabled = true; if (btnSubmit) btnSubmit.disabled = true;
      const uploadErrors = [];
      try {
        setBtn('Saving release…');
        let relId = window.__editId, createdTracks = [];
        if (relId) {
          await API.call('/releases/' + relId, { method: 'PUT', body });
          if (status === 'submitted') await API.call('/releases/' + relId + '/submit', { method: 'POST' });
          createdTracks = ((await API.call('/releases/' + relId)).tracks) || [];
        } else {
          const r = await API.call('/releases', { method: 'POST', body });
          relId = r.id; createdTracks = r.tracks || [];
        }
        toast && toast('Release data saved ✓ (#' + relId + ')');
        // artwork (validated server-side: JPG + 3000x3000)
        const artInput = document.getElementById('nrArtFile');
        if (artInput && artInput.files[0]) {
          try {
            await uploadFile('/releases/' + relId + '/artwork', 'artwork', artInput.files[0], p => setBtn('Uploading artwork… ' + p + '%'));
            toast && toast('Artwork uploaded ✓');
          } catch (e) { uploadErrors.push('Artwork: ' + e.message); }
        }
        // per-track WAV files (matched by position)
        const audioInputs = document.querySelectorAll('#assetList .asset .audioFile');
        for (let i = 0; i < audioInputs.length; i++) {
          const file = audioInputs[i].files[0];
          const trackRow = createdTracks[i];
          if (file && trackRow) {
            try {
              await uploadFile('/tracks/' + trackRow.id + '/audio', 'audio', file, p => setBtn('Uploading track ' + (i + 1) + ' audio… ' + p + '%'));
              toast && toast('Track ' + (i + 1) + ' audio uploaded ✓');
            } catch (e) { uploadErrors.push('Track ' + (i + 1) + ' audio: ' + e.message); }
          }
        }
        window.__editId = null;
        await loadReleases();
        if (uploadErrors.length) {
          alert('The release was saved, but some files were NOT accepted:\n\n' + uploadErrors.join('\n') + '\n\nOpen the release from Manage Music to re-upload them.');
        } else {
          toast && toast(status === 'draft' ? 'Saved as draft ✓' : 'Release submitted for review ✓');
        }
        if (window.go) go('releases');
      } catch (e) { toast && toast(e.message); }
      if (btn) btn.innerHTML = btnHTML;
      if (btnSave) btnSave.disabled = false; if (btnSubmit) btnSubmit.disabled = false;
    },

    // ---------- release details modal (all info + tracks + artwork zoom) ----------
    async viewRelease(id) {
      let d; try { d = await API.call('/releases/' + id); } catch (e) { toast && toast(e.message); return; }
      const r = d.release, tracks = d.tracks || [];
      const editable = CATALOG_EDITABLE.includes(r.status);
      document.getElementById('rmTitle').textContent = r.title;
      const artSrc = r.artwork ? '/uploads/' + esc(r.artwork) : '';
      const info = (l, val) => `<div><div class="cell-sub">${l}</div><div class="cell-main">${esc(val || '—')}</div></div>`;
      const trackRows = tracks.map(t => {
        const contribs = (t.contributors || []).map(x => `${esc(x.name)} <span class="cell-sub">(${esc(x.role)})</span>`).join(', ');
        const audio = t.audio_file
          ? `<span class="chip green">Audio ✓</span>`
          : `<span class="chip amber">No audio</span>`;
        const up = editable ? ` <label class="btn btn-ghost btn-sm" style="cursor:pointer">Upload WAV<input type="file" accept=".wav" style="display:none" onchange="SoutClient.uploadTrackAudio(${t.id},this,${r.id})"></label>` : '';
        return `<tr>
          <td class="cell-mono">${t.track_no}</td>
          <td><div class="cell-main">${esc(t.title)}</div><div class="cell-sub">${contribs || ''}</div></td>
          <td class="cell-mono">${esc(t.isrc || '—')}</td>
          <td><span class="chip gray">${esc(t.version || 'Original')}</span></td>
          <td>${audio}${up}</td></tr>`;
      }).join('');
      const artBlock = artSrc
        ? `<img src="${artSrc}" onclick="SoutClient.zoom('${artSrc}')" style="width:150px;height:150px;border-radius:14px;object-fit:cover;border:1px solid var(--line);cursor:zoom-in" title="Click to enlarge">`
        : `<div class="art" style="width:150px;height:150px;font-size:2rem;border-radius:14px">${esc(initials(r.title))}</div>`;
      const artUp = editable ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer;margin-top:8px;display:inline-flex">${artSrc ? 'Replace artwork' : 'Upload artwork'}<input type="file" accept=".jpg,.jpeg" style="display:none" onchange="SoutClient.uploadArt(${r.id},this)"></label><div class="cell-sub" style="margin-top:4px">JPG · 3000×3000</div>` : '';
      const note = (r.note && ['rejected', 'correction'].includes(r.status)) ? `<div class="card card-pad" style="border-color:var(--red);color:var(--red);margin-top:12px;font-size:.85rem">${esc(r.note)}</div>` : '';
      document.getElementById('rmBody').innerHTML = `
        <div style="display:flex;gap:18px;align-items:flex-start;margin-bottom:16px">
          <div style="text-align:center">${artBlock}${artUp}</div>
          <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${info('Artist', r.artist)}
            ${info('Label', r.label)}
            ${info('Type', r.type)}
            ${info('Genre', r.genre)}
            ${info('UPC', r.upc || 'Generated automatically')}
            ${info('Digital release date', r.digital_date)}
            ${info('Territories', r.territories)}
            ${info('Stores', r.stores)}
          </div>
        </div>
        <div class="row-flex" style="gap:8px;margin-bottom:12px">${chip(r.status)}<span class="cell-sub">Created ${esc((r.created_at || '').slice(0, 10))}${r.delivered_at ? ' · Delivered ' + esc(r.delivered_at.slice(0, 10)) : ''}</span></div>
        ${note}
        <div class="sec-title" style="margin:14px 0 8px">Tracks (${tracks.length})</div>
        <div class="table-wrap"><div class="table-scroll"><table>
          <thead><tr><th>#</th><th>Title</th><th>ISRC</th><th>Version</th><th>Audio</th></tr></thead>
          <tbody>${trackRows || '<tr><td colspan="5"><div class="empty"><h4>No tracks</h4></div></td></tr>'}</tbody>
        </table></div></div>`;
      // fix the empty status cell (first info slot)
      openModal('relModal');
    },
    zoom(src) { const lb = document.getElementById('lightbox'); document.getElementById('lightboxImg').src = src; lb.style.display = 'grid'; },
    async uploadArt(relId, input) {
      const f = input.files[0]; if (!f) return;
      const lbl = input.parentElement; const orig = lbl.firstChild.textContent;
      try {
        await uploadFile('/releases/' + relId + '/artwork', 'artwork', f, p => lbl.firstChild.textContent = 'Uploading ' + p + '%');
        toast && toast('Artwork uploaded ✓'); await loadReleases(); await this.viewRelease(relId);
      } catch (e) { lbl.firstChild.textContent = orig; alert('Artwork not accepted:\n' + e.message); }
    },
    async uploadTrackAudio(trackId, input, relId) {
      const f = input.files[0]; if (!f) return;
      const lbl = input.parentElement; const orig = lbl.firstChild.textContent;
      try {
        await uploadFile('/tracks/' + trackId + '/audio', 'audio', f, p => lbl.firstChild.textContent = 'Uploading ' + p + '%');
        toast && toast('Audio uploaded ✓'); await this.viewRelease(relId);
      } catch (e) { lbl.firstChild.textContent = orig; alert('Audio not accepted:\n' + e.message); }
    },
    async deleteRelease(id) {
      if (!confirm('Delete this draft?')) return;
      try { await API.call('/releases/' + id, { method: 'DELETE' }); toast && toast('Draft deleted'); await loadReleases(); }
      catch (e) { toast && toast(e.message); }
    },
  };
  window.SoutClient = SoutClient;

  async function fillBuilder(id) {
    try {
      const d = await API.call('/releases/' + id);
      const r = d.release;
      const set = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val || ''; };
      set('nrTitle', r.title); set('nrLabel', r.label); set('nrUpc', r.upc); set('nrType', r.type);
      set('nrGenre', r.genre); set('nrDigital', r.digital_date); set('nrOriginal', r.original_date);
      // existing artwork preview
      const img = document.getElementById('nrArtPreview');
      if (img && r.artwork) { img.src = '/uploads/' + r.artwork; img.style.display = ''; }
      // first track into the builder (full track editing lives in the release details modal)
      const t = (d.tracks || [])[0];
      if (t) {
        const asset = document.querySelector('#assetList .asset');
        if (asset) {
          const sf = (sel, val) => { const el = asset.querySelector(`[data-f="${sel}"]`); if (el) el.value = val || ''; };
          sf('t_title', t.title); sf('c_line', t.c_line); sf('p_line', t.p_line); sf('isrc', t.isrc);
          sf('version', t.version); sf('content_type', t.content_type); sf('prod_year', t.production_year);
          const nameEl = document.getElementById('assetName1'); if (nameEl) nameEl.textContent = t.title || 'Untitled track';
          const c0 = (t.contributors || [])[0];
          if (c0) { const inp = asset.querySelector('.contrib-row input'); if (inp) inp.value = c0.name; }
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ============================================================
  // Router hook
  // ============================================================
  window.SoutPage = {
    onReady() {
      loadReleases().catch(() => { });
      loadOverview().catch(() => { });
      SoutRights.load().catch(() => { });
      if (window.go && !window.__goWrapped) {
        const _go = window.go;
        window.go = function (p) {
          _go(p);
          if (p === 'releases') loadReleases();
          else if (p === 'overview') loadOverview();
          else if (p === 'rights') SoutRights.load();
        };
        window.__goWrapped = true;
      }
    }
  };
})();
