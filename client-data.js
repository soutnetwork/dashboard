// ============================================================
// Client dashboard — real-data loaders
// Manage Music (unified tabs) + Rights Manager (Believe-style)
// ============================================================
(function () {
  const { chip, esc, initials } = window.SoutUI;
  const API = window.SoutAPI;
  let CACHE = { releases: [], issues: [], claims: [], rightsApiMissing: false };

  function art(label) { return `<div class="art">${esc(label)}</div>`; }
  function thumb(title) { return art(initials(title)); }

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
        <td><div class="row-flex">${thumb(r.title)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div>${note}</div></div></td>
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
  const SoutClient = {
    async editRelease(id) { window.__editId = id; if (window.go) go('newrelease'); toast && toast('Loading release...'); await fillBuilder(id); },
    async deleteRelease(id) {
      if (!confirm('Delete this draft?')) return;
      try { await API.call('/releases/' + id, { method: 'DELETE' }); toast && toast('Draft deleted'); await loadReleases(); }
      catch (e) { toast && toast(e.message); }
    },
    async submitNew(payload) {
      try { const r = await API.call('/releases', { method: 'POST', body: payload }); toast && toast('Release submitted'); await loadReleases(); return r; }
      catch (e) { toast && toast(e.message); }
    }
  };
  window.SoutClient = SoutClient;

  async function fillBuilder(id) {
    try {
      const d = await API.call('/releases/' + id);
      const r = d.release; const page = document.querySelector('.page[data-page="newrelease"]');
      if (!page) return;
      const set = (label, val) => {
        const fields = page.querySelectorAll('.field');
        fields.forEach(f => { const l = f.querySelector('label'); if (l && l.textContent.trim().toLowerCase().startsWith(label.toLowerCase())) { const inp = f.querySelector('input,select'); if (inp) inp.value = val || ''; } });
      };
      set('Release title', r.title); set('Label', r.label); set('UPC', r.upc); set('Genre', r.genre);
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
