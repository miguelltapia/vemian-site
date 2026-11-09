// Forth Gen leasing report (/forthgen-report). The figures are encrypted in the page (#report-data, written by
// source/report/build-report.mjs); this unlocks them with the password (WebCrypto: PBKDF2-SHA-256 + AES-256-GCM)
// and draws two views, each with its own address (#dashboard, #week-2026-11-02) so Back and shared links work:
// - Dashboard: where things stand now (the latest week's units and buildings) and the totals since marketing began.
// - Weekly reports: one frozen report per week, picked from a list: filters, figures, charts, takeaways, the
//   showings' feedback, and the buildings and units as they were that week.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-CA'));
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const day = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', ...opts });
  const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  const cap = (s) => String(s || '').replace(/^\w/, (c) => c.toUpperCase());
  const chev = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const ENC = JSON.parse($('#report-data').textContent);
  const SAVED = 'vemian-report';        // sessionStorage: the password, for this tab only
  let R = null;                         // the decrypted report: { client, buildingNames, weeks: [...] }, oldest week first
  let WI = 0;                           // the week on screen in Weekly reports (index in R.weeks)
  let shown = null;                     // the week the filters belong to (they reset when the week changes)
  let snapOpen = false;                 // the week's "Buildings and units" panel
  const F = { b: 'all', s: 'all' };     // filters: building code, source
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function decrypt(password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(ENC.salt), iterations: ENC.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(ENC.iv) }, key, b64(ENC.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ---------- lock ----------
  const lock = $('#lock');
  const form = $('#lock-form');
  const msg = $('.lock-msg', form);
  const app = $('#app');
  async function open(password, { quiet = false } = {}) {
    const btn = $('button', form);
    btn.disabled = true;
    if (!quiet) msg.textContent = 'Opening…';
    try {
      R = await decrypt(password);
      try { sessionStorage.setItem(SAVED, password); } catch { /* storage blocked */ }
      lock.hidden = true;
      app.hidden = false;
      start();
    } catch {
      try { sessionStorage.removeItem(SAVED); } catch { /* storage blocked */ }
      if (!quiet) { msg.textContent = 'That password didn’t work. Check it and try again.'; $('input', form).select(); }
      else msg.textContent = '';
    } finally { btn.disabled = false; }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); const pw = $('input', form).value; if (pw) open(pw); });
  let remembered = null;
  try { remembered = sessionStorage.getItem(SAVED); } catch { /* storage blocked */ }
  if (remembered) open(remembered, { quiet: true });
  else $('input', form).focus();

  // ---------- helpers for the report ----------
  const names = () => R.buildingNames || {};
  const code = (u) => String(u || '').split(' ')[0];
  const homeName = (u) => {
    const [c, n] = String(u || '').split(' ');
    const name = names()[c];
    if (!name) return u || 'Unit not given';
    return n ? `${name} #${n}` : `${name}, unit not given`;
  };
  const unitKey = (u) => `${u.code} ${u.unit}`;
  // "Nov 2 – 8", or "Oct 26 – Nov 1" across two months
  const range = (w) => {
    const end = addDays(w.week, 6);
    const start = day(w.week, { month: 'short', day: 'numeric' });
    return `${start} – ${day(end, w.week.slice(5, 7) === end.slice(5, 7) ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
  };
  const stats = (w) => ({
    inquiries: w.leads.length,
    booked: w.leads.filter((l) => l.st === 'booked').length,
    held: w.showings.length,
    apps: (w.applications || []).length,
    leases: (w.leases || []).length,
  });
  const count = (list, key) => Object.entries(list.reduce((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const STATUSES = ['Open', 'Application in review', 'Leased', 'Rented by the building manager', 'Not available'];
  const stClass = (s) => (s === 'Open' ? 'open' : /applic/i.test(s) ? 'app' : s === 'Leased' ? 'leased' : /manager/i.test(s) ? 'rented' : 'off');
  const stShort = (s) => (s === 'Rented by the building manager' ? 'Rented by manager' : s);
  // Michael's layout ("2BR penthouse", "1BR + den"), or one made from the beds and baths in the same style
  const layout = (u) => (/\dBR/i.test(u.layout || '') ? u.layout : [u.beds && `${u.beds}BR`, u.baths > 1 && `${u.baths} bath`, u.layout].filter(Boolean).join(' · ') || '—');
  const FOOT = '<p class="rp-foot">Figures come from Michael’s leasing log for Forth Gen. Prospects’ contact details stay out of this report; the showing notes are Michael’s and use first names only.</p>';

  // horizontal bars: rows are [label, value, tooltip?]
  const bars = (rows, total, one = 'inquiry', many = 'inquiries') => {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return rows.length ? `<div class="hb">${rows.map(([k, v, tip]) => `<div class="hb-row" tabindex="0" data-tip="${esc(tip || `${k}: ${plural(v, one, many)}${total ? ` (${pct(v, total)})` : ''}`)}"><span class="hb-label">${esc(k)}</span><span class="hb-track"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></span><span class="hb-val">${v}</span></div>`).join('')}</div>` : '<p class="rp-empty">Nothing for this filter.</p>';
  };

  const buildingsTable = (list) => `
    <div class="rp-table-wrap"><table class="rp-table">
      <thead><tr><th>Building</th><th class="num">Vacant</th><th class="num">Upcoming</th><th class="num">Total</th></tr></thead>
      <tbody>${list.map((b) => `<tr><td>${esc(b.b)}</td><td class="num">${b.vacant}</td><td class="num">${b.upcoming}</td><td class="num">${b.total}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${sum(list, (b) => b.vacant)}</td><td class="num">${sum(list, (b) => b.upcoming)}</td><td class="num">${sum(list, (b) => b.total)}</td></tr></tfoot>
    </table></div>`;

  // the units, with status chips; on the dashboard also last week's rent or status ("was") and the demand per unit
  function unitsTable(units, { prev, demand } = {}) {
    const present = [...STATUSES, ...new Set(units.map((u) => u.status))].filter((s, i, all) => all.indexOf(s) === i && units.some((u) => u.status === s));
    return `
      <div class="rp-chips" role="group" aria-label="Status">${['all', ...present].map((s) => `<button type="button" class="chip" data-st="${esc(s)}" aria-pressed="${s === 'all'}">${s === 'all' ? 'All' : esc(stShort(s))} <span data-n></span></button>`).join('')}</div>
      <div class="rp-table-wrap"><table class="rp-table rp-units">
        <thead><tr><th>Unit</th><th>Layout</th><th class="num">Sq ft</th><th class="num">Rent</th><th>Available</th><th>Status</th>${demand ? '<th class="num">Inquiries</th><th class="num">Showings</th>' : ''}</tr></thead>
        <tbody>${units.map((u) => {
          const was = prev && prev.get(unitKey(u));
          const rentWas = was && was.rent && u.rent && was.rent !== u.rent ? `<small class="was">was ${money(was.rent)}</small>` : '';
          const stWas = prev && prev.size ? (!was ? '<small class="was">new in the list</small>' : was.status !== u.status ? `<small class="was">was ${esc(stShort(was.status))}</small>` : '') : '';
          const d = demand && demand.get(unitKey(u));
          return `<tr data-status="${esc(u.status)}" data-code="${esc(u.code)}">
            <td>${esc(names()[u.code] || u.code)} #${esc(u.unit)}</td>
            <td>${esc(layout(u))}</td>
            <td class="num">${u.sqft ? u.sqft.toLocaleString('en-CA') : '—'}</td>
            <td class="num">${money(u.rent)}${rentWas}</td>
            <td>${esc(cap(u.avail) || '—')}</td>
            <td><span class="st st-${stClass(u.status)}" title="${esc(u.status)}">${esc(stShort(u.status))}</span>${stWas}</td>
            ${demand ? `<td class="num">${d?.i || '—'}</td><td class="num">${d?.s || '—'}</td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }
  function wireUnits(root) {
    const apply = () => {
      const st = $('[data-st][aria-pressed="true"]', root)?.dataset.st || 'all';
      const b = $('[data-ub]', root)?.value || 'all';
      const rows = $$('.rp-units tbody tr', root);
      const inB = rows.filter((tr) => b === 'all' || tr.dataset.code === b);
      rows.forEach((tr) => { tr.hidden = !inB.includes(tr) || (st !== 'all' && tr.dataset.status !== st); });
      $$('[data-st]', root).forEach((c) => { $('[data-n]', c).textContent = c.dataset.st === 'all' ? inB.length : inB.filter((tr) => tr.dataset.status === c.dataset.st).length; });
    };
    $$('[data-st]', root).forEach((c) => c.addEventListener('click', () => {
      $$('[data-st]', root).forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      apply();
    }));
    $('[data-ub]', root)?.addEventListener('change', apply);
    apply();
  }

  // ---------- page, tabs and addresses ----------
  function start() {
    WI = R.weeks.length - 1;
    app.innerHTML = `
      <header class="rp-top">
        <div class="wrap rp-top-in">
          <img src="/assets/brand/vemian-wordmark-56.png" srcset="/assets/brand/vemian-wordmark-112.png 2x" alt="Vemian" height="28">
          <div class="rp-title"><b>Leasing report</b><span>${esc(R.client)} · prepared by Michael, Vemian</span></div>
          <button type="button" class="btn btn-ghost btn-sm" data-lock>Lock</button>
        </div>
        <div class="wrap"><div class="rp-views" role="tablist" aria-label="Report">
          <button type="button" role="tab" id="tab-dashboard" aria-controls="rp-view" data-view="dashboard">Dashboard</button>
          <button type="button" role="tab" id="tab-weeks" aria-controls="rp-view" data-view="weeks">Weekly reports</button>
        </div></div>
      </header>
      <div class="wrap rp-main"><div id="rp-view" role="tabpanel"></div></div>
      <div class="rp-tip" role="tooltip" hidden></div>`;
    $('[data-lock]', app).addEventListener('click', () => {
      try { sessionStorage.removeItem(SAVED); } catch { /* storage blocked */ }
      location.reload();
    });
    const tabs = $$('[data-view]', app);
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => go(t.dataset.view));
      t.addEventListener('keydown', (e) => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (to == null) return;
        e.preventDefault();
        const next = tabs[(to + tabs.length) % tabs.length];
        next.focus();
        go(next.dataset.view);
      });
    });
    window.addEventListener('hashchange', route);
    route();
    tooltips();
  }

  // #dashboard (or no address), #weeks (the latest week) or #week-<monday>
  function route() {
    const m = location.hash.match(/^#week-(\d{4}-\d{2}-\d{2})$/);
    const i = m ? R.weeks.findIndex((w) => w.week === m[1]) : -1;
    const view = i >= 0 || location.hash === '#weeks' ? 'weeks' : 'dashboard';
    if (i >= 0) WI = i;
    $$('[data-view]', app).forEach((t) => {
      const on = t.dataset.view === view;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    $('#rp-view').setAttribute('aria-labelledby', `tab-${view}`);
    if (view === 'dashboard') dashboard(); else weekView();
  }
  function go(view, i = WI) {
    const hash = view === 'dashboard' ? '#dashboard' : `#week-${R.weeks[i].week}`;
    if (location.hash !== hash) location.hash = hash;   // → hashchange → route()
    else route();
    window.scrollTo({ top: 0 });
  }

  // ---------- Dashboard: now, and since marketing began ----------
  function dashboard() {
    const W = R.weeks[R.weeks.length - 1];
    const before = R.weeks[R.weeks.length - 2];
    const leads = R.weeks.flatMap((w) => w.leads);
    const shows = R.weeks.flatMap((w) => w.showings);
    const apps = R.weeks.flatMap((w) => w.applications || []);
    const leases = R.weeks.flatMap((w) => w.leases || []);
    const since = leads.map((l) => l.d).sort()[0] || R.weeks[0].week;
    const sinceTxt = day(since, { month: 'short', day: 'numeric' });
    const units = W.inventory;
    const inReview = units.filter((u) => /applic/i.test(u.status));
    const appsInReview = apps.filter((a) => inReview.some((u) => unitKey(u) === a.u));
    const byManager = units.filter((u) => /manager/i.test(u.status)).length;
    const B = W.buildings || [];
    const vacant = B.length ? sum(B, (b) => b.vacant) : units.filter((u) => u.status === 'Open').length;
    const upcoming = sum(B, (b) => b.upcoming);
    const total = B.length ? sum(B, (b) => b.total) : units.length;
    const now = stats(W);
    const demand = new Map();
    const tally = (u, k) => { const d = demand.get(u) || { i: 0, s: 0 }; d[k]++; demand.set(u, d); };
    leads.forEach((l) => tally(l.u, 'i'));
    shows.forEach((s) => tally(s.u, 's'));
    const top = [...demand].filter(([, d]) => d.i).sort((a, b) => b[1].i - a[1].i).slice(0, 8)
      .map(([u, d]) => [homeName(u), d.i, `${homeName(u)}: ${plural(d.i, 'inquiry', 'inquiries')} and ${plural(d.s, 'showing')} since ${sinceTxt}`]);
    const weeks = R.weeks.map((w, i) => ({ w, i, s: stats(w) })).reverse();
    const most = Math.max(1, ...weeks.map((x) => x.s.inquiries));
    const codes = [...new Set(units.map((u) => u.code))];
    const prev = before ? new Map(before.inventory.map((u) => [unitKey(u), u])) : null;

    $('#rp-view').innerHTML = `
      <div class="rp-head">
        <h1>Where things stand</h1>
        <p>As of ${esc(day(W.updated, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))} · marketing began ${esc(sinceTxt)}</p>
      </div>
      <section class="rp-kpis" aria-label="Where things stand, in numbers">
        <div class="kpi kpi-hero"><span>Vacant units</span><b>${vacant}</b><small>${upcoming ? `${upcoming} more upcoming · ` : ''}${total} in all</small></div>
        <div class="kpi"><span>Applications in review</span><b>${Math.max(appsInReview.length, inReview.length)}</b><small>${inReview.length ? `for ${esc(inReview.map((u) => homeName(unitKey(u))).join(', '))}` : 'none right now'}</small></div>
        <div class="kpi"><span>Leases signed</span><b>${leases.length}</b><small>${byManager ? `${plural(byManager, 'unit')} rented by the building managers` : `since ${esc(sinceTxt)}`}</small></div>
        <div class="kpi"><span>Inquiries</span><b>${leads.length}</b><small>since ${esc(sinceTxt)} · ${now.inquiries} in ${esc(range(W))}</small></div>
        <div class="kpi"><span>Showings held</span><b>${shows.length}</b><small>since ${esc(sinceTxt)} · ${now.held} in ${esc(range(W))}</small></div>
      </section>

      <section class="rp-grid">
        <article class="rp-card rp-wide">
          <h2>Week by week</h2>
          <div class="rp-scroll"><table class="rp-table rp-wk">
            <thead><tr><th>Week</th><th>Inquiries</th><th class="num">Showings booked</th><th class="num">Showings held</th><th class="num">Applications</th><th class="num">Leases signed</th></tr></thead>
            <tbody>${weeks.map(({ w, i, s }) => `<tr>
              <td><button type="button" class="rp-link" data-goweek="${i}">${esc(range(w))}</button></td>
              <td><span class="wk-bar" data-tip="${esc(`${w.label}: ${plural(s.inquiries, 'inquiry', 'inquiries')}`)}"><i style="width:${(s.inquiries / most) * 100}%"></i><b>${s.inquiries}</b></span></td>
              <td class="num">${s.booked}</td><td class="num">${s.held}</td><td class="num">${s.apps}</td><td class="num">${s.leases}</td>
            </tr>`).join('')}</tbody>
          </table></div>
          <p class="rp-note">Open a week for its full report.</p>
        </article>
        <article class="rp-card"><h2>Buildings</h2>${B.length ? buildingsTable(B) : '<p class="rp-empty">Not given this week.</p>'}</article>
        <article class="rp-card"><h2>Most asked-about homes since ${esc(sinceTxt)}</h2>${bars(top, 0)}</article>
      </section>

      <section class="rp-sec" id="rp-now-units">
        <div class="rp-sec-head"><h2>Units</h2>
          <label class="rp-ub"><span class="sr-only">Building</span><select class="select" data-ub><option value="all">All buildings</option>${codes.map((c) => `<option value="${esc(c)}">${esc(names()[c] || c)}</option>`).join('')}</select></label>
        </div>
        ${unitsTable(units, { prev, demand })}
        <p class="rp-note">Inquiries and showings count since ${esc(sinceTxt)}.${prev ? ` “Was” is the rent or status in the week of ${esc(range(before))}.` : ''}</p>
      </section>
      ${FOOT}`;

    $$('[data-goweek]').forEach((b) => b.addEventListener('click', () => go('weeks', Number(b.dataset.goweek))));
    wireUnits($('#rp-now-units'));
  }

  // ---------- Weekly reports ----------
  function weekView() {
    const W = R.weeks[WI];
    if (shown !== WI) { F.b = 'all'; F.s = 'all'; shown = WI; }
    const codes = [...new Set([...W.leads.map((l) => code(l.u)), ...W.inventory.map((u) => u.code)])].filter(Boolean).sort();
    const sources = [...new Set(W.leads.map((l) => l.s))].sort();
    const last = R.weeks.length - 1;
    $('#rp-view').innerHTML = `
      <div class="rp-weekbar">
        <div class="rp-weekpick">
          <button type="button" class="rp-step" data-step="-1" aria-label="Previous week"${WI === 0 ? ' disabled' : ''}>${chev('M15 6l-6 6 6 6')}</button>
          <label class="sr-only" for="rp-wk">Week</label>
          <select class="select" id="rp-wk">${R.weeks.map((w, i) => ({ w, i })).reverse().map(({ w, i }) => `<option value="${i}"${i === WI ? ' selected' : ''}>Week of ${esc(range(w))}, ${addDays(w.week, 6).slice(0, 4)}</option>`).join('')}</select>
          <button type="button" class="rp-step" data-step="1" aria-label="Next week"${WI === last ? ' disabled' : ''}>${chev('M9 6l6 6-6 6')}</button>
        </div>
        <p class="rp-scope">${WI === last ? 'Latest week' : 'Past week'} · figures as of ${esc(day(W.updated, { month: 'short', day: 'numeric' }))}</p>
      </div>
      <div class="rp-filters" role="group" aria-label="Filters">
        <label>Building <select class="select" data-f="b"><option value="all">All buildings</option>${codes.map((c) => `<option value="${esc(c)}">${esc(names()[c] || c)}</option>`).join('')}</select></label>
        <label>Source <select class="select" data-f="s"><option value="all">All sources</option>${sources.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
        <p class="rp-scope">The source filter applies to inquiries.</p>
      </div>
      <div id="rp-body"></div>`;
    $('#rp-wk').addEventListener('change', (e) => go('weeks', Number(e.target.value)));
    $$('[data-step]').forEach((b) => b.addEventListener('click', () => go('weeks', WI + Number(b.dataset.step))));
    $$('[data-f]').forEach((s) => {
      s.value = F[s.dataset.f];
      s.addEventListener('change', () => { F[s.dataset.f] = s.value; weekBody(); });
    });
    weekBody();
  }

  function weekBody() {
    const W = R.weeks[WI];
    const byB = (u) => F.b === 'all' || code(u) === F.b;
    const leads = W.leads.filter((l) => byB(l.u) && (F.s === 'all' || l.s === F.s));
    const shows = W.showings.filter((s) => byB(s.u));
    const apps = (W.applications || []).filter((a) => byB(a.u));
    const leases = (W.leases || []).filter((a) => byB(a.u));
    const units = W.inventory.filter((u) => F.b === 'all' || u.code === F.b);
    const booked = leads.filter((l) => l.st === 'booked').length;
    const people = new Set(leads.map((l) => l.p).filter(Boolean)).size;
    const attended = sum(shows, (s) => s.n);
    const byManager = units.filter((u) => /manager/i.test(u.status)).length;
    const open = units.filter((u) => u.status === 'Open').length;
    const homes = (list) => esc([...new Set(list.map((a) => homeName(a.u)))].join(', '));

    // the seven days of the week, Monday first
    const days = Array.from({ length: 7 }, (_, i) => addDays(W.week, i));
    const perDay = days.map((d) => ({ d, n: leads.filter((l) => l.d === d).length, b: leads.filter((l) => l.d === d && l.st === 'booked').length }));
    const top = Math.max(1, ...perDay.map((x) => x.n));
    const homeRows = count(leads, (l) => l.u).map(([u, n]) => {
      const b = leads.filter((l) => l.u === u && l.st === 'booked').length;
      return [homeName(u), n, `${homeName(u)}: ${plural(n, 'inquiry', 'inquiries')}, ${plural(b, 'showing')} booked`];
    });
    const funnel = [['Inquiries', leads.length], ['Showings booked', booked], ['Showings held', shows.length], ['Applications', apps.length], ['Leases signed', leases.length]]
      .map(([k, v]) => [k, v, `${k}: ${v}${k === 'Inquiries' ? '' : ` (${pct(v, leads.length)} of inquiries)`}`]);

    $('#rp-body').innerHTML = `
      <section class="rp-kpis" aria-label="This week in numbers">
        <div class="kpi kpi-hero"><span>Inquiries</span><b>${leads.length}</b><small>from ${plural(people, 'person', 'people')}${F.b === 'all' && F.s === 'all' && W.unlogged ? `<br>plus at least ${W.unlogged} not logged one by one` : ''}</small></div>
        <div class="kpi"><span>Showings booked</span><b>${booked}</b><small>${pct(booked, leads.length)} of inquiries</small></div>
        <div class="kpi"><span>Showings held</span><b>${shows.length}</b><small>${plural(attended, 'person', 'people')} in person${F.b === 'all' && W.cancelled ? ` · ${W.cancelled} cancelled` : ''}</small></div>
        <div class="kpi"><span>Applications</span><b>${apps.length}</b><small>${apps.length ? `for ${homes(apps)}` : 'none this week'}</small></div>
        <div class="kpi"><span>Leases signed</span><b>${leases.length}</b><small>${leases.length ? homes(leases) : byManager ? `${plural(byManager, 'unit')} rented by the building managers` : 'none this week'}</small></div>
      </section>

      <section class="rp-grid">
        <article class="rp-card rp-wide">
          <h2>Inquiries by day</h2>
          <div class="cols">${perDay.map((x) => `<div class="col" tabindex="0" data-tip="${esc(`${day(x.d, { weekday: 'long', month: 'short', day: 'numeric' })}: ${plural(x.n, 'inquiry', 'inquiries')}, ${plural(x.b, 'showing')} booked`)}"><span class="col-val">${x.n || ''}</span><i style="height:${(x.n / top) * 100}%"></i><span class="col-label">${esc(day(x.d, { weekday: 'short' }))}<br>${esc(day(x.d, { day: 'numeric' }))}</span></div>`).join('')}</div>
        </article>
        <article class="rp-card"><h2>Inquiries by home</h2>${bars(homeRows, leads.length)}</article>
        <article class="rp-card"><h2>Where inquiries came from</h2>${bars(count(leads, (l) => l.s), leads.length)}</article>
        <article class="rp-card rp-wide"><h2>From inquiry to lease</h2>${bars(funnel, 0)}</article>
      </section>

      ${W.notes?.length ? `<section class="rp-card rp-notes"><h2>Key takeaways</h2><ul>${W.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}

      <section class="rp-sec">
        <h2>Showings: what prospects said</h2>
        ${shows.length ? `<div class="fb">${shows.map((s) => `<article class="fb-card"><header><b>${esc(homeName(s.u))}</b><span>${esc(day(s.d, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${s.n} in person</span></header><p>${esc(s.note)}</p></article>`).join('')}</div>` : '<p class="rp-empty">No showings this week for this filter.</p>'}
      </section>

      <details class="rp-snap" id="rp-week-units"${snapOpen ? ' open' : ''}>
        <summary><span>Buildings and units as of ${esc(day(W.updated, { month: 'short', day: 'numeric' }))}</span><small>${open} open of ${plural(units.length, 'unit')}</small></summary>
        <div class="rp-snap-in">
          ${F.b === 'all' && W.buildings?.length ? buildingsTable(W.buildings) : ''}
          ${unitsTable(units)}
        </div>
      </details>
      ${FOOT}`;

    const snap = $('#rp-week-units');
    snap.addEventListener('toggle', () => { snapOpen = snap.open; });
    wireUnits(snap);
  }

  // one tooltip for every bar and column (hover, or keyboard focus); text set with textContent
  function tooltips() {
    const tip = $('.rp-tip');
    const show = (el, x, y) => {
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
      tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
    };
    app.addEventListener('pointermove', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else tip.hidden = true; });
    app.addEventListener('pointerleave', () => { tip.hidden = true; });
    app.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (!el) return; const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
    app.addEventListener('focusout', () => { tip.hidden = true; });
  }
})();
