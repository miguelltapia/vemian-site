// Rental application: one step at a time, answers checked as you go, documents resized in the browser,
// a review screen, then everything is sent in one message (see common.js send()).
(() => {
  const { $, $$, esc, track, avail, money, send, toast, share, config: C } = window.V;
  const HOMES = JSON.parse($('#apply-data').textContent);
  const form = $('#app-form');
  if (!form) return;
  const steps = $$('.step', form);
  const DRAFT = 'vemian-application-draft';
  const NO_SAVE = new Set(['sin', 'dl', 'company']);
  const MAX_FILE = 10 * 1024 * 1024;
  const MAX_TOTAL = 20 * 1024 * 1024;
  const params = new URLSearchParams(location.search);
  let at = 0;
  let reached = 0;
  const files = {}; // zone id -> [{ name, type, size, data }]

  // ---------- small helpers ----------
  const val = (name) => {
    const els = $$(`[name="${name}"]`, form);
    if (!els.length) return '';
    if (els[0].type === 'radio') return els.find((e) => e.checked)?.value || '';
    if (els[0].type === 'checkbox') return els[0].checked;
    return els[0].value.trim();
  };
  const visible = (el) => !el.closest('[hidden]');
  // shown within its own step (steps other than the current one are hidden, but their answers still count)
  const inStep = (el) => { for (let n = el; n && !n.classList.contains('step'); n = n.parentElement) if (n.hidden) return false; return true; };
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };
  const nowYM = () => { const t = new Date(); return t.getFullYear() * 12 + t.getMonth(); };

  // ---------- the home on the side ----------
  function showHome() {
    const id = val('home');
    const h = HOMES[id];
    const side = $('#side-home');
    if (!side) return;
    if (!h) {
      side.innerHTML = `<div class="bd"><span class="eyebrow">Your application</span><h2>${id === 'other' ? 'Another home' : 'Pick a home to start'}</h2><p>${id === 'other' ? 'Add its address below.' : 'Choose the home you’d like to rent in step 1.'}</p></div>`;
      return;
    }
    const a = avail(h.av);
    side.innerHTML = `<img src="${h.img}" alt="${esc(h.t)}" width="400" height="267"><div class="bd"><span class="eyebrow">Applying for</span><h2>${esc(h.name)}</h2><p>${esc(h.t)} · ${esc(h.street)}, ${esc(h.area)}</p><p class="rent">${money(h.rent)}/month · ${esc(a.now ? 'Available now' : a.short)}</p></div>`;
    $$('[data-share-link]').forEach((el) => { el.dataset.shareLink = `${C.site}/apply?home=${encodeURIComponent(id)}`; });
    const petsWarn = $('#pets-warn');
    if (petsWarn) petsWarn.hidden = !(val('pets') === 'yes' && h.pets === false);
  }

  // ---------- show/hide what depends on an answer ----------
  function sync() {
    $$('[data-show-if]', form).forEach((el) => {
      const [name, want] = el.dataset.showIf.split('=');
      const v = val(name);
      const show = want === undefined ? !!v : (want.startsWith('!') ? String(v) !== want.slice(1) : String(v) === want);
      el.hidden = !show;
    });
    // the address is only asked for homes in Canada or the US
    const abroad = val('abroad');
    $$('[data-local]', form).forEach((el) => { el.hidden = abroad === true; });
    // previous home when the current one is less than 2 years old
    const mi = ym('movedIn');
    $('#prev-home').hidden = abroad === true || !(mi && nowYM() - mi < 24);
    // one name box per extra adult
    const adults = Number(val('adults') || 1);
    $$('[data-renter]', form).forEach((el) => {
      const n = Number(el.dataset.renter);
      el.hidden = n > adults;
      $('input', el).required = n <= adults;
    });
    $('#extra-adults').hidden = adults < 2;
    const you = [val('firstName'), val('lastName')].filter(Boolean).join(' ');
    $('#renter-you').textContent = you || 'You (from step 2)';
    $('#homes-other').hidden = val('home') !== 'other';
    showHome();
  }

  // mm / yyyy and dd / mm / yyyy groups
  function ym(name) {
    const m = Number($(`[name="${name}M"]`, form)?.value);
    const y = Number($(`[name="${name}Y"]`, form)?.value);
    return m >= 1 && m <= 12 && y >= 1940 && y <= 2100 ? y * 12 + (m - 1) : null;
  }
  function dob() {
    const d = Number(val('dobD')); const m = Number(val('dobM')); const y = Number(val('dobY'));
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (!(y >= 1900 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d)) return null;
    return dt;
  }
  // move focus forward as people type the date parts
  $$('[data-auto-next]', form).forEach((inp) => inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/\D/g, '');
    if (inp.value.length >= Number(inp.maxLength)) $(`#${inp.dataset.autoNext}`)?.focus();
  }));
  $$('input[inputmode="numeric"]:not([data-auto-next])', form).forEach((inp) => inp.addEventListener('input', () => {
    if (inp.dataset.money !== undefined) {
      const digits = inp.value.replace(/\D/g, '');
      inp.value = digits ? Number(digits).toLocaleString('en-CA') : '';
    } else inp.value = inp.value.replace(/\D/g, '');
  }));

  // ---------- checking a step ----------
  const phoneOk = (v) => v.replace(/\D/g, '').length >= 10;
  const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v);
  function checkField(f) {
    if (!visible(f)) { f.classList.remove('invalid'); return true; }
    let ok = true;
    const kind = f.dataset.check;
    const inputs = $$('input, select, textarea', f).filter((i) => i.type !== 'hidden');
    if (kind === 'dob') {
      const d = dob();
      const age = d ? (Date.now() - d.getTime()) / 31557600000 : 0;
      ok = !!d && age >= 15 && age < 110;
    } else if (kind === 'ym') {
      const name = f.dataset.name;
      const v = ym(name);
      ok = v !== null || (!f.dataset.req && !$$('input', f).some((i) => i.value));
      if (ok && v !== null && name === 'movedIn') ok = v <= nowYM();
      if (ok && v !== null && name === 'movingOut') { const mi = ym('movedIn'); ok = mi === null || v >= mi; }
    } else if (kind === 'choice') {
      ok = !f.dataset.req || inputs.some((i) => i.checked);
    } else {
      const el = inputs[0];
      if (!el) return true;
      const v = el.value.trim();
      ok = el.checkValidity() && !(el.required && !v);
      if (ok && v && el.type === 'tel') ok = phoneOk(v);
      if (ok && v && el.type === 'email') ok = emailOk(v);
      if (ok && v && el.type === 'date' && el.min) ok = v >= el.min;
    }
    f.classList.toggle('invalid', !ok);
    return ok;
  }
  function checkStep(i) {
    let first = null;
    $$('.field', steps[i]).forEach((f) => { if (!checkField(f) && !first) first = f; });
    $$('.agree', steps[i]).forEach((g) => {
      const ok = $('input', g).checked;
      g.classList.toggle('invalid', !ok);
      if (!ok && !first) first = g;
    });
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => $('input:not([type=hidden]), select, textarea', first)?.focus({ preventScroll: true }), 300);
    }
    return !first;
  }
  form.addEventListener('input', (e) => {
    const f = e.target.closest('.field');
    if (!f) return;
    f.dataset.touched = '1';
    if (f.classList.contains('invalid')) checkField(f);
  });
  form.addEventListener('change', (e) => {
    const f = e.target.closest('.field');
    if (f?.classList.contains('invalid')) checkField(f);
    const g = e.target.closest('.agree');
    if (g) g.classList.toggle('invalid', !e.target.checked);
    sync();
    save();
  });
  // check a field once the person has typed in it and moved on
  form.addEventListener('focusout', (e) => {
    const f = e.target.closest('.field');
    if (f && f.dataset.touched && !f.contains(e.relatedTarget)) checkField(f);
  });

  // ---------- moving between steps ----------
  function go(i, { focus = true } = {}) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    reached = Math.max(reached, at);
    steps.forEach((s, n) => { s.hidden = n !== at; });
    const title = steps[at].dataset.title;
    $('#prog-step').textContent = `Step ${at + 1} of ${steps.length}`;
    $('#prog-title').textContent = title;
    $('#prog-bar').style.width = `${((at + 1) / steps.length) * 100}%`;
    $$('.stepdots button').forEach((b, n) => {
      b.classList.toggle('done', n < at || (n <= reached && n !== at));
      b.disabled = n > reached;
      if (n === at) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    $('#btn-back').hidden = at === 0;
    $('#btn-next').hidden = at === steps.length - 1;
    $('#btn-send').hidden = at !== steps.length - 1;
    if (at === steps.length - 1) review();
    if (focus) {
      const top = $('.progress').getBoundingClientRect().top + scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h'), 10) || 68) - 4;
      if (scrollY > top) scrollTo({ top, behavior: 'smooth' });
      setTimeout(() => $('h2', steps[at]).focus({ preventScroll: true }), 250);
    }
    track('application_step', { step: at + 1, step_title: title });
  }
  $('#btn-next').addEventListener('click', () => { if (checkStep(at)) { save(); go(at + 1); } });
  $('#btn-back').addEventListener('click', () => go(at - 1));
  $$('.stepdots button').forEach((b, n) => b.addEventListener('click', () => { if (n <= reached) go(n); }));
  $$('[data-goto]', form).forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.goto))));

  // ---------- documents ----------
  const human = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const total = () => Object.values(files).flat().reduce((s, f) => s + f.size, 0);
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
  const toB64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  function drawZone(zone) {
    const list = $('.files', zone);
    const items = files[zone.id] || [];
    list.innerHTML = items.map((f, i) => `<li>${f.type.startsWith('image/') ? `<img src="data:${f.type};base64,${f.data}" alt="">` : `<span class="ext">${esc((f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase())}</span>`}
      <span class="nm">${esc(f.name)}</span><span class="sz">${human(f.size)}</span>
      <button type="button" data-remove="${i}" aria-label="Remove ${esc(f.name)}"><svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg></button></li>`).join('');
  }
  async function addFiles(zone, list) {
    const msg = $('#doc-msg');
    msg.textContent = '';
    for (const raw of list) {
      if (!/^image\/|^application\/pdf$/.test(raw.type) && !/\.(heic|heif|pdf|jpe?g|png|webp)$/i.test(raw.name)) { msg.textContent = `${raw.name}: please use a photo or a PDF.`; continue; }
      const f = await shrink(raw);
      if (f.size > MAX_FILE) { msg.textContent = `${raw.name} is over 10 MB. Try a smaller photo or PDF, or email it to ${C.email}.`; continue; }
      if (total() + f.size > MAX_TOTAL) { msg.textContent = `That’s more than 20 MB in total. Send the rest to ${C.email} after you apply.`; break; }
      (files[zone.id] ||= []).push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, data: await toB64(f), field: zone.dataset.label });
    }
    drawZone(zone);
    $('#doc-total').textContent = total() ? `${human(total())} of 20 MB used` : '';
  }
  $$('.drop', form).forEach((zone) => {
    const input = $('input[type=file]', zone);
    $('[data-pick]', zone).addEventListener('click', () => input.click());
    input.addEventListener('change', () => { addFiles(zone, [...input.files]); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles(zone, [...e.dataTransfer.files]); });
    zone.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-remove]');
      if (!rm) return;
      files[zone.id].splice(Number(rm.dataset.remove), 1);
      drawZone(zone);
      $('#doc-total').textContent = total() ? `${human(total())} of 20 MB used` : '';
    });
  });

  // ---------- what was entered, section by section (review screen and the email) ----------
  function display(f) {
    const kind = f.dataset.check;
    if (kind === 'dob') { const d = dob(); return d ? `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : ''; }
    if (kind === 'ym') { const v = ym(f.dataset.name); return v === null ? '' : `${pad((v % 12) + 1)}/${Math.floor(v / 12)}`; }
    if (kind === 'choice') return $$('input:checked', f).map((i) => i.closest('label')?.textContent.trim()).join(', ');
    const el = $('input, select, textarea', f);
    if (!el || el.type === 'file') return '';
    if (el.tagName === 'SELECT') return el.value ? el.selectedOptions[0].textContent.trim() : '';
    if (el.type === 'checkbox') return el.checked ? 'Yes' : '';
    if (el.type === 'date') return fmtDate(el.value);
    if (el.dataset.money !== undefined && el.value) return `$${el.value}`;
    return el.value.trim();
  }
  function collect({ forEmail = false } = {}) {
    const out = [];
    $$('[data-section]', form).forEach((sec) => {
      if (!inStep(sec)) return;
      const rows = [];
      $$('.field', sec).forEach((f) => {
        if (!inStep(f) || f.closest('[data-section]') !== sec) return;
        const v = display(f);
        if (v) rows.push([f.dataset.label || $('label, legend', f)?.textContent.replace(/\(optional\)/, '').trim(), v]);
      });
      if (sec.dataset.section === 'Who’s moving in') rows.unshift(['Renter #1', $('#renter-you').textContent]);
      if (sec.dataset.section === 'The home') {
        const h = HOMES[val('home')];
        rows[0] = ['Home', h ? `${h.name}, ${h.street} (${money(h.rent)}/mo)` : `Another home: ${val('otherHome')}`];
      }
      if (rows.length) out.push({ title: sec.dataset.section, rows, step: Number(sec.closest('.step').dataset.index) });
    });
    const docs = Object.values(files).flat();
    out.push({ title: 'Documents', rows: docs.length ? docs.map((d) => [d.field, `${d.name} (${human(d.size)})`]) : [['Documents', 'None sent yet']], step: 5 });
    if (forEmail) {
      const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short' });
      out.push({ title: 'Agreements', rows: [
        ['Agreement #1', val('agree1') ? `Agreed on ${when} (Vancouver time)` : 'Not agreed'],
        ['Agreement #2', val('agree2') ? `Agreed on ${when} (Vancouver time)` : 'Not agreed'],
        ['Early access to new rentals by email', val('alerts') ? 'Yes' : 'No'],
      ] });
    }
    return out;
  }
  function review() {
    $('#review').innerHTML = collect().map((s) => `<div class="rv"><div class="rv-head"><h3>${esc(s.title)}</h3>${Number.isInteger(s.step) ? `<button type="button" class="link" data-goto="${s.step}">Edit</button>` : ''}</div>
      <dl>${s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'S.I.N.' || k === 'Social Insurance Number' ? '•••••' + esc(String(v).slice(-3)) : esc(v)}</dd>`).join('')}</dl></div>`).join('');
    $$('#review [data-goto]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.goto))));
  }

  // ---------- draft: kept for this browser tab only, never the SIN, licence or documents ----------
  function save() {
    try {
      const data = {};
      $$('input, select, textarea', form).forEach((el) => {
        if (!el.name || NO_SAVE.has(el.name) || el.type === 'file') return;
        if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
        else if (el.type === 'checkbox') data[el.name] = el.checked;
        else data[el.name] = el.value;
      });
      data._at = at;
      sessionStorage.setItem(DRAFT, JSON.stringify(data));
    } catch { /* storage blocked */ }
  }
  function restore() {
    let data = null;
    try { data = JSON.parse(sessionStorage.getItem(DRAFT) || 'null'); } catch { /* ignore */ }
    if (!data) return false;
    Object.entries(data).forEach(([k, v]) => {
      $$(`[name="${k}"]`, form).forEach((el) => {
        if (el.type === 'radio') el.checked = el.value === v;
        else if (el.type === 'checkbox') el.checked = !!v;
        else el.value = v;
      });
    });
    return data._at || 0;
  }

  // ---------- send ----------
  $('#btn-send').addEventListener('click', async () => {
    if (!checkStep(at)) return;
    if (val('company')) return; // honeypot
    const h = HOMES[val('home')];
    const name = [val('firstName'), val('lastName')].join(' ');
    const homeLabel = h ? `${h.name}, ${h.street}` : `Another home: ${val('otherHome')}`;
    const btn = $('#btn-send');
    const status = $('#send-status');
    btn.disabled = true;
    $('#btn-back').disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';
    status.hidden = false;
    $('#send-bar').hidden = false;
    $('#send-msg').textContent = Object.keys(files).length ? 'Sending your application and documents. This can take up to a minute.' : 'Sending your application…';
    $('#send-msg').className = 'form-msg';
    try {
      const how = await send({
        type: 'application',
        subject: `Application · ${h ? h.name : 'another home'} · ${name}`,
        name, email: val('email'), phone: val('phone'), replyTo: val('email'), home: homeLabel,
        message: val('comments'), alerts: val('alerts'),
        sections: collect({ forEmail: true }).map(({ title, rows }) => ({ title, rows })),
        files: Object.values(files).flat(),
      });
      try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ }
      $('#app-flow').hidden = true;
      const done = $('#app-done');
      done.hidden = false;
      $('#done-title').textContent = how === 'sent' ? `Thank you, ${val('firstName')}!` : 'Almost there';
      $('#done-text').textContent = how === 'sent'
        ? `Your application for ${homeLabel} is with ${C.person}. He’ll review it and contact you about next steps by phone or email.`
        : 'Your email app opened with your application filled in. Press send to deliver it, and attach your documents to the same email.';
      $('#done-adults').hidden = Number(val('adults') || 1) < 2;
      scrollTo({ top: 0, behavior: 'smooth' });
      done.focus();
      track('application_submit', { home_id: val('home'), adults: Number(val('adults') || 1), documents: Object.values(files).flat().length, method: how });
    } catch {
      $('#send-msg').textContent = `Sorry, your application didn’t go through. Please try again, or text ${C.person} at ${C.phoneLabel}.`;
      $('#send-msg').className = 'form-msg error';
      btn.disabled = false;
      $('#btn-back').disabled = false;
      btn.textContent = 'Send my application';
      $('#send-bar').hidden = true;
    }
  });

  // copy the application link for the other adults
  $$('[data-share-link]').forEach((b) => b.addEventListener('click', () => share(b.dataset.shareLink || `${C.site}/apply`, 'Rental application | Vemian')));
  $$('[data-restart]').forEach((b) => b.addEventListener('click', () => {
    try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ }
    location.href = location.pathname + (val('home') && val('home') !== 'other' ? `?home=${encodeURIComponent(val('home'))}` : '');
  }));

  // ---------- start ----------
  const start = $('#start-date');
  if (start) start.min = window.V.todayISO();
  const restoredAt = restore();
  const want = params.get('home');
  if (want && (HOMES[want] || want === 'other')) {
    const r = $(`input[name="home"][value="${CSS.escape(want)}"]`, form);
    if (r) r.checked = true;
  }
  // a home already chosen: show just that one, with a link to pick another
  const picker = $('.homes-pick', form);
  const more = $('#pick-more');
  if (val('home') && val('home') !== 'other') {
    picker.classList.add('collapsed');
    more.hidden = false;
  }
  more.addEventListener('click', () => {
    picker.classList.remove('collapsed');
    more.hidden = true;
    $('input[name="home"]:checked', picker)?.closest('.pick')?.scrollIntoView({ block: 'nearest' });
  });
  sync();
  if (restoredAt !== false) {
    $('#restored').hidden = false;
    reached = Number(restoredAt);
    go(Number(restoredAt), { focus: false });
  } else go(0, { focus: false });
  if (!C.endpoint) console.info('Vemian: no form endpoint set in source/config.mjs, so forms open the visitor’s email app.');
})();
