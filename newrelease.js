/* ============================================================
   Sout Network — New Release (Believe-style flow)
   Steps 1–11. Self-contained; augments window.SoutClient.
   ============================================================ */
(function () {
  'use strict';
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }

  ready(function () {
    var API = window.SoutAPI || window.API;
    var toast = function (m) { (window.toast || function(){})(m); };
    var esc = (window.SoutUI && window.SoutUI.esc) || function (s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); };
    if (!API) { console.error('NewRelease: API missing'); return; }
    var SC = window.SoutClient = window.SoutClient || {};

    // ---------- state ----------
    var NR = {
      tracks: [],           // { id, title, filename, staged, audio_file, uploading, pct, ... , contributors:[], instruments:[] }
      artStaged: null,
      hasArtwork: false,
      editId: null,
      seq: 0,
      dates: { digital: '', original: '', preorder: '', exclusive: '' },
      platforms: [],
      terrMode: 'worldwide',
      terrList: []
    };
    window.__NR = NR;

    var PLATFORMS = [
      { id: 'spotify', name: 'Spotify', tier: 'major' }, { id: 'apple', name: 'Apple Music', tier: 'major' },
      { id: 'youtube', name: 'YouTube Music', tier: 'major' }, { id: 'youtube_video', name: 'YouTube Content ID', tier: 'major' },
      { id: 'amazon', name: 'Amazon Music', tier: 'major' }, { id: 'tiktok', name: 'TikTok', tier: 'major' },
      { id: 'facebook', name: 'Meta (FB/Instagram)', tier: 'major' }, { id: 'deezer', name: 'Deezer', tier: 'major' },
      { id: 'anghami', name: 'Anghami', tier: 'mena' }, { id: 'boomplay', name: 'Boomplay', tier: 'mena' },
      { id: 'audiomack', name: 'Audiomack', tier: 'mena' }, { id: 'tidal', name: 'Tidal', tier: 'other' },
      { id: 'soundcloud', name: 'SoundCloud', tier: 'other' }, { id: 'pandora', name: 'Pandora', tier: 'other' },
      { id: 'napster', name: 'Napster', tier: 'other' }, { id: 'iheart', name: 'iHeartRadio', tier: 'other' },
      { id: 'shazam', name: 'Shazam', tier: 'other' }, { id: 'kkbox', name: 'KKBox', tier: 'other' },
      { id: 'joox', name: 'JOOX', tier: 'other' }, { id: 'qobuz', name: 'Qobuz', tier: 'other' }
    ];
    window.PLATFORMS = PLATFORMS;
    var ROLES = ['Main Artist', 'Featured Artist', 'Composer', 'Author', 'Producer', 'Sound Engineer', 'Lyricist', 'Arranger'];
    var COUNTRIES = ['Egypt', 'Saudi Arabia', 'UAE', 'Kuwait', 'Qatar', 'Bahrain', 'Oman', 'Jordan', 'Lebanon', 'Iraq', 'Morocco', 'Algeria', 'Tunisia', 'Libya', 'Sudan', 'Palestine', 'Syria', 'Yemen', 'United States', 'United Kingdom', 'France', 'Germany', 'Canada', 'Turkey', 'Spain', 'Italy', 'Netherlands', 'Sweden', 'Australia', 'Brazil', 'India', 'Indonesia', 'Malaysia', 'Nigeria', 'South Africa'];

    // ---------- upload helper (independent) ----------
    function upload(path, field, file, onp) {
      return new Promise(function (resolve, reject) {
        var fd = new FormData(); fd.append(field, file);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api' + path);
        xhr.withCredentials = true;
        xhr.upload.onprogress = function (e) { if (e.lengthComputable && onp) onp(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = function () {
          var j = {}; try { j = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(j);
          else reject(new Error(j.error || ('Upload failed (' + xhr.status + ')')));
        };
        xhr.onerror = function () { reject(new Error('Network error')); };
        xhr.send(fd);
      });
    }
    var STAGING = [];

    // ============================================================
    // STEP 1: upload-first
    // ============================================================
    window.artPicked = function (input) { handleArt(input.files[0]); };
    window.nrDropArt = function (e) { e.preventDefault(); var d = e.currentTarget; d.classList.remove('drag'); if (e.dataTransfer.files[0]) handleArt(e.dataTransfer.files[0]); };
    function handleArt(f) {
      if (!f) return;
      var nameEl = document.getElementById('nrArtName'), bar = document.getElementById('nrArtBar'), img = document.getElementById('nrArtPreview'), hdr = document.getElementById('nrHdrArt');
      if (!/\.jpe?g$/i.test(f.name)) { toast('Artwork must be JPG'); return; }
      var url = URL.createObjectURL(f);
      if (img) { img.src = url; img.style.display = ''; }
      if (hdr) hdr.src = url;
      if (bar) { bar.style.display = ''; bar.style.width = '0%'; }
      NR.artStaged = null;
      var p = upload('/stage/artwork', 'artwork', f, function (pct) { if (bar) bar.style.width = pct + '%'; if (nameEl) nameEl.textContent = pct + '%'; })
        .then(function (r) { NR.artStaged = r.file; NR.hasArtwork = true; if (nameEl) nameEl.textContent = 'Uploaded ✓'; if (bar) bar.style.width = '100%'; })
        .catch(function (err) { if (img) img.style.display = 'none'; if (bar) bar.style.display = 'none'; if (nameEl) nameEl.textContent = 'JPG · 3000×3000'; alert('Artwork not accepted:\n' + err.message); });
      STAGING.push(p);
    }

    window.nrAudioPicked = function (input) { handleAudioList(input.files); input.value = ''; };
    window.nrDropAudio = function (e) { e.preventDefault(); var d = e.currentTarget; d.classList.remove('drag'); handleAudioList(e.dataTransfer.files); };
    function handleAudioList(files) {
      Array.prototype.forEach.call(files, function (f) {
        if (!/\.wav$/i.test(f.name)) { toast(f.name + ' skipped — WAV only'); return; }
        var baseName = f.name.replace(/\.wav$/i, '');
        var t = { key: 'k' + (++NR.seq), title: baseName, filename: f.name, staged: null, audio_file: null, pct: 0, uploading: true,
          c_line: '', p_line: '', version: 'Original', isrc: '', prod_year: '2026', price: 'Front (Default)',
          lyrics_lang: 'Arabic', content_type: 'Not Explicit', start: '', contributors: [], instruments: [] };
        NR.tracks.push(t);
        renderAssets();
        var p = upload('/stage/audio', 'audio', f, function (pct) { t.pct = pct; updateTrackBar(t.key, pct); })
          .then(function (r) { t.staged = r.file; t.uploading = false; t.pct = 100; renderAssets(); })
          .catch(function (err) { t.uploading = false; t.error = err.message; renderAssets(); alert(f.name + ' not accepted:\n' + err.message); });
        STAGING.push(p);
      });
    }
    function updateTrackBar(key, pct) {
      var el = document.querySelector('.nr-track[data-k="' + key + '"] .up-mini > i');
      if (el) el.style.width = pct + '%';
    }

    SC.addEmptyTrack = function () {
      NR.tracks.push({ key: 'k' + (++NR.seq), title: '', filename: '', staged: null, audio_file: null, pct: 0, uploading: false,
        c_line: '', p_line: '', version: 'Original', isrc: '', prod_year: '2026', price: 'Front (Default)',
        lyrics_lang: 'Arabic', content_type: 'Not Explicit', start: '', contributors: [], instruments: [] });
      renderAssets();
    };

    // ============================================================
    // STEP 3: assets list
    // ============================================================
    function renderAssets() {
      var list = document.getElementById('assetList'), empty = document.getElementById('assetEmpty'), count = document.getElementById('trackCount');
      if (count) count.textContent = NR.tracks.length;
      if (empty) empty.style.display = NR.tracks.length ? 'none' : '';
      if (!list) return;
      list.innerHTML = NR.tracks.map(function (t, i) {
        var status = t.uploading ? '<div class="up-mini"><i style="width:' + t.pct + '%"></i></div>'
          : t.error ? '<span class="chip red">Failed</span>'
          : (t.staged || t.audio_file) ? '<span class="chip green">Audio ✓</span>'
          : '<span class="chip amber">No audio</span>';
        var mains = t.contributors.filter(function (c) { return (c.roles || []).indexOf('Main Artist') >= 0; }).map(function (c) { return esc(c.name); }).join(', ');
        return '<div class="nr-track" data-k="' + t.key + '" onclick="SoutClient.openTrack(\'' + t.key + '\')">' +
          '<span class="tno">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<div style="flex:1;min-width:0"><div class="cell-main" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (esc(t.title) || '<span class="cell-sub">Untitled track</span>') + '</div>' +
          '<div class="cell-sub">' + (mains ? esc(mains) : (t.filename ? esc(t.filename) : 'Tap to add details')) + '</div></div>' +
          status +
          '<button class="icon-btn btn-sm" onclick="event.stopPropagation();SoutClient.removeTrack(\'' + t.key + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="var(--fg-faint)" stroke-width="2" style="width:16px;height:16px"><path d="M9 18l6-6-6-6"/></svg>' +
          '</div>';
      }).join('');
    }
    SC.removeTrack = function (key) { NR.tracks = NR.tracks.filter(function (t) { return t.key !== key; }); renderAssets(); };

    // ============================================================
    // STEP 4: track details modal
    // ============================================================
    var editingKey = null;
    SC.openTrack = function (key) {
      var t = NR.tracks.find(function (x) { return x.key === key; }); if (!t) return;
      editingKey = key;
      var g = function (id) { return document.getElementById(id); };
      g('tmTitle').textContent = t.title || 'Track details';
      g('tmTrackTitle').value = t.title || ''; g('tmCLine').value = t.c_line || ''; g('tmPLine').value = t.p_line || '';
      g('tmVersion').value = t.version || 'Original'; g('tmIsrc').value = t.isrc || ''; g('tmProdYear').value = t.prod_year || '2026';
      g('tmPrice').value = t.price || 'Front (Default)'; g('tmLyricsLang').value = t.lyrics_lang || 'Arabic';
      g('tmContent').value = t.content_type || 'Not Explicit'; g('tmStart').value = t.start || '';
      renderContribs(); renderInstrTags();
      openModal('trackModal');
    };
    SC.closeTrack = function () { closeModal('trackModal'); editingKey = null; };
    SC.saveTrack = function () {
      var t = NR.tracks.find(function (x) { return x.key === editingKey; }); if (!t) return;
      var g = function (id) { return (document.getElementById(id) || {}).value || ''; };
      t.title = g('tmTrackTitle').trim(); t.c_line = g('tmCLine').trim(); t.p_line = g('tmPLine').trim();
      t.version = g('tmVersion'); t.isrc = g('tmIsrc').trim(); t.prod_year = g('tmProdYear').trim();
      t.price = g('tmPrice'); t.lyrics_lang = g('tmLyricsLang'); t.content_type = g('tmContent'); t.start = g('tmStart').trim();
      closeModal('trackModal'); renderAssets(); toast('Track saved');
    };

    // instruments
    SC.addInstrument = function (val) {
      val = (val || '').trim(); if (!val) return;
      var t = NR.tracks.find(function (x) { return x.key === editingKey; }); if (!t) return;
      if (t.instruments.indexOf(val) < 0) t.instruments.push(val);
      renderInstrTags();
    };
    function renderInstrTags() {
      var t = NR.tracks.find(function (x) { return x.key === editingKey; }); if (!t) return;
      var box = document.getElementById('tmInstrTags'); if (!box) return;
      box.innerHTML = t.instruments.map(function (ins, i) {
        return '<span class="chip gray" style="gap:6px">' + esc(ins) + ' <span style="cursor:pointer;font-weight:800" onclick="SoutClient.removeInstrument(' + i + ')">×</span></span>';
      }).join('');
    }
    SC.removeInstrument = function (i) {
      var t = NR.tracks.find(function (x) { return x.key === editingKey; }); if (!t) return;
      t.instruments.splice(i, 1); renderInstrTags();
    };

    // ============================================================
    // STEP 5+6+7: contributors
    // ============================================================
    function renderContribs() {
      var t = NR.tracks.find(function (x) { return x.key === editingKey; }); if (!t) return;
      var box = document.getElementById('tmContribs'); if (!box) return;
      if (!t.contributors.length) { box.innerHTML = '<div class="cell-sub" style="padding:6px 0">No contributors yet — add the main artist.</div>'; return; }
      box.innerHTML = t.contributors.map(function (c, i) {
        var linked = '';
        if (c.spotify_url) linked += '<span class="art-badge" style="background:#e9f7ef;color:#16a34a">Spotify ✓</span> ';
        if (c.apple_url) linked += '<span class="art-badge" style="background:#fdecec;color:#dc2626">Apple ✓</span> ';
        if (!c.spotify_url && !c.apple_url) linked = '<span class="art-badge" style="background:var(--surface-3);color:var(--fg-soft)">New profile</span>';
        return '<div class="row-flex" style="justify-content:space-between;padding:8px 10px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px">' +
          '<div><div class="cell-main">' + esc(c.name) + '</div><div class="cell-sub">' + esc((c.roles || []).join(' · ')) + '</div></div>' +
          '<div class="row-flex" style="gap:8px">' + linked +
          '<button class="btn btn-ghost btn-sm" onclick="SoutClient.editContributor(' + i + ')">Edit</button>' +
          '<button class="icon-btn btn-sm" onclick="SoutClient.removeContributor(' + i + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div></div>';
      }).join('');
    }
    var editingContrib = -1;
    SC.addContributor = function () { editingContrib = -1; openContrib({ name: '', roles: ['Main Artist'] }); };
    SC.editContributor = function (i) {
      var t = NR.tracks.find(function (x) { return x.key === editingKey; });
      editingContrib = i; openContrib(t.contributors[i]);
    };
    SC.removeContributor = function (i) {
      var t = NR.tracks.find(function (x) { return x.key === editingKey; });
      t.contributors.splice(i, 1); renderContribs();
    };
    function openContrib(c) {
      NR._draftContrib = { name: c.name || '', roles: (c.roles || []).slice(), spotify_url: c.spotify_url || '', spotify_id: c.spotify_id || '', apple_url: c.apple_url || '', apple_id: c.apple_id || '', image: c.image || '' };
      document.getElementById('coName').value = c.name || '';
      document.getElementById('coResults').style.display = 'none';
      renderRolePills(); renderLinked();
      openModal('contribModal');
    }
    function renderRolePills() {
      var box = document.getElementById('coRoles');
      box.innerHTML = ROLES.map(function (r) {
        var on = NR._draftContrib.roles.indexOf(r) >= 0;
        return '<span class="role-pill' + (on ? ' on' : '') + '" onclick="SoutClient.toggleRole(\'' + r + '\')">' + r + '</span>';
      }).join('');
    }
    SC.toggleRole = function (r) {
      var arr = NR._draftContrib.roles, i = arr.indexOf(r);
      if (i >= 0) arr.splice(i, 1); else arr.push(r);
      renderRolePills();
    };
    function renderLinked() {
      var box = document.getElementById('coLinked'); var d = NR._draftContrib;
      if (d.spotify_url || d.apple_url) {
        box.style.display = '';
        box.innerHTML = '<div class="card card-pad" style="padding:10px">' +
          (d.image ? '<img src="' + esc(d.image) + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;float:left;margin-right:10px">' : '') +
          '<div class="cell-main">' + esc(d.name) + '</div>' +
          '<div class="cell-sub">' + (d.spotify_url ? 'Spotify linked ✓ ' : '') + (d.apple_url ? 'Apple linked ✓' : '') + '</div></div>';
      } else { box.style.display = 'none'; box.innerHTML = ''; }
    }
    SC.saveContributor = function () {
      var name = (document.getElementById('coName').value || '').trim();
      if (!name) { toast('Enter a name'); return; }
      if (!NR._draftContrib.roles.length) { toast('Pick at least one role'); return; }
      NR._draftContrib.name = name;
      var t = NR.tracks.find(function (x) { return x.key === editingKey; });
      if (editingContrib >= 0) t.contributors[editingContrib] = NR._draftContrib;
      else t.contributors.push(NR._draftContrib);
      closeModal('contribModal'); renderContribs();
    };

    // artist search (Spotify/Apple) + internal autocomplete
    var searchTimer = null;
    SC.searchArtist = function (q) {
      NR._draftContrib.name = q;
      var box = document.getElementById('coResults');
      q = (q || '').trim();
      if (q.length < 2) { box.style.display = 'none'; return; }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        Promise.all([
          API.call('/artists?q=' + encodeURIComponent(q)).catch(function () { return { artists: [] }; }),
          API.call('/artists/search?q=' + encodeURIComponent(q)).catch(function () { return { results: [] }; })
        ]).then(function (res) {
          var internal = res[0].artists || [], ext = res[1].results || [];
          var html = '';
          if (internal.length) {
            html += '<div class="cell-sub" style="padding:6px 10px;font-weight:700">Your artists</div>';
            html += internal.map(function (a) {
              return '<div class="art-result" onclick=\'SoutClient.pickArtist(' + JSON.stringify({ name: a.name, spotify_url: a.spotify_url, spotify_id: a.spotify_id, apple_url: a.apple_url, apple_id: a.apple_id, image: a.image }).replace(/'/g, "&#39;") + ')\'>' +
                '<div class="art-badge" style="background:var(--surface-3);color:var(--fg-soft)">Saved</div>' +
                '<div style="flex:1"><div class="cell-main">' + esc(a.name) + '</div><div class="cell-sub">' + (a.spotify_url ? 'Spotify ✓ ' : '') + (a.apple_url ? 'Apple ✓' : '') + '</div></div></div>';
            }).join('');
          }
          if (ext.length) {
            html += '<div class="cell-sub" style="padding:6px 10px;font-weight:700">Spotify &amp; Apple Music</div>';
            html += ext.map(function (a) {
              var badge = a.platform === 'spotify' ? '<div class="art-badge" style="background:#e9f7ef;color:#16a34a">Spotify</div>' : '<div class="art-badge" style="background:#fdecec;color:#dc2626">Apple</div>';
              var payload = a.platform === 'spotify' ? { name: a.name, spotify_url: a.url, spotify_id: a.id, image: a.image || '' } : { name: a.name, apple_url: a.url, apple_id: a.id };
              return '<div class="art-result" onclick=\'SoutClient.pickArtist(' + JSON.stringify(payload).replace(/'/g, "&#39;") + ')\'>' + badge +
                (a.image ? '<img src="' + esc(a.image) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover">' : '') +
                '<div style="flex:1"><div class="cell-main">' + esc(a.name) + '</div><div class="cell-sub">' + (a.followers ? Number(a.followers).toLocaleString() + ' followers' : (a.genre || 'Link to this profile')) + '</div></div></div>';
            }).join('');
          }
          if (!html) html = '<div class="art-result"><div class="art-badge" style="background:var(--surface-3);color:var(--fg-soft)">New</div><div class="cell-sub">No match — a new artist profile will be created for "' + esc(q) + '"</div></div>';
          box.innerHTML = html; box.style.display = '';
        });
      }, 250);
    };
    SC.pickArtist = function (a) {
      var d = NR._draftContrib;
      d.name = a.name; document.getElementById('coName').value = a.name;
      if (a.spotify_url) { d.spotify_url = a.spotify_url; d.spotify_id = a.spotify_id || ''; }
      if (a.apple_url) { d.apple_url = a.apple_url; d.apple_id = a.apple_id || ''; }
      if (a.image) d.image = a.image;
      document.getElementById('coResults').style.display = 'none';
      renderLinked();
    };

    // ============================================================
    // STEP 8: dates
    // ============================================================
    SC.openDates = function () {
      document.getElementById('dtDigital').value = NR.dates.digital;
      document.getElementById('dtOriginal').value = NR.dates.original;
      document.getElementById('dtPreorder').value = NR.dates.preorder;
      document.getElementById('dtExclusive').value = NR.dates.exclusive;
      openModal('datesModal');
    };
    SC.saveDates = function () {
      NR.dates.digital = document.getElementById('dtDigital').value;
      NR.dates.original = document.getElementById('dtOriginal').value;
      NR.dates.preorder = document.getElementById('dtPreorder').value;
      NR.dates.exclusive = document.getElementById('dtExclusive').value;
      document.getElementById('nrDigital').value = NR.dates.digital;
      document.getElementById('nrOriginal').value = NR.dates.original;
      var s = NR.dates.digital ? ('Digital: ' + NR.dates.digital) : 'Set digital date…';
      document.getElementById('nrDatesSummary').textContent = s;
      closeModal('datesModal');
    };

    // ============================================================
    // STEP 9: platforms
    // ============================================================
    SC.openPlatforms = function () { renderPlatModal(); openModal('platModal'); };
    function renderPlatModal() {
      var grid = document.getElementById('platModalGrid'); if (!grid) return;
      grid.innerHTML = PLATFORMS.map(function (p) {
        var on = NR.platforms.indexOf(p.id) >= 0;
        return '<label class="row-flex" style="gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;cursor:pointer">' +
          '<input type="checkbox" data-plat="' + p.id + '"' + (on ? ' checked' : '') + '> ' + esc(p.name) + '</label>';
      }).join('');
    }
    SC.setPlatforms = function (preset) {
      if (preset === 'all') NR.platforms = PLATFORMS.map(function (p) { return p.id; });
      else if (preset === 'major') NR.platforms = PLATFORMS.filter(function (p) { return p.tier === 'major'; }).map(function (p) { return p.id; });
      else if (preset === 'mena') NR.platforms = PLATFORMS.filter(function (p) { return p.tier === 'mena'; }).map(function (p) { return p.id; });
      else if (preset === 'clear') NR.platforms = [];
      renderPlatModal();
    };
    SC.applyPlatforms = function () {
      NR.platforms = Array.prototype.map.call(document.querySelectorAll('#platModalGrid input:checked'), function (x) { return x.dataset.plat; });
      updatePlatSummary(); closeModal('platModal');
    };
    function updatePlatSummary() {
      var n = NR.platforms.length, total = PLATFORMS.length, el = document.getElementById('nrPlatSummary');
      if (!el) return;
      if (n === 0) el.textContent = 'None selected';
      else if (n === total) el.textContent = 'All platforms (' + total + ')';
      else if (n === PLATFORMS.filter(function (p) { return p.tier === 'major'; }).length && NR.platforms.every(function (id) { return PLATFORMS.find(function (p) { return p.id === id; }).tier === 'major'; })) el.textContent = 'All major platforms';
      else el.textContent = n + ' platforms selected';
    }

    // ============================================================
    // STEP 10: territories
    // ============================================================
    SC.openTerritories = function () { openModal('terrModal'); };
    SC.terrMode = function (mode) {
      NR.terrMode = mode;
      document.getElementById('terrPickWrap').style.display = mode === 'worldwide' ? 'none' : '';
      if (mode !== 'worldwide') SC.renderCountries('');
    };
    SC.renderCountries = function (q) {
      q = (q || '').toLowerCase();
      var grid = document.getElementById('terrGrid');
      grid.innerHTML = COUNTRIES.filter(function (c) { return c.toLowerCase().indexOf(q) >= 0; }).map(function (c) {
        var on = NR.terrList.indexOf(c) >= 0;
        return '<label class="row-flex" style="gap:6px;padding:4px 8px;cursor:pointer"><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="SoutClient.toggleCountry(\'' + c.replace(/'/g, "\\'") + '\')"> ' + c + '</label>';
      }).join('');
    };
    SC.toggleCountry = function (c) {
      var i = NR.terrList.indexOf(c);
      if (i >= 0) NR.terrList.splice(i, 1); else NR.terrList.push(c);
    };
    SC.applyTerritories = function () {
      var summary = 'Worldwide', store = 'Worldwide';
      if (NR.terrMode === 'exclude' && NR.terrList.length) { summary = 'Worldwide except ' + NR.terrList.length + ' countries'; store = 'Worldwide except: ' + NR.terrList.join(', '); }
      else if (NR.terrMode === 'only' && NR.terrList.length) { summary = NR.terrList.length + ' countries only'; store = 'Only: ' + NR.terrList.join(', '); }
      document.getElementById('nrTerrSummary').textContent = summary;
      document.getElementById('nrTerr').value = store;
      closeModal('terrModal');
    };

    // ============================================================
    // SAVE / SUBMIT
    // ============================================================
    SC.saveRelease = function (status, clickedBtn) {
      var v = function (id) { return ((document.getElementById(id) || {}).value || '').trim(); };
      var missing = [];
      if (!v('nrTitle')) missing.push('Release title');
      if (status === 'submitted') {
        if (!v('nrLabel')) missing.push('Label');
        if (!v('nrGenre')) missing.push('Genre');
        if (!NR.dates.digital) missing.push('Digital release date');
        if (!NR.platforms.length) missing.push('At least one distribution platform');
        if (!NR.artStaged && !NR.hasArtwork) missing.push('Cover artwork (JPG 3000×3000)');
        if (!NR.tracks.length) missing.push('At least one track');
        NR.tracks.forEach(function (t, i) {
          var n = 'Track ' + (i + 1) + ': ';
          if (!t.title) missing.push(n + 'title');
          if (!t.c_line) missing.push(n + 'C Line');
          if (!t.p_line) missing.push(n + 'P Line');
          if (!t.contributors.some(function (c) { return (c.roles || []).indexOf('Main Artist') >= 0; })) missing.push(n + 'a Main Artist');
          if (!t.staged && !t.audio_file) missing.push(n + 'WAV audio');
        });
      } else {
        if (!NR.tracks.some(function (t) { return t.title; })) missing.push('At least one track with a title');
      }
      if (missing.length) { alert((status === 'submitted' ? 'Cannot submit — missing:' : 'Cannot save yet:') + '\n\n• ' + missing.join('\n• ')); return; }

      var firstMain = '';
      for (var i = 0; i < NR.tracks.length; i++) {
        var m = NR.tracks[i].contributors.find(function (c) { return (c.roles || []).indexOf('Main Artist') >= 0; });
        if (m) { firstMain = m.name; break; }
      }
      var body = {
        title: v('nrTitle'), artist: firstMain, label: v('nrLabel'), type: v('nrType') || 'Single', genre: v('nrGenre'),
        status: 'draft', digital_date: NR.dates.digital, original_date: NR.dates.original,
        territories: v('nrTerr') || 'Worldwide', stores: '', platforms: NR.platforms.slice(),
        tracks: NR.tracks.filter(function (t) { return t.title; }).map(function (t) {
          return {
            title: t.title, c_line: t.c_line, p_line: t.p_line, version: t.version, isrc: t.isrc,
            production_year: t.prod_year, lyrics_lang: t.lyrics_lang, content_type: t.content_type,
            audio_staged: t.staged || undefined,
            contributors: t.contributors.map(function (c) {
              return { name: c.name, roles: c.roles, role: c.roles[0], spotify_url: c.spotify_url || '', spotify_id: c.spotify_id || '', apple_url: c.apple_url || '', apple_id: c.apple_id || '', image: c.image || '', instruments: t.instruments };
            })
          };
        })
      };

      var btns = document.querySelectorAll('.nr-act');
      var btn = clickedBtn || document.getElementById(status === 'draft' ? 'nrSaveBtn' : 'nrSubmitBtn');
      var html = btn ? btn.innerHTML : '';
      var setBtn = function (x) { if (btn) btn.textContent = x; };
      btns.forEach(function (b) { b.disabled = true; });

      (function () {
        return Promise.resolve()
          .then(function () { if (STAGING.length) { setBtn('Finishing uploads…'); return Promise.allSettled(STAGING); } })
          .then(function () {
            STAGING = [];
            if (NR.artStaged) body.artwork_staged = NR.artStaged;
            setBtn('Saving…');
            if (NR.editId) return API.call('/releases/' + NR.editId, { method: 'PUT', body: body }).then(function () { return NR.editId; });
            return API.call('/releases', { method: 'POST', body: body }).then(function (r) { return r.id; });
          })
          .then(function (relId) {
            NR._relId = relId;
            if (status === 'submitted') { setBtn('Submitting…'); return API.call('/releases/' + relId + '/submit', { method: 'POST' }); }
          })
          .then(function () {
            toast(status === 'submitted' ? 'Submitted for review ✓' : 'Saved as draft ✓');
            resetNR();
            if (window.SoutClient.reloadReleases) window.SoutClient.reloadReleases();
            if (window.go) window.go('releases');
          })
          .catch(function (err) { alert('Error: ' + (err && err.message || err)); })
          .then(function () { btns.forEach(function (b) { b.disabled = false; }); if (btn) btn.innerHTML = html; });
      })();
    };

    function resetNR() {
      NR.tracks = []; NR.artStaged = null; NR.hasArtwork = false; NR.editId = null;
      NR.dates = { digital: '', original: '', preorder: '', exclusive: '' };
      NR.terrMode = 'worldwide'; NR.terrList = [];
    }

    // ---------- init on page enter ----------
    SC.initNewRelease = function (editId) {
      resetNR();
      NR.editId = editId || null;
      SC.setPlatforms('major'); updatePlatSummary();
      document.getElementById('nrTitle').value = '';
      document.getElementById('nrLabel').value = '';
      var hdr = document.getElementById('nrHdrArt'); if (hdr) hdr.removeAttribute('src');
      var pv = document.getElementById('nrArtPreview'); if (pv) pv.style.display = 'none';
      document.getElementById('nrArtName').textContent = 'JPG · 3000×3000';
      document.getElementById('nrDatesSummary').textContent = 'Set digital date…';
      document.getElementById('nrTerrSummary').textContent = 'Worldwide';
      document.getElementById('nrTerr').value = 'Worldwide';
      renderAssets();
      // load client's labels into the datalist
      API.call('/labels').then(function (d) {
        var dl = document.getElementById('labelList');
        if (dl && d.labels) dl.innerHTML = d.labels.map(function (l) { return '<option value="' + esc(l) + '">'; }).join('');
      }).catch(function () {});
    };

    console.log('New Release (Believe-style) ready');
  });
})();
