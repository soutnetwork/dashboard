// ============================================================
// Sout Network — Front-end API layer
// Loaded by dashboard.html and admin.html.
// Guards auth, fetches real data, renders into existing pages.
// ============================================================
(function () {
  const API = {
    async call(path, opts = {}) {
      const r = await fetch('/api' + path, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...opts,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      if (r.status === 401) { window.location.href = '/login.html'; throw new Error('unauthorized'); }
      const ct = r.headers.get('content-type') || '';
      const data = ct.includes('json') ? await r.json() : await r.text();
      if (!r.ok) throw new Error((data && data.error) || 'Request failed');
      return data;
    }
  };
  window.SoutAPI = API;

  // ---- status chip helper (matches existing CSS classes) ----
  const STATUS = {
    draft: ['Draft', 'gray'], submitted: ['Submitted', 'gray'], review: ['Under Review', 'amber'],
    approved: ['Approved', 'blue'], delivered: ['Delivered', 'green'], live: ['Live', 'green'],
    rejected: ['Rejected', 'red'], correction: ['Correction Requested', 'amber'], scheduled: ['Scheduled', 'gray']
  };
  function chip(st) { const [l, c] = STATUS[st] || [st, 'gray']; return `<span class="chip ${c}">${l}</span>`; }
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
  function initials(s) { return (s || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
  window.SoutUI = { chip, esc, initials };

  // ---- boot: verify session, set user name in topbar ----
  async function boot() {
    let me;
    try { me = await API.call('/me'); } catch { return; }
    const u = me.user;
    // ---- role guards ----
    const onAdminPage = window.location.pathname.indexOf('admin.html') !== -1;
    if (onAdminPage && u.role !== 'admin') { window.location.href = '/dashboard.html'; return; }
    const adminLink = document.getElementById('adminLink');
    if (adminLink && u.role === 'admin') adminLink.style.display = '';
    // set user name/role in topbar if elements exist
    document.querySelectorAll('.tb-user .un').forEach(el => el.textContent = u.name || 'User');
    window.__me = me;
    document.querySelectorAll('.tb-user .uc').forEach(el => el.textContent = u.role === 'admin' ? 'Administrator' : ('#' + (u.client_id || '—')));
    const umh = document.getElementById('umHead');
    if (umh) umh.innerHTML = '<div style="font-weight:700;color:var(--fg)">' + (u.name || '') + '</div><div>' + (u.email || '') + '</div><div style="margin-top:2px">Account ID: #' + (u.client_id || '—') + '</div>';
    document.addEventListener('click', () => { const m = document.getElementById('userMenu'); if (m) m.style.display = 'none'; });
    // page visibility controlled per client from the admin
    if (me.client && Array.isArray(me.client.visible_pages)) {
      const always = ['overview', 'settings', 'releases', 'newrelease'];
      document.querySelectorAll('.sb-item[data-page]').forEach(el => {
        const p = el.getAttribute('data-page');
        if (!always.includes(p) && !me.client.visible_pages.includes(p)) el.style.display = 'none';
      });
    }
    document.querySelectorAll('.tb-avatar').forEach(el => el.textContent = initials(u.name));
    // settings page account fields
    const stN = document.getElementById('stName'), stE = document.getElementById('stEmail');
    if (stN) stN.value = u.name || ''; if (stE) stE.value = u.email || '';
    // wire logout if a logout button exists
    document.querySelectorAll('[data-action="logout"]').forEach(b => b.addEventListener('click', async () => {
      await API.call('/logout', { method: 'POST' }); window.location.href = '/login.html';
    }));
    // let page-specific loaders run
    if (window.SoutPage && typeof window.SoutPage.onReady === 'function') window.SoutPage.onReady(u);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
