// ============================================================
// Client dashboard — real-data loaders
// Replaces demo tables with live API data.
// ============================================================
(function () {
  const { chip, esc, initials } = window.SoutUI;
  const API = window.SoutAPI;
  let CACHE = { releases: [] };

  function art(label) { return `<div class="art">${esc(label)}</div>`; }
  function thumb(title) { return art(initials(title)); }

  // ---------- Manage Releases ----------
  async function loadReleases() {
    const d = await API.call('/releases');
    CACHE.releases = d.releases || [];
    renderReleaseTab('all');
  }
  function editable(st) { return ['draft', 'rejected', 'correction'].includes(st); }
  function renderReleaseTab(filter) {
    const rows = CACHE.releases.filter(r => {
      if (filter === 'all') return true;
      if (filter === 'review') return ['submitted', 'review'].includes(r.status);
      if (filter === 'delivered') return ['delivered', 'live'].includes(r.status);
      return r.status === filter;
    });
    const tbody = document.querySelector('#relAll') || document.querySelector('.page[data-page="releases"] tbody');
    if (!tbody) return;
    // hide the other demo tbodies
    document.querySelectorAll('#relReview,#relApproved,#relDelivered,#relRejected').forEach(b => { if (b) { b.style.display = 'none'; b.innerHTML = ''; } });
    tbody.id = 'relAll'; tbody.setAttribute('data-cat', 'all'); tbody.style.display = '';
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty"><h4>No releases in this view</h4></div></td></tr>`; return; }
    tbody.innerHTML = rows.map(r => {
      const note = (r.note && ['rejected', 'correction'].includes(r.status)) ? `<div class="cell-sub" style="color:var(--red);margin-top:2px">${esc(r.note)}</div>` : '';
      const actions = editable(r.status)
        ? `<button class="btn btn-ghost btn-sm" onclick="SoutClient.editRelease(${r.id})">Edit</button>`
        : `<span class="cell-sub">Contact support</span>`;
      return `<tr>
        <td><div class="cbx" onclick="toggleRow(this,event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div></td>
        <td><div class="row-flex">${thumb(r.title)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div>${note}</div></div></td>
        <td class="cell-mono">${esc(r.label)}</td><td>${chip(r.status)}</td><td><span class="chip gray">${esc(r.type)}</span></td>
        <td class="cell-mono">${esc(r.upc || '—')}</td><td class="cell-mono">${esc((r.created_at || '').slice(0, 10))}</td>
        <td style="text-align:right">${actions}</td></tr>`;
    }).join('');
  }
  // hook the existing catTab() so tab clicks filter live data
  window.catTab = function (el, cat) {
    el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderReleaseTab(cat);
  };

  // ---------- Drafts ----------
  async function loadDrafts() {
    const rows = (CACHE.releases.length ? CACHE.releases : (await API.call('/releases')).releases).filter(r => r.status === 'draft');
    const tbody = document.querySelector('.page[data-page="drafts"] tbody');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map(r => `<tr>
      <td><div class="cbx" onclick="toggleRow(this,event)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></div></td>
      <td><div class="row-flex">${thumb(r.title)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div></div></div></td>
      <td class="cell-mono">${esc(r.label)}</td><td><span class="chip gray">${esc(r.type)}</span></td><td class="cell-mono">${esc((r.created_at || '').slice(0, 10))}</td>
      <td style="text-align:right"><button class="btn btn-ghost btn-sm" onclick="SoutClient.editRelease(${r.id})">Edit</button> <button class="btn btn-danger btn-sm" onclick="SoutClient.deleteRelease(${r.id})">Delete</button></td></tr>`).join('')
      : `<tr><td colspan="6"><div class="empty"><h4>No drafts</h4></div></td></tr>`;
  }

  // ---------- Needs Correction ----------
  async function loadCorrections() {
    const rows = (CACHE.releases.length ? CACHE.releases : (await API.call('/releases')).releases).filter(r => r.status === 'correction');
    const tbody = document.querySelector('.page[data-page="corrections"] tbody');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map(r => `<tr>
      <td><div class="row-flex">${thumb(r.title)}<div><div class="cell-main">${esc(r.title)}</div><div class="cell-sub">${esc(r.artist)}</div></div></div></td>
      <td class="cell-mono">${esc(r.label)}</td><td><div class="cell-main" style="color:var(--red)">${esc(r.note || 'Correction requested')}</div></td>
      <td style="text-align:right"><button class="btn btn-primary btn-sm" onclick="SoutClient.editRelease(${r.id})">Fix &amp; Resubmit</button></td></tr>`).join('')
      : `<tr><td colspan="4"><div class="empty"><h4>Nothing needs correction</h4></div></td></tr>`;
    // update sidebar badge
    const badge = document.querySelector('.sb-item[data-page="corrections"] .badge');
    if (badge) { if (rows.length) { badge.textContent = rows.length; badge.style.display = ''; } else badge.style.display = 'none'; }
  }

  // ---------- Overview (latest delivered + stats) ----------
  async function loadOverview() {
    let ov; try { ov = await API.call('/overview'); } catch { return; }
    const delivered = ov.latest_delivered || [];
    // find the "Latest Releases" table on overview
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
    // service card numbers (Music Distribution stats) from ov.stats
    const s = ov.stats || {};
    const map = { PENDING: (s.submitted || 0) + (s.review || 0), DELIVERED: (s.delivered || 0) + (s.live || 0), FAILED: 0 };
  }

  // ---------- actions ----------
  const SoutClient = {
    async editRelease(id) { window.__editId = id; if (window.go) go('newrelease'); toast && toast('Loading release...'); await fillBuilder(id); },
    async deleteRelease(id) {
      if (!confirm('Delete this draft?')) return;
      try { await API.call('/releases/' + id, { method: 'DELETE' }); toast && toast('Draft deleted'); await loadReleases(); await loadDrafts(); }
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

  // ---------- page router hook ----------
  window.SoutPage = {
    onReady() {
      // initial load
      loadReleases().then(() => { loadDrafts(); loadCorrections(); }).catch(() => { });
      loadOverview().catch(() => { });
      // reload data when navigating via go()
      if (window.go && !window.__goWrapped) {
        const _go = window.go;
        window.go = function (p) {
          _go(p);
          if (p === 'releases') loadReleases();
          else if (p === 'drafts') loadDrafts();
          else if (p === 'corrections') loadCorrections();
          else if (p === 'overview') loadOverview();
        };
        window.__goWrapped = true;
      }
    }
  };
})();
