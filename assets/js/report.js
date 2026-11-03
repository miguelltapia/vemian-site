// Forth Gen leasing report (/forthgen-report). The figures are encrypted in the page (#report-data, written by
// source/report/build-report.mjs); this unlocks them with the password (WebCrypto: PBKDF2-SHA-256 + AES-256-GCM)
// and draws the dashboard: a tab per week, filters, figures, charts, the showings' feedback and the units.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-CA'));
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const day = (iso, opts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-CA', { timeZone: 'UTC', ...opts });
  const ENC = JSON.parse($('#report-data').textContent);
  const SAVED = 'vemian-report';        // sessionStorage: the password, for this tab only
  let R = null;                         // the decrypted report: { client, buildingNames, weeks: [...] }
  let W = null;                         // the week on screen
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

  // ---------- the report ----------
  const code = (u) => String(u || '').split(' ')[0];
  const homeName = (u) => {
    const [c, n] = String(u || '').split(' ');
    const name = (R.buildingNames || {})[c];
    return name ? `${name} #${n}` : u || 'Not given';
  };

  function start() {
    W = R.weeks[R.weeks.length - 1];
    app.innerHTML = `
      <header class="rp-top"><div class="wrap rp-top-in">
        <img src="/assets/brand/vemian-wordmark-56.png" srcset="/assets/brand/vemian-wordmark-112.png 2x" alt="Vemian" height="28">
        <div class="rp-title"><b>Leasing report</b><span>${esc(R.client)} · prepared by Michael, Vemian</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-lock>Lock</button>
      </div></header>
      <div class="wrap rp-main">
        <div class="rp-weeks" role="tablist" aria-label="Weeks">${R.weeks.map((w, i) => `<button type="button" role="tab" data-week="${i}" aria-selected="${w === W}">${esc(w.label)}</button>`).join('')}</div>
        <div id="rp-week" role="tabpanel"></div>
      </div>
      <div class="rp-tip" role="tooltip" hidden></div>`;
    $('[data-lock]', app).addEventListener('click', () => {
      try { sessionStorage.removeItem(SAVED); } catch { /* storage blocked */ }
      location.reload();
    });
    $$('[data-week]', app).forEach((b) => b.addEventListener('click', () => {
      W = R.weeks[Number(b.dataset.week)];
      $$('[data-week]', app).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      F.b = 'all'; F.s = 'all';
      week();
    }));
    week();
    tooltips();
  }

  function week() {
    const codes = [...new Set([...W.leads.map((l) => code(l.u)), ...W.inventory.map((u) => u.code)])].filter(Boolean).sort();
    const sources = [...new Set(W.leads.map((l) => l.s))].sort();
    $('#rp-week').innerHTML = `
      <div class="rp-filters" role="group" aria-label="Filters">
        <label>Building <select class="select" data-f="b"><option value="all">All buildings</option>${codes.map((c) => `<option value="${esc(c)}">${esc((R.buildingNames || {})[c] || c)}</option>`).join('')}</select></label>
        <label>Source <select class="select" data-f="s"><option value="all">All sources</option>${sources.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>
        <p class="rp-scope">Week of ${esc(W.label)} · updated ${esc(day(W.updated, { month: 'short', day: 'numeric' }))}. The source filter applies to inquiries.</p>
      </div>
      <div id="rp-body"></div>`;
    $$('[data-f]').forEach((s) => {
      s.value = F[s.dataset.f];
      s.addEventListener('change', () => { F[s.dataset.f] = s.value; body(); });
    });
    body();
  }

  const count = (list, key) => Object.entries(list.reduce((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);

  function body() {
    const byB = (u) => F.b === 'all' || code(u) === F.b;
    const leads = W.leads.filter((l) => byB(l.u) && (F.s === 'all' || l.s === F.s));
    const shows = W.showings.filter((s) => byB(s.u));
    const units = W.inventory.filter((u) => F.b === 'all' || u.code === F.b);
    const booked = leads.filter((l) => l.st === 'booked').length;
    const people = new Set(leads.map((l) => l.p).filter(Boolean)).size;
    const open = units.filter((u) => u.status === 'Open').length;

    // the seven days of the week, Monday first
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(`${W.week}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
    const perDay = days.map((d) => ({ d, n: leads.filter((l) => l.d === d).length, b: leads.filter((l) => l.d === d && l.st === 'booked').length }));
    const top = Math.max(1, ...perDay.map((x) => x.n));

    const bars = (rows, total, unit) => {
      const max = Math.max(1, ...rows.map((r) => r[1]));
      return rows.length ? `<div class="hb">${rows.map(([k, v, tip]) => `<div class="hb-row" tabindex="0" data-tip="${esc(tip || `${k}: ${v} ${unit}${v === 1 ? '' : 's'}${total ? ` (${pct(v, total)})` : ''}`)}"><span class="hb-label">${esc(k)}</span><span class="hb-track"><i style="width:${Math.max(2, (v / max) * 100)}%"></i></span><span class="hb-val">${v}</span></div>`).join('')}</div>` : '<p class="rp-empty">Nothing for this filter.</p>';
    };

    const homeRows = count(leads, (l) => l.u).map(([u, n]) => {
      const b = leads.filter((l) => l.u === u && l.st === 'booked').length;
      return [homeName(u), n, `${homeName(u)}: ${n} inquir${n === 1 ? 'y' : 'ies'}, ${b} showing${b === 1 ? '' : 's'} booked`];
    });
    const funnel = [['Inquiries', leads.length], ['Showings booked', booked], ['Showings held', shows.length], ['Leases signed', 0]]
      .map(([k, v]) => [k, v, `${k}: ${v}${k === 'Inquiries' ? '' : ` (${pct(v, leads.length)} of inquiries)`}`]);
    const statuses = ['all', 'Open', 'Not available', 'Rented by the building manager'];

    $('#rp-body').innerHTML = `
      <section class="rp-kpis" aria-label="This week in numbers">
        <div class="kpi kpi-hero"><span>Inquiries</span><b>${leads.length}</b><small>from ${people} ${people === 1 ? 'person' : 'people'}</small></div>
        <div class="kpi"><span>Showings booked</span><b>${booked}</b><small>${pct(booked, leads.length)} of inquiries</small></div>
        <div class="kpi"><span>Showings held</span><b>${shows.length}</b><small>${shows.reduce((s, x) => s + x.n, 0)} in person</small></div>
        <div class="kpi"><span>Leases signed</span><b>0</b><small>${W.inventory.filter((u) => /rented/i.test(u.status) && (F.b === 'all' || u.code === F.b)).map((u) => `${u.code} ${u.unit}`).join(' and ') || 'none'}${W.inventory.some((u) => /rented/i.test(u.status) && (F.b === 'all' || u.code === F.b)) ? ' rented by the building managers' : ''}</small></div>
        <div class="kpi"><span>Homes open</span><b>${open}</b><small>of ${units.length} units in the list</small></div>
      </section>

      <section class="rp-grid">
        <article class="rp-card rp-wide">
          <h2>Inquiries by day</h2>
          <div class="cols">${perDay.map((x) => `<div class="col" tabindex="0" data-tip="${esc(`${day(x.d, { weekday: 'long', month: 'short', day: 'numeric' })}: ${x.n} inquir${x.n === 1 ? 'y' : 'ies'}, ${x.b} showing${x.b === 1 ? '' : 's'} booked`)}"><span class="col-val">${x.n || ''}</span><i style="height:${(x.n / top) * 100}%"></i><span class="col-label">${esc(day(x.d, { weekday: 'short' }))}<br>${esc(day(x.d, { day: 'numeric' }))}</span></div>`).join('')}</div>
        </article>
        <article class="rp-card"><h2>Inquiries by home</h2>${bars(homeRows, leads.length, 'inquiry')}</article>
        <article class="rp-card"><h2>Where inquiries came from</h2>${bars(count(leads, (l) => l.s), leads.length, 'inquiry')}</article>
        <article class="rp-card rp-wide"><h2>From inquiry to lease</h2>${bars(funnel, 0, '')}</article>
      </section>

      ${W.notes?.length ? `<section class="rp-card rp-notes"><h2>Key takeaways</h2><ul>${W.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : ''}

      <section class="rp-sec">
        <h2>Showings: what prospects said</h2>
        ${shows.length ? `<div class="fb">${shows.map((s) => `<article class="fb-card"><header><b>${esc(homeName(s.u))}</b><span>${esc(day(s.d, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${s.n} in person</span></header><p>${esc(s.note)}</p></article>`).join('')}</div>` : '<p class="rp-empty">No showings this week for this filter.</p>'}
      </section>

      <section class="rp-sec">
        <h2>Buildings</h2>
        <div class="rp-table-wrap"><table class="rp-table">
          <thead><tr><th>Building</th><th class="num">Vacant</th><th class="num">Upcoming</th><th class="num">Total</th></tr></thead>
          <tbody>${W.buildings.map((b) => `<tr><td>${esc(b.b)}</td><td class="num">${b.vacant}</td><td class="num">${b.upcoming}</td><td class="num">${b.total}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${W.buildings.reduce((s, b) => s + b.vacant, 0)}</td><td class="num">${W.buildings.reduce((s, b) => s + b.upcoming, 0)}</td><td class="num">${W.buildings.reduce((s, b) => s + b.total, 0)}</td></tr></tfoot>
        </table></div>
      </section>

      <section class="rp-sec">
        <div class="rp-sec-head"><h2>Units</h2>
          <div class="rp-chips" role="group" aria-label="Status">${statuses.map((s) => `<button type="button" class="chip" data-st="${esc(s)}" aria-pressed="${s === 'all'}">${s === 'all' ? 'All' : s === 'Rented by the building manager' ? 'Rented by manager' : esc(s)}</button>`).join('')}</div>
        </div>
        <div class="rp-table-wrap"><table class="rp-table" id="rp-units">
          <thead><tr><th>Unit</th><th>Layout</th><th class="num">Sq ft</th><th class="num">Rent</th><th class="num">$/sq ft</th><th>Available</th><th>Status</th></tr></thead>
          <tbody>${units.map((u) => `<tr data-status="${esc(u.status)}"><td>${esc((R.buildingNames || {})[u.code] || u.code)} #${esc(u.unit)}</td><td>${esc(u.layout || [u.beds && `${u.beds} bed`, u.baths && `${u.baths} bath`].filter(Boolean).join(', ') || '—')}</td><td class="num">${u.sqft ? u.sqft.toLocaleString('en-CA') : '—'}</td><td class="num">${money(u.rent)}</td><td class="num">${u.rent && u.sqft ? `$${(u.rent / u.sqft).toFixed(2)}` : '—'}</td><td>${esc(u.avail || '—')}</td><td><span class="st st-${u.status === 'Open' ? 'open' : /rented/i.test(u.status) ? 'rented' : 'off'}">${esc(u.status)}</span></td></tr>`).join('')}</tbody>
        </table></div>
      </section>

      <p class="rp-foot">Figures come from Michael’s leasing log for Forth Gen. Prospects’ names, emails and phone numbers are left out of this report; the showing notes are Michael’s.</p>`;

    $$('[data-st]').forEach((b) => b.addEventListener('click', () => {
      $$('[data-st]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $$('#rp-units tbody tr').forEach((tr) => { tr.hidden = b.dataset.st !== 'all' && tr.dataset.status !== b.dataset.st; });
    }));
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
