// The homes map: Leaflet (self-hosted in assets/vendor/leaflet) with OpenStreetMap streets. home.js loads this file,
// and Leaflet, only when the map comes near the screen. One pin per neighbourhood when zoomed out (the West End's
// buildings sit too close together to tell apart), one pin per building when zoomed in; a pin lists its homes and
// each opens the home's pop-up.
(() => {
  const { $, $$, esc, money, avail, track } = window.V;
  const DATA = window.V.data;
  const HOMES = DATA.homes;
  const box = $('#homes-map');
  if (!box || !window.L || box.dataset.ready) return;
  box.dataset.ready = '1';
  box.innerHTML = '';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;

  const map = L.map(box, { scrollWheelZoom: false, dragging: !touch, zoomSnap: 0.5, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  const thumb = (h) => {
    const ph = h.photos ? { dir: h.ph, p: h.photos[0] } : (DATA.buildings[h.b] ? { dir: DATA.buildings[h.b].ph, p: DATA.buildings[h.b].photos[0] } : null);
    return ph ? `<img src="/assets/photos/${ph.dir}/${ph.p[0]}-${ph.p[4][0]}.webp${ph.p[5] ? `?v=${ph.p[5]}` : ''}" alt="" width="64" height="48" loading="lazy">` : '';
  };
  const icon = (label, cls = '') => L.divIcon({ className: `pin${cls}`, html: `<span>${esc(label)}</span>`, iconSize: [0, 0] });

  // building pins
  const bLayer = L.layerGroup();
  const markers = {};
  DATA.pins.forEach((p) => {
    const list = p.homes.map((id) => HOMES[id]);
    // round pins with the number of homes: three West End buildings stand within about 60 m of each other
    const from = Math.min(...list.map((h) => h.rent));
    const m = L.marker([p.lat, p.lng], { icon: icon(String(list.length), ' pin-b'), title: p.name, alt: `${p.name}: ${list.length} ${list.length === 1 ? 'home' : 'homes'}`, riseOnHover: true, keyboard: true });
    m.bindTooltip(`${esc(p.name)} · ${list.length === 1 ? `${money(from)}/mo` : `${list.length} homes from ${money(from)}`}`, { direction: 'top', offset: [0, -34] });
    m.bindPopup(() => `<div class="pin-pop"><b>${esc(p.name)}</b><span>${esc(p.street)} · ${esc(p.an)}</span>
      <ul>${list.map((h) => { const a = avail(h.av); return `<li><button type="button" data-open-home="${h.id}">${thumb(h)}<span><b>${money(h.rent)}<small>/mo</small></b> · ${esc(h.bl)} · ${a.now ? 'Available now' : esc(a.short)}<small>${esc(h.t)}</small></span></button></li>`; }).join('')}</ul></div>`,
      { maxWidth: 300, minWidth: 240, autoPanPadding: [24, 24] });
    m.on('popupopen', () => track('map_pin_open', { building: p.k }));
    m.addTo(bLayer);
    markers[p.k] = m;
  });

  // neighbourhood pins (zoomed out)
  const aLayer = L.layerGroup();
  const areaBounds = {};
  DATA.mapAreas.forEach((a) => {
    const pts = DATA.pins.filter((p) => p.area === a.id).map((p) => [p.lat, p.lng]);
    if (!pts.length) return;
    areaBounds[a.id] = L.latLngBounds(pts);
    const n = DATA.pins.filter((p) => p.area === a.id).reduce((s, p) => s + p.homes.length, 0);
    const m = L.marker(areaBounds[a.id].getCenter(), { icon: icon(`${a.name} · ${n} ${n === 1 ? 'home' : 'homes'}`, ' pin-area'), title: a.name, riseOnHover: true });
    m.on('click', () => { unlock(); focusArea(a.id); });
    m.addTo(aLayer);
  });

  const DETAIL_ZOOM = 14;
  const sync = () => {
    const near = map.getZoom() >= DETAIL_ZOOM;
    if (near) { if (map.hasLayer(aLayer)) map.removeLayer(aLayer); if (!map.hasLayer(bLayer)) bLayer.addTo(map); }
    else { if (map.hasLayer(bLayer)) map.removeLayer(bLayer); if (!map.hasLayer(aLayer)) aLayer.addTo(map); }
  };
  map.on('zoomend', sync);

  const all = L.latLngBounds(DATA.pins.map((p) => [p.lat, p.lng]));
  const fitAll = () => map.fitBounds(all, { padding: [36, 36], maxZoom: 15, animate: false });
  fitAll();
  sync();
  function focusArea(id) {
    const b = areaBounds[id];
    if (b) map.flyToBounds(b, { padding: [40, 40], maxZoom: 16, duration: reduceMotion ? 0 : 0.8 });
  }
  function focusPin(k) {
    const m = markers[k];
    if (!m) return;
    const go = () => { sync(); m.openPopup(); };
    map.once('moveend', go);
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16), { duration: reduceMotion ? 0 : 0.8 });
  }

  // phones: the page keeps scrolling over the map until it's tapped once
  const lock = $('.map-lock');
  function unlock() {
    if (!lock || lock.hidden) return;
    lock.hidden = true;
    map.dragging.enable();
  }
  if (lock) {
    lock.hidden = !touch;
    lock.addEventListener('click', unlock);
  }

  // the popups' homes, and the address list under the map
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-home]');
    if (!b) return;
    map.closePopup();
    window.V.openHome(b.dataset.openHome);
  });
  window.V.focusPin = (k) => { unlock(); focusPin(k); };
  $('[data-map-all]')?.addEventListener('click', () => { map.closePopup(); fitAll(); sync(); });
})();
