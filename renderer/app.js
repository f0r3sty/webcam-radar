(() => {
  const $ = (id) => document.getElementById(id);
  const C = window.COUNTRIES || {};

  const HLS_HOST = 'https://hd-auth.skylinewebcams.com/live.m3u8?a=';

  const state = {
    catalog: [],
    list: [],
    idx: 0,
    interval: 120000,
    remaining: 120,
    playing: true,
    order: 'shuffle',
    country: '',
    current: null,
    failed: new Set(),
    pageCache: new Map(), // url -> html
  };

  let hls = null;
  let watchdog = null;
  let photoTimer = null;
  let failStreak = 0;

  // ---------- 地图 ----------
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    worldCopyJump: true,
    minZoom: 1,
    maxZoom: 12,
    zoomSnap: 0.5,
  }).setView([25, 20], 2);

  L.tileLayer(
    'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
    { subdomains: '1234', maxZoom: 18 }
  ).addTo(map);

  const marker = L.circleMarker([0, 0], {
    radius: 7,
    color: '#22d3ee',
    weight: 2,
    fillColor: '#22d3ee',
    fillOpacity: 0.5,
  }).addTo(map);
  marker.bindTooltip('', { direction: 'top' });

  // ---------- 工具 ----------
  function humanize(slug) {
    return (slug || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }
  function approxLocalTime(lon) {
    const off = Math.round(lon / 15);
    const t = new Date(Date.now() + off * 3600000);
    return (
      String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0')
    );
  }
  function sceneOf(cam) {
    if (cam.desc) return cam.desc;
    return humanize(cam.region);
  }

  // ---------- 播放 ----------
  function destroyHls() {
    clearTimeout(watchdog);
    clearInterval(photoTimer);
    photoTimer = null;
    if (hls) {
      try { hls.destroy(); } catch (e) {}
      hls = null;
    }
    const v = $('video');
    try { v.pause(); } catch (e) {}
    v.removeAttribute('src');
    try { v.load(); } catch (e) {}
  }

  function buildList() {
    const base = state.country
      ? state.catalog.filter((c) => c.country === state.country)
      : state.catalog.slice();
    state.list = base;
    $('totalBadge').textContent = base.length;
    if (state.order === 'shuffle') shuffle(state.list);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function extractToken(cam) {
    let html = state.pageCache.get(cam.url);
    if (!html) {
      const res = await window.cam.getText(cam.url);
      if (!res || !res.ok || !res.text) return null;
      html = res.text;
      state.pageCache.set(cam.url, html);
    }
    const m = html.match(/livee\.m3u8\?a=([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }

  function updateOverlay(cam) {
    const info = C[cam.country] || {};
    $('camFlag').textContent = window.flagEmoji(info.iso);
    $('camName').textContent = cam.name || '—';
    $('camCountry').textContent = info.n || humanize(cam.country);
    $('camCity').textContent = humanize(cam.city);
    $('camScene').textContent = sceneOf(cam);
    const ll = [
      Number.isFinite(cam.lat) ? cam.lat : info.lat || 0,
      Number.isFinite(cam.lon) ? cam.lon : info.lon || 0,
    ];
    marker.setLatLng(ll);
    marker.setTooltipContent(window.flagEmoji(info.iso) + ' ' + (cam.name || ''));
    map.flyTo(ll, Number.isFinite(cam.lat) ? 9 : 4, { duration: 1.1 });
  }

  function updateNext() {
    if (!state.list.length) return;
    const nxt = state.list[(state.idx + 1) % state.list.length];
    $('nextName').textContent = nxt.name || '—';
    const info = C[nxt.country] || {};
    $('nextMeta').textContent = (info.n || humanize(nxt.country)) + ' · ' + humanize(nxt.city);
    $('nextThumb').src = nxt.thumb || '';
  }

  function loadPhoto(cam) {
    const img = $('photo');
    img.src = cam.url + (cam.url.includes('?') ? '&' : '?') + '_=' + Date.now();
  }

  function showPhoto(cam) {
    const img = $('photo');
    $('video').classList.add('hidden');
    img.classList.remove('hidden');
    let done = false;
    img.onload = () => {
      done = true;
      failStreak = 0;
      console.log('[cam] photo:', cam.name);
      $('loading').classList.add('hidden');
      $('status').textContent = '快照 · 每 2 分钟更新';
    };
    img.onerror = () => {
      if (done) return;
      state.failed.add(cam.url);
      console.log('[cam] photo-fail:', cam.name);
      $('status').textContent = '（快照失败）换下一个';
      next(true);
    };
    loadPhoto(cam);
    photoTimer = setInterval(() => loadPhoto(cam), 60000);
    watchdog = setTimeout(() => { if (!done) { state.failed.add(cam.url); next(true); } }, 15000);
  }

  async function showCam(cam, { isSkip } = {}) {
    state.current = cam;
    updateOverlay(cam);
    updateNext();
    $('progressBar').style.width = '0%';
    state.remaining = Math.round(state.interval / 1000);
    $('status').textContent = '连线中…';

    destroyHls();
    $('loading').classList.remove('hidden');
    $('loadingText').textContent = '正在连线 ' + (cam.name || '');

    // 快照类摄像头（JPEG，每 2 分钟更新，无直播流）
    if (cam.kind === 'image') {
      showPhoto(cam);
      return;
    }

    $('photo').classList.add('hidden');
    $('video').classList.remove('hidden');

    let url = null;
    if (cam.kind === 'bili') {
      let r = null;
      try { r = await window.cam.biliPlayUrl(cam.roomId); } catch (e) {}
      if (!r || !r.ok || !r.url) {
        state.failed.add(cam.url);
        console.log('[cam] bili-offline:', cam.name);
        $('status').textContent = '直播间未开播，跳过';
        return next(true);
      }
      url = r.url;
    } else {
      let token = null;
      try { token = await extractToken(cam); } catch (e) {}
      if (!token) {
        state.failed.add(cam.url);
        console.log('[cam] no-stream:', cam.name);
        $('status').textContent = '此摄像头无可用直播流，跳过';
        return next(true);
      }
      url = HLS_HOST + token;
    }

    playHls(url, cam);
  }

  function playHls(url, cam) {
    const video = $('video');
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls({
        lowLatencyMode: false,
        enableWorker: true,
        maxBufferLength: 8,
        liveSyncDurationCount: 3,
        manifestLoadingTimeOut: 15000,
      });
      let recovered = false;
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        failStreak = 0;
        console.log('[cam] playing:', cam.name, '|', url.slice(0, 70));
        $('loading').classList.add('hidden');
        $('status').textContent = '播放中';
        video.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal || !hls) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && !recovered) {
          recovered = true;
          hls.startLoad();
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
          recovered = true;
          hls.recoverMediaError();
        } else {
          onFail(cam, '流中断');
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.onloadedmetadata = () => {
        $('loading').classList.add('hidden');
        video.play().catch(() => {});
      };
    }

    watchdog = setTimeout(() => {
      if ($('loading').classList.contains('hidden')) return;
      onFail(cam, '连接超时');
    }, 16000);
  }

  function onFail(cam, why) {
    state.failed.add(cam.url);
    console.log('[cam] fail:', cam.name, why);
    $('status').textContent = '（' + why + '）换下一个';
    next(true);
  }

  function pickIndex() {
    if (!state.list.length) return 0;
    if (state.order === 'seq') return (state.idx + 1) % state.list.length;
    // shuffle: 随机挑一个不在失败集合里的
    const ok = state.list.filter((c) => !state.failed.has(c.url));
    const pool = ok.length ? ok : state.list;
    return state.list.indexOf(pool[Math.floor(Math.random() * pool.length)]);
  }

  function next(isSkip) {
    if (isSkip) failStreak++;
    else failStreak = 0;
    if (failStreak > 12) {
      $('status').textContent = '连续失败过多，暂停 30 秒…';
      state.remaining = 30;
      return;
    }
    if (!state.list.length) return;
    state.idx = pickIndex();
    showCam(state.list[state.idx], { isSkip: true });
  }

  function prev() {
    if (!state.list.length) return;
    state.idx = (state.idx - 1 + state.list.length) % state.list.length;
    showCam(state.list[state.idx], { isSkip: true });
  }

  // ---------- 计时 ----------
  function fmt(sec) {
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m + '分' + String(s).padStart(2, '0') + '秒';
    }
    return sec + ' 秒';
  }

  setInterval(() => {
    const info = state.current && C[state.current.country];
    if (info) $('camClock').textContent = '≈ ' + approxLocalTime(info.lon) + ' 当地';

    if (state.playing) {
      state.remaining--;
      if (state.remaining <= 0) {
        next();
      }
    }
    const total = Math.round(state.interval / 1000) || 1;
    const pct = Math.max(0, Math.min(100, (1 - state.remaining / total) * 100));
    $('progressBar').style.width = pct + '%';
    $('countdown').textContent = state.playing
      ? fmt(Math.max(0, state.remaining)) + '后切换'
      : '已暂停';
  }, 1000);

  // ---------- 事件 ----------
  $('nextBtn').addEventListener('click', () => next());
  $('prevBtn').addEventListener('click', prev);
  $('playBtn').addEventListener('click', () => {
    state.playing = !state.playing;
    $('playBtn').textContent = state.playing ? '⏸' : '▶';
    $('playBtn').title = state.playing ? '暂停轮播' : '继续轮播';
  });
  $('interval').addEventListener('change', (e) => {
    state.interval = Number(e.target.value) * 1000;
    state.remaining = Math.round(state.interval / 1000);
    window.cam.setConfig({ interval: state.interval });
  });
  $('order').addEventListener('change', (e) => {
    state.order = e.target.value;
    buildList();
    updateNext();
  });
  $('country').addEventListener('change', (e) => {
    state.country = e.target.value;
    buildList();
    next();
  });
  $('detailBtn').addEventListener('click', () => {
    if (state.current) window.cam.openExternal(state.current.url);
  });
  $('widgetBtn').addEventListener('click', () => window.cam.openWidget());
  $('fullBtn').addEventListener('click', () => {
    const el = $('stage');
    if (!document.fullscreenElement) el.requestFullscreen && el.requestFullscreen();
    else document.exitFullscreen();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === ' ') { e.preventDefault(); $('playBtn').click(); }
  });

  // ---------- 启动 ----------
  (async () => {
    const cat = await window.cam.getCatalog();
    state.catalog = (cat || []).filter((c) => c && c.url);
    // 国家下拉
    const counts = {};
    state.catalog.forEach((c) => (counts[c.country] = (counts[c.country] || 0) + 1));
    const sel = $('country');
    Object.keys(counts)
      .sort((a, b) => counts[b] - counts[a])
      .forEach((slug) => {
        const info = C[slug] || {};
        const o = document.createElement('option');
        o.value = slug;
        o.textContent = (info.n || humanize(slug)) + ' (' + counts[slug] + ')';
        sel.appendChild(o);
      });

    buildList();
    $('status').textContent = '共 ' + state.list.length + ' 个摄像头';
    next();
  })();
})();
