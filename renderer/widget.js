(() => {
  const $ = (id) => document.getElementById(id);
  const C = window.COUNTRIES || {};
  const HLS_HOST = 'https://hd-auth.skylinewebcams.com/live.m3u8?a=';

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
    $('wflag').textContent = window.flagEmoji(info.iso);
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
    $('wplay').textContent = st.playing ? '⏸' : '▶';
  });
  $('wclose').addEventListener('click', () => window.cam.closeWidget());
  $('wopen').addEventListener('click', () => window.cam.openMain());
  $('wvideo').addEventListener('click', (e) => { if (e.target === $('wvideo')) window.cam.openMain(); });

  let pinMode = 'desktop';
  function applyPin() {
    const onTop = pinMode === 'top';
    $('wpin').textContent = onTop ? '📌' : '📍';
    $('wpin').classList.toggle('on', onTop);
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
