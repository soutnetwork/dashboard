/* New Release — Believe-style two-column flow */
(function () {
  'use strict';
  function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    var API = window.SoutAPI || window.API;
    var toast = function (m) { (window.toast || function () {})(m); };
    var esc = (window.SoutUI && window.SoutUI.esc) || function (s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); };
    if (!API) { console.error('NewRelease: API missing'); return; }
    var SC = window.SoutClient = window.SoutClient || {};
    var NR = { tracks: [], artStaged: null, hasArtwork: false, artUrl: '', editId: null, seq: 0, dates: { digital: '', original: '', preorder: '', exclusive: '' }, platforms: [], terrMode: 'worldwide', terrList: [], activeKey: null };
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

    function upload(path, field, file, onp) {
      return new Promise(function (resolve, reject) {
        var fd = new FormData(); fd.append(field, file);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api' + path); xhr.withCredentials = true;
        xhr.upload.onprogress = function (e) { if (e.lengthComputable && onp) onp(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = function () { var j = {}; try { j = JSON.parse(xhr.responseText); } catch (e) {} if (xhr.status >= 200 && xhr.status < 300) resolve(j); else reject(new Error(j.error || ('Upload failed (' + xhr.status + ')'))); };
        xhr.onerror = function () { reject(new Error('Network error')); };
        xhr.send(fd);
      });
    }
    var STAGING = [];
    function showWorkspace() { var st = document.getElementById('nrStepName'); if (st) st.style.display = 'none'; var w = document.getElementById('nrWelcome'); if (w) w.style.display = 'none'; var ws = document.getElementById('nrWorkspace'); if (ws) ws.style.display = ''; }

    // ---- selection queue: files wait here until the user presses Upload ----
    NR.queueArt = null; NR.queueAudio = [];
    window.artPicked = function (input) { queueArt(input.files[0]); input.value = ''; };
    function queueArt(f) {
      if (!f) return;
      if (!/\.jpe?g$/i.test(f.name)) { toast('Artwork must be JPG'); return; }
      NR.queueArt = f; renderQueue();
    }
    window.nrAudioPicked = function (input) { queueAudio(input.files); input.value = ''; };
    window.nrDropAny = function (e) {
      e.preventDefault(); var d = e.currentTarget; d.classList.remove('drag');
      var files = e.dataTransfer.files, audio = [], art = null;
      Array.prototype.forEach.call(files, function (f) { if (/\.jpe?g$/i.test(f.name)) art = f; else if (/\.wav$/i.test(f.name)) audio.push(f); });
      if (art) queueArt(art);
      if (audio.length) queueAudio(audio);
    };
    window.nrDropAudio = window.nrDropAny; window.nrDropArt = window.nrDropAny;
    function queueAudio(files) {
      Array.prototype.forEach.call(files, function (f) {
        if (!/\.wav$/i.test(f.name)) { toast(f.name + ' skipped — WAV only'); return; }
        NR.queueAudio.push(f);
      });
      renderQueue();
    }
    SC.removeQueued = function (kind, idx) {
      if (kind === 'art') NR.queueArt = null;
      else NR.queueAudio.splice(idx, 1);
      renderQueue();
    };
    function renderQueue() {
      var box = document.getElementById('nrQueue'), btn = document.getElementById('nrUploadBtn');
      var count = (NR.queueArt ? 1 : 0) + NR.queueAudio.length;
      if (!box) return;
      if (!count) { box.style.display = 'none'; if (btn) btn.style.display = 'none'; return; }
      box.style.display = ''; if (btn) { btn.style.display = ''; btn.textContent = 'Upload ' + count + ' file' + (count > 1 ? 's' : '') + ' →'; }
      var rows = '';
      if (NR.queueArt) rows += queuedRow('art', 0, NR.queueArt.name, 'Cover', '#2563eb');
      NR.queueAudio.forEach(function (f, i) { rows += queuedRow('audio', i, f.name, 'WAV', '#7c3aed'); });
      box.innerHTML = rows;
    }
    function queuedRow(kind, idx, name, tag, color) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);margin-bottom:6px">' +
        '<span class="art-badge" style="background:' + color + '22;color:' + color + '">' + tag + '</span>' +
        '<div class="cell-main" style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(name) + '</div>' +
        '<button class="icon-btn btn-sm" onclick="SoutClient.removeQueued(\'' + kind + '\',' + idx + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>';
    }
    // ---- the actual upload: only runs when the user presses Upload ----
    SC.doUpload = function () {
      var count = (NR.queueArt ? 1 : 0) + NR.queueAudio.length;
      if (!count) { toast('Select files first'); return; }
      showWorkspace();
      if (NR.queueArt) { startArtUpload(NR.queueArt); NR.queueArt = null; }
      NR.queueAudio.forEach(function (f) { startAudioUpload(f); });
      NR.queueAudio = [];
      renderQueue();
    };
    function startArtUpload(f) {
      var url = URL.createObjectURL(f); NR.artUrl = url;
      var hdr = document.getElementById('nrHdrArt'); if (hdr) hdr.src = url;
      NR.artStaged = null;
      var p = upload('/stage/artwork', 'artwork', f, null).then(function (r) { NR.artStaged = r.file; NR.hasArtwork = true; toast('Cover uploaded ✓'); }).catch(function (err) { NR.artUrl = ''; if (hdr) hdr.removeAttribute('src'); alert('Artwork not accepted:\n' + err.message); });
      STAGING.push(p);
    }
    function startAudioUpload(f) {
      var t = { key: 'k' + (++NR.seq), title: f.name.replace(/\.wav$/i, ''), filename: f.name, staged: null, audio_file: null, pct: 0, uploading: true, c_line: '', p_line: '', version: 'Original', isrc: '', prod_year: '2026', price: 'Front (Default)', lyrics_lang: 'Arabic', content_type: 'Not Explicit', start: '', contributors: [], instruments: [] };
      NR.tracks.push(t); renderTracks(); autoNameFromSingle();
      var p = upload('/stage/audio', 'audio', f, function (pct) { t.pct = pct; var el = document.querySelector('.nr-track[data-k="' + t.key + '"] .up-mini > i'); if (el) el.style.width = pct + '%'; }).then(function (r) { t.staged = r.file; t.uploading = false; t.pct = 100; renderTracks(); }).catch(function (err) { t.uploading = false; t.error = err.message; renderTracks(); alert(f.name + ' not accepted:\n' + err.message); });
      STAGING.push(p);
    }
    // add-more inside the workspace uploads immediately (already inside)
    SC.addMoreAudio = function (input) { Array.prototype.forEach.call(input.files, function (f) { if (/\.wav$/i.test(f.name)) startAudioUpload(f); }); input.value = ''; };

    function autoNameFromSingle() { var el = document.getElementById('nrTitle'); if (NR.tracks.length === 1 && el && !el.value.trim()) { el.value = NR.tracks[0].title; SC.syncHeader(); } }

    // ---- STEP A: name & type first ----
    SC.pickType = function (el, type) {
      var box = document.getElementById('nrPreType');
      if (box) Array.prototype.forEach.call(box.children, function (ch) { ch.classList.remove('active'); });
      el.classList.add('active');
      NR.preType = type;
    };
    SC.startRelease = function () {
      var t = (document.getElementById('nrPreTitle') || {}).value || '';
      t = t.trim();
      if (!t) { toast('Enter a release title first'); var el = document.getElementById('nrPreTitle'); if (el) el.focus(); return; }
      var titleEl = document.getElementById('nrTitle'); if (titleEl) titleEl.value = t;
      var typeEl = document.getElementById('nrType'); if (typeEl && NR.preType) typeEl.value = NR.preType;
      SC.syncHeader();
      var step = document.getElementById('nrStepName'); if (step) step.style.display = 'none';
      var welcome = document.getElementById('nrWelcome'); if (welcome) welcome.style.display = '';
      var ht = document.getElementById('nrHeroTitle'); if (ht) ht.textContent = 'Drop tracks for "' + t + '"';
    };
    SC.backToName = function () {
      var welcome = document.getElementById('nrWelcome'); if (welcome) welcome.style.display = 'none';
      var step = document.getElementById('nrStepName'); if (step) step.style.display = '';
    };

    SC.addEmptyTrack = function () { showWorkspace(); var t = { key: 'k' + (++NR.seq), title: '', filename: '', staged: null, audio_file: null, pct: 0, uploading: false, c_line: '', p_line: '', version: 'Original', isrc: '', prod_year: '2026', price: 'Front (Default)', lyrics_lang: 'Arabic', content_type: 'Not Explicit', start: '', contributors: [], instruments: [] }; NR.tracks.push(t); renderTracks(); openPanel(t.key); };

    function renderTracks() {
      var list = document.getElementById('assetList'), count = document.getElementById('trackCount');
      if (count) count.textContent = NR.tracks.length;
      if (!list) return;
      list.innerHTML = NR.tracks.map(function (t, i) {
        var status = t.uploading ? '<div class="up-mini"><i style="width:' + t.pct + '%"></i></div>' : t.error ? '<span class="chip red">Failed</span>' : (t.staged || t.audio_file) ? '<span class="chip green">✓</span>' : '<span class="chip amber">No audio</span>';
        return '<div class="nr-track' + (NR.activeKey === t.key ? ' active' : '') + '" data-k="' + t.key + '" onclick="SoutClient.openTrack(\'' + t.key + '\')"><span class="tno">' + String(i + 1).padStart(2, '0') + '</span><div style="flex:1;min-width:0"><div class="cell-main" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (esc(t.title) || '<span class="cell-sub">Untitled</span>') + '</div><div class="cell-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (t.filename ? esc(t.filename) + ' · WAV' : 'Manual track') + '</div></div>' + status + '<button class="icon-btn btn-sm" onclick="event.stopPropagation();SoutClient.removeTrack(\'' + t.key + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button></div>';
      }).join('');
    }
    SC.removeTrack = function (key) { NR.tracks = NR.tracks.filter(function (t) { return t.key !== key; }); if (NR.activeKey === key) { NR.activeKey = null; showPanelWelcome(); } renderTracks(); };
    SC.openTrack = function (key) { openPanel(key); };

    SC.syncHeader = function () {
      var v = function (id) { return (document.getElementById(id) || {}).value || ''; };
      var t = document.getElementById('nrHdrTitle'); if (t) t.textContent = v('nrTitle') || 'Untitled release';
      var lbl = document.getElementById('nrHdrLabel'); if (lbl) lbl.innerHTML = v('nrLabel') ? 'Label: <b>' + esc(v('nrLabel')) + '</b><br>' : '';
      var gn = document.getElementById('nrHdrGenre'); if (gn) gn.innerHTML = v('nrGenre') ? 'Genre: <b>' + esc(v('nrGenre')) + '</b><br>' : '';
      var ty = document.getElementById('nrHdrType'); if (ty) ty.innerHTML = 'Type: <b>' + esc((v('nrType') || 'Single').toUpperCase()) + '</b>';
      var artist = ''; for (var i = 0; i < NR.tracks.length; i++) { var m = NR.tracks[i].contributors.find(function (c) { return (c.roles || []).indexOf('Main Artist') >= 0; }); if (m) { artist = m.name; break; } }
      var ar = document.getElementById('nrHdrArtist'); if (ar) ar.textContent = 'Artist: ' + (artist || '—');
    };

    function showPanelWelcome() { var w = document.getElementById('nrPanelWelcome'), c = document.getElementById('nrPanelContent'); if (w) w.style.display = ''; if (c) c.style.display = 'none'; }
    function openPanel(key) { var t = NR.tracks.find(function (x) { return x.key === key; }); if (!t) return; NR.activeKey = key; renderTracks(); var w = document.getElementById('nrPanelWelcome'), box = document.getElementById('nrPanelContent'); if (w) w.style.display = 'none'; if (box) box.style.display = ''; renderTrackPanel(t); }
    function active() { return NR.tracks.find(function (x) { return x.key === NR.activeKey; }); }
    function fld(label, type, id, val, opts) { if (type === 'select') return '<div class="field"><label>' + label + '</label><select class="input" id="' + id + '">' + opts.map(function (o) { return '<option' + (o === val ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></div>'; return '<div class="field"><label>' + label + '</label><input class="input" id="' + id + '" value="' + esc(val || '') + '"></div>'; }
    function renderTrackPanel(t) {
      var box = document.getElementById('nrPanelContent'); if (!box) return;
      box.innerHTML =
        '<div class="sec-title" style="border-left-color:#7c3aed"><svg viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2" style="width:16px;height:16px"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Track information</div>' +
        '<div class="fgrid">' + fld('Track title *', 'input', 'tmTitle', t.title) + fld('Version', 'select', 'tmVersion', t.version, ['Original', 'Remix', 'Remastered', 'Acoustic', 'Live', 'Instrumental', 'Radio Edit', 'Extended']) + '<div class="field"><label>C Line *</label><input class="input" id="tmCLine" value="' + esc(t.c_line) + '"></div><div class="field"><label>P Line *</label><input class="input" id="tmPLine" value="' + esc(t.p_line) + '"></div></div>' +
        '<div class="sec-title" style="margin-top:16px;border-left-color:#16a34a"><svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" style="width:16px;height:16px"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> Contributor(s) *</div><div id="tmContribs"></div><button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="SoutClient.addContributor()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Add a contributor</button>' +
        '<div class="sec-title" style="margin-top:16px;border-left-color:#d97706">Main information</div><div class="fgrid">' + fld('Track title language', 'select', 'tmLyricsLang', t.lyrics_lang, ['Arabic', 'English', 'French', 'Instrumental']) + fld('Content type', 'select', 'tmContent', t.content_type, ['Not Explicit', 'Explicit', 'Clean']) + '</div>' +
        '<div class="sec-title" style="margin-top:16px;border-left-color:#d97706">Additional information</div><div class="fgrid"><div class="field"><label>ISRC <span class="cell-sub" style="font-weight:400">(auto)</span></label><input class="input" id="tmIsrc" placeholder="Generated on approval" value="' + esc(t.isrc) + '"></div>' + fld('Production year', 'input', 'tmProdYear', t.prod_year) + fld('Price tier', 'select', 'tmPrice', t.price, ['Front (Default)', 'Mid', 'Back', 'Budget']) + '<div class="field"><label>Start time (preview)</label><input class="input" id="tmStart" placeholder="e.g. 0:45" value="' + esc(t.start) + '"></div></div>' +
        '<div class="sec-title" style="margin-top:16px;border-left-color:#6b7280"><svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" style="width:16px;height:16px"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> Instruments</div><input class="input" id="tmInstruments" list="instrList" placeholder="Type instrument, press Enter" onkeydown="if(event.key===\'Enter\'){event.preventDefault();SoutClient.addInstrument(this.value);this.value=\'\'}"><datalist id="instrList"><option value="Voice"><option value="Oud"><option value="Qanun"><option value="Ney"><option value="Violin"><option value="Piano"><option value="Guitar"><option value="Drums"><option value="Percussion"><option value="Tabla"><option value="Riq"></datalist><div id="tmInstrTags" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>' +
        '<div class="row-flex" style="justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn btn-ghost btn-sm" onclick="SoutClient.removeTrack(\'' + t.key + '\')">Delete track</button><button class="btn btn-primary btn-sm" onclick="SoutClient.saveTrackPanel()">Save track</button></div>';
      var tt = document.getElementById('tmTitle'); if (tt) tt.addEventListener('input', function () { t.title = tt.value; renderTracks(); autoNameFromSingle(); SC.syncHeader(); });
      renderContribs(); renderInstrTags();
    }
    SC.saveTrackPanel = function () { var t = active(); if (!t) return; var g = function (id) { return (document.getElementById(id) || {}).value || ''; }; t.title = g('tmTitle').trim(); t.version = g('tmVersion'); t.c_line = g('tmCLine').trim(); t.p_line = g('tmPLine').trim(); t.lyrics_lang = g('tmLyricsLang'); t.content_type = g('tmContent'); t.isrc = g('tmIsrc').trim(); t.prod_year = g('tmProdYear').trim(); t.price = g('tmPrice'); t.start = g('tmStart').trim(); renderTracks(); autoNameFromSingle(); SC.syncHeader(); toast('Track saved ✓'); };
    SC.addInstrument = function (val) { val = (val || '').trim(); if (!val) return; var t = active(); if (!t) return; if (t.instruments.indexOf(val) < 0) t.instruments.push(val); renderInstrTags(); };
    SC.removeInstrument = function (i) { var t = active(); if (!t) return; t.instruments.splice(i, 1); renderInstrTags(); };
    function renderInstrTags() { var t = active(); if (!t) return; var box = document.getElementById('tmInstrTags'); if (!box) return; box.innerHTML = t.instruments.map(function (ins, i) { return '<span class="chip gray" style="gap:6px">' + esc(ins) + ' <span style="cursor:pointer;font-weight:800" onclick="SoutClient.removeInstrument(' + i + ')">×</span></span>'; }).join(''); }

    function renderContribs() {
      var t = active(); if (!t) return; var box = document.getElementById('tmContribs'); if (!box) return;
      if (!t.contributors.length) { box.innerHTML = '<div class="cell-sub" style="padding:6px 0">No contributors yet — add the Main Artist.</div>'; return; }
      box.innerHTML = t.contributors.map(function (c, i) {
        var badges = ''; if (c.spotify_url) badges += '<span class="art-badge" style="background:#e9f7ef;color:#16a34a">Spotify</span> '; if (c.apple_url) badges += '<span class="art-badge" style="background:#fdecec;color:#dc2626">Apple</span> '; if (!c.spotify_url && !c.apple_url) badges = '<span class="art-badge" style="background:var(--surface-3);color:var(--fg-soft)">New profile</span>';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin-bottom:6px"><div style="min-width:0"><div class="cell-main">' + esc(c.name) + '</div><div class="cell-sub">' + esc((c.roles || []).join(' · ')) + '</div></div><div class="row-flex" style="gap:6px;flex:none">' + badges + '<button class="btn btn-ghost btn-sm" onclick="SoutClient.editContributor(' + i + ')">Edit</button><button class="icon-btn btn-sm" onclick="SoutClient.removeContributor(' + i + ')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div></div>';
      }).join('');
    }
    var editingContrib = -1;
    SC.addContributor = function () { editingContrib = -1; openContrib({ name: '', roles: ['Main Artist'] }); };
    SC.editContributor = function (i) { var t = active(); editingContrib = i; openContrib(t.contributors[i]); };
    SC.removeContributor = function (i) { var t = active(); t.contributors.splice(i, 1); renderContribs(); SC.syncHeader(); };
    function openContrib(c) {
      NR._draft = { name: c.name || '', roles: (c.roles || []).slice(), spotify_url: c.spotify_url || '', spotify_id: c.spotify_id || '', apple_url: c.apple_url || '', apple_id: c.apple_id || '', image: c.image || '', spotify_status: c.spotify_status || 'none', apple_status: c.apple_status || 'none' };
      NR._spOpen = false; NR._apOpen = false;
      var box = document.getElementById('nrPanelContent');
      box.innerHTML =
        '<div class="row-flex" style="justify-content:space-between;margin-bottom:10px"><div class="sec-title" style="margin:0;border-left-color:#16a34a">Contributor / artist</div><button class="btn btn-ghost btn-sm" onclick="SoutClient.backToTrack()">Back</button></div>' +
        '<div class="field full" style="margin-bottom:10px"><label>Artist / contributor name</label>' +
          '<input class="input" id="coName" placeholder="Type a name…" autocomplete="off" value="' + esc(c.name || '') + '" oninput="SoutClient.searchArtist(this.value)">' +
          '<div id="coResults" style="margin-top:6px;border:1px solid var(--line);border-radius:10px;max-height:220px;overflow:auto;display:none"></div>' +
        '</div>' +
        // compact side-by-side platform chips
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px">' +
          '<div id="coSpChip"></div><div id="coApChip"></div>' +
        '</div>' +
        '<div id="coPlatPanel"></div>' +
        '<label style="display:block;margin:14px 0 8px">Roles <span class="cell-sub" style="font-weight:400">(one person can hold several)</span></label>' +
        '<div id="coRoles" style="display:flex;flex-wrap:wrap;gap:8px"></div>' +
        '<div class="row-flex" style="justify-content:flex-end;gap:8px;margin-top:18px"><button class="btn btn-ghost btn-sm" onclick="SoutClient.backToTrack()">Cancel</button><button class="btn btn-primary btn-sm" onclick="SoutClient.saveContributor()">Save contributor</button></div>';
      renderRolePills(); renderPlatChips(); renderPlatPanel();
    }
    SC.backToTrack = function () { var t = active(); if (t) renderTrackPanel(t); };
    function renderRolePills() { var box = document.getElementById('coRoles'); if (!box) return; box.innerHTML = ROLES.map(function (r) { var on = NR._draft.roles.indexOf(r) >= 0; return '<span class="role-pill' + (on ? ' on' : '') + '" onclick="SoutClient.toggleRole(\'' + r + '\')">' + r + '</span>'; }).join(''); }
    SC.toggleRole = function (r) { var a = NR._draft.roles, i = a.indexOf(r); if (i >= 0) a.splice(i, 1); else a.push(r); renderRolePills(); };
    function extractSpotify(v) { v = (v || '').trim(); var m = v.match(/artist\/([A-Za-z0-9]{22})/) || v.match(/^([A-Za-z0-9]{22})$/) || v.match(/spotify:artist:([A-Za-z0-9]{22})/); return m ? m[1] : ''; }
    function extractApple(v) { v = (v || '').trim(); var m = v.match(/artist\/(?:[^/]+\/)?(\d{3,})/) || v.match(/id(\d{3,})/) || v.match(/^(\d{3,})$/); return m ? m[1] : ''; }
    // small chip per platform: shows state, click to expand inline
    function platChip(which) {
      var d = NR._draft;
      var isSp = which === 'sp';
      var status = isSp ? d.spotify_status : d.apple_status;
      var color = isSp ? '#16a34a' : '#dc2626';
      var bg = isSp ? '#e9f7ef' : '#fdecec';
      var label = isSp ? 'Spotify' : 'Apple Music';
      var state = status === 'linked' ? '✓ Linked' : status === 'create' ? '＋ Will create' : 'Add';
      var open = isSp ? NR._spOpen : NR._apOpen;
      return '<div onclick="SoutClient.togglePlat(\'' + which + '\')" style="cursor:pointer;border:1.5px solid ' + (open ? color : 'var(--line)') + ';border-radius:10px;padding:9px 11px;transition:.15s;background:' + (open ? bg : 'var(--surface)') + '">' +
        '<div class="row-flex" style="justify-content:space-between;gap:6px">' +
          '<span class="art-badge" style="background:' + bg + ';color:' + color + '">' + label + '</span>' +
          '<span class="cell-sub" style="font-size:.72rem;color:' + (status === 'none' ? 'var(--fg-faint)' : color) + '">' + state + '</span>' +
        '</div></div>';
    }
    function renderPlatChips() {
      var sp = document.getElementById('coSpChip'), ap = document.getElementById('coApChip');
      if (sp) sp.innerHTML = platChip('sp');
      if (ap) ap.innerHTML = platChip('ap');
    }
    SC.togglePlat = function (which) {
      if (which === 'sp') { NR._spOpen = !NR._spOpen; NR._apOpen = false; }
      else { NR._apOpen = !NR._apOpen; NR._spOpen = false; }
      renderPlatChips(); renderPlatPanel();
    };
    function renderPlatPanel() {
      var box = document.getElementById('coPlatPanel'); if (!box) return;
      var d = NR._draft;
      var which = NR._spOpen ? 'sp' : NR._apOpen ? 'ap' : null;
      if (!which) { box.style.display = 'none'; box.innerHTML = ''; return; }
      var isSp = which === 'sp';
      var color = isSp ? '#16a34a' : '#dc2626';
      var name = isSp ? 'Spotify' : 'Apple Music';
      var val = isSp ? (d.spotify_url || '') : (d.apple_url || '');
      var status = isSp ? d.spotify_status : d.apple_status;
      box.style.display = '';
      box.innerHTML = '<div style="border:1px solid ' + color + '55;border-radius:10px;padding:12px;margin-top:2px;background:var(--surface-2)">' +
        '<div class="cell-sub" style="margin-bottom:8px">Paste the artist\'s ' + name + ' link or ID:</div>' +
        '<input class="input" id="coPlatInput" placeholder="' + name + ' link or ID" value="' + esc(val) + '" oninput="SoutClient.onPlatInput()">' +
        '<div id="coPlatState" class="cell-sub" style="margin-top:8px;min-height:18px"></div>' +
        '<div style="border-top:1px solid var(--line);margin:10px 0"></div>' +
        '<label class="row-flex" style="gap:8px;cursor:pointer;font-size:.85rem"><input type="checkbox" id="coPlatCreate"' + (status === 'create' ? ' checked' : '') + ' onchange="SoutClient.onPlatCreate()"> This artist has no ' + name + ' profile yet — <b>create a new one</b></label>' +
        '</div>';
      SC.onPlatInput();
    }
    SC.onPlatInput = function () {
      var which = NR._spOpen ? 'sp' : NR._apOpen ? 'ap' : null; if (!which) return;
      var isSp = which === 'sp';
      var inp = document.getElementById('coPlatInput'); var v = inp ? inp.value : '';
      var id = isSp ? extractSpotify(v) : extractApple(v);
      var d = NR._draft;
      if (isSp) { d.spotify_id = id; d.spotify_url = id ? 'https://open.spotify.com/artist/' + id : ''; d.spotify_status = id ? 'linked' : (d.spotify_status === 'create' ? 'create' : 'none'); }
      else { d.apple_id = id; d.apple_url = id ? 'https://music.apple.com/artist/' + id : ''; d.apple_status = id ? 'linked' : (d.apple_status === 'create' ? 'create' : 'none'); }
      if (id) { var cb = document.getElementById('coPlatCreate'); if (cb) cb.checked = false; }
      var st = document.getElementById('coPlatState');
      if (st) st.innerHTML = id ? '<span style="color:#16a34a">✓ Linked — ID: ' + esc(id) + '</span>' : ((isSp ? d.spotify_status : d.apple_status) === 'create' ? '<span style="color:#c2410c">＋ A new profile will be created</span>' : '');
      renderPlatChips();
    };
    SC.onPlatCreate = function () {
      var which = NR._spOpen ? 'sp' : NR._apOpen ? 'ap' : null; if (!which) return;
      var isSp = which === 'sp';
      var cb = document.getElementById('coPlatCreate'); var on = cb ? cb.checked : false;
      var d = NR._draft;
      if (on) { var inp = document.getElementById('coPlatInput'); if (inp) inp.value = ''; if (isSp) { d.spotify_id = ''; d.spotify_url = ''; d.spotify_status = 'create'; } else { d.apple_id = ''; d.apple_url = ''; d.apple_status = 'create'; } }
      else { if (isSp) d.spotify_status = 'none'; else d.apple_status = 'none'; }
      SC.onPlatInput();
    };
    function renderLinked() {}
    SC.unlinkArtist = function () { NR._draft.spotify_url = NR._draft.spotify_id = NR._draft.apple_url = NR._draft.apple_id = NR._draft.image = ''; renderPlatChips(); };
    SC.saveContributor = function () {
      var name = (document.getElementById('coName').value || '').trim();
      if (!name) { toast('Enter a name'); return; }
      if (!NR._draft.roles.length) { toast('Pick at least one role'); return; }
      NR._draft.name = name;
      var t = active();
      if (editingContrib >= 0) t.contributors[editingContrib] = NR._draft; else t.contributors.push(NR._draft);
      API.call('/artists', { method: 'POST', body: {
        name: name, spotify_input: NR._draft.spotify_url, apple_input: NR._draft.apple_url,
        spotify_create: NR._draft.spotify_status === 'create', apple_create: NR._draft.apple_status === 'create', image: NR._draft.image || ''
      } }).catch(function () {});
      renderTrackPanel(t); SC.syncHeader(); toast('Saved to your artist database ✓');
    };
    var searchTimer = null;
    SC.searchArtist = function (q) {
      NR._draft.name = q; var box = document.getElementById('coResults'); q = (q || '').trim();
      if (q.length < 2) { box.style.display = 'none'; return; }
      clearTimeout(searchTimer); box.style.display = ''; box.innerHTML = '<div class="cell-sub" style="padding:10px">Searching Spotify &amp; Apple…</div>';
      searchTimer = setTimeout(function () {
        Promise.all([API.call('/artists?q=' + encodeURIComponent(q)).catch(function () { return { artists: [] }; }), API.call('/artists/search?q=' + encodeURIComponent(q)).catch(function () { return { results: [] }; })]).then(function (res) {
          var internal = res[0].artists || [], ext = res[1].results || [], html = '';
          var spotifyOn = res[1].spotify_enabled, spErr = res[1].spotify_error;
          var spResults = ext.filter(function (a) { return a.platform === 'spotify'; });
          var apResults = ext.filter(function (a) { return a.platform === 'apple'; });
          if (internal.length) { html += '<div class="cell-sub" style="padding:7px 11px;font-weight:700;background:var(--surface-2)">Your saved artists</div>'; html += internal.map(function (a) {
            var sub = '';
            if (a.spotify_status === 'linked') sub += '🟢 Spotify ✓ '; else if (a.spotify_status === 'create') sub += '🟢 Spotify (new) ';
            if (a.apple_status === 'linked') sub += '🔴 Apple ✓'; else if (a.apple_status === 'create') sub += '🔴 Apple (new)';
            if (!sub) sub = 'Saved artist';
            return row({ name: a.name, spotify_url: a.spotify_url, spotify_id: a.spotify_id, apple_url: a.apple_url, apple_id: a.apple_id, image: a.image, spotify_status: a.spotify_status, apple_status: a.apple_status }, 'Saved', a.image, sub);
          }).join(''); }
          if (spResults.length) { html += '<div class="cell-sub" style="padding:7px 11px;font-weight:700;background:var(--surface-2)">🟢 Spotify</div>'; html += spResults.map(function (a) { return row({ name: a.name, spotify_url: a.url, spotify_id: a.id, image: a.image || '' }, 'Spotify', a.image, a.sub || ''); }).join(''); }
          else if (!spotifyOn) { html += '<div class="cell-sub" style="padding:7px 11px;background:#fff7ed;color:#c2410c">Spotify not connected' + (spErr && spErr !== 'no_token' ? ': ' + esc(spErr) : ' — add API keys to enable') + '</div>'; }
          if (apResults.length) { html += '<div class="cell-sub" style="padding:7px 11px;font-weight:700;background:var(--surface-2)">🔴 Apple Music</div>'; html += apResults.map(function (a) { return row({ name: a.name, apple_url: a.url, apple_id: a.id, image: a.image || '' }, 'Apple', a.image, a.sub || ''); }).join(''); }
          if (!internal.length && !ext.length) {
            if (res[1].apple_error) {
              html = '<div class="art-result"><span class="art-badge" style="background:#fdecec;color:#dc2626">Apple offline</span><div class="cell-sub">Server can\'t reach Apple Music right now. You can still paste the artist\'s link manually below.</div></div>';
            } else {
              html = '<div class="art-result"><span class="art-badge" style="background:var(--surface-3);color:var(--fg-soft)">New</span><div class="cell-sub">No match — a new profile will be created for "' + esc(q) + '"</div></div>';
            }
          }
          box.innerHTML = html; box.style.display = '';
        });
      }, 300);
    };
    function row(payload, badge, img, sub) { var color = badge === 'Spotify' ? 'background:#e9f7ef;color:#16a34a' : badge === 'Apple' ? 'background:#fdecec;color:#dc2626' : 'background:var(--surface-3);color:var(--fg-soft)'; var pj = JSON.stringify(payload).replace(/"/g, '&quot;'); return '<div class="art-result" onclick="SoutClient.pickArtist(JSON.parse(this.dataset.p))" data-p="' + pj + '">' + (img ? '<img src="' + esc(img) + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex:none">' : '<div class="art" style="width:34px;height:34px;border-radius:50%;flex:none">' + esc((payload.name || '?').slice(0, 2).toUpperCase()) + '</div>') + '<div style="flex:1;min-width:0"><div class="cell-main">' + esc(payload.name) + '</div><div class="cell-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(sub || 'Link this profile') + '</div></div><span class="art-badge" style="' + color + '">' + badge + '</span></div>'; }
    SC.pickArtist = function (a) {
      var d = NR._draft; d.name = a.name;
      document.getElementById('coName').value = a.name;
      if (a.spotify_url) { d.spotify_url = a.spotify_url; d.spotify_id = a.spotify_id || extractSpotify(a.spotify_url); d.spotify_status = 'linked'; }
      if (a.apple_url) { d.apple_url = a.apple_url; d.apple_id = a.apple_id || extractApple(a.apple_url); d.apple_status = 'linked'; }
      if (a.spotify_status) d.spotify_status = a.spotify_status;
      if (a.apple_status) d.apple_status = a.apple_status;
      if (a.image) d.image = a.image;
      document.getElementById('coResults').style.display = 'none';
      NR._spOpen = false; NR._apOpen = false;
      renderPlatChips(); renderPlatPanel();
    };
    SC.openReleaseInfo = function () { var el = document.getElementById('nrTitle'); if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } };

    SC.openDates = function () { document.getElementById('dtDigital').value = NR.dates.digital; document.getElementById('dtOriginal').value = NR.dates.original; document.getElementById('dtPreorder').value = NR.dates.preorder; document.getElementById('dtExclusive').value = NR.dates.exclusive; openModal('datesModal'); };
    SC.saveDates = function () { NR.dates.digital = document.getElementById('dtDigital').value; NR.dates.original = document.getElementById('dtOriginal').value; NR.dates.preorder = document.getElementById('dtPreorder').value; NR.dates.exclusive = document.getElementById('dtExclusive').value; document.getElementById('nrDigital').value = NR.dates.digital; document.getElementById('nrOriginal').value = NR.dates.original; document.getElementById('nrDatesSummary').textContent = NR.dates.digital ? ('Digital: ' + NR.dates.digital) : 'Set digital date…'; closeModal('datesModal'); };

    SC.openPlatforms = function () { renderPlatModal(); openModal('platModal'); };
    function renderPlatModal() { var grid = document.getElementById('platModalGrid'); if (!grid) return; grid.innerHTML = PLATFORMS.map(function (p) { var on = NR.platforms.indexOf(p.id) >= 0; return '<label class="row-flex" style="gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;cursor:pointer"><input type="checkbox" data-plat="' + p.id + '"' + (on ? ' checked' : '') + '> ' + esc(p.name) + '</label>'; }).join(''); }
    SC.setPlatforms = function (preset) { if (preset === 'all') NR.platforms = PLATFORMS.map(function (p) { return p.id; }); else if (preset === 'major') NR.platforms = PLATFORMS.filter(function (p) { return p.tier === 'major'; }).map(function (p) { return p.id; }); else if (preset === 'mena') NR.platforms = PLATFORMS.filter(function (p) { return p.tier === 'mena'; }).map(function (p) { return p.id; }); else if (preset === 'clear') NR.platforms = []; renderPlatModal(); };
    SC.applyPlatforms = function () { NR.platforms = Array.prototype.map.call(document.querySelectorAll('#platModalGrid input:checked'), function (x) { return x.dataset.plat; }); updatePlatSummary(); closeModal('platModal'); };
    function updatePlatSummary() { var n = NR.platforms.length, total = PLATFORMS.length, el = document.getElementById('nrPlatSummary'); if (!el) return; var mc = PLATFORMS.filter(function (p) { return p.tier === 'major'; }).length; if (n === 0) el.textContent = 'None selected'; else if (n === total) el.textContent = 'All stores (' + total + ')'; else if (n === mc && NR.platforms.every(function (id) { var p = PLATFORMS.find(function (x) { return x.id === id; }); return p && p.tier === 'major'; })) el.textContent = 'All major platforms'; else el.textContent = n + ' stores selected'; }

    SC.openTerritories = function () { openModal('terrModal'); };
    SC.terrMode = function (m) { NR.terrMode = m; document.getElementById('terrPickWrap').style.display = m === 'worldwide' ? 'none' : ''; if (m !== 'worldwide') SC.renderCountries(''); };
    SC.renderCountries = function (q) { q = (q || '').toLowerCase(); var grid = document.getElementById('terrGrid'); grid.innerHTML = COUNTRIES.filter(function (c) { return c.toLowerCase().indexOf(q) >= 0; }).map(function (c) { var on = NR.terrList.indexOf(c) >= 0; return '<label class="row-flex" style="gap:6px;padding:4px 8px;cursor:pointer"><input type="checkbox"' + (on ? ' checked' : '') + ' onchange="SoutClient.toggleCountry(\'' + c.replace(/'/g, "\\'") + '\')"> ' + c + '</label>'; }).join(''); };
    SC.toggleCountry = function (c) { var i = NR.terrList.indexOf(c); if (i >= 0) NR.terrList.splice(i, 1); else NR.terrList.push(c); };
    SC.applyTerritories = function () { var summary = 'Worldwide', store = 'Worldwide'; if (NR.terrMode === 'exclude' && NR.terrList.length) { summary = 'Worldwide except ' + NR.terrList.length; store = 'Worldwide except: ' + NR.terrList.join(', '); } else if (NR.terrMode === 'only' && NR.terrList.length) { summary = NR.terrList.length + ' countries only'; store = 'Only: ' + NR.terrList.join(', '); } document.getElementById('nrTerrSummary').textContent = summary; document.getElementById('nrTerr').value = store; closeModal('terrModal'); };

    SC.saveRelease = function (status, clickedBtn) {
      var v = function (id) { return ((document.getElementById(id) || {}).value || '').trim(); };
      var missing = [];
      if (!v('nrTitle')) missing.push('Release title');
      if (status === 'submitted') {
        if (!v('nrLabel')) missing.push('Label'); if (!v('nrGenre')) missing.push('Genre'); if (!NR.dates.digital) missing.push('Digital release date'); if (!NR.platforms.length) missing.push('At least one platform'); if (!NR.artStaged && !NR.hasArtwork) missing.push('Cover artwork'); if (!NR.tracks.length) missing.push('At least one track');
        NR.tracks.forEach(function (t, i) { var n = 'Track ' + (i + 1) + ': '; if (!t.title) missing.push(n + 'title'); if (!t.c_line) missing.push(n + 'C Line'); if (!t.p_line) missing.push(n + 'P Line'); if (!t.contributors.some(function (c) { return (c.roles || []).indexOf('Main Artist') >= 0; })) missing.push(n + 'a Main Artist'); if (!t.staged && !t.audio_file) missing.push(n + 'WAV audio'); });
      } else { if (!NR.tracks.some(function (t) { return t.title; })) missing.push('At least one track with a title'); }
      if (missing.length) { alert((status === 'submitted' ? 'Cannot submit — missing:' : 'Cannot save yet:') + '\n\n• ' + missing.join('\n• ')); return; }
      var firstMain = ''; for (var i = 0; i < NR.tracks.length; i++) { var m = NR.tracks[i].contributors.find(function (c) { return (c.roles || []).indexOf('Main Artist') >= 0; }); if (m) { firstMain = m.name; break; } }
      var body = { title: v('nrTitle'), artist: firstMain, label: v('nrLabel'), type: v('nrType') || 'Single', genre: v('nrGenre'), status: 'draft', digital_date: NR.dates.digital, original_date: NR.dates.original, territories: v('nrTerr') || 'Worldwide', stores: '', platforms: NR.platforms.slice(), tracks: NR.tracks.filter(function (t) { return t.title; }).map(function (t) { return { title: t.title, c_line: t.c_line, p_line: t.p_line, version: t.version, isrc: t.isrc, production_year: t.prod_year, lyrics_lang: t.lyrics_lang, content_type: t.content_type, audio_staged: t.staged || undefined, contributors: t.contributors.map(function (c) { return { name: c.name, roles: c.roles, role: c.roles[0], spotify_url: c.spotify_url || '', spotify_id: c.spotify_id || '', apple_url: c.apple_url || '', apple_id: c.apple_id || '', image: c.image || '', instruments: t.instruments }; }) }; }) };
      var btns = document.querySelectorAll('.nr-act'); var btn = clickedBtn || document.getElementById(status === 'draft' ? 'nrSaveBtn' : 'nrSubmitBtn'); var html = btn ? btn.innerHTML : ''; var setBtn = function (x) { if (btn) btn.textContent = x; }; btns.forEach(function (b) { b.disabled = true; });
      Promise.resolve().then(function () { if (STAGING.length) { setBtn('Finishing uploads…'); return Promise.allSettled(STAGING); } }).then(function () { STAGING = []; if (NR.artStaged) body.artwork_staged = NR.artStaged; setBtn('Saving…'); if (NR.editId) return API.call('/releases/' + NR.editId, { method: 'PUT', body: body }).then(function () { return NR.editId; }); return API.call('/releases', { method: 'POST', body: body }).then(function (r) { return r.id; }); }).then(function (relId) { if (status === 'submitted') { setBtn('Submitting…'); return API.call('/releases/' + relId + '/submit', { method: 'POST' }); } }).then(function () { toast(status === 'submitted' ? 'Submitted for review ✓' : 'Saved as draft ✓'); resetNR(); if (SC.reloadReleases) SC.reloadReleases(); if (window.go) window.go('releases'); }).catch(function (err) { alert('Error: ' + (err && err.message || err)); }).then(function () { btns.forEach(function (b) { b.disabled = false; }); if (btn) btn.innerHTML = html; });
    };
    function resetNR() { NR.tracks = []; NR.artStaged = null; NR.hasArtwork = false; NR.artUrl = ''; NR.editId = null; NR.activeKey = null; NR.dates = { digital: '', original: '', preorder: '', exclusive: '' }; NR.terrMode = 'worldwide'; NR.terrList = []; }
    SC.initNewRelease = function (editId) { resetNR(); NR.editId = editId || null; SC.setPlatforms('major'); updatePlatSummary(); NR.queueArt = null; NR.queueAudio = []; var qb = document.getElementById('nrQueue'); if (qb) qb.style.display = 'none'; var ub = document.getElementById('nrUploadBtn'); if (ub) ub.style.display = 'none'; var g = function (id) { var e = document.getElementById(id); if (e) e.value = ''; }; g('nrTitle'); g('nrLabel'); var hdr = document.getElementById('nrHdrArt'); if (hdr) hdr.removeAttribute('src'); var st = document.getElementById('nrStepName'); if (st) st.style.display = ''; var w = document.getElementById('nrWelcome'); if (w) w.style.display = 'none'; var ws = document.getElementById('nrWorkspace'); if (ws) ws.style.display = 'none'; var pt = document.getElementById('nrPreTitle'); if (pt) pt.value = ''; NR.preType = 'Single'; var ptc = document.getElementById('nrPreType'); if (ptc) { Array.prototype.forEach.call(ptc.children, function (ch, i) { ch.classList.toggle('active', i === 0); }); } var ds = document.getElementById('nrDatesSummary'); if (ds) ds.textContent = 'Set digital date…'; var ts = document.getElementById('nrTerrSummary'); if (ts) ts.textContent = 'Worldwide'; document.getElementById('nrTerr').value = 'Worldwide'; showPanelWelcome(); renderTracks(); SC.syncHeader(); API.call('/labels').then(function (d) { var dl = document.getElementById('labelList'); if (dl && d.labels) dl.innerHTML = d.labels.map(function (l) { return '<option value="' + esc(l) + '">'; }).join(''); }).catch(function () {}); };
    console.log('New Release (Believe two-column) ready');
  });
})();
