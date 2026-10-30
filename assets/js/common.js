// Shared by every page: dialogs, sending forms, the "Talk to Michael" widget, header and toast.
// Settings (email, phone, form endpoint) come from window.VEMIAN, written into each page by source/build.mjs.
(() => {
  const C = window.VEMIAN;
  const html = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- analytics hook: Tag Manager (when installed) reads these events ----------
  window.dataLayer = window.dataLayer || [];
  const track = (event, params = {}) => window.dataLayer.push({ event, ...params });

  // ---------- dates and money ----------
  const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  function avail(iso) {
    const today = todayISO();
    if (!iso || iso === 'now' || iso <= today) return { now: true, label: 'Available now', short: 'Now', sort: today };
    const [y, m, d] = iso.split('-').map(Number);
    const md = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const short = y === Number(today.slice(0, 4)) ? md : `${md}, ${y}`;
    return { now: false, label: `Available ${short}`, short, sort: iso };
  }
  const money = (n) => '$' + Number(n).toLocaleString('en-CA');

  // ---------- dialogs ----------
  let locks = 0;
  function openDlg(d) {
    if (!d || d.open) return;
    d.showModal();
    locks++;
    html.classList.add('no-scroll');
  }
  function closeDlg(d) {
    if (!d || !d.open || d.classList.contains('closing')) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => { d.classList.remove('closing'); d.close(); resolve(); };
      if (reduceMotion.matches) return finish();
      d.classList.add('closing');
      setTimeout(finish, 190);
    });
  }
  // 'close' doesn't bubble, so listen in the capture phase.
  document.addEventListener('close', (e) => {
    if (e.target.tagName !== 'DIALOG') return;
    locks = Math.max(0, locks - 1);
    if (!locks) html.classList.remove('no-scroll');
  }, true);
  $$('dialog').forEach((d) => {
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeDlg(d); });
    let downOnBackdrop = false;
    d.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === d; });
    d.addEventListener('click', (e) => { if (e.target === d && downOnBackdrop) closeDlg(d); });
    $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => closeDlg(d)));
  });

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- sending ----------
  // Posts JSON as text/plain (no CORS preflight, which Google Apps Script can't answer).
  // Without an endpoint, opens the visitor's email app with the message filled in.
  async function send(payload) {
    const body = { ...payload, page: location.href, sentAt: new Date().toISOString() };
    if (!C.endpoint) { mailto(body); return 'mail'; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const res = await fetch(C.endpoint, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal });
      let data = {};
      try { data = await res.json(); } catch { /* non-JSON answer */ }
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      return 'sent';
    } finally { clearTimeout(timer); }
  }
  function mailto(body) {
    const lines = [];
    (body.sections || []).forEach((s) => {
      lines.push(`— ${s.title} —`);
      s.rows.forEach(([k, v]) => { if (v) lines.push(`${k}: ${v}`); });
      lines.push('');
    });
    if (body.files?.length) lines.push('(Please attach your documents to this email.)');
    const url = `mailto:${C.email}?subject=${encodeURIComponent(body.subject || 'Message from vemianpm.com')}&body=${encodeURIComponent(lines.join('\n'))}`;
    location.href = url.length > 7800 ? url.slice(0, 7800) : url;
  }

  // ---------- presence ----------
  function isActive() {
    if (C.alwaysActive) return true;
    const h = C.hours;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: h.tz, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday').value);
    const hr = parseInt(parts.find((p) => p.type === 'hour').value, 10) % 24;
    return h.days.includes(wd) && hr >= h.start && hr < h.end;
  }

  // ---------- header ----------
  const header = $('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- privacy ----------
  $$('[data-open="privacy"]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openDlg($('#privacy')); }));

  // ---------- Talk to Michael ----------
  const talk = $('.talk');
  const talkApi = { open() {}, ask() {} };
  if (talk) {
    const active = isActive();
    talk.classList.toggle('active', active);
    $$('[data-status]', talk).forEach((el) => { el.textContent = active ? 'Active now' : 'Leave a message'; });
    const panel = $('.talk-panel', talk);
    const btn = $('.talk-btn', talk);
    const body = $('.talk-body', talk);
    const form = $('.talk-form', talk);
    const ta = $('textarea', form);
    let greeted = false;

    // On phones the panel fills the part of the screen that's visible above the keyboard, so the form and its
    // Send button never end up hidden behind it (visualViewport shrinks when the keyboard opens).
    const phone = matchMedia('(max-width: 560px)');
    const fit = () => {
      const vv = window.visualViewport;
      if (!vv || !phone.matches || panel.hidden) { panel.style.removeProperty('--vv-h'); panel.style.removeProperty('--vv-top'); return; }
      panel.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
      panel.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    };
    window.visualViewport?.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('scroll', fit);
    phone.addEventListener('change', () => { fit(); html.classList.toggle('talk-lock', phone.matches && !panel.hidden); });

    const show = (el) => { body.append(el); el.scrollIntoView({ block: 'nearest' }); };
    const bubble = (text, mine) => {
      const p = document.createElement('p');
      p.className = 'talk-msg' + (mine ? ' mine' : '');
      p.textContent = text;
      show(p);
    };
    const typingThen = (text, ms = 900) => {
      const t = document.createElement('div');
      t.className = 'talk-typing';
      t.setAttribute('aria-label', `${C.person} is typing`);
      t.innerHTML = '<span></span><span></span><span></span>';
      show(t);
      setTimeout(() => { t.remove(); bubble(text); }, reduceMotion.matches ? 0 : ms);
    };
    const open = (prefill) => {
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      talk.classList.add('open');
      html.classList.toggle('talk-lock', phone.matches);
      fit();
      if (!greeted) {
        greeted = true;
        typingThen(active
          ? `Hi, I’m ${C.person}. Looking for a home? Ask me anything about these homes, or I can set up a viewing for you.`
          : `Hi, I’m ${C.person}. I’m away right now; leave a message and I’ll get back to you first thing.`);
      }
      if (prefill) { ta.value = prefill; }
      // on phones, wait for a tap before raising the keyboard (it would cover the greeting and shortcuts)
      if (!phone.matches || prefill) setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 60);
      track('talk_open');
    };
    const close = () => {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      talk.classList.remove('open');
      html.classList.remove('talk-lock');
      fit();
      btn.focus();
    };
    talkApi.open = open;
    talkApi.ask = (text) => open(text);
    // on phones, shrink to the photo while scrolling down; show the label again on the way up
    let lastY = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY;
      if (Math.abs(y - lastY) < 12) return;
      talk.classList.toggle('mini', y > lastY && y > 240);
      lastY = y;
    }, { passive: true });
    btn.addEventListener('click', () => (panel.hidden ? open() : close()));
    $('.talk-x', talk).addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden && !$('dialog[open]')) close(); });
    $$('[data-talk]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); open(el.dataset.talk || ''); }));
    $$('.talk-chips button', talk).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.action === 'viewing' && window.V.openContact) { close(); window.V.openContact({ mode: 'viewing' }); return; }
      if (b.dataset.href) { location.href = b.dataset.href; return; }
      ta.value = b.dataset.say || b.textContent;
      ta.focus();
    }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      if (!f.message.trim() || !f.name.trim() || !f.contact.trim()) {
        form.classList.add('tried');
        $(':invalid', form)?.focus();
        return;
      }
      if (f.company) return; // honeypot
      bubble(f.message, true);
      const sendBtn = $('button[type=submit]', form);
      sendBtn.disabled = true;
      try {
        const how = await send({
          type: 'message',
          subject: `Message from ${f.name.trim()} (vemianpm.com)`,
          name: f.name.trim(), email: /@/.test(f.contact) ? f.contact.trim() : '', phone: /@/.test(f.contact) ? '' : f.contact.trim(),
          replyTo: /@/.test(f.contact) ? f.contact.trim() : '',
          message: f.message.trim(),
          sections: [{ title: 'Message', rows: [['Name', f.name.trim()], ['Email or phone', f.contact.trim()], ['Message', f.message.trim()]] }],
        });
        form.reset();
        form.classList.remove('tried');
        const first = f.name.trim().split(' ')[0];
        typingThen(how === 'sent'
          ? `Thanks, ${first}! Got it. I’ll reply by text or email shortly.`
          : `Thanks, ${first}! Your email app opened with your message. Press send and it comes straight to me.`);
        track('talk_message_sent', { method: how });
      } catch {
        typingThen(`Sorry, that didn’t go through. Please text me at ${C.phoneLabel}.`, 500);
      } finally { sendBtn.disabled = false; }
    });
  }

  // ---------- share a link ----------
  async function share(url, title) {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch { /* user cancelled */ }
  }

  window.V = { $, $$, esc, track, avail, money, todayISO, openDlg, closeDlg, send, toast, share, talk: talkApi, config: C };
})();
