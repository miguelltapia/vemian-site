// Michael's showing scheduler (/schedule, not linked, not indexed). The page holds no secrets: the password, the
// managers' emails and the exact addresses are in the "Vemian showings" Google script (form-backend/Showings.gs),
// which checks the password on every request, books, moves and cancels the calendar events (Outlook is invited)
// and sends the emails, including the thank-you email to the prospect 30 minutes after each showing starts (not
// for a cancelled one). Every showing is 15 minutes, in Vancouver time: UTC−7 all year since BC's permanent
// daylight time (2026).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = JSON.parse($('#schedule-data').textContent);
  const SAVED = 'vemian-schedule';      // sessionStorage: the password, for this tab only
  const OFFSET = -7;                    // Vancouver, all year
  let PW = '';
  let MANAGERS = {};
  let THANKS = null;                    // is the script's thank-you trigger on? (false until setup has run)

  // ---------- Vancouver time ----------
  const vanToday = () => new Date(Date.now() + OFFSET * 3600000).toISOString().slice(0, 10);
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const clock = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
  const when = (date, time) => {
    const [y, mo, d] = date.split('-').map(Number);
    return `${DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]}, ${MONTHS[mo - 1]} ${d}, ${y} at ${clock(time)}`;
  };
  const times = [];
  for (let m = 8 * 60; m <= 20 * 60 + 45; m += 15) times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const timeOptions = (sel) => times.map((t) => `<option value="${t}"${t === sel ? ' selected' : ''}>${clock(t)}</option>`).join('');

  // ---------- talking to the script ----------
  async function call(action, extra = {}) {
    if (!D.showingsEndpoint) throw new Error('The scheduler isn’t connected yet: follow form-backend/SHOWINGS-SETUP.md and add the script’s link as showingsEndpoint in source/config.mjs.');
    const res = await fetch(D.showingsEndpoint, { method: 'POST', body: JSON.stringify({ action, password: PW, ...extra }) });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok || !data.ok) { const err = new Error(data.error || `The script answered ${res.status}.`); err.auth = data.auth === false; throw err; }
    return data;
  }
  const sentText = (s = {}) => [
    s.calendar && 'Google Calendar updated',
    s.outlook && `${esc(D.outlook)} told`,
    s.prospect && `prospect emailed from ${esc(s.prospect)}`,
    s.manager && (/^not sent/.test(s.manager) ? `manager ${esc(s.manager)}` : `manager told at ${esc(s.manager)}`),
    s.thankAt && `thank-you email to the prospect at ${esc(s.thankAt)}`,
  ].filter(Boolean).join(' · ');
  // the thank-you email, as the list shows it (an older script sends no thank-you fields: show nothing)
  const thankText = (s) => !s.thankAt ? '' : s.thank === false ? 'No thank-you email' : s.thanked ? 'Thank-you email sent' : `Thank-you email at ${s.thankAt}, unless you cancel`;

  // ---------- lock ----------
  const lock = $('#lock');
  const form = $('#lock-form');
  const msg = $('.lock-msg', form);
  const app = $('#app');
  async function open(password, quiet) {
    PW = password;
    const btn = $('button', form);
    btn.disabled = true;
    if (!quiet) msg.textContent = 'Checking…';
    try {
      const r = await call('ping');
      MANAGERS = r.managers || {};
      THANKS = r.thanks;
      try { sessionStorage.setItem(SAVED, password); } catch { /* storage blocked */ }
      lock.hidden = true;
      app.hidden = false;
      start(r.account);
    } catch (e) {
      try { sessionStorage.removeItem(SAVED); } catch { /* storage blocked */ }
      msg.textContent = quiet ? '' : e.auth ? 'That password didn’t work.' : e.message;
    } finally { btn.disabled = false; }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); const pw = $('input', form).value; if (pw) open(pw, false); });
  let remembered = null;
  try { remembered = sessionStorage.getItem(SAVED); } catch { /* storage blocked */ }
  if (remembered) open(remembered, true); else $('input', form).focus();

  // ---------- book ----------
  function start(account) {
    app.innerHTML = `
      <header class="rp-top"><div class="wrap rp-top-in">
        <img src="/assets/brand/vemian-wordmark-56.png" srcset="/assets/brand/vemian-wordmark-112.png 2x" alt="Vemian" height="28">
        <div class="rp-title"><b>Showings</b><span>Calendar: ${esc(account || 'your Google account')} · 15 min · Vancouver time (UTC−7)</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-lock>Lock</button>
      </div></header>
      <div class="wrap sc-main">
        <form class="sc-card" id="sc-form" novalidate>
          <h1>Schedule a showing</h1>
          <div class="row-2">
            <div class="field"><label for="sc-b">Building</label><select class="select" id="sc-b" required><option value="">Choose…</option>${D.buildings.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="sc-u">Unit</label><select class="select" id="sc-u" required disabled><option value="">Pick the building first</option></select></div>
          </div>
          <div class="field" id="sc-other" hidden><label for="sc-unit">Unit number <span class="opt">(no listing link for this one)</span></label><input class="input" id="sc-unit" inputmode="text" maxlength="30" placeholder="e.g. 1406"></div>
          <div class="field"><label for="sc-email">Prospect’s email</label><input class="input" id="sc-email" type="email" autocomplete="off" required placeholder="name@example.com"></div>
          <div class="row-2">
            <div class="field"><label for="sc-date">Day</label><input class="input" id="sc-date" type="date" required min="${vanToday()}" value="${vanToday()}"></div>
            <div class="field"><label for="sc-time">Time <span class="opt">(15 min)</span></label><select class="select" id="sc-time" required>${timeOptions('17:00')}</select></div>
          </div>
          <div class="field"><label for="sc-note">Private note <span class="opt">(only in your calendar and Outlook)</span></label><input class="input" id="sc-note" maxlength="300"></div>
          <fieldset class="sc-sends"><legend class="label">Send</legend>
            <label class="check"><input type="checkbox" id="sc-p" checked> <span><b>Confirmation to the prospect</b>, from ${esc(D.prospectFrom)}: the listing, the address and a tap-to-text link to ${esc(D.textNumber)}</span></label>
            <label class="check"><input type="checkbox" id="sc-m" checked> <span><b>Note to the building manager</b>, from your Gmail: building, unit, day and time only <em id="sc-mgr"></em></span></label>
            <label class="check"><input type="checkbox" id="sc-o" checked> <span><b>Invitation to ${esc(D.outlook)}</b> with the listing, to accept in Outlook</span></label>
            <label class="check"><input type="checkbox" id="sc-t" checked> <span><b>Thank-you email to the prospect</b>, from ${esc(D.prospectFrom)}, 30 minutes after the showing starts: the listing and the link to apply. Not sent if you cancel the showing. ${THANKS === false ? '<em>(Off until you run setup once in the Google script.)</em>' : ''}</span></label>
          </fieldset>
          <p class="sc-when" id="sc-when" aria-live="polite"></p>
          <button class="btn btn-primary btn-block" type="submit" id="sc-go">Schedule showing</button>
          <p class="form-msg" id="sc-msg" role="alert"></p>
        </form>
        <section class="sc-card sc-list" aria-labelledby="sc-up">
          <div class="sc-list-head"><h2 id="sc-up">Upcoming showings</h2><button type="button" class="link" id="sc-refresh">Refresh</button></div>
          <p class="form-msg" id="sc-list-msg" role="status"></p>
          <div id="sc-items"><p class="rp-empty">Loading…</p></div>
        </section>
      </div>`;
    $('[data-lock]', app).addEventListener('click', () => { try { sessionStorage.removeItem(SAVED); } catch { /* storage blocked */ } location.reload(); });

    const b = $('#sc-b'), u = $('#sc-u'), other = $('#sc-other');
    const fill = () => {
      const list = D.homes.filter((h) => h.b === b.value);
      u.disabled = !b.value;
      // a listed home's value is its id (the emails link to its listing); "Another unit…" is typed in
      u.innerHTML = b.value ? `${list.map((h) => `<option value="${esc(h.id)}">#${esc(h.unit)} · ${esc(h.label)}</option>`).join('')}<option value="__other">Another unit…</option>` : '<option value="">Pick the building first</option>';
      other.hidden = !b.value || list.length > 0;
      if (b.value && !list.length) u.value = '__other';
      const known = Object.prototype.hasOwnProperty.call(MANAGERS, b.value);
      $('#sc-mgr').textContent = !b.value ? '' : known && MANAGERS[b.value] ? '' : '(no manager email for this building)';
      sum();
    };
    const sum = () => {
      const date = $('#sc-date').value, time = $('#sc-time').value;
      $('#sc-when').textContent = date && time ? `${when(date, time)} · 15 min · Vancouver time (UTC−7)` : '';
    };
    b.addEventListener('change', fill);
    u.addEventListener('change', () => { other.hidden = u.value !== '__other'; if (!other.hidden) $('#sc-unit').focus(); });
    ['#sc-date', '#sc-time'].forEach((s) => $(s).addEventListener('change', sum));
    sum();

    $('#sc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = $('#sc-msg');
      const home = D.homes.find((h) => h.id === u.value);
      const unit = home ? home.unit : $('#sc-unit').value.trim();
      const email = $('#sc-email').value.trim();
      const problems = [!b.value && 'pick the building', !unit && 'add the unit', !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) && 'enter the prospect’s email', !$('#sc-date').value && 'pick the day'].filter(Boolean);
      if (problems.length) { out.className = 'form-msg error'; out.textContent = `Please ${problems.join(', ')}.`; return; }
      const go = $('#sc-go');
      go.disabled = true;
      go.innerHTML = '<span class="spinner"></span> Scheduling…';
      out.className = 'form-msg';
      out.textContent = '';
      const bld = D.buildings.find((x) => x.id === b.value);
      try {
        const r = await call('schedule', {
          building: b.value, buildingName: bld?.name, address: bld?.street ? `${bld.street}, Vancouver, BC` : '', area: bld?.area || '', unit, home: home ? home.id : '', email,
          date: $('#sc-date').value, time: $('#sc-time').value, note: $('#sc-note').value.trim(),
          emailProspect: $('#sc-p').checked, emailManager: $('#sc-m').checked, outlook: $('#sc-o').checked, thankYou: $('#sc-t').checked,
        });
        out.className = 'form-msg sc-done';
        out.innerHTML = `<b>Scheduled: ${esc(r.place)}, ${esc(r.when)}.</b><br>${sentText(r.sent)}`;
        $('#sc-email').value = '';
        $('#sc-note').value = '';
        list();
      } catch (err) {
        out.className = 'form-msg error';
        out.textContent = err.auth ? 'The password stopped working. Lock and open the page again.' : `Not scheduled: ${err.message}`;
      } finally {
        go.disabled = false;
        go.textContent = 'Schedule showing';
      }
    });
    $('#sc-refresh').addEventListener('click', list);
    $('#sc-items').addEventListener('click', onItem);
    list();
  }

  // ---------- upcoming: reschedule or cancel ----------
  let ITEMS = [];
  async function list() {
    const box = $('#sc-items');
    try {
      const r = await call('list');
      ITEMS = r.showings || [];
      box.innerHTML = ITEMS.length ? `<ul class="sc-items">${ITEMS.map((s, i) => `<li data-i="${i}">
          <b>${esc(s.when)}</b><span>${esc(s.title)}</span>${s.prospect ? `<small>${esc(s.prospect)}</small>` : ''}${thankText(s) ? `<small>${esc(thankText(s))}</small>` : ''}
          <div class="sc-acts"><button type="button" class="btn btn-ghost btn-sm" data-act="move">Reschedule</button><button type="button" class="btn btn-ghost btn-sm sc-cancel" data-act="cancel">Cancel</button></div>
          <div class="sc-move" hidden>
            <div class="row-2"><div class="field"><label>New day</label><input class="input" type="date" min="${vanToday()}" value="${esc(s.date || vanToday())}"></div>
            <div class="field"><label>New time</label><select class="select">${timeOptions(s.time || '17:00')}</select></div></div>
            <div class="sc-acts"><button type="button" class="btn btn-primary btn-sm" data-act="save">Move showing</button><button type="button" class="link" data-act="close">Keep it</button></div>
          </div></li>`).join('')}</ul>` : '<p class="rp-empty">Nothing booked in the next 60 days.</p>';
    } catch (e) {
      box.innerHTML = `<p class="rp-empty">${esc(e.message)}</p>`;
    }
  }

  async function onItem(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const li = btn.closest('li');
    const s = ITEMS[Number(li.dataset.i)];
    const out = $('#sc-list-msg');
    const move = $('.sc-move', li);
    if (btn.dataset.act === 'move') { move.hidden = !move.hidden; return; }
    if (btn.dataset.act === 'close') { move.hidden = true; return; }
    const busy = (on, label) => { $$('button', li).forEach((x) => { x.disabled = on; }); if (on) btn.innerHTML = `<span class="spinner"></span> ${label}`; };
    try {
      if (btn.dataset.act === 'cancel') {
        if (!confirm(`Cancel the showing at ${s.title}, ${s.when}?\n\nThe prospect, the building manager and ${D.outlook} will be told${s.thankAt && !s.thanked ? ', and no thank-you email will go out' : ''}.`)) return;
        busy(true, 'Cancelling…');
        const r = await call('cancel', { id: s.id });
        out.className = 'form-msg sc-done';
        out.innerHTML = `<b>Cancelled: ${esc(r.place)}, ${esc(r.when)}.</b><br>${sentText(r.sent)}`;
      } else if (btn.dataset.act === 'save') {
        const date = $('input[type=date]', move).value, time = $('select', move).value;
        if (!date) return;
        busy(true, 'Moving…');
        const r = await call('reschedule', { id: s.id, date, time });
        out.className = 'form-msg sc-done';
        out.innerHTML = `<b>Moved: ${esc(r.place)}, now ${esc(r.when)}.</b><br>${sentText(r.sent)}`;
      }
      list();
    } catch (err) {
      out.className = 'form-msg error';
      out.textContent = err.auth ? 'The password stopped working. Lock and open the page again.' : err.message;
      busy(false);
      list();
    }
  }
})();
