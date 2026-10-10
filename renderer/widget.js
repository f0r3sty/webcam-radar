(() => {
  const $ = (id) => document.getElementById(id);
  const C = window.COUNTRIES || {};

  // Windows(旧系统无 emoji 字体)才用 SVG 图标/文字国旗；Mac 保持原样
  const IS_WIN = /win/i.test(navigator.platform);
  const WSVG = {
    prev: '<svg viewBox="0 0 24 24"><path d="M14 5 6 12l8 7zM20 5l-8 7 8 7z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M10 5l8 7-8 7zM4 5l8 7-8 7z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5 20 12 8 19z" fill="currentColor"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 2.5A6.5 6.5 0 0 0 5.5 9c0 4.6 6.5 12.5 6.5 12.5S18.5 13.6 18.5 9A6.5 6.5 0 0 0 12 2.5zm0 9a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  };
  function isoFlag(info) { return ((info && info.iso) || '').toUpperCase() || '·'; }
  if (IS_WIN) {
    const st = document.createElement('style');
    st.textContent = '.wbtn svg{width:13px;height:13px;display:block}#wpin.on{color:#22d3ee}' +
      '.wflag{font-size:9px;font-weight:700;background:rgba(0,0,0,.4);border-radius:5px;padding:1px 5px;color:#dbe3ee}';
    document.head.appendChild(st);
    $('wprev').innerHTML = WSVG.prev;
    $('wnext').innerHTML = WSVG.next;
    $('wplay').innerHTML = WSVG.pause;
    $('wpin').innerHTML = WSVG.pin;
    $('wclose').innerHTML = WSVG.close;
    $('wopen').innerHTML = WSVG.open;
  }

  const st = {
    list: [], idx: 0, current: null,
    interval: 120000, remaining: 120, playing: true,
    failed: new Set(), cache: new Map(),
  };
  let hls = null, watchdog = null, photoTimer = null;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function humanize(s) { return (s || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }

  async function token(cam) {
    let html = st.cache.get(cam.url);
    if (!html) {
      const r = await window.cam.getText(cam.url);
      if (!r || !r.ok || !r.text) return null;
      html = r.text; st.cache.set(cam.url, html);
    }
    const m = html.match(/livee\.m3u8\?a=([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }

  function destroy() {
    clearTimeout(watchdog);
    clearInterval(photoTimer); photoTimer = null;
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    const v = $('wvideo'); try { v.pause(); } catch (e) {}
    v.removeAttribute('src'); try { v.load(); } catch (e) {}
  }

  function showPhoto(cam) {
    const img = $('wphoto');
    $('wvideo').classList.add('hidden');
    img.classList.remove('hidden');
    let done = false;
    const load = () => { img.src = cam.url + (cam.url.includes('?') ? '&' : '?') + '_=' + Date.now(); };
    img.onload = () => { done = true; console.log('[wcam] photo:', cam.name); $('wload').classList.add('hidden'); };
    img.onerror = () => { if (!done) { st.failed.add(cam.url); next(); } };
    load();
    photoTimer = setInterval(load, 60000);
    watchdog = setTimeout(() => { if (!done) { st.failed.add(cam.url); next(); } }, 15000);
  }

  async function show(cam) {
    st.current = cam;
    const info = C[cam.country] || {};
    $('wflag').textContent = IS_WIN ? isoFlag(info) : window.flagEmoji(info.iso);
    $('wname').textContent = cam.name || '—';
    $('wload').classList.remove('hidden');
    st.remaining = Math.round(st.interval / 1000);

    destroy();
    $('wload').classList.remove('hidden');

    if (cam.kind === 'image') { showPhoto(cam); return; }
    $('wphoto').classList.add('hidden');
    $('wvideo').classList.remove('hidden');

    let url = null;
    if (cam.kind === 'bili') {
      let r = null;
      try { r = await window.cam.biliPlayUrl(cam.roomId); } catch (e) {}
      if (!r || !r.ok || !r.url) { st.failed.add(cam.url); console.log('[wcam] bili-offline:', cam.name); return next(); }
      url = r.url;
    } else {
      let tk = null;
      try { tk = await token(cam); } catch (e) {}
      if (!tk) { st.failed.add(cam.url); console.log('[wcam] no-stream:', cam.name); return next(); }
      url = HLS_HOST + tk;
    }

    const v = $('wvideo');
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({ enableWorker: true, maxBufferLength: 8, liveSyncDurationCount: 3, manifestLoadingTimeOut: 15000 });
      let rec = false;
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => { console.log('[wcam] playing:', cam.name); $('wload').classList.add('hidden'); v.play().catch(() => {}); });
      hls.on(window.Hls.Events.ERROR, (_e, d) => {
        if (!d.fatal || !hls) return;
        if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR && !rec) { rec = true; hls.startLoad(); }
        else if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && !rec) { rec = true; hls.recoverMediaError(); }
        else { st.failed.add(cam.url); next(); }
      });
      hls.loadSource(url); hls.attachMedia(v);
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url; v.onloadedmetadata = () => { $('wload').classList.add('hidden'); v.play().catch(() => {}); };
    }
    watchdog = setTimeout(() => { if (!$('wload').classList.contains('hidden')) { st.failed.add(cam.url); next(); } }, 16000);
  }

  function next() {
    if (!st.list.length) return;
    const pool = st.list.filter((c) => !st.failed.has(c.url));
    const arr = pool.length ? pool : st.list;
    st.idx = st.list.indexOf(arr[(Math.random() * arr.length) | 0]);
    show(st.list[st.idx]);
  }
  function prev() {
    if (!st.list.length) return;
    st.idx = (st.idx - 1 + st.list.length) % st.list.length;
    show(st.list[st.idx]);
  }

  // 计时
  setInterval(() => {
    if (st.playing) {
      st.remaining--;
      if (st.remaining <= 0) next();
    }
    $('wcount').textContent = st.playing ? Math.max(0, st.remaining) + 's' : '暂停';
  }, 1000);

  // 事件
  $('wnext').addEventListener('click', next);
  $('wprev').addEventListener('click', prev);
  $('wplay').addEventListener('click', () => {
    st.playing = !st.playing;
    if (IS_WIN) $('wplay').innerHTML = st.playing ? WSVG.pause : WSVG.play;
    else $('wplay').textContent = st.playing ? '⏸' : '▶';
  });
  $('wclose').addEventListener('click', () => window.cam.closeWidget());
  $('wopen').addEventListener('click', () => window.cam.openMain());
  $('wvideo').addEventListener('click', (e) => { if (e.target === $('wvideo')) window.cam.openMain(); });

  let pinMode = 'desktop';
  function applyPin() {
    const onTop = pinMode === 'top';
    if (IS_WIN) $('wpin').classList.toggle('on', onTop);
    else $('wpin').textContent = onTop ? '📍' : '📌';
    $('wpin').title = onTop ? '已置顶（点击沉到桌面）' : '已沉到桌面（点击置顶）';
  }
  $('wpin').addEventListener('click', () => {
    pinMode = pinMode === 'top' ? 'desktop' : 'top';
    applyPin(); // 立即反馈
    window.cam.setWidgetPin(pinMode);
  });

  (async () => {
    const cfg = await window.cam.getConfig();
    pinMode = cfg.widgetPin || 'desktop';
    if (cfg.interval) st.interval = Number(cfg.interval);
    applyPin();
    const cat = await window.cam.getCatalog();
    const all = (cat || []).filter((c) => c && c.url);
    // 按国家均匀取样，每国最多 50 个，避免被摄像头最多的国家刷屏
    const by = {};
    for (const c of all) (by[c.country] || (by[c.country] = [])).push(c);
    const pool = [];
    for (const k in by) {
      let arr = by[k];
      if (arr.length > 50) arr = shuffle(arr.slice()).slice(0, 50);
      pool.push(...arr);
    }
    st.list = pool;
    shuffle(st.list);
    next();
  })();
})();
