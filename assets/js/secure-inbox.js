// Michael's secure inbox (/secure-inbox, not linked anywhere). His passphrase unlocks the office key here, in the
// browser (secure-crypto.js). The list of uploads comes from the forms script (form-backend/SecureDocs.gs), and each
// document is decrypted on this device when he opens or downloads it. The passphrase and the unlocked key never
// leave the page; Lock, closing the tab or 20 minutes without use forgets them.
(() => {
  const VC = window.VemianCrypto;
  const D = JSON.parse(document.getElementById('inbox-data').textContent);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const human = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const ext = (name) => (String(name).split('.').pop() || 'file').slice(0, 4).toUpperCase();
  const when = (t) => new Date(t).toLocaleString('en-CA', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const icon = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  let me = null;   // { keys: [{ kid, privateKey }], token }
  let items = [];

  async function post(payload) {
    const res = await fetch(D.endpoint, { method: 'POST', body: JSON.stringify(payload) });   // text/plain: no preflight
    let data = {};
    try { data = await res.json(); } catch { /* not the script's answer */ }
    if (res.ok && data.ok === true) return data;
    if (data.auth === false) { lockNow('The forms script didn’t accept this key. Has the new office key been deployed to the script?'); }
    throw new Error(data.error || `The server answered ${res.status}`);
  }

  // ---------- unlock ----------
  $('#lock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#lock-pw');
    const msg = $('.lock-msg');
    const b = $('#lock-form button');
    b.disabled = true;
    b.textContent = 'Unlocking…';
    msg.textContent = '';
    try {
      const keys = [];
      for (const k of D.keys) { const u = await VC.unlockOffice(k, input.value); if (u) keys.push(u); }
      if (!keys.length) { msg.textContent = 'That passphrase doesn’t open the office key.'; input.select(); return; }
      if (keys[0].kid !== D.keys[0].kid) { msg.textContent = 'That passphrase only opens an older office key. Use the current one.'; return; }
      me = { keys: keys.map(({ kid, privateKey }) => ({ kid, privateKey })), token: keys[0].token };
      input.value = '';
      $('#lock').hidden = true;
      $('#app').hidden = false;
      shell();
      await loadList();
      const want = VC.readRef(decodeURIComponent(location.hash.slice(1)));
      if (want) openRef(want);
    } catch (err) {
      msg.textContent = `Couldn’t unlock: ${err.message}`;
    } finally {
      b.disabled = false;
      b.textContent = 'Unlock';
    }
  });

  function lockNow(reason) {
    me = null;
    if (reason) sessionStorage.setItem('vemian-inbox-msg', reason);
    location.reload();
  }
  const why = sessionStorage.getItem('vemian-inbox-msg');
  if (why) { $('.lock-msg').textContent = why; sessionStorage.removeItem('vemian-inbox-msg'); }
  let idle;
  const wake = () => { clearTimeout(idle); idle = setTimeout(() => { if (me) lockNow('Locked after 20 minutes without use.'); }, 20 * 60000); };
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, wake, { passive: true }));
  wake();

  // ---------- the page once unlocked ----------
  function shell() {
    $('#app').innerHTML = `<header class="ib-top"><div class="wrap ib-top-in">
        <img src="/assets/brand/vemian-wordmark-56.png" alt="Vemian" width="84" height="28">
        <div class="ib-title"><b>Secure documents</b><span>Unlocked in this browser only</span></div>
        <button type="button" class="btn btn-ghost btn-sm" id="ib-refresh">Refresh</button>
        <button type="button" class="btn btn-primary btn-sm" id="ib-lock">${icon('lock')} Lock</button>
      </div></header>
      <div class="wrap ib-main">
        <section class="ib-list" aria-label="Uploads">
          <form class="ib-find" id="ib-find"><input class="input" name="ref" placeholder="Reference (VPM-…)" aria-label="Open a reference, like VPM-8F4K92" autocomplete="off" spellcheck="false"><button class="btn btn-ghost" type="submit">Open</button></form>
          <div id="ib-items"></div>
        </section>
        <section class="ib-detail" id="ib-detail" aria-live="polite"><p class="ib-msg">Choose an upload on the left.</p></section>
      </div>`;
    $('#ib-lock').addEventListener('click', () => lockNow());
    $('#ib-refresh').addEventListener('click', () => loadList());
    $('#ib-find').addEventListener('submit', (e) => {
      e.preventDefault();
      const ref = VC.readRef(e.target.elements.ref.value);
      if (ref) openRef(ref); else detail(`<p class="ib-msg error">That isn’t a reference. They look like VPM-8F4K92.</p>`);
    });
  }
  const detail = (html) => { $('#ib-detail').innerHTML = html; };

  async function loadList() {
    const box = $('#ib-items');
    box.innerHTML = '<p class="ib-msg">Loading…</p>';
    try {
      items = (await post({ action: 'docs-list', admin: me.token })).items;
    } catch (err) {
      box.innerHTML = `<p class="ib-msg error">Couldn’t load the list: ${esc(err.message)}</p>`;
      return;
    }
    box.innerHTML = items.length ? items.map((it) => `<button type="button" class="ib-item" data-ref="${esc(it.ref)}">
        <b>${esc(it.name)}</b>
        <span>${esc(it.home || 'No home chosen')} · ${it.files} file${it.files === 1 ? '' : 's'} · ${human(it.bytes || 0)}</span>
        <span>${esc(when(it.t))} · ${esc(it.ref)}${it.status === 'complete' ? '' : ' · <span class="ib-wait">not finished</span>'}</span>
      </button>`).join('') : '<p class="ib-empty">No secure uploads yet.</p>';
    $$('.ib-item', box).forEach((b) => b.addEventListener('click', () => openRef(b.dataset.ref)));
  }

  // ---------- one upload ----------
  async function openRef(ref) {
    history.replaceState(null, '', `#${ref}`);
    $$('.ib-item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.ref === ref)));
    detail('<p class="ib-msg">Opening…</p>');
    let r, K, man;
    try {
      r = await post({ action: 'docs-open', ref, admin: me.token });
      const key = me.keys.find((k) => k.kid === r.header.kid);
      if (!key) { detail(`<p class="ib-msg error">${esc(ref)} was locked with another office key (${esc(r.header.kid)}), which isn’t on this page.</p>`); return; }
      K = await VC.keyFromOffice(r.header, key.privateKey);
      man = await VC.readManifest(r.header, K);
    } catch (err) {
      detail(`<p class="ib-msg error">Couldn’t open ${esc(ref)}: ${esc(err.message === 'Not found' ? 'there’s no finished upload with that reference.' : err.message)}</p>`);
      return;
    }
    const firsts = [];
    let at = 0;
    man.files.forEach((f) => { firsts.push(at); at += f.pieces; });
    const rows = [
      ['Reference', esc(r.ref)],
      ['Received', esc(when(r.created))],
      ['Home', esc(r.homeFull || r.home || 'No home chosen')],
      ['Email', r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''],
      ['Phone', r.phone ? `<a href="sms:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''],
      ['Drive', r.folderUrl ? `<a href="${esc(r.folderUrl)}" target="_blank" rel="noopener">The encrypted files</a>` : ''],
    ].filter((x) => x[1]);
    detail(`<h2>${esc(r.name)}</h2>
      <dl class="ib-meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      ${man.message ? `<p class="open-note">${esc(man.message)}</p>` : ''}
      <ul class="dl-list">${man.files.map((f, i) => `<li><span class="ext">${esc(ext(f.name))}</span><span class="nm"><b>${esc(f.name)}</b><span>${f.label ? `${esc(f.label)} · ` : ''}${human(f.size)}</span></span>
        <span class="acts">${/^(image\/|application\/pdf)/.test(f.type) ? `<button type="button" class="btn btn-ghost" data-view="${i}">Open</button>` : ''}<button type="button" class="btn btn-primary" data-dl="${i}">Download</button></span></li>`).join('')}</ul>
      <p class="ib-msg" id="ib-file-msg" role="status"></p>`);
    const blobs = {};
    async function file(i, b) {
      if (blobs[i]) return blobs[i];
      const f = man.files[i];
      const parts = [];
      for (let c = 0; c < f.pieces; c++) {
        if (f.pieces > 1) b.textContent = `${Math.round((c / f.pieces) * 100)}%`;
        const g = await post({ action: 'docs-get', ref: r.ref, admin: me.token, i: firsts[i] + c });
        parts.push(await VC.readPiece(K, g.data, i, c));
      }
      blobs[i] = URL.createObjectURL(new Blob(parts, { type: f.type || 'application/octet-stream' }));
      return blobs[i];
    }
    const fail = (f, err) => { const m = $('#ib-file-msg'); m.className = 'ib-msg error'; m.textContent = `Couldn’t open ${f.name}: ${err.message}`; };
    $$('[data-dl]').forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.dl);
      const label = b.textContent;
      b.disabled = true;
      try {
        const a = document.createElement('a');
        a.href = await file(i, b);
        a.download = man.files[i].name;
        document.body.append(a);
        a.click();
        a.remove();
      } catch (err) { fail(man.files[i], err); } finally { b.disabled = false; b.textContent = label; }
    }));
    $$('[data-view]').forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.view);
      const label = b.textContent;
      const w = window.open('', '_blank');   // opened now, while it's still a click, then pointed at the file
      b.disabled = true;
      try {
        const url = await file(i, b);
        if (w) w.location.href = url;
        else {
          // pop-up blocked: a link to click instead (never leave this page, which would lock it)
          const m = $('#ib-file-msg');
          m.className = 'ib-msg';
          m.innerHTML = `The browser blocked a new tab. <a href="${url}" target="_blank" rel="noopener">Open ${esc(man.files[i].name)}</a>`;
        }
      } catch (err) { if (w) w.close(); fail(man.files[i], err); } finally { b.disabled = false; b.textContent = label; }
    }));
  }
  addEventListener('hashchange', () => { const ref = VC.readRef(decodeURIComponent(location.hash.slice(1))); if (me && ref) openRef(ref); });
})();
