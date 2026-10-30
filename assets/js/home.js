// Home page: ocean-view carousel, filters, the home pop-up (gallery, details, more homes),
// the full-screen photo viewer, the viewing/question form and the new-homes alert.
(() => {
  const { $, $$, esc, track, avail, money, openDlg, closeDlg, send, toast, share, config: C } = window.V;
  const DATA = JSON.parse($('#homes-data').textContent);
  const HOMES = DATA.homes;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const icon = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const img = (dir, p, sizes, eager) => `<img src="/assets/photos/${dir}/${p[0]}-${p[4][Math.min(1, p[4].length - 1)]}.webp" srcset="${p[4].map((w) => `/assets/photos/${dir}/${p[0]}-${w}.webp ${w}w`).join(', ')}" sizes="${sizes}" width="${p[2]}" height="${p[3]}" alt="${esc(p[1])}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;
  const homeName = (h) => `${h.bn} #${h.u}`;
  const homeUrl = (id) => `${location.pathname}?home=${encodeURIComponent(id)}`;

  // ---------- keep "Available …" labels current (a date that has passed reads "Available now") ----------
  function refreshDates(root = document) {
    $$('[data-avail]', root).forEach((el) => {
      const a = avail(el.dataset.avail);
      const fmt = el.dataset.fmt;
      if (fmt === 'when') { el.textContent = a.now ? 'Available now' : a.short; el.classList.toggle('now', a.now); }
      else if (fmt === 'badge') el.hidden = !a.now;
      else el.textContent = a.now ? 'Available now' : a.short;
    });
  }
  refreshDates();

  // ---------- carousels (ocean views, more homes) ----------
  function initCarousel(root) {
    const track = $('.track', root);
    const prev = $('[data-car="prev"]', root);
    const next = $('[data-car="next"]', root);
    if (!track || !prev) return;
    const step = () => (track.firstElementChild?.getBoundingClientRect().width || 300) + 16;
    const update = () => {
      prev.disabled = track.scrollLeft < 8;
      next.disabled = track.scrollLeft + track.clientWidth > track.scrollWidth - 8;
    };
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: reduceMotion.matches ? 'auto' : 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: reduceMotion.matches ? 'auto' : 'smooth' }));
    track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    // also re-measure when the track gets its size (e.g. the pop-up opening)
    new ResizeObserver(update).observe(track);
    update();
  }
  $$('[data-carousel]').forEach(initCarousel);

  // ---------- filters ----------
  const filterBar = $('.filters');
  const cards = $$('#homes .grid > .card');
  const areas = $$('#homes .area');
  const state = { area: 'all', beds: '', max: '', ocean: false, now: false, pets: false, sort: 'soon' };
  const sorters = {
    soon: (a, b) => avail(a.dataset.av).sort.localeCompare(avail(b.dataset.av).sort) || a.dataset.rent - b.dataset.rent,
    low: (a, b) => a.dataset.rent - b.dataset.rent,
    high: (a, b) => b.dataset.rent - a.dataset.rent,
    big: (a, b) => b.dataset.sqft - a.dataset.sqft,
  };
  const matches = (d) => (state.area === 'all' || d.area === state.area)
    && (!state.beds || (state.beds === '1' ? +d.beds === 1 : +d.beds >= 2))
    && (!state.max || +d.rent <= +state.max)
    && (!state.ocean || d.ocean === '1')
    && (!state.now || avail(d.av).now)
    && (!state.pets || d.pets === '1');
  const filtered = () => state.area !== 'all' || state.beds || state.max || state.ocean || state.now || state.pets;

  function applyFilters() {
    let shown = 0;
    areas.forEach((area) => {
      const grid = $('.grid', area);
      const list = [...grid.children].sort(sorters[state.sort]);
      list.forEach((c) => grid.append(c));
      let n = 0;
      list.forEach((c) => { const ok = matches(c.dataset); c.hidden = !ok; if (ok) n++; });
      area.hidden = n === 0;
      $('.area-count', area).textContent = `${n} ${n === 1 ? 'home' : 'homes'}`;
      shown += n;
    });
    $('#result-count').textContent = filtered() ? `Showing ${shown} of ${cards.length} homes` : `Showing all ${cards.length} homes`;
    $('#clear-filters').hidden = !filtered();
    $('#no-results').hidden = shown > 0;
  }
  function setFilters(fn) {
    fn();
    const run = () => applyFilters();
    if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(run);
    else run();
    track('filter_homes', { ...state });
  }
  if (filterBar) {
    // fade the right edge only while more filters are hidden off to the side
    const row = $('.filter-row', filterBar);
    const edge = () => row.classList.toggle('fade', row.scrollLeft + row.clientWidth < row.scrollWidth - 4);
    row.addEventListener('scroll', edge, { passive: true });
    new ResizeObserver(edge).observe(row);
    $$('.seg button', filterBar).forEach((b) => b.addEventListener('click', () => setFilters(() => {
      state.area = b.dataset.area;
      $$('.seg button', filterBar).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    })));
    $$('[data-toggle]', filterBar).forEach((b) => b.addEventListener('click', () => setFilters(() => {
      state[b.dataset.toggle] = !state[b.dataset.toggle];
      b.setAttribute('aria-pressed', String(state[b.dataset.toggle]));
    })));
    $$('select[data-filter]', filterBar).forEach((s) => s.addEventListener('change', () => setFilters(() => {
      state[s.dataset.filter] = s.value;
      s.parentElement.classList.toggle('on', !!s.value && s.dataset.filter !== 'sort');
    })));
    const clear = () => setFilters(() => {
      Object.assign(state, { area: 'all', beds: '', max: '', ocean: false, now: false, pets: false });
      $$('.seg button', filterBar).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.area === 'all')));
      $$('[data-toggle]', filterBar).forEach((x) => x.setAttribute('aria-pressed', 'false'));
      $$('select[data-filter]', filterBar).forEach((s) => { if (s.dataset.filter !== 'sort') { s.value = ''; s.parentElement.classList.remove('on'); } });
    });
    $('#clear-filters').addEventListener('click', clear);
    $('#no-results .btn').addEventListener('click', clear);
    // Neighbourhood links jump to that section; if filters are hiding it, clear them first.
    $$('[data-pick-area]').forEach((a) => a.addEventListener('click', () => {
      const area = $(`#${CSS.escape(a.dataset.pickArea)}`);
      if (area?.hidden || $$('.card', area || document).every((c) => c.hidden)) {
        Object.assign(state, { area: 'all', beds: '', max: '', ocean: false, now: false, pets: false });
        $$('.seg button', filterBar).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.area === 'all')));
        $$('[data-toggle]', filterBar).forEach((x) => x.setAttribute('aria-pressed', 'false'));
        $$('select[data-filter]', filterBar).forEach((s) => { if (s.dataset.filter !== 'sort') { s.value = ''; s.parentElement.classList.remove('on'); } });
        applyFilters();
      }
    }));
    applyFilters();
  }

  // ---------- photo viewer ----------
  const lb = $('#lb');
  const lbTrack = $('.lb-track', lb);
  const lbCount = $('.lb-count', lb);
  let lbList = [];
  function lbIndex() { return Math.round(lbTrack.scrollLeft / Math.max(1, lbTrack.clientWidth)); }
  function lbUpdate() {
    const i = lbIndex();
    lbCount.textContent = `${i + 1} / ${lbList.length}`;
    $('.lb-prev', lb).disabled = i <= 0;
    $('.lb-next', lb).disabled = i >= lbList.length - 1;
  }
  function openViewer(list, start = 0) {
    lbList = list;
    lbTrack.innerHTML = list.map((x, i) => `<figure>${img(x.dir, x.p, '100vw', Math.abs(i - start) <= 1)}<figcaption>${esc(x.p[1])}</figcaption></figure>`).join('');
    openDlg(lb);
    lbTrack.style.scrollBehavior = 'auto';
    lbTrack.scrollLeft = start * lbTrack.clientWidth;
    lbTrack.style.scrollBehavior = '';
    lbUpdate();
    lbTrack.focus({ preventScroll: true });
    track('photo_viewer_open');
  }
  const lbGo = (d) => lbTrack.scrollTo({ left: (lbIndex() + d) * lbTrack.clientWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  lbTrack.addEventListener('scroll', () => requestAnimationFrame(lbUpdate), { passive: true });
  $('.lb-prev', lb).addEventListener('click', () => lbGo(-1));
  $('.lb-next', lb).addEventListener('click', () => lbGo(1));
  lb.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); lbGo(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); lbGo(1); }
  });
  addEventListener('resize', () => { if (lb.open) { const i = lbIndex(); lbTrack.style.scrollBehavior = 'auto'; lbTrack.scrollLeft = i * lbTrack.clientWidth; lbTrack.style.scrollBehavior = ''; } });

  // ---------- the home pop-up ----------
  const dlg = $('#home');
  const scroller = $('.hd-scroll', dlg);
  const inner = $('.hd-inner', dlg);
  const top = $('.hd-top', dlg);
  const baseTitle = document.title;
  let cur = null;
  let pushed = false;
  let closingFromHistory = false;

  // the order on screen right now (filters and sort applied)
  const orderVisible = () => $$('#homes .grid > .card').filter((c) => !c.hidden && !c.closest('.area')?.hidden).map((c) => c.dataset.id);
  const orderAll = () => $$('#homes .grid > .card').map((c) => c.dataset.id);

  // the suite's photos, the building's when the suite has none, or both when the listing asks for it
  function gallerySet(h) {
    const b = DATA.buildings[h.b];
    const bset = b ? b.photos.map((p) => ({ dir: b.ph, p })) : [];
    if (!h.photos) return bset;
    const own = h.photos.map((p) => ({ dir: h.ph, p }));
    return h.addB ? own.concat(bset) : own;
  }

  function moreHomes(h) {
    const others = orderAll().filter((id) => id !== h.id).map((id) => HOMES[id]);
    const score = (o) => (o.area === h.area ? 0 : 10000) + Math.abs(o.rent - h.rent) + (o.beds === h.beds ? 0 : 400);
    return others.sort((a, b) => score(a) - score(b)).slice(0, 8);
  }

  function render(id) {
    const h = HOMES[id];
    const card = $(`#homes .card[data-id="${CSS.escape(id)}"]`);
    const set = gallerySet(h);
    const n = set.length;
    const a = avail(h.av);
    const bld = DATA.buildings[h.b];
    const gal = set.map((x, i) => `<button type="button" data-lb="${i}" aria-label="Photo ${i + 1} of ${n}: ${esc(x.p[1])}">${img(x.dir, x.p, i === 0 ? '(max-width: 899px) 100vw, 640px' : '(max-width: 899px) 100vw, 300px', i === 0)}</button>`).join('');
    const size = h.sqft ? `${h.sqft.toLocaleString('en-CA')} sq ft${h.balcony ? ` + ${h.balcony} balcony` : ''}` : '';
    const beds = `${h.beds} bed${h.den ? ' + den' : ''}${h.flex ? ' + flex' : ''}`;

    inner.innerHTML = `
      <div class="gal-wrap">
        <div class="gal n${Math.min(n, 5)}" id="hd-gal">${gal}</div>
        ${n > 5 ? `<button type="button" class="gal-all" data-tour>${icon('grid')} Show all ${n} photos</button>` : ''}
        <span class="gal-count" aria-hidden="true">1 / ${n}</span>
      </div>
      ${h.label ? `<p class="gal-label">${icon('info')}<span>${esc(h.label)}</span></p>` : ''}
      <div class="hd-grid">
        <div class="hd-main">
          <div class="hd-badges">
            ${a.now ? '<span class="badge badge-now">Available now</span>' : `<span class="badge">${icon('cal')} ${esc(a.label)}</span>`}
            ${h.badge ? `<span class="badge">${esc(h.badge)}</span>` : ''}
            ${h.vt ? `<span class="badge">${icon('wave')} ${esc(h.vt)}</span>` : ''}
          </div>
          <h2 id="hd-title">${esc(h.t)}</h2>
          <p class="hd-addr">${icon('pin')}<span>${esc(homeName(h))} · ${esc(h.street)}, ${esc(h.an)}, Vancouver</span></p>
          <dl class="hd-quick">
            <div><dt>${icon('bed')} Bedrooms</dt><dd>${esc(beds)}</dd></div>
            <div><dt>${icon('bath')} Bathrooms</dt><dd>${h.baths}</dd></div>
            ${size ? `<div><dt>${icon('size')} Size</dt><dd>${esc(size)}</dd></div>` : ''}
            <div><dt>${icon('cal')} Move in</dt><dd>${esc(a.now ? 'Now' : a.short)}</dd></div>
          </dl>
          ${card ? $('.card-more', card).innerHTML : ''}
        </div>
        <aside class="hd-aside" aria-label="Rent and next steps">
          <div class="price-card">
            <p class="pc-rent"><b>${money(h.rent)}</b>/ month</p>
            <p class="pc-av${a.now ? ' now' : ''}"><span class="dot"></span>${esc(a.label)}</p>
            <button type="button" class="btn btn-primary btn-block" data-act="viewing">${icon('cal')} Book a viewing</button>
            <a class="btn btn-ghost btn-block" href="/apply?home=${encodeURIComponent(h.id)}" data-act="apply">Apply for this home</a>
            <button type="button" class="link pc-ask" data-act="ask">Ask ${esc(C.person)} a question</button>
            <div class="pc-person">
              <img src="/assets/brand/michael-128.webp" alt="" width="44" height="44" loading="lazy">
              <div><b>${esc(C.person)}, Vemian</b><span>${$('.talk')?.classList.contains('active') ? 'Active now' : 'Replies soon'}</span></div>
            </div>
            <p class="pc-small">Call or text <a href="tel:${esc(C.phone)}">${esc(C.phoneLabel)}</a></p>
          </div>
        </aside>
      </div>
      <section class="more" aria-labelledby="more-title" data-carousel>
        <div class="more-head">
          <h3 id="more-title">More homes you might like</h3>
          <div class="car-nav">
            <button type="button" class="icon-btn" data-car="prev" aria-label="Previous homes">${icon('left')}</button>
            <button type="button" class="icon-btn" data-car="next" aria-label="More homes">${icon('right')}</button>
          </div>
        </div>
        <div class="track more-track"></div>
      </section>`;

    // slots inside the details
    const video = $('[data-slot="video"]', inner);
    if (video && h.video) {
      video.outerHTML = `<section class="hd-sec"><h3>Video tour</h3><button type="button" class="video-lite" data-video="${esc(h.video)}" aria-label="Play the video tour">
        <img src="https://i.ytimg.com/vi/${esc(h.video)}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span class="play"></span><span class="lbl">Video tour</span></button></section>`;
    }
    const plan = $('[data-slot="plan"]', inner);
    if (plan && h.floorplan && h.photos) {
      const i = h.photos.findIndex((p) => p[0] === h.floorplan);
      if (i >= 0) plan.outerHTML = `<section class="hd-sec"><h3>Floor plan</h3><button type="button" class="plan-btn" data-lb="${i}" aria-label="Open the floor plan">${img(h.ph, h.photos[i], '(max-width: 899px) 100vw, 520px')}</button></section>`;
    }
    const strip = $('[data-slot="bstrip"]', inner);
    if (strip) {
      // the building's photos are already in the gallery when the suite has none (or adds them)
      if (bld && h.photos && !h.addB) strip.innerHTML = bld.photos.map((p, i) => `<button type="button" data-blb="${i}" aria-label="${esc(p[1])}">${img(bld.ph, p, '(max-width: 899px) 62vw, 240px')}</button>`).join('');
      else strip.remove();
    }
    const tour = $('[data-slot="tour"]', inner);
    if (tour) {
      tour.outerHTML = `<section class="hd-sec" id="hd-tour"><h3>All ${n} photos</h3><div class="tour">${set.map((x, i) => `<button type="button" class="${i % 5 === 0 ? 'wide' : ''}" data-lb="${i}" aria-label="Open photo ${i + 1}: ${esc(x.p[1])}">${img(x.dir, x.p, i % 5 === 0 ? '(max-width: 899px) 100vw, 720px' : '(max-width: 899px) 100vw, 360px')}<figcaption>${esc(x.p[1])}</figcaption></button>`).join('')}</div></section>`;
    }

    // more homes: copies of the page's own cards
    const moreTrack = $('.more-track', inner);
    moreHomes(h).forEach((o) => {
      const src = $(`#homes .card[data-id="${CSS.escape(o.id)}"]`);
      if (!src) return;
      const c = src.cloneNode(true);
      c.hidden = false;
      c.removeAttribute('style');
      $('.card-more', c)?.remove();
      $$('img', c).forEach((im) => { im.sizes = '(max-width: 899px) 78vw, 300px'; im.loading = 'lazy'; im.removeAttribute('fetchpriority'); });
      const h4 = $('h4', c);
      if (h4) h4.outerHTML = `<p class="h4">${h4.innerHTML}</p>`;
      moreTrack.append(c);
    });
    initCarousel($('.more', inner));
    refreshDates(inner);

    // mobile sticky bar
    $('.hd-bar', dlg).innerHTML = `<div class="bar-price"><b>${money(h.rent)}<small> /mo</small></b><span>${esc(a.label)}</span></div>
      <button type="button" class="btn btn-ghost" data-act="viewing">Book viewing</button>
      <a class="btn btn-primary" href="/apply?home=${encodeURIComponent(h.id)}" data-act="apply">Apply</a>`;
    $('.hd-crumb', dlg).innerHTML = `${esc(h.an)} · <b>${esc(homeName(h))}</b>`;
    const list = orderVisible().includes(id) ? orderVisible() : orderAll();
    const at = list.indexOf(id);
    $('.hd-prev', dlg).disabled = at <= 0;
    $('.hd-next', dlg).disabled = at < 0 || at >= list.length - 1;
    $('.hd-prev', dlg).dataset.to = list[at - 1] || '';
    $('.hd-next', dlg).dataset.to = list[at + 1] || '';
    document.title = `${h.t} · ${homeName(h)} | ${C.name}`;
    cur = id;
  }

  function openHome(id, { push = true } = {}) {
    if (!HOMES[id]) return;
    if (dlg.open) {
      if (id === cur) return;
      inner.classList.add('swap');
      setTimeout(() => {
        render(id);
        scroller.scrollTo({ top: 0, behavior: 'auto' });
        top.classList.remove('solid');
        inner.classList.remove('swap');
      }, reduceMotion.matches ? 0 : 180);
      history.replaceState({ home: id }, '', homeUrl(id));
    } else {
      render(id);
      scroller.scrollTop = 0;
      top.classList.remove('solid');
      openDlg(dlg);
      $('.hd-close', dlg).focus({ preventScroll: true });
      if (push) { history.pushState({ home: id }, '', homeUrl(id)); pushed = true; }
    }
    track('view_home', { home_id: id, rent: HOMES[id].rent });
  }

  dlg.addEventListener('close', () => {
    document.title = baseTitle;
    const iframe = $('iframe', dlg);
    if (iframe) iframe.remove();
    if (!closingFromHistory) {
      if (pushed) history.back();
      else history.replaceState(null, '', location.pathname + location.hash);
    }
    pushed = false;
    closingFromHistory = false;
    // return focus to the card that opened it
    $(`#homes .card[data-id="${CSS.escape(cur || '')}"] .card-link`)?.focus({ preventScroll: true });
  });
  addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('home');
    if (id && HOMES[id]) { if (!dlg.open) { pushed = false; openHome(id, { push: false }); } else if (id !== cur) openHome(id, { push: false }); }
    else if (dlg.open) { closingFromHistory = true; pushed = false; closeDlg(dlg); }
  });

  // clicks anywhere: cards, view tiles, more-homes cards
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-home]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openHome(a.dataset.home);
  });

  // clicks inside the pop-up
  dlg.addEventListener('click', (e) => {
    const t = e.target;
    const h = HOMES[cur];
    if (!h) return;
    const lbBtn = t.closest('[data-lb]');
    if (lbBtn) { openViewer(gallerySet(h), +lbBtn.dataset.lb); return; }
    const bBtn = t.closest('[data-blb]');
    if (bBtn) { const b = DATA.buildings[h.b]; openViewer(b.photos.map((p) => ({ dir: b.ph, p })), +bBtn.dataset.blb); return; }
    if (t.closest('[data-tour]')) { $('#hd-tour', dlg)?.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' }); return; }
    const v = t.closest('[data-video]');
    if (v) {
      v.outerHTML = `<iframe class="video-frame" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.dataset.video)}?autoplay=1&rel=0&playsinline=1" title="Video tour of ${esc(homeName(h))}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      track('video_play', { home_id: h.id });
      return;
    }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'viewing') openContact({ mode: 'viewing', home: h.id });
    else if (act === 'ask') openContact({ mode: 'question', home: h.id });
    else if (act === 'apply') track('apply_click', { home_id: h.id });
  });
  $('.hd-close', dlg).addEventListener('click', () => closeDlg(dlg));
  $('.hd-prev', dlg).addEventListener('click', (e) => { if (e.currentTarget.dataset.to) openHome(e.currentTarget.dataset.to); });
  $('.hd-next', dlg).addEventListener('click', (e) => { if (e.currentTarget.dataset.to) openHome(e.currentTarget.dataset.to); });
  $('.share-btn', dlg).addEventListener('click', () => {
    const h = HOMES[cur];
    share(`${C.site}/?home=${encodeURIComponent(cur)}`, `${h.t} · ${homeName(h)} | ${C.name}`);
    track('share_home', { home_id: cur });
  });
  // phone gallery counter + solid top bar once the photos scroll away
  dlg.addEventListener('scroll', (e) => {
    const g = e.target;
    if (g.id === 'hd-gal') {
      const c = $('.gal-count', dlg);
      if (c) c.textContent = `${Math.round(g.scrollLeft / Math.max(1, g.clientWidth)) + 1} / ${g.children.length}`;
    }
  }, true);
  scroller.addEventListener('scroll', () => {
    const g = $('#hd-gal', dlg);
    top.classList.toggle('solid', !!g && scroller.scrollTop > g.offsetHeight - 70);
  }, { passive: true });

  // ---------- viewing / question form ----------
  const ct = $('#contact');
  const ctForm = $('#ct-form');
  const ctHome = $('#ct-home');
  const ctDone = $('.done', ct);
  function pill(id) {
    const h = HOMES[id];
    const p = $('#ct-pill');
    if (!h) { p.hidden = true; return; }
    const set = gallerySet(h);
    const x = set[0];
    p.innerHTML = `${x ? img(x.dir, x.p, '64px') : ''}<div><b>${esc(h.t)}</b><span>${esc(homeName(h))} · ${money(h.rent)}/mo · ${esc(avail(h.av).label)}</span></div>`;
    p.hidden = false;
  }
  function openContact({ mode = 'viewing', home = '' } = {}) {
    ct.dataset.mode = mode;
    ctForm.hidden = false;
    ctDone.hidden = true;
    $('.form-msg', ctForm).textContent = '';
    $('#ct-title').textContent = mode === 'viewing' ? 'Book a viewing' : `Ask ${C.person} a question`;
    $('#ct-sub').textContent = mode === 'viewing'
      ? `Tell ${C.person} when suits you. He’ll text you to confirm a time.`
      : `${C.person} answers by text or email, usually the same day.`;
    $$('[data-mode="viewing"]', ctForm).forEach((el) => { el.hidden = mode !== 'viewing'; });
    $('#ct-msg-label').firstChild.textContent = mode === 'viewing' ? 'Anything else? ' : 'Your question ';
    $('#ct-msg').required = mode !== 'viewing';
    $('#ct-msg-label .opt').hidden = mode !== 'viewing';
    ctHome.value = home && HOMES[home] ? home : (ctHome.value || '');
    pill(ctHome.value);
    openDlg(ct);
    setTimeout(() => $('#ct-name').focus(), 80);
    track(mode === 'viewing' ? 'viewing_form_open' : 'question_form_open', { home_id: home });
  }
  window.V.openContact = openContact;
  ctHome.addEventListener('change', () => pill(ctHome.value));
  $$('[data-contact]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openContact({ mode: b.dataset.contact || 'viewing', home: b.dataset.home || '' }); }));

  function validate(form) {
    let first = null;
    $$('.field', form).forEach((f) => {
      if (f.closest('[hidden]')) { f.classList.remove('invalid'); return; }
      const el = $('input, select, textarea', f);
      if (!el) return;
      let ok = el.checkValidity();
      if (ok && el.type === 'tel' && el.value.trim()) ok = el.value.replace(/\D/g, '').length >= 10;
      f.classList.toggle('invalid', !ok);
      if (!ok && !first) first = el;
    });
    if (first) first.focus();
    return !first;
  }
  ctForm.addEventListener('input', (e) => e.target.closest('.field')?.classList.remove('invalid'));
  ctForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate(ctForm)) return;
    const f = new FormData(ctForm);
    if (f.get('company')) return;
    const mode = ct.dataset.mode;
    const h = HOMES[f.get('home')];
    const label = h ? `${homeName(h)}, ${h.street} (${money(h.rent)}/mo)` : 'Not sure yet';
    const times = f.getAll('times').join(', ');
    const btn = $('button[type=submit]', ctForm);
    const msg = $('.form-msg', ctForm);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending…';
    msg.textContent = '';
    msg.className = 'form-msg';
    try {
      const how = await send({
        type: mode,
        subject: `${mode === 'viewing' ? 'Viewing request' : 'Question'} · ${h ? homeName(h) : 'any home'} · ${f.get('name')}`,
        name: f.get('name'), email: f.get('email'), phone: f.get('phone'), replyTo: f.get('email'),
        home: label, message: f.get('message'),
        sections: [{
          title: mode === 'viewing' ? 'Viewing request' : 'Question',
          rows: [['Home', label], ['Name', f.get('name')], ['Phone', f.get('phone')], ['Email', f.get('email')],
            ...(mode === 'viewing' ? [['Best times to view', times], ['Move-in date', f.get('movein')], ['People moving in', f.get('people')]] : []),
            ['Message', f.get('message')]],
        }],
      });
      ctForm.hidden = true;
      ctDone.hidden = false;
      const first = String(f.get('name')).trim().split(' ')[0];
      $('h3', ctDone).textContent = how === 'sent' ? `Thanks, ${first}!` : 'Almost there';
      $('p', ctDone).textContent = how === 'sent'
        ? (mode === 'viewing' ? `${C.person} will text you at ${f.get('phone')} to confirm a time.` : `${C.person} will get back to you shortly.`)
        : 'Your email app opened with everything filled in. Press send and it goes straight to Michael.';
      const applyA = $('[data-done-apply]', ctDone);
      applyA.href = `/apply${h ? `?home=${encodeURIComponent(h.id)}` : ''}`;
      ctForm.reset();
      pill('');
      track(mode === 'viewing' ? 'viewing_request_sent' : 'question_sent', { home_id: h?.id || '', method: how });
    } catch {
      msg.textContent = `Sorry, that didn’t go through. Please text or call ${C.person} at ${C.phoneLabel}.`;
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send to Michael';
    }
  });

  // ---------- new homes alert ----------
  const al = $('#alerts-form');
  if (al) {
    al.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(al);
      const email = String(f.get('email') || '').trim();
      const msg = $('.form-msg', al);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Please enter your email.'; $('input[type=email]', al).focus(); return; }
      if (f.get('company')) return;
      const btn = $('button[type=submit]', al);
      btn.disabled = true;
      try {
        const how = await send({
          type: 'alerts', subject: `New-homes alert · ${email}`, email, replyTo: email,
          sections: [{ title: 'Send me new homes first', rows: [['Email', email], ['Bedrooms', f.get('beds') || 'Any'], ['Budget', f.get('budget') || 'Any']] }],
        });
        al.innerHTML = `<p class="form-msg" style="font-size:1.05rem">${how === 'sent' ? 'You’re on the list. New homes will reach you before they’re posted anywhere else.' : 'Your email app opened. Press send and you’re on the list.'}</p>`;
        track('alerts_signup', { method: how });
      } catch {
        msg.textContent = `Sorry, that didn’t go through. Email ${C.email} instead.`;
        btn.disabled = false;
      }
    });
  }

  // ---------- open from the address bar: ?home=… (a home) or ?book=1 (the viewing form) ----------
  const q = new URLSearchParams(location.search);
  const start = q.get('home');
  if (q.has('book')) {
    history.replaceState(null, '', location.pathname + location.hash);
    openContact({ mode: 'viewing', home: HOMES[start] ? start : '' });
  } else if (start && HOMES[start]) { history.replaceState({ home: start }, ''); openHome(start, { push: false }); }
})();
