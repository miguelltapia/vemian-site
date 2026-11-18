// Secure upload page (/secure-upload). The documents are encrypted here, on the applicant's device, before anything
// is sent (secure-crypto.js: a key made just for this upload, plus Vemian's office public key). The encrypted
// pieces then go to the forms script (form-backend/SecureDocs.gs) a few at a time, and the bar moves only when the
// script confirms a piece. The thank-you replaces the form on this page, with the reference and the applicant's key
// (shown once: copy it or save it as a file). Nothing is emailed to the applicant. "Open documents you've sent"
// unlocks them again with the reference and the key.
(() => {
  const { $, $$, esc, track, copyText, config: C } = window.V;
  const VC = window.VemianCrypto;
  const form = $('#sec-form');
  const dataEl = $('#secure-data');
  if (!form || !dataEl || !VC) return;
  const D = JSON.parse(dataEl.textContent);
  const files = {};   // drop zone id -> [{ name, type, size, label, bytes, url }]
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const human = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const ext = (name) => (String(name).split('.').pop() || 'file').slice(0, 4).toUpperCase();
  const allFiles = () => Object.values(files).flat();
  const total = () => allFiles().reduce((s, f) => s + f.size, 0);
  const field = (name) => form.elements[name];
  const val = (name) => String(field(name)?.value || '').trim();
  const when = (iso) => new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  // the home from Michael's link: /secure-upload?home=bm-801
  const pre = new URLSearchParams(location.search).get('home');
  if (pre && D.homes[pre]) field('home').value = pre;

  // ---------- documents: photos or PDFs, 10 MB each, 20 MB together (as on the application) ----------
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale);
      cv.height = Math.round(bmp.height * scale);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
    } catch { return file; }
  }
  function drawZone(zone) {
    $('.files', zone).innerHTML = (files[zone.id] || []).map((f, i) => `<li>${f.url ? `<img src="${f.url}" alt="">` : `<span class="ext">${esc(ext(f.name))}</span>`}
      <span class="nm">${esc(f.name)}</span><span class="sz">${human(f.size)}</span>
      <button type="button" data-remove="${i}" aria-label="Remove ${esc(f.name)}"><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button></li>`).join('');
    $('#doc-total').textContent = total() ? `${human(total())} of 20 MB used` : '';
  }
  async function addFiles(zone, list) {
    const msg = $('#doc-msg');
    msg.textContent = '';
    for (const raw of list) {
      if (!/^image\/|^application\/pdf$/.test(raw.type) && !/\.(heic|heif|pdf|jpe?g|png|webp)$/i.test(raw.name)) { msg.textContent = `${raw.name}: please use a photo or a PDF.`; continue; }
      if (allFiles().length >= D.max.files) { msg.textContent = `That’s ${D.max.files} documents, the most for one upload.`; break; }
      const f = await shrink(raw);
      if (f.size > D.max.file) { msg.textContent = `${raw.name} is over 10 MB. Try a smaller photo or PDF.`; continue; }
      if (total() + f.size > D.max.total) { msg.textContent = 'That’s more than 20 MB in total. Send the rest in a second upload.'; break; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      (files[zone.id] ||= []).push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, label: zone.dataset.label, bytes, url: /^image\/(jpeg|png|webp|gif)$/.test(f.type) ? URL.createObjectURL(f) : '' });
    }
    drawZone(zone);
  }
  $$('.drop', form).forEach((zone) => {
    const input = $('input[type=file]', zone);
    $('[data-pick]', zone).addEventListener('click', () => input.click());
    input.addEventListener('change', () => { addFiles(zone, [...input.files]); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); if (!busy) addFiles(zone, [...e.dataTransfer.files]); });
    zone.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (!rm || busy) return;
      const [gone] = files[zone.id].splice(Number(rm.dataset.remove), 1);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      drawZone(zone);
    });
  });

  // ---------- checks ----------
  const emailOk = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s);
  function check() {
    let first = null;
    const mark = (el, bad) => { el.closest('.field')?.classList.toggle('invalid', bad); if (bad && !first) first = el; };
    mark(field('name'), !val('name'));
    mark(field('email'), !emailOk(val('email')));
    mark(field('home'), !val('home'));
    const noDocs = !allFiles().length;
    if (noDocs) $('#doc-msg').textContent = 'Add at least one document.';
    if (noDocs && !first) first = $('.drop [data-pick]', form);
    mark(field('consent'), !field('consent').checked);
    if (!first) return true;
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    return false;
  }
  const clear = (e) => e.target.closest('.field')?.classList.remove('invalid');
  form.addEventListener('input', clear);
  form.addEventListener('change', clear);

  // ---------- the forms script ----------
  let stopped = false;
  async function post(payload) {
    if (!C.endpoint) throw Object.assign(new Error('Secure uploads aren’t connected yet.'), { final: true });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      // text/plain JSON: no CORS preflight, which Google Apps Script can't answer
      const res = await fetch(C.endpoint, { method: 'POST', body: JSON.stringify({ ...payload, page: location.origin + location.pathname }), signal: ctrl.signal });
      let data = {};
      try { data = await res.json(); } catch { /* not the script's answer */ }
      if (res.ok && data.ok === true) return data;
      throw Object.assign(new Error(data.error || `The server answered ${res.status}.`), { final: !!data.error });
    } finally { clearTimeout(timer); }
  }
  // A dropped connection is tried again (twice); the script's own "no" isn't.
  async function postAgain(payload, tries = 3) {
    for (let n = 1; ; n++) {
      try { return await post(payload); } catch (e) { if (e.final || n >= tries || stopped) throw e; await sleep(1500 * n); }
    }
  }

  // ---------- encrypt and send ----------
  const btn = $('#btn-send');
  const btnHtml = btn.innerHTML;
  const bar = $('#send-bar');
  const msg = $('#send-msg');
  let busy = false;
  const setBar = (p) => { const pct = Math.round(p * 100); bar.style.setProperty('--p', `${pct}%`); bar.setAttribute('aria-valuenow', String(pct)); };
  const lockForm = (on) => $$('input, select, textarea, button', form).forEach((el) => { el.disabled = on; });
  addEventListener('beforeunload', (e) => { if (busy) { e.preventDefault(); e.returnValue = ''; } });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || val('company')) return;   // company: the spam trap
    if (!check()) return;
    busy = true;
    stopped = false;
    const list = allFiles();
    const homeId = val('home');
    const h = D.homes[homeId];
    lockForm(true);
    btn.innerHTML = '<span class="spinner"></span> Encrypting…';
    $('#send-status').hidden = false;
    msg.className = 'form-msg';
    msg.textContent = 'Locking your documents with a key made on this device…';
    setBar(0);
    try {
      const office = await VC.officePublic(D.office);
      const sealed = await VC.lockSubmission({ files: list, message: val('message'), office });
      btn.innerHTML = '<span class="spinner"></span> Sending…';
      msg.textContent = 'Uploading your encrypted documents. Please keep this page open.';
      const { ref, up } = await postAgain({
        action: 'docs-start', name: val('name'), email: val('email'), phone: val('phone'),
        home: h ? `${h.name}, ${h.street}` : 'Another home, or not sure yet', homeName: h ? h.name : '', header: sealed.header,
      });
      // a forms script from before secure uploads answers like a plain form: stop before sending any pieces
      if (!/^VPM-[0-9A-Z]{6}$/.test(ref || '') || !/^[0-9a-f]{64}$/.test(up || '')) throw Object.assign(new Error('Secure uploads aren’t switched on yet'), { final: true });
      const sizes = sealed.header.parts.map((p) => p.n);
      const all = sizes.reduce((a, b) => a + b, 0);
      let sent = 0;
      let next = 0;
      const worker = async () => {
        while (!stopped && next < sealed.pieces.length) {
          const i = next++;
          await postAgain({ action: 'docs-part', ref, up, i, data: VC.b64(sealed.pieces[i]) });
          sent += sizes[i];
          setBar(sent / all);
          msg.textContent = `Uploading your encrypted documents: ${Math.round((sent / all) * 100)}%. Please keep this page open.`;
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(3, sealed.pieces.length) }, worker));
      } catch (err) { stopped = true; throw err; }
      msg.textContent = 'Checking that everything arrived…';
      const fin = await postAgain({ action: 'docs-finish', ref, up });
      if (fin.ref !== ref || fin.saved !== list.length) throw Object.assign(new Error('The upload didn’t finish.'), { final: true });
      busy = false;
      showDone(ref, sealed.key, list.length);
      track('secure_documents_sent', { documents: list.length, home_id: homeId });
    } catch (err) {
      stopped = true;
      busy = false;
      lockForm(false);
      btn.innerHTML = btnHtml;
      msg.className = 'form-msg error';
      msg.textContent = `Sorry, your documents didn’t go through (${err && err.final ? err.message : 'the connection dropped'}). They’re still here: press “Encrypt and send” to try again, or text ${C.person} at ${C.phoneLabel}.`;
    }
  });

  // ---------- the thank-you: reference and key, shown once ----------
  let receipt = null;
  function showDone(ref, key, n) {
    receipt = { ref, key, n, at: new Date().toISOString() };
    $('#sd-title').textContent = `Thank you, ${val('name').split(/\s+/)[0]}!`;
    $('#sd-text').textContent = `Your ${n === 1 ? 'document was' : `${n} documents were`} encrypted and received. ${C.person} will review ${n === 1 ? 'it' : 'them'} with your application.`;
    $('#sd-ref').textContent = ref;
    $('#sd-key').textContent = key;
    allFiles().forEach((f) => { if (f.url) URL.revokeObjectURL(f.url); });
    Object.keys(files).forEach((k) => delete files[k]);
    form.hidden = true;
    $('.sec-points').hidden = true;
    const done = $('#sec-done');
    done.hidden = false;
    $('#open-form').elements.oref.value = ref;
    scrollTo({ top: 0, behavior: 'smooth' });
    done.focus({ preventScroll: true });
  }
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($(`#${b.dataset.copy}`).textContent, b.dataset.what)));
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  $('#sd-save').addEventListener('click', () => {
    if (!receipt) return;
    const text = [
      `${C.name}: secure documents`,
      '',
      `Reference:    ${receipt.ref}`,
      `Private key:  ${receipt.key}`,
      `Sent:         ${when(receipt.at)} (Vancouver time)`,
      `Documents:    ${receipt.n}`,
      '',
      `To open them again: ${C.site}/secure-upload#open`,
      '',
      'Your documents were encrypted on your device with this key before they were sent.',
      `Keep it private: you don’t need to send it to anyone. ${C.name} opens your documents with its own key.`,
      '',
    ].join('\r\n');
    saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${C.name} documents ${receipt.ref}.txt`);
  });

  // ---------- open documents you've sent ----------
  const openBox = $('#sec-open');
  const openForm = $('#open-form');
  const openOut = $('#open-out');
  const openMsg = $('#open-msg');
  if (location.hash === '#open') openBox.open = true;
  addEventListener('hashchange', () => { if (location.hash === '#open') { openBox.open = true; openBox.scrollIntoView({ behavior: 'smooth' }); } });
  openForm.addEventListener('input', clear);
  openForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { oref, okey } = openForm.elements;
    const ref = VC.readRef(oref.value);
    const keyOk = !!VC.readKey(okey.value);
    oref.closest('.field').classList.toggle('invalid', !ref);
    okey.closest('.field').classList.toggle('invalid', !keyOk);
    if (!ref || !keyOk) return;
    const b = $('#btn-open');
    b.disabled = true;
    openMsg.className = 'form-msg';
    openMsg.textContent = 'Opening…';
    openOut.hidden = true;
    try {
      const access = await VC.accessCode(okey.value);
      const r = await post({ action: 'docs-open', ref, access });
      const K = await VC.keyFromApplicant(r.header, okey.value);
      const man = await VC.readManifest(r.header, K);
      openMsg.textContent = '';
      showOpened(r, man, K, access);
    } catch (err) {
      openMsg.className = 'form-msg error';
      openMsg.textContent = err && err.final ? err.message : 'Couldn’t open them. Check your connection and try again.';
    } finally { b.disabled = false; }
  });
  function showOpened(r, man, K, access) {
    const firsts = [];
    let at = 0;
    man.files.forEach((f) => { firsts.push(at); at += f.pieces; });
    openOut.innerHTML = `<div class="open-head"><b>${esc(r.name)}${r.home ? ` · ${esc(r.home)}` : ''}</b><span>Sent ${esc(when(r.created))} · ${esc(r.ref)}</span></div>
      ${man.message ? `<p class="open-note">${esc(man.message)}</p>` : ''}
      <ul class="dl-list">${man.files.map((f, i) => `<li><span class="ext">${esc(ext(f.name))}</span><span class="nm"><b>${esc(f.name)}</b><span>${f.label ? `${esc(f.label)} · ` : ''}${human(f.size)}</span></span><span class="acts"><button type="button" class="btn btn-ghost" data-dl="${i}">Download</button></span></li>`).join('')}</ul>`;
    openOut.hidden = false;
    $$('[data-dl]', openOut).forEach((b) => b.addEventListener('click', async () => {
      const i = Number(b.dataset.dl);
      const f = man.files[i];
      b.disabled = true;
      try {
        const parts = [];
        for (let c = 0; c < f.pieces; c++) {
          b.textContent = f.pieces > 1 ? `${Math.round((c / f.pieces) * 100)}%` : 'Opening…';
          const g = await post({ action: 'docs-get', ref: r.ref, access, i: firsts[i] + c });
          parts.push(await VC.readPiece(K, g.data, i, c));
        }
        saveBlob(new Blob(parts, { type: f.type || 'application/octet-stream' }), f.name);
        b.textContent = 'Download again';
      } catch (err) {
        b.textContent = 'Try again';
        openMsg.className = 'form-msg error';
        openMsg.textContent = err && err.final ? err.message : `Couldn’t download ${f.name}. Check your connection and try again.`;
      } finally { b.disabled = false; }
    }));
  }
})();
