// ═══ Музыка: движок плейбека, источники (Jamendo / YouTube / радио), RP-подбор ═══

import { generateSceneMood } from './social.js';

const LS_CFG = 'gp_music_cfg_v1';
const LS_QUEUE = 'gp_music_queue_v1';
const DEFAULT_JAMENDO_KEY = '6fcc94f7';
const INVIDIOUS = ['https://inv.thepixora.com', 'https://invidious.jing.rocks', 'https://yt.artemislena.eu', 'https://invidious.private.coffee'];

export const SOMA_STATIONS = [
    { name: 'Drone Zone', url: 'https://ice1.somafm.com/dronezone-128-mp3', tag: 'ambient/космос' },
    { name: 'Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3', tag: 'чилл/даунтемпо' },
    { name: 'Groove Salad Classic', url: 'https://ice1.somafm.com/gsclassic-128-mp3', tag: 'чилл/классика Soma' },
    { name: 'Deep Space One', url: 'https://ice1.somafm.com/deepspaceone-128-mp3', tag: 'тёмный эмбиент' },
    { name: 'Space Station Soma', url: 'https://ice1.somafm.com/spacestation-128-mp3', tag: 'электро/спейс' },
    { name: 'Mission Control', url: 'https://ice1.somafm.com/missioncontrol-128-mp3', tag: 'эмбиент/космос' },
    { name: 'Lush', url: 'https://ice1.somafm.com/lush-128-mp3', tag: 'вокал/мечтательное' },
    { name: 'Beat Blender', url: 'https://ice1.somafm.com/beatblender-128-mp3', tag: 'хаус/даунтемпо' },
    { name: 'Secret Agent', url: 'https://ice1.somafm.com/secretagent-128-mp3', tag: 'спай/джаз/нуар' },
    { name: 'Dub Step Beyond', url: 'https://ice1.somafm.com/dubstep-128-mp3', tag: 'дабстеп/бас' },
    { name: 'DEF CON Radio', url: 'https://ice1.somafm.com/defcon-128-mp3', tag: 'тёмное электро' },
    { name: 'The Trip', url: 'https://ice1.somafm.com/thetrip-128-mp3', tag: 'прог/транс' },
    { name: 'Black Rock FM', url: 'https://ice1.somafm.com/brfm-128-mp3', tag: 'разное/burning man' },
    { name: 'Indie Pop Rocks', url: 'https://ice1.somafm.com/indiepop-128-mp3', tag: 'инди-поп/альтернатива' },
    { name: 'Metal Detector', url: 'https://ice1.somafm.com/metal-128-mp3', tag: 'метал' },
    { name: 'Folk Forward', url: 'https://ice1.somafm.com/folkfwd-128-mp3', tag: 'фолк/инди-фолк' },
    { name: 'Seven Inch Soul', url: 'https://ice1.somafm.com/7soul-128-mp3', tag: 'соул/фанк' },
    { name: 'Suburbs of Goa', url: 'https://ice1.somafm.com/suburbsofgoa-128-mp3', tag: 'world/desi' },
    { name: 'Vaporwaves', url: 'https://ice1.somafm.com/vaporwaves-128-mp3', tag: 'вейпорвейв' },
    { name: 'Sonic Universe', url: 'https://ice1.somafm.com/sonicuniverse-128-mp3', tag: 'авангард-джаз' },
    { name: 'Fluid', url: 'https://ice1.somafm.com/fluid-128-mp3', tag: 'хип-хоп/трип-хоп' },
    { name: 'Illinois Street Lounge', url: 'https://ice1.somafm.com/illstreet-128-mp3', tag: 'lounge/retro' },
    { name: 'Boot Liquor', url: 'https://ice1.somafm.com/bootliquor-128-mp3', tag: 'americana/country' },
    { name: 'BAGeL Radio', url: 'https://ice1.somafm.com/bagel-128-mp3', tag: 'альтернатива/инди/андерграунд' },
    { name: 'Doomed', url: 'https://ice1.somafm.com/doomed-128-mp3', tag: 'dark/industrial/doom' },
    { name: 'PopTron', url: 'https://ice1.somafm.com/poptron-128-mp3', tag: 'electropop/synthpop' },
    { name: 'Cliqhop IDM', url: 'https://ice1.somafm.com/cliqhop-128-mp3', tag: 'idm/glitch' },
    { name: 'Digitalis', url: 'https://ice1.somafm.com/digitalis-128-mp3', tag: 'инди-электро/альт' },
    { name: 'Underground 80s', url: 'https://ice1.somafm.com/u80s-128-mp3', tag: 'андерграунд/80s/post-punk' },
    { name: 'Covers', url: 'https://ice1.somafm.com/covers-128-mp3', tag: 'каверы/разное' },
];

// ── Конфиг: ключи API + громкость ──
let cfg = { jamendoKey: '', ytKey: '', volume: 0.8 };
try { cfg = Object.assign(cfg, JSON.parse(localStorage.getItem(LS_CFG) || '{}')); } catch (_) {}

function saveCfg() { try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) {} }
export function getMusicCfg() { return { jamendoKey: cfg.jamendoKey, ytKey: cfg.ytKey, volume: cfg.volume }; }
export function setMusicKeys({ jamendoKey, ytKey }) {
    if (jamendoKey !== undefined) cfg.jamendoKey = String(jamendoKey).trim();
    if (ytKey !== undefined) cfg.ytKey = String(ytKey).trim();
    saveCfg();
}
const jamKey = () => cfg.jamendoKey || DEFAULT_JAMENDO_KEY;

// ── Состояние ──
const audio = new Audio();
audio.preload = 'auto';
let queue = [];
let curIdx = -1;
let playing = false;
let ytPlayer = null;
let ytApiPromise = null;
let ytReady = false;
let statusMsg = '';
let searchResults = [];
let radioResults = null;      // null = показывать SomaFM, массив = результаты поиска
let searching = false;
let picking = false;

try {
    const s = JSON.parse(localStorage.getItem(LS_QUEUE) || '{}');
    if (Array.isArray(s.queue)) { queue = s.queue; curIdx = typeof s.curIdx === 'number' ? s.curIdx : -1; }
} catch (_) {}

function saveQueue() { try { localStorage.setItem(LS_QUEUE, JSON.stringify({ queue, curIdx })); } catch (_) {} }
function emit() { window.dispatchEvent(new Event('gp-music-change')); }
export function onMusicChange(cb) { window.addEventListener('gp-music-change', cb); }

export function getMusicState() {
    return {
        queue, curIdx, playing, picking, searching, statusMsg,
        current: curIdx >= 0 ? queue[curIdx] : null,
        searchResults, radioResults,
    };
}
export function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Тикер прогресса: дёргает DOM напрямую, без перерисовки экрана ──
setInterval(() => {
    const t = curIdx >= 0 ? queue[curIdx] : null;
    if (!t) return;
    let cur = 0, dur = 0;
    if (t.kind === 'radio') { cur = 0; dur = 0; }
    else if (t.kind === 'yt') {
        if (ytReady && ytPlayer?.getCurrentTime) {
            try { cur = ytPlayer.getCurrentTime() || 0; dur = ytPlayer.getDuration() || 0; } catch (_) {}
        }
    } else { cur = audio.currentTime || 0; dur = audio.duration || 0; }
    const elC = document.getElementById('gp-mus-cur');
    const elD = document.getElementById('gp-mus-dur');
    const elF = document.getElementById('gp-mus-bar-fill');
    if (elC) elC.textContent = t.kind === 'radio' ? 'LIVE' : fmtTime(cur);
    if (elD) elD.textContent = t.kind === 'radio' ? '' : fmtTime(dur);
    if (elF) elF.style.width = (dur > 0 ? Math.min(100, (cur / dur) * 100) : 0) + '%';
}, 500);

// ── YouTube iframe API (скрытый плеер на body, перерисовки телефона его не трогают) ──
function ensureYtApi() {
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise((resolve, reject) => {
        if (window.YT?.Player) return resolve();
        const old = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { try { old?.(); } catch (_) {} resolve(); };
        if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
            const s = document.createElement('script');
            s.src = 'https://www.youtube.com/iframe_api';
            s.onerror = () => reject(new Error('yt_api_load'));
            document.head.appendChild(s);
        }
        setTimeout(() => window.YT?.Player ? resolve() : reject(new Error('yt_api_timeout')), 8000);
    });
    return ytApiPromise;
}

async function ensureYtPlayer() {
    await ensureYtApi();
    if (ytPlayer) return ytPlayer;
    const holder = document.createElement('div');
    holder.id = 'gp-music-yt-holder';
    holder.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(holder);
    return await new Promise((resolve, reject) => {
        ytPlayer = new window.YT.Player(holder, {
            width: '2', height: '2',
            playerVars: { autoplay: 0, playsinline: 1, rel: 0, origin: location.origin || undefined },
            events: {
                onReady: () => { ytReady = true; resolve(ytPlayer); },
                onStateChange: (e) => {
                    if (e.data === window.YT.PlayerState.ENDED) nextTrack(true);
                    if (e.data === window.YT.PlayerState.PLAYING && !playing) { playing = true; emit(); }
                    if (e.data === window.YT.PlayerState.PAUSED && playing) { playing = false; emit(); }
                },
                onError: () => { statusMsg = 'Ролик недоступен для встраивания'; nextTrack(true); },
            },
        });
        setTimeout(() => ytReady ? null : reject(new Error('yt_player_timeout')), 8000);
    });
}

// ── Движок ──
function stopAll() {
    try { audio.pause(); } catch (_) {}
    if (ytReady) { try { ytPlayer.stopVideo(); } catch (_) {} }
}

async function playCurrent() {
    const t = curIdx >= 0 ? queue[curIdx] : null;
    if (!t) { playing = false; emit(); return; }
    stopAll();
    statusMsg = '';
    try {
        if (t.kind === 'yt') {
            const p = await ensureYtPlayer();
            p.setVolume(Math.round(cfg.volume * 100));
            p.loadVideoById(t.ytid);
            playing = true;
        } else {
            audio.src = t.url;
            audio.volume = cfg.volume;
            audio.loop = false;
            await audio.play();
            playing = true;
        }
    } catch (e) {
        statusMsg = t.kind === 'yt' ? 'YouTube не ответил' : 'Не удалось воспроизвести';
        playing = false;
    }
    saveQueue();
    emit();
}

export function playIndex(i) {
    if (i < 0 || i >= queue.length) return;
    curIdx = i;
    playCurrent();
}
export function playTrack(track) {
    queue.push(track);
    curIdx = queue.length - 1;
    saveQueue();
    playCurrent();
}
export function enqueue(track) {
    queue.push(track);
    if (curIdx < 0) curIdx = 0;
    saveQueue();
    emit();
}
export function togglePlay() {
    const t = curIdx >= 0 ? queue[curIdx] : null;
    if (!t) return;
    if (t.kind === 'yt') {
        if (!ytReady) return;
        if (playing) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
    } else {
        if (playing) { audio.pause(); playing = false; emit(); }
        else { audio.play().then(() => { playing = true; emit(); }).catch(() => {}); }
    }
}
export function nextTrack(auto = false) {
    if (!queue.length) return;
    if (curIdx + 1 < queue.length) { curIdx++; playCurrent(); }
    else if (auto) { playing = false; stopAll(); emit(); }
}
export function prevTrack() {
    if (curIdx > 0) { curIdx--; playCurrent(); }
}
export function removeAt(i) {
    if (i < 0 || i >= queue.length) return;
    const wasCurrent = i === curIdx;
    queue.splice(i, 1);
    if (i < curIdx) curIdx--;
    if (wasCurrent) {
        if (queue.length) { curIdx = Math.min(curIdx, queue.length - 1); playCurrent(); }
        else { curIdx = -1; playing = false; stopAll(); emit(); }
    }
    saveQueue();
    emit();
}
export function clearQueue() {
    queue = []; curIdx = -1; playing = false;
    stopAll();
    saveQueue();
    emit();
}
export function seekFrac(frac) {
    const t = curIdx >= 0 ? queue[curIdx] : null;
    if (!t || t.kind === 'radio') return;
    if (t.kind === 'yt') {
        if (ytReady && ytPlayer.getDuration) {
            const d = ytPlayer.getDuration() || 0;
            if (d > 0) ytPlayer.seekTo(d * frac, true);
        }
    } else if (isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = audio.duration * frac;
    }
}
export function setVolume(v) {
    cfg.volume = Math.max(0, Math.min(1, v));
    audio.volume = cfg.volume;
    if (ytReady) { try { ytPlayer.setVolume(Math.round(cfg.volume * 100)); } catch (_) {} }
    saveCfg();
}

audio.addEventListener('ended', () => nextTrack(true));
audio.addEventListener('error', () => {
    if (curIdx >= 0 && queue[curIdx] && queue[curIdx].kind !== 'yt') {
        statusMsg = 'Поток недоступен';
        emit();
    }
});

// ── Источники ──
async function fetchJson(url, timeout = 8000) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeout);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error('http_' + res.status);
        return await res.json();
    } finally { clearTimeout(to); }
}

async function searchJamendo(query, limit = 12) {
    const data = await fetchJson('https://api.jamendo.com/v3.0/tracks/?client_id=' + encodeURIComponent(jamKey()) +
        '&format=json&limit=' + limit + '&audioformat=mp32&order=popularity_total&namesearch=' + encodeURIComponent(query));
    return (data?.results || []).filter(t => t.audio).map(t => ({
        kind: 'audio', url: t.audio, title: t.name, artist: t.artist_name, source: 'Jamendo',
    }));
}

function htmlDecode(s) {
    const ta = document.createElement('textarea');
    ta.innerHTML = s || '';
    return ta.value;
}

async function searchYouTube(query, limit = 10) {
    if (cfg.ytKey) {
        const data = await fetchJson('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&order=relevance&maxResults=' +
            limit + '&q=' + encodeURIComponent(query) + '&key=' + encodeURIComponent(cfg.ytKey));
        if (data?.error) throw new Error('yt_api_error');
        return (data?.items || []).filter(it => it.id?.videoId).map(it => ({
            kind: 'yt', ytid: it.id.videoId, title: htmlDecode(it.snippet.title), artist: it.snippet.channelTitle || '', source: 'YouTube',
        }));
    }
    // Без ключа — Invidious-публичные инстансы, по кругу
    for (const base of [...INVIDIOUS].sort(() => 0.5 - Math.random()).slice(0, 3)) {
        try {
            const data = await fetchJson(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, 5000);
            if (Array.isArray(data) && data.length) {
                return data.filter(it => it.videoId).slice(0, limit).map(it => ({
                    kind: 'yt', ytid: it.videoId, title: it.title, artist: it.author || '', source: 'YouTube',
                }));
            }
        } catch (_) {}
    }
    return [];
}

function parseYtLink(query) {
    const mList = query.match(/[?&]list=([\w-]+)/);
    const mVid = query.match(/(?:youtu\.be\/|[?&]v=|shorts\/)([\w-]{11})/);
    if (mVid) return { kind: 'yt', ytid: mVid[1], title: 'YouTube видео', artist: mVid[1], source: 'YT-ссылка' };
    if (mList) return { kind: 'ytlist', ytlist: mList[1], title: 'YouTube плейлист', artist: 'list', source: 'YT-ссылка' };
    return null;
}

export async function searchMusic(query, source) {
    const q = String(query || '').trim();
    if (!q) return [];
    searching = true;
    statusMsg = 'Ищу…';
    emit();
    try {
        const link = parseYtLink(q);
        if (link) {
            searchResults = link.kind === 'ytlist' ? [] : [link];
            statusMsg = link.kind === 'ytlist' ? 'Плейлисты не поддерживаю — кинь ссылку на видео' : '';
        } else if (source === 'jamendo') {
            searchResults = await searchJamendo(q);
            statusMsg = searchResults.length ? '' : 'Ничего не найдено';
        } else {
            searchResults = await searchYouTube(q);
            statusMsg = searchResults.length ? '' : 'Ничего не найдено';
        }
    } catch (e) {
        searchResults = [];
        statusMsg = e?.message === 'yt_api_error' ? 'YouTube API отклонил ключ' : 'Ошибка поиска';
    } finally {
        searching = false;
        emit();
    }
    return searchResults;
}

// ── Радио ──
export async function searchRadioStations(q) {
    const query = String(q || '').trim();
    if (!query) { radioResults = null; emit(); return []; }
    searching = true;
    statusMsg = 'Ищу радио…';
    emit();
    try {
        const base = 'https://de1.api.radio-browser.info/json/stations/search';
        let data = [];
        try {
            data = await fetchJson(base + '?limit=20&hidebroken=true&order=clickcount&reverse=true&tag=' + encodeURIComponent(query));
        } catch (_) {}
        if (!Array.isArray(data) || !data.length) {
            data = await fetchJson(base + '?limit=20&hidebroken=true&order=clickcount&reverse=true&name=' + encodeURIComponent(query));
        }
        radioResults = (data || []).filter(s => s.url_resolved).slice(0, 18).map(s => ({
            kind: 'radio', url: s.url_resolved, title: s.name || 'станция',
            artist: (s.country || '') + (s.tags ? ' · ' + String(s.tags).split(',').slice(0, 2).join(',') : ''),
            source: 'Радио',
        }));
        statusMsg = radioResults.length ? '' : 'Ничего не найдено';
    } catch (_) {
        radioResults = [];
        statusMsg = 'Ошибка поиска радио';
    } finally {
        searching = false;
        emit();
    }
    return radioResults;
}

export function playRadioStation(st) {
    playTrack({ kind: 'radio', url: st.url, title: st.name || st.title, artist: st.tag || st.artist || 'Радио', source: 'Радио' });
}

// ── RP-подбор: модель читает сцену и предлагает трек ──
export async function pickForScene() {
    if (picking) return null;
    picking = true;
    statusMsg = 'Подбираю под сцену…';
    emit();
    try {
        const arr = await generateSceneMood();
        const pick = arr?.[0];
        if (!pick?.query) throw new Error('no_pick');
        let found = await searchJamendo(pick.query, 1).catch(() => []);
        if (!found.length) found = await searchYouTube(pick.query, 1).catch(() => []);
        if (!found.length) throw new Error('not_found');
        playTrack(found[0]);
        statusMsg = '';
        return { mood: pick.mood || '', track: found[0] };
    } catch (e) {
        statusMsg = e?.message === 'not_found' ? 'Трек не нашёлся ни в одном источнике' : 'Модель ничего не предложила';
        return null;
    } finally {
        picking = false;
        emit();
    }
}
