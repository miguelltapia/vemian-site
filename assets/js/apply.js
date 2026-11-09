// Rental application: one step at a time, answers checked as you go, documents resized in the browser,
// a review screen, then everything is sent in one message (see common.js send()).
// West End (Forth Gen) homes also sign Forth Gen's RentBC form here: extra questions marked data-rentbc, a signature
// pad, and an optional co-applicant who adds their part after the first applicant, on the same device or on their
// own phone, through a link (/apply?join=CODE). The forms script fills in the form (form-backend/RentBC.gs).
(() => {
  const { $, $$, esc, track, avail, money, send, toast, share, config: C } = window.V;
  const HOMES = JSON.parse($('#apply-data').textContent);
  const RB = JSON.parse($('#rentbc-data')?.textContent || '{}');
  const form = $('#app-form');
  if (!form) return;
  const steps = $$('.step', form);
  const params = new URLSearchParams(location.search);
  // A co-applicant's link: /apply?join=CODE&home=ID&with=FIRST NAME&d=MOVE-IN DATE&p=1 (parking stall).
  // Only the code counts on the server; the rest is for showing what they're signing.
  const JOIN = /^[A-Z2-9]{12}$/.test(params.get('join') || '') ? params.get('join') : '';
  const JOIN_HOME = JOIN ? params.get('home') || '' : '';
  const JOIN_WITH = JOIN ? (params.get('with') || '').trim().slice(0, 40) : '';
  const DRAFT = JOIN ? `vemian-application-draft-${JOIN}` : 'vemian-application-draft';
  const NO_SAVE = new Set(['sin', 'dl', 'company']);
  const MAX_FILE = 10 * 1024 * 1024;
  const MAX_TOTAL = 20 * 1024 * 1024;
  const order = steps.map((_, i) => i).filter((i) => !JOIN || i > 0);   // a co-applicant skips "The home"
  let at = order[0];
  let reached = 0;   // furthest position in order
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
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  };
  const nowYM = () => { const t = new Date(); return t.getFullYear() * 12 + t.getMonth(); };
  const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';
  const homeId = () => (JOIN ? JOIN_HOME : val('home'));
  // West End homes apply on Forth Gen's RentBC form (a co-applicant's link is always one)
  const isRB = () => !!JOIN || !!HOMES[val('home')]?.rb;
  const coChoice = () => (isRB() && !JOIN && Number(val('adults') || 1) >= 2 ? val('coApplicant') : '');
  const withCo = () => coChoice() === 'here' || coChoice() === 'link';

  // ---------- the home on the side ----------
  function showHome() {
    const id = homeId();
    const h = HOMES[id];
    const side = $('#side-home');
    if (!side) return;
    if (!h) {
      side.innerHTML = JOIN
        ? `<div class="bd"><span class="eyebrow">Co-applicant</span><h2>${esc(JOIN_WITH ? `${JOIN_WITH}’s application` : 'Joining an application')}</h2><p>Add your own details and sign at the end.</p></div>`
        : `<div class="bd"><span class="eyebrow">Your application</span><h2>${id === 'other' ? 'Another home' : 'Pick a home to start'}</h2><p>${id === 'other' ? 'Add its address below.' : 'Choose the home you’d like to rent in step 1.'}</p></div>`;
      return;
    }
    const a = avail(h.av);
    side.innerHTML = `<img src="${h.img}" alt="${esc(h.t)}" width="400" height="267"><div class="bd"><span class="eyebrow">${JOIN ? 'Applying with ' + esc(JOIN_WITH || 'your co-applicant') : 'Applying for'}</span><h2>${esc(h.name)}</h2><p>${esc(h.t)} · ${esc(h.street)}, ${esc(h.area)}</p><p class="rent">${money(h.rent)}/month · ${esc(a.now ? 'Available now' : a.short)}</p></div>`;
    $$('[data-share-link]').forEach((el) => { el.dataset.shareLink = `${C.site}/apply?home=${encodeURIComponent(id)}`; });
    const petsWarn = $('#pets-warn');
    if (petsWarn) petsWarn.hidden = JOIN || !(val('pets') === 'yes' && h.pets === false);
  }

  // ---------- show/hide what depends on an answer ----------
  function sync() {
    const rb = isRB();
    // data-show-if="name=value", data-rentbc (West End homes only), data-shared (once per application: not for a co-applicant)
    $$('[data-show-if], [data-rentbc], [data-shared]', form).forEach((el) => {
      let show = true;
      if (el.dataset.showIf) {
        const [name, want] = el.dataset.showIf.split('=');
        const v = val(name);
        show = want === undefined ? !!v : (want.startsWith('!') ? String(v) !== want.slice(1) : String(v) === want);
      }
      if (el.hasAttribute('data-rentbc') && !rb) show = false;
      if (el.hasAttribute('data-shared') && JOIN) show = false;
      el.hidden = !show;
    });
    // the address is only asked for homes in Canada or the US
    const abroad = val('abroad');
    $$('[data-local]', form).forEach((el) => { el.hidden = abroad === true; });
    // previous home when the current one is less than 2 years old
    const mi = ym('movedIn');
    $('#prev-home').hidden = abroad === true || !(mi && nowYM() - mi < 24);
    // one name box per extra adult, and per child for the RentBC form
    const adults = Number(val('adults') || 1);
    const minors = Number(val('minors') || 0);
    $$('[data-renter]', form).forEach((el) => {
      const n = Number(el.dataset.renter);
      el.hidden = n > adults;
      $('input', el).required = n <= adults;
    });
    $('#minor-names').hidden = !rb || !!JOIN || minors < 1;
    $$('[data-minor]', form).forEach((el) => {
      const n = Number(el.dataset.minor);
      el.hidden = n > minors;
      $('input', el).required = n <= minors;
    });
    // co-applicant: West End homes with 2 or more adults; Renter #2 is the one who joins
    const coQ = $('#co-q');
    coQ.hidden = !rb || !!JOIN || adults < 2;
    $('legend', coQ).textContent = `Will ${firstWord(val('renter2')) || 'Renter #2'} apply with you on the same form?`;
    $('#extra-adults').hidden = adults < (withCo() ? 3 : 2);
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

  // ---------- signature (RentBC form) ----------
  // Strokes are kept in the pad's CSS pixels and sent as [[x, y, x, y, ...], ...]; the script draws them on the form.
  const sig = (() => {
    const box = $('#sig');
    if (!box) return null;
    const cv = $('canvas', box);
    const ctx = cv.getContext('2d');
    const typed = $('#sig-typed');
    let strokes = [];
    let cur = null;
    let typing = false;
    const pt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1b2f6e';
      strokes.forEach((s) => {
        ctx.beginPath();
        ctx.moveTo(s[0][0], s[0][1]);
        if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
        for (let i = 1; i < s.length - 1; i++) ctx.quadraticCurveTo(s[i][0], s[i][1], (s[i][0] + s[i + 1][0]) / 2, (s[i][1] + s[i + 1][1]) / 2);
        if (s.length > 1) ctx.lineTo(s[s.length - 1][0], s[s.length - 1][1]);
        ctx.stroke();
      });
    }
    function resize() {
      const r = cv.getBoundingClientRect();
      if (!r.width) return;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      draw();
    }
    const changed = () => { if (box.classList.contains('invalid')) checkField(box); };
    cv.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      cur = [pt(e)];
      strokes.push(cur);
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!cur) return;
      (e.getCoalescedEvents?.() || [e]).forEach((ev) => {
        const p = pt(ev);
        const last = cur[cur.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.5) cur.push(p);
      });
      draw();
    });
    const end = () => { if (cur) { cur = null; changed(); } };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => cv.addEventListener(t, end));
    $('[data-sig-clear]', box).addEventListener('click', () => { strokes = []; typed.value = ''; draw(); });
    $('[data-sig-mode]', box).addEventListener('click', (e) => {
      typing = !typing;
      $('.sig-pad', box).hidden = typing;
      $('#sig-h').hidden = typing;
      $('.sig-typed', box).hidden = !typing;
      e.currentTarget.textContent = typing ? 'Draw your signature instead' : 'Type your name instead';
      if (typing) { typed.placeholder = [val('firstName'), val('middleName'), val('lastName')].filter(Boolean).join(' '); typed.focus(); } else resize();
      changed();
    });
    typed.addEventListener('input', changed);
    addEventListener('resize', () => { if (visible(cv)) resize(); });
    const length = () => strokes.reduce((n, s) => n + s.slice(1).reduce((m, p, i) => m + Math.hypot(p[0] - s[i][0], p[1] - s[i][1]), 0), 0);
    return {
      resize,
      ok: () => (typing ? typed.value.trim().length >= 2 : length() >= 40),
      value: () => (typing
        ? { kind: 'type', text: typed.value.trim() }
        : { kind: 'draw', s: strokes.map((s) => s.flatMap((p) => [Math.round(p[0]), Math.round(p[1])])) }),
      kind: () => (typing ? 'typed' : 'drawn'),
    };
  })();

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
      if (ok && v !== null && (name === 'movedIn' || name === 'jobStart')) ok = v <= nowYM();
      if (ok && v !== null && name === 'movingOut') { const mi = ym('movedIn'); ok = mi === null || v >= mi; }
    } else if (kind === 'choice') {
      ok = !f.dataset.req || inputs.some((i) => i.checked);
    } else if (kind === 'sig') {
      ok = !sig || sig.ok();
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
      setTimeout(() => $('input:not([type=hidden]):not([readonly]), select, textarea', first)?.focus({ preventScroll: true }), 300);
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
  const pos = () => order.indexOf(at);
  function go(i, { focus = true } = {}) {
    const p = Math.max(0, Math.min(order.length - 1, Math.max(0, order.indexOf(i))));
    at = order[p];
    reached = Math.max(reached, p);
    steps.forEach((s, n) => { s.hidden = n !== at; });
    const title = steps[at].dataset.title;
    $('#prog-step').textContent = `Step ${p + 1} of ${order.length}`;
    $('#prog-title').textContent = title;
    $('#prog-bar').style.width = `${((p + 1) / order.length) * 100}%`;
    $$('.stepdots button').forEach((b, n) => {
      const q = order.indexOf(n);
      b.hidden = q < 0;
      if (q < 0) return;
      b.textContent = `${q + 1}. ${steps[n].dataset.title}`;
      b.classList.toggle('done', q < p || (q <= reached && q !== p));
      b.disabled = q > reached;
      if (q === p) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    const last = p === order.length - 1;
    $('#btn-back').hidden = p === 0;
    $('#btn-next').hidden = last;
    $('#btn-send').hidden = !last;
    if (last) review();
    if (focus) {
      const top = $('.progress').getBoundingClientRect().top + scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h'), 10) || 68) - 4;
      if (scrollY > top) scrollTo({ top, behavior: 'smooth' });
      setTimeout(() => $('h2', steps[at]).focus({ preventScroll: true }), 250);
    }
    track('application_step', { step: p + 1, step_title: title, rentbc: isRB(), co_applicant: !!JOIN });
  }
  $('#btn-next').addEventListener('click', () => { if (checkStep(at)) { save(); go(order[pos() + 1]); } });
  $('#btn-back').addEventListener('click', () => go(order[pos() - 1]));
  $$('.stepdots button').forEach((b, n) => b.addEventListener('click', () => { const q = order.indexOf(n); if (q >= 0 && q <= reached) go(n); }));
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
    if (kind === 'dob') { const d = dob(); return d ? `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}` : ''; }
    if (kind === 'ym') { const v = ym(f.dataset.name); return v === null ? '' : `${pad2((v % 12) + 1)}/${Math.floor(v / 12)}`; }
    if (kind === 'choice') return $$('input:checked', f).map((i) => i.closest('label')?.textContent.trim()).join(', ');
    if (kind === 'sig') return '';
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
    if (JOIN) {
      const h = HOMES[JOIN_HOME];
      out.push({ title: 'Co-applicant', rows: [['Applying with', JOIN_WITH || 'The first applicant (see their email)'], ['Home', h ? `${h.name}, ${h.street} (${money(h.rent)}/mo)` : JOIN_HOME], ['Link code', JOIN]] });
    }
    $$('[data-section]', form).forEach((sec) => {
      if (!inStep(sec)) return;
      if (JOIN && sec.dataset.section === 'The home') return;
      const rows = [];
      $$('.field', sec).forEach((f) => {
        if (!inStep(f) || f.closest('[data-section]') !== sec) return;
        const v = display(f);
        if (v) rows.push([f.dataset.label || $('label, legend', f)?.textContent.replace(/\(optional\)/, '').trim(), v]);
      });
      if (sec.dataset.section === 'Who’s moving in' && !JOIN) rows.unshift(['Renter #1', $('#renter-you').textContent]);
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
      const rows = [
        ['Agreement #1', val('agree1') ? `Agreed on ${when} (Vancouver time)` : 'Not agreed'],
        ['Agreement #2', val('agree2') ? `Agreed on ${when} (Vancouver time)` : 'Not agreed'],
      ];
      if (isRB()) rows.push(['Forth Gen’s RentBC form', `Signed on this website (${sig?.kind() || 'drawn'} signature), on ${when}`]);
      rows.push(['Early access to new rentals by email', val('alerts') ? 'Yes' : 'No']);
      out.push({ title: 'Agreements', rows });
    }
    return out;
  }
  function review() {
    $('#review').innerHTML = collect().map((s) => `<div class="rv"><div class="rv-head"><h3>${esc(s.title)}</h3>${Number.isInteger(s.step) ? `<button type="button" class="link" data-goto="${s.step}">Edit</button>` : ''}</div>
      <dl>${s.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'S.I.N.' || k === 'Social Insurance Number' ? '•••••' + esc(String(v).slice(-3)) : esc(v)}</dd>`).join('')}</dl></div>`).join('');
    $$('#review [data-goto]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.goto))));
    rbSummary();
    if (isRB()) requestAnimationFrame(() => sig?.resize());
  }

  // What signing Forth Gen's form means, in plain words (Section A and the form's statements)
  function rbSummary() {
    const el = $('#rb-summary');
    const h = HOMES[homeId()];
    const L = h?.rb && RB[h.rb.ll];
    if (!el) return;
    if (!L) { el.innerHTML = JOIN ? `<p>Your answers and signature go on Forth Gen’s Application for Tenancy, the RentBC form landlords use in BC, together with ${esc(JOIN_WITH || 'the first applicant')}’s.</p>` : ''; return; }
    const park = JOIN ? params.get('p') === '1' : answers().parking === true;
    const start = JOIN ? params.get('d') || '' : val('startDate');
    const utilities = L.utilities.map((u, i) => (i ? u.toLowerCase() : u));
    const list = utilities.length > 1 ? `${utilities.slice(0, -1).join(', ')} and ${utilities[utilities.length - 1]}` : utilities.join('');
    el.innerHTML = `<p>Your answers and signature go on <b>Forth Gen’s Application for Tenancy</b>, the RentBC form landlords use in BC${JOIN ? `, on the same form as ${esc(JOIN_WITH || 'the first applicant')}` : ''}. ${esc(C.person)} passes it on to Forth Gen. By signing, you:</p>
      <ul>
        <li><b>Offer to rent ${esc(h.name)}</b> at ${money(h.rent)} a month${park ? ` plus ${money(L.parking)} for a parking stall` : ''}${/^\d{4}-\d{2}-\d{2}$/.test(start) ? `, from ${esc(fmtDate(start))}` : ''}. ${esc(list)} are included.</li>
        <li><b>Agree that if Forth Gen accepts, the offer is binding:</b> you’ll sign their tenancy agreement and pay a security deposit of ${money(Math.round(h.rent * L.deposit))}${L.deposit === 0.5 ? ' (half a month’s rent)' : ''}. If you then don’t sign it or move in, you may have to pay the rent they lose and related costs.</li>
        <li><b>Agree to these terms:</b> “${esc(L.terms)}”</li>
        <li><b>Let Forth Gen check</b> your credit, rental history and employment with the references you gave, and confirm that your answers are true and correct.</li>
      </ul>`;
  }

  // Every visible answer by field name, for the RentBC form (the script fills it in from these)
  function answers() {
    const out = {};
    $$('input, select, textarea', form).forEach((el) => {
      if (!el.name || el.type === 'file' || el.name === 'company' || !inStep(el)) return;
      if (JOIN && el.closest('.step')?.dataset.index === '0') return;
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; } else if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.value.trim()) out[el.name] = el.value.trim();
    });
    return out;
  }

  // ---------- draft: kept for this browser tab only, never the SIN, licence, documents or signature ----------
  function save() {
    try {
      const data = {};
      $$('input, select, textarea', form).forEach((el) => {
        if (!el.name || NO_SAVE.has(el.name) || el.type === 'file') return;
        if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; } else if (el.type === 'checkbox') data[el.name] = el.checked;
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
    if (data.middleInitial && !data.middleName) data.middleName = data.middleInitial;   // drafts from before 9 Nov 2026
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
    const rb = isRB();
    const h = HOMES[homeId()];
    const name = [val('firstName'), val('lastName')].join(' ');
    const homeLabel = h ? `${h.name}, ${h.street}` : JOIN ? `${JOIN_WITH ? JOIN_WITH + '’s' : 'An'} application` : `Another home: ${val('otherHome')}`;
    const co = coChoice();
    const btn = $('#btn-send');
    const status = $('#send-status');
    btn.disabled = true;
    $('#btn-back').disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';
    status.hidden = false;
    $('#send-bar').hidden = false;
    $('#send-msg').textContent = Object.keys(files).length ? 'Sending your application and documents. This can take up to a minute.' : 'Sending your application…';
    $('#send-msg').className = 'form-msg';
    const payload = {
      type: 'application',
      subject: `${JOIN ? 'Co-applicant' : 'Application'} · ${h ? h.name : 'another home'} · ${name}`,
      name, email: val('email'), phone: val('phone'), replyTo: val('email'), home: homeLabel,
      message: val('comments'), alerts: val('alerts'),
      sections: collect({ forEmail: true }).map(({ title, rows }) => ({ title, rows })),
      files: Object.values(files).flat(),
    };
    if (rb) {
      payload.rentbc = {
        homeId: homeId(),
        home: h?.rb ? { code: h.rb.code, name: h.name, suite: h.rb.suite, addr: h.rb.addr, rent: h.rent } : null,
        landlord: h?.rb ? RB[h.rb.ll] : null,
        form: answers(),
        sig: sig?.value() || null,
        agree: $$('.agree-text', form).map((t) => t.textContent.trim()),
        join: JOIN || undefined,
      };
    }
    try {
      const how = await send(payload);
      const reply = send.reply || {};
      // Keep the saved answers until the application has really arrived. The email-app fallback (no endpoint in
      // config.mjs) can't confirm that: on a phone without a mail app set up, nothing is sent at all.
      if (how === 'sent') { try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ } }
      $('#app-flow').hidden = true;
      const done = $('#app-done');
      done.hidden = false;
      $('#done-title').textContent = how === 'sent' ? `Thank you, ${val('firstName')}!` : 'One more step';
      $('#done-text').textContent = how !== 'sent'
        ? `Your email app should have opened with your application filled in: press send there, and attach your documents to the same email. If nothing opened, your answers are still here. Go back to them, or text ${C.person} at ${C.phoneLabel}.`
        : JOIN ? `Your part is with ${C.person}, on the same form as ${JOIN_WITH ? JOIN_WITH + '’s' : 'the first'} application. He’ll review it and contact you both about next steps.`
          : `Your application for ${homeLabel} is with ${C.person}${rb ? ', on Forth Gen’s form with your signature' : ''}. He’ll review it and contact you about next steps by phone or email.`;
      $('#done-back').hidden = how === 'sent';
      $('#done-home').hidden = how !== 'sent';
      $('#done-adults').hidden = JOIN || Number(val('adults') || 1) < (withCo() ? 3 : 2);
      if (how === 'sent' && reply.join && withCo()) showCoLink(reply.join, co);
      scrollTo({ top: 0, behavior: 'smooth' });
      done.focus();
      track('application_submit', { home_id: homeId(), adults: Number(val('adults') || 1), documents: Object.values(files).flat().length, method: how, rentbc: rb, co_applicant: JOIN ? 'joined' : co || 'none' });
    } catch {
      $('#send-msg').textContent = `Sorry, your application didn’t go through. Please try again, or text ${C.person} at ${C.phoneLabel}.`;
      $('#send-msg').className = 'form-msg error';
      btn.disabled = false;
      $('#btn-back').disabled = false;
      btn.textContent = 'Send my application';
      $('#send-bar').hidden = true;
    }
  });

  // After the first applicant sends: their co-applicant's link, to open here or send to the co-applicant's phone
  function showCoLink(code, co) {
    const coName = firstWord(val('renter2')) || 'your co-applicant';
    const q = new URLSearchParams({ join: code, home: val('home'), with: val('firstName'), d: val('startDate') });
    if (answers().parking === true) q.set('p', '1');
    const link = `${location.origin}/apply?${q}`;
    const box = $('#done-co');
    const start = $('#co-start');
    const shareBtn = $('#co-share');
    box.hidden = false;
    $('#co-link').value = link;
    start.href = link;
    start.textContent = co === 'here' ? `Start ${coName}’s part` : `${coName} is here? Start their part`;
    shareBtn.textContent = `Send ${coName} the link`;
    start.className = `btn ${co === 'here' ? 'btn-primary' : 'btn-ghost'}`;
    shareBtn.className = `btn ${co === 'here' ? 'btn-ghost' : 'btn-primary'}`;
    if (co !== 'here') start.before(shareBtn);
    $('#done-co-text').textContent = co === 'here'
      ? `Now it’s ${coName}’s turn: they add their own details and sign, here on this ${matchMedia('(pointer: coarse)').matches ? 'phone' : 'computer'}. ${C.person} then gets one form with both of you.`
      : `Text ${coName} this link. They add their own details and sign on their phone, and ${C.person} gets one form with both of you. The link works for 60 days.`;
    shareBtn.onclick = () => share(link, `Our rental application: add your part`);
  }

  // after the email-app fallback: back to the review step, answers intact
  $('#done-back').addEventListener('click', () => {
    $('#app-done').hidden = true;
    $('#app-flow').hidden = false;
    const btn = $('#btn-send');
    btn.disabled = false;
    btn.textContent = 'Send my application';
    $('#btn-back').disabled = false;
    $('#send-status').hidden = true;
    $('#btn-send').scrollIntoView({ block: 'center' });
  });

  // copy the application link for the other adults
  $$('[data-share-link]').forEach((b) => b.addEventListener('click', () => share(b.dataset.shareLink || `${C.site}/apply`, 'Rental application | Vemian')));
  $$('[data-restart]').forEach((b) => b.addEventListener('click', () => {
    try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ }
    location.href = JOIN ? location.pathname + location.search : location.pathname + (val('home') && val('home') !== 'other' ? `?home=${encodeURIComponent(val('home'))}` : '');
  }));

  // ---------- start ----------
  const start = $('#start-date');
  if (start) start.min = window.V.todayISO();
  const restoredAt = restore();
  const want = JOIN ? JOIN_HOME : params.get('home');
  if (want && (HOMES[want] || want === 'other')) {
    const r = $(`input[name="home"][value="${CSS.escape(want)}"]`, form);
    if (r) r.checked = true;
  }
  if (JOIN) {
    const h = HOMES[JOIN_HOME];
    // a co-applicant's steps leave out what the first applicant already answered
    $$('[data-co-text]').forEach((el) => { el.textContent = el.dataset.coText.replace('{with}', JOIN_WITH || 'The first applicant'); });
    steps.forEach((s) => { if (s.dataset.coTitle) s.dataset.title = s.dataset.coTitle; });
    $('#co-banner').hidden = false;
    $('#co-banner-text').textContent = `You’re adding your part to ${JOIN_WITH ? JOIN_WITH + '’s' : 'an'} application${h ? ` for ${h.name}` : ''}. Fill in your own details and sign at the end: ${C.person} gets one form with both of you.`;
    $('.apply-head h1').textContent = 'Your part of the application';
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
    reached = Math.max(0, order.indexOf(Number(restoredAt)));
    go(Number(restoredAt), { focus: false });
  } else go(order[0], { focus: false });
  if (!C.endpoint) console.info('Vemian: no form endpoint set in source/config.mjs, so forms open the visitor’s email app.');
})();
