'use strict';

/* global Parser */
(function () {
  const IMAGE_EXT = /\.(jpe?g|png|webp|avif|tiff?|gif|heic|heif|dng|bmp)$/i;
  const VIDEO_EXT = /\.(mp4|mov|m4v|avi|webm|mkv)$/i;

  /** @type {Array<{id,path,name,ext,status,result,vm,error}>} */
  let items = [];
  let selectedId = null;
  let currentRaw = '';
  let currentName = 'manifest';

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  function toFileURL(p) {
    let s = String(p).replace(/\\/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }

  // ---------- Window controls ----------
  document.querySelectorAll('.dot').forEach((b) => {
    b.addEventListener('click', () => {
      const action = b.dataset.win;
      if (action === 'close') window.c2pa.window.close();
      else if (action === 'minimize') window.c2pa.window.minimize();
      else if (action === 'maximize') window.c2pa.window.maximize();
    });
  });

  // ---------- Toolbar buttons ----------
  $('#btn-open').addEventListener('click', async () => addPaths(await window.c2pa.pickFiles()));
  $('#btn-clear').addEventListener('click', () => {
    items = [];
    selectedId = null;
    renderList();
    showEmpty();
  });

  // ---------- About / Credits ----------
  const aboutEl = $('#about');
  $('#btn-about').addEventListener('click', async () => {
    const info = await window.c2pa.appInfo();
    $('#about-version').textContent = 'v' + (info && info.version ? info.version : '—');
    const tv = await window.c2pa.toolVersion();
    $('#about-tool').textContent = tv ? 'Bundled ' + tv + '.' : '';
    aboutEl.classList.remove('hidden');
  });
  $('#about-close').addEventListener('click', () => aboutEl.classList.add('hidden'));
  aboutEl.addEventListener('click', (e) => {
    if (e.target === aboutEl) aboutEl.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') aboutEl.classList.add('hidden');
  });
  document.querySelectorAll('[data-ext]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.c2pa.openExternal(a.dataset.ext);
    });
  });

  // ---------- Auto-update (Discord-style Download button) ----------
  const updateBtn = $('#btn-update');
  let updateReady = false;

  function applyUpdateState(st) {
    if (!st || st.state === 'idle') return;
    updateBtn.classList.remove('hidden');
    if (st.state === 'downloaded') {
      updateReady = true;
      updateBtn.classList.add('ready');
      updateBtn.classList.remove('downloading');
      updateBtn.title = 'Restart to update' + (st.version ? ' to v' + st.version : '');
    } else {
      updateReady = false;
      updateBtn.classList.add('downloading');
      updateBtn.classList.remove('ready');
      const pct = st.percent ? ' (' + Math.round(st.percent) + '%)' : '';
      updateBtn.title = 'Downloading update…' + pct;
    }
  }

  updateBtn.addEventListener('click', async () => {
    if (updateReady) await window.c2pa.updates.install();
  });

  if (window.c2pa.updates) {
    window.c2pa.updates.onAvailable(applyUpdateState);
    window.c2pa.updates.onProgress(applyUpdateState);
    window.c2pa.updates.onDownloaded(applyUpdateState);
  }

  // ---------- Tabs ----------
  function activateTab(which) {
    document
      .querySelectorAll('.tab')
      .forEach((t) => t.classList.toggle('active', t.dataset.tab === which));
    $('#panel-summary').classList.toggle('hidden', which !== 'summary');
    $('#panel-raw').classList.toggle('hidden', which !== 'raw');
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  // ---------- Raw JSON actions ----------
  $('#btn-copy').addEventListener('click', async () => {
    await copyText(currentRaw);
    flash('Copied to clipboard');
  });
  $('#btn-editor').addEventListener('click', async () => {
    if (!currentRaw) return;
    const res = await window.c2pa.openInEditor(currentRaw, currentName);
    flash(res && res.ok ? 'Opened in your default editor' : 'Could not open editor');
  });
  $('#btn-save').addEventListener('click', async () => {
    if (!currentRaw) return;
    const res = await window.c2pa.saveJson(currentRaw, currentName);
    if (res && res.ok) flash('Saved');
    else if (res && res.canceled) flash('');
    else flash('Could not save');
  });
  function flash(msg) {
    $('#raw-status').textContent = msg;
    if (msg) setTimeout(() => ($('#raw-status').textContent = ''), 2500);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      /* fall through */
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // ---------- Find in JSON (Ctrl/Cmd+F) ----------
  const findBar = $('#find-bar');
  const findInput = $('#find-input');
  const findCount = $('#find-count');
  let findHits = [];
  let findIndex = -1;
  let jsonBaseHTML = ''; // clean highlighted JSON, before any find marks

  function openFind() {
    if ($('#result').classList.contains('hidden')) return; // nothing to search
    activateTab('raw');
    findBar.classList.remove('hidden');
    findInput.focus();
    findInput.select();
    if (findInput.value) runFind();
  }

  function closeFind() {
    findBar.classList.add('hidden');
    if (jsonBaseHTML) $('#json').innerHTML = jsonBaseHTML;
    findHits = [];
    findIndex = -1;
    findCount.textContent = '';
  }

  function runFind() {
    const q = findInput.value;
    const box = $('#json');
    if (jsonBaseHTML) box.innerHTML = jsonBaseHTML;
    findHits = [];
    findIndex = -1;
    if (!q) {
      findCount.textContent = '';
      return;
    }
    const needle = q.toLowerCase();

    // Collect text nodes first, then wrap matches, so token colouring stays.
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);

    for (const node of nodes) {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(needle);
      if (idx === -1) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (idx !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mark = document.createElement('mark');
        mark.className = 'find-hit';
        mark.textContent = text.slice(idx, idx + q.length);
        frag.appendChild(mark);
        findHits.push(mark);
        last = idx + q.length;
        idx = lower.indexOf(needle, last);
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }

    if (findHits.length) setFindIndex(0);
    else findCount.textContent = 'No results';
  }

  function setFindIndex(i) {
    if (!findHits.length) return;
    if (findIndex >= 0 && findHits[findIndex]) findHits[findIndex].classList.remove('current');
    findIndex = ((i % findHits.length) + findHits.length) % findHits.length;
    const cur = findHits[findIndex];
    cur.classList.add('current');
    cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    findCount.textContent = `${findIndex + 1} / ${findHits.length}`;
  }

  findInput.addEventListener('input', runFind);
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setFindIndex(findIndex + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    }
  });
  $('#find-next').addEventListener('click', () => setFindIndex(findIndex + 1));
  $('#find-prev').addEventListener('click', () => setFindIndex(findIndex - 1));
  $('#find-close').addEventListener('click', closeFind);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
    }
  });

  // ---------- Drag & drop ----------
  const mask = $('#dropmask');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    mask.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragDepth <= 0) {
      dragDepth = 0;
      mask.classList.add('hidden');
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    mask.classList.add('hidden');
    const paths = [];
    for (const file of e.dataTransfer.files) {
      const p = window.c2pa.pathForFile(file);
      if (p) paths.push(p);
    }
    addPaths(paths);
  });

  // ---------- Core ----------
  async function addPaths(paths) {
    if (!paths || !paths.length) return;
    const fresh = [];
    for (const p of paths) {
      if (items.some((it) => it.path === p)) continue;
      const name = p.split(/[\\/]/).pop();
      const item = { id: p, path: p, name, ext: name, status: 'pending', result: null, vm: null, error: null };
      items.push(item);
      fresh.push(item);
    }
    renderList();
    if (!selectedId && fresh.length) select(fresh[0].id);
    for (const item of fresh) {
      await analyzeItem(item);
    }
  }

  async function analyzeItem(item) {
    item.status = 'pending';
    renderList();
    if (selectedId === item.id) renderDetail(item);

    const res = await window.c2pa.analyze(item.path);
    item.result = res;
    if (res && res.json) {
      item.vm = Parser.parse(res.json);
      item.status = item.vm ? item.vm.validationBadge : 'none';
    } else {
      item.vm = null;
      item.status = 'none';
      item.error = res ? res.error : 'No data';
    }
    renderList();
    if (selectedId === item.id) renderDetail(item);
  }

  function select(id) {
    selectedId = id;
    renderList();
    const item = items.find((it) => it.id === id);
    if (item) renderDetail(item);
  }

  // ---------- Sidebar ----------
  function renderList() {
    const list = $('#list');
    list.innerHTML = '';
    for (const item of items) {
      const li = el('li', 'list-item' + (item.id === selectedId ? ' active' : ''));
      li.appendChild(thumbEl('li-thumb', item));

      const body = el('div', 'li-body');
      body.appendChild(el('div', 'li-name', esc(item.name)));
      body.appendChild(el('div', 'li-sub', statusText(item)));
      li.appendChild(body);

      li.appendChild(el('span', 'li-status ' + item.status));
      li.addEventListener('click', () => select(item.id));
      list.appendChild(li);
    }
  }

  function statusText(item) {
    if (item.status === 'pending') return 'Analyzing…';
    if (!item.vm) return 'No Content Credentials';
    const a = item.vm.active;
    const gen = a && a.generators[0] ? a.generators[0].name : item.vm.validationState;
    return esc(gen);
  }

  function thumbEl(cls, item) {
    const box = el('div', cls);
    if (IMAGE_EXT.test(item.name)) {
      const img = el('img');
      img.src = toFileURL(item.path);
      img.onerror = () => (box.textContent = '🖼');
      box.appendChild(img);
    } else if (VIDEO_EXT.test(item.name)) {
      const v = el('video');
      v.src = toFileURL(item.path);
      v.muted = true;
      v.preload = 'metadata';
      v.addEventListener('loadeddata', () => {
        try {
          v.currentTime = 0.1;
        } catch {
          /* ignore */
        }
      });
      v.onerror = () => (box.textContent = '🎞');
      box.appendChild(v);
    } else {
      box.textContent = '📄';
    }
    return box;
  }

  // ---------- Detail ----------
  function showEmpty() {
    $('#empty').classList.remove('hidden');
    $('#result').classList.add('hidden');
  }

  function renderDetail(item) {
    $('#empty').classList.add('hidden');
    $('#result').classList.remove('hidden');

    $('#thumb').replaceWith(buildThumb(item));
    $('#r-name').textContent = item.name;
    $('#r-sub').textContent = item.path;

    const badge = $('#r-state');
    if (item.status === 'pending') {
      setBadge(badge, 'none', 'Analyzing…');
    } else if (item.vm) {
      setBadge(badge, item.vm.validationBadge, item.vm.validationState);
    } else {
      setBadge(badge, 'none', 'No Content Credentials');
    }

    $('#cards').innerHTML = item.vm ? buildCards(item.vm) : buildNoManifest(item);

    currentRaw = item.result && item.result.raw ? item.result.raw : '';
    currentName = item.name;
    $('#json').innerHTML = currentRaw ? highlightJSON(currentRaw) : emptyJsonNote(item);
    jsonBaseHTML = $('#json').innerHTML;
    if (!findBar.classList.contains('hidden')) runFind();
  }

  function buildThumb(item) {
    const box = thumbEl('thumb', item);
    box.id = 'thumb';
    return box;
  }

  function setBadge(node, cls, text) {
    node.className = 'state-badge ' + cls;
    node.textContent = text;
  }

  function row(k, v, mono) {
    if (v == null || v === '') return '';
    return `<div class="row"><span class="k">${esc(k)}</span><span class="v${mono ? ' mono' : ''}">${v}</span></div>`;
  }

  function card(title, inner, span) {
    if (!inner) return '';
    return `<div class="card${span ? ' span-2' : ''}"><h2>${esc(title)}</h2>${inner}</div>`;
  }

  function fmtTime(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return isNaN(d) ? esc(iso) : d.toLocaleString();
  }

  function buildCards(P) {
    const A = P.active;
    const cards = [];

    // Validation
    let valInner = row('State', `<span class="pill ${P.validationBadge}">${esc(P.validationState)}</span>`);
    valInner += row('Checks passed', P.successes != null ? String(P.successes) : null);
    valInner += row('Manifests in store', String(P.manifests.length));
    if (P.claimVersions && P.claimVersions.length) {
      const multi = P.claimVersions.length > 1;
      const pills = P.claimVersions
        .map((v) => `<span class="pill${multi ? ' multi' : ''}">v${esc(v)}</span>`)
        .join(' ');
      valInner += row(multi ? 'Claim versions ⚠' : 'Claim version', pills);
    }
    for (const f of P.failures) {
      valInner += row(Parser.prettify(f.code), esc(f.explanation));
    }
    for (const f of P.informational) {
      valInner += row(Parser.prettify(f.code), esc(f.explanation));
    }
    cards.push(card('Validation', valInner));

    if (A) {
      // Content credentials
      const gens = A.generators
        .map((g) => `<span class="pill accent">${esc(g.name)}${g.version ? ' ' + esc(g.version) : ''}</span>`)
        .join(' ');
      let ccInner = row('Generator', gens || null);
      ccInner += row('Produced by', A.softwareAgent ? esc(A.softwareAgent) : null);
      ccInner += row(
        'Content type',
        A.aiGenerated
          ? `<span class="pill ai">AI-generated</span>`
          : A.digitalSourceLabel
          ? esc(A.digitalSourceLabel)
          : null,
      );
      ccInner += row('Source type', A.aiGenerated && A.digitalSourceLabel ? esc(A.digitalSourceLabel) : null);
      ccInner += row('Format', A.format ? esc(A.format) : null);
      ccInner += row('Claim version', A.claimVersion != null ? String(A.claimVersion) : null);
      cards.push(card('Content Credentials', ccInner));

      // AI model
      if (A.model) {
        let mInner = row('Model', A.model.details ? esc(A.model.details) : null);
        mInner += row('Model version', A.model.version ? esc(A.model.version) : null);
        mInner += row('Model id', A.model.id ? esc(A.model.id) : null);
        mInner += row('Provider type', A.model.type ? esc(A.model.type) : null);
        mInner += row('Gen AI id', A.model.genAiId ? esc(A.model.genAiId) : null, true);
        cards.push(card('AI Model', mInner));
      }

      // Signature
      if (A.signature) {
        const s = A.signature;
        let sInner = row('Issuer', s.issuer ? esc(s.issuer) : null);
        sInner += row('Common name', s.commonName ? esc(s.commonName) : null);
        sInner += row('Algorithm', s.alg ? esc(s.alg) : null);
        sInner += row('Signed at', fmtTime(s.time));
        sInner += row('Cert serial', s.certSerial ? esc(s.certSerial) : null, true);
        cards.push(card('Signature', sInner));
      }

      // Provenance / ingredients
      if (A.ingredients.length) {
        const chain = A.ingredients
          .map((ing, i) => {
            const ref = ing.activeManifest && P.byId[ing.activeManifest];
            const gen = ref && ref.generators[0] ? `${ref.generators[0].name}` : '';
            const signer = ref && ref.signature ? ref.signature.issuer : '';
            const cv = ref && ref.claimVersion != null ? `claim v${ref.claimVersion}` : '';
            const rel = ing.relationship ? `<span class="pill">${esc(ing.relationship)}</span>` : '';
            const meta = [gen, signer, cv].filter(Boolean).map(esc).join(' · ');
            return `<div class="chain-item"><span class="idx">${i + 1}</span><div><div>${esc(
              ing.title,
            )} ${rel}</div>${meta ? `<div class="li-sub">${meta}</div>` : ''}</div></div>`;
          })
          .join('');
        cards.push(card('Provenance (ingredients)', `<div class="chain">${chain}</div>`, true));
      }
    }

    return cards.join('');
  }

  function buildNoManifest(item) {
    const detail = item.error
      ? `<div class="row"><span class="v">${esc(item.error)}</span></div>`
      : '';
    return card(
      'No Content Credentials',
      `<div class="row"><span class="v">This file has no embedded C2PA manifest, or it could not be read.</span></div>${detail}`,
      true,
    );
  }

  function emptyJsonNote(item) {
    const msg = item.error ? esc(item.error) : 'No manifest data.';
    return `<div class="jline"><span class="jcode">${msg}</span></div>`;
  }

  // ---------- JSON syntax highlighter (dependency-free) ----------
  function highlightJSON(value) {
    let json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    // Re-pretty-print if it came as a compact string
    try {
      if (typeof value === 'string') json = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      /* keep as-is */
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    json = json.replace(
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
      (m) => {
        let cls = 'tok-num';
        if (/^"/.test(m)) cls = /:\s*$/.test(m) ? 'tok-key' : 'tok-str';
        else if (/^(true|false)$/.test(m)) cls = 'tok-bool';
        else if (/^null$/.test(m)) cls = 'tok-null';
        return `<span class="${cls}">${m}</span>`;
      },
    );
    return json
      .split('\n')
      .map((line) => `<div class="jline"><span class="jcode">${line.length ? line : ' '}</span></div>`)
      .join('');
  }

  // ---------- Init ----------
  (async function init() {
    const v = await window.c2pa.toolVersion();
    $('#tool-version').textContent = v ? v : 'c2patool not found — run "npm run setup"';
    window.c2pa.window.onState(() => {});
    // Catch an update that was already found before listeners were wired.
    if (window.c2pa.updates) {
      try {
        applyUpdateState(await window.c2pa.updates.state());
      } catch {
        /* ignore */
      }
    }
  })();
})();
