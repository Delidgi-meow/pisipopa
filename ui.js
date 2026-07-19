
import { sendMessageAsUser, Generate, generateQuietPrompt, saveSettingsDebounced, saveChatConditional } from '../../../../script.js';
import { saveBase64AsFile } from '../../../utils.js';
import {
    getSettings, getThreadList, getThread, markRead, addManualContact, hideContact,
    randomNumber, getTotalUnread, fmtTime, getRpDateTime, keyOf, getHiddenMessageIndexes,
    addGroup, delGroup, attachImageToMessage, renameContact, banAccount,
    isSmsBlocked, blockSmsContact, unblockSmsContact, saveMeta,
} from './state.js';
import { updatePhoneInjection } from './prompts.js';
import {
    getBank, fmtMoney, addTransaction, deleteTransaction, takeLoan, payLoanInstallment, deleteLoan,
    totalDebt, monthlyLoanPayment, addRecurring, delRecurring, payRecurring, monthlyObligations,
    getBankReminders, spendingByCategory, incomeExpenseTotals, bankBadgeCount, setCurrency, convertCurrency,
} from './bank.js';
import { SHOP_CATS, catById, getCategory, generateCategory, buyItem, getOrders, deleteOrder, getCustomCats, addCustomCat, delCustomCat } from './shop.js';
import {
    getTweets, getIgPosts, postTweet, likeTweet, rtTweet, delTweet, addTweetReply, delTweetReply,
    postIg, likeIg, delIg, addIgComment, delIgComment,
    getOfPosts, postOf, likeOf, delOf, addOfComment, delOfComment, generateOfComments, getSocial,
    withdrawOf, setOfWallet,
    generateTweetFeed, generateTweetComments, generateAuthorReply, generateReplyToComment, generateIgFeed, generateIgComments,
    compressImage, setContactAvatar, getContactAvatar, avatarForAuthor,
    timeAgo, makeHandle, getUserName, generatePostImage, isImageGenAvailable,
    handleFor, setContactHandle, setUserHandle, getUserHandle, describePostImage, generateSmsPhotoReply, logSocialToChat, getSocialJournalEntries,
    settleSocialPost, maybeGenerateStoryEvent, resolveStoryEvent, generateAdvertisingOffers,
    getStories, activeStories, addStory, deleteStory, bumpStoryViews, generateContactStories,
    generateRepLabel,
} from './social.js';
import { getSystemsView, deferEvent, declineEvent, selectStoryEvent, acceptAdOffer, declineAdOffer, attachActiveAd, getReputationStatus } from './social-events.js';
import { maybeScamSms } from './scam.js';
import { casinoStats, spinSlots, spinRoulette, canBet } from './casino.js';
import { getNews, refreshNews, shareNews, deleteNews } from './news.js';
import { getDiscord, findDServer, findDChannel, refreshDiscordServers, refreshDChannel, postToDChannel, deleteDServer } from './discord.js';
import { getTwitch, findStream, refreshStreams, tickStream, donateToStream, startMyStream, tickMyStream, endMyStream } from './twitch.js';
import { getNotes, addNote, updateNote, deleteNote, toggleNoteShared } from './notes.js';
import { tr, trDom, lang, DAYS_I18N, MONTHS_I18N } from './i18n.js';

// Все confirm/prompt модуля идут через перевод (шэдоуинг браузерных диалогов)
const confirm = (msg) => window.confirm(tr(msg));
const prompt = (msg, def) => window.prompt(tr(msg), def);

// ── Локальное UI-состояние (не персистится) ──
let currentScreen = 'home';     // + 'of' | 'ofnew' | 'ofview'
let currentThreadKey = null;
let currentTweetId = null;
let currentPostId = null;
let typingKey = null;           // тред, в котором «печатает…»
let sending = false;
let _smsDraftImage = null;      // фото, приложенное к смс (dataURL до отправки)
let _smsDraftVoice = false;     // режим голосового: текст уйдёт как расшифровка
let _mmsGenBusy = new Set();    // ММС в процессе генерации фото (по eventId)
let genBusy = false;            // идёт генерация ленты/комментов
let selectedStoryEventId = null;
let clockTimer = null;
let prevIncomingCounts = new Map(); // для детекта новых входящих (тосты)

function ic(name) { return `<i class="fa-solid ${name}"></i>`; }


function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Градиент аватарки по имени ──
const PALETTES = [
    ['#6a8dff', '#8f6aff'], ['#ff6a9e', '#ff8f6a'], ['#3ec9a7', '#4a90d9'],
    ['#c66bff', '#ff6b9d'], ['#ffb347', '#ff6a6a'], ['#4facfe', '#00f2fe'],
    ['#a18cd1', '#fbc2eb'], ['#f77062', '#fe5196'],
];
function avatarStyle(name) {
    let h = 0;
    const s = String(name || '?');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const p = PALETTES[Math.abs(h) % PALETTES.length];
    return `background:linear-gradient(135deg, ${p[0]}, ${p[1]})`;
}
// Персональный цвет ника (групповые чаты): тот же хэш, что и у аватара
function senderColor(name) {
    let h = 0;
    const s = String(name || '?');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return PALETTES[Math.abs(h) % PALETTES.length][0];
}
function initialOf(name) {
    const t = String(name || '?').trim();
    return esc(t.charAt(0).toUpperCase() || '?');
}

// Онлайн-аватар для НПС без фото: детерминированный портрет с randomuser.me
// (хэш имени → номер 0-98; пол — по окончанию первого имени, с исключениями)
const MALE_A_NAMES = new Set([
    'никита', 'илья', 'лука', 'фома', 'кузьма', 'данила', 'савва', 'миша', 'паша',
    'саша', 'гоша', 'лёша', 'леша', 'ваня', 'петя', 'коля', 'толя', 'вася', 'дима',
    'костя', 'витя', 'юра', 'боря', 'серёжа', 'сережа', 'стёпа', 'степа', 'лёва',
    'лева', 'гриша', 'тёма', 'тема', 'рома', 'слава', 'жора', 'сеня', 'веня', 'митя',
]);
// Женские имена НЕ на -а/-я
const FEMALE_X_NAMES = new Set([
    'марго', 'любовь', 'нинель', 'николь', 'мишель', 'рахиль', 'эстер', 'руфь',
    'кармен', 'ассоль', 'сольвейг', 'ингрид', 'астрид', 'гретхен', 'элен', 'джейн',
    'кейт', 'мэри', 'энн', 'грейс', 'скарлетт', 'жанетт', 'фло',
]);
function onlineAvatarUrl(name) {
    const first = String(name || '').trim().split(/\s+/)[0].toLowerCase();
    if (!first || /^\+?\d/.test(first)) return ''; // номера телефонов — без портрета
    let h = 0;
    for (const ch of String(name)) h = (Math.imul(h, 31) + ch.codePointAt(0)) | 0;
    const n = Math.abs(h) % 99;
    const fem = (/[ая]$/.test(first) && !MALE_A_NAMES.has(first)) || FEMALE_X_NAMES.has(first);
    return `https://randomuser.me/api/portraits/${fem ? 'women' : 'men'}/${n}.jpg`;
}

// Аватар: фото если загружено, иначе онлайн-портрет (если включено),
// под ним всегда градиент с инициалом — если источник недоступен, img прячется
function avatarHtml(name, avatarUrl, cls = 'gp-avatar') {
    if (avatarUrl) {
        return `<div class="${cls} gp-avatar-img"><img src="${esc(avatarUrl)}" alt=""></div>`;
    }
    const online = getSettings().onlineAvatars !== false ? onlineAvatarUrl(name) : '';
    if (online) {
        return `<div class="${cls} gp-avatar-img" style="${avatarStyle(name)}"><span class="gp-avatar-fb">${initialOf(name)}</span><img src="${esc(online)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>`;
    }
    return `<div class="${cls}" style="${avatarStyle(name)}">${initialOf(name)}</div>`;
}

function brand(name) { return `<i class="fa-brands ${name}"></i>`; }

// ═══ FAB ═══

// FAB. Позиционирование через left/top (fabPos={left,top}) — как в Asta,
// которая надёжно показывается на айфоне. Драг реализован раздельными
// touch- и mouse-обработчиками (pointer events на мобильном ST капризничают).
// Ключевой фикс невидимости на iOS: на тачскринах у кнопки СПЛОШНАЯ заливка
// без backdrop-filter (blur-поверхность Safari часто рендерит прозрачной).
function createFab() {
    if (document.getElementById('gp-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'gp-fab';
    fab.innerHTML = `${ic('fa-mobile-screen-button')}<span id="gp-fab-badge" class="gp-hidden"></span>`;
    document.body.appendChild(fab);

    // Позиция: сохранённая ВСЕГДА зажимается в текущий вьюпорт (позиция с широкого
    // монитора не должна уносить кнопку за экран телефона). Дефолт — правый край.
    const FAB_SZ = 48;
    const applyFabPos = () => {
        const st = getSettings();
        const vw = window.innerWidth, vh = window.innerHeight;
        let left, top;
        const p = st.fabPos;
        if (p && typeof p.left === 'number' && typeof p.top === 'number') {
            left = p.left; top = p.top;
        } else if (p && typeof p.right === 'number') {
            // Миграция старого формата {right,bottom} → {left,top}
            left = vw - FAB_SZ - p.right;
            top = vh - FAB_SZ - (p.bottom ?? 190);
        } else {
            left = vw - FAB_SZ - 16;
            top = Math.round(vh * 0.55);
        }
        left = Math.max(2, Math.min(left, vw - FAB_SZ - 2));
        top = Math.max(2, Math.min(top, vh - FAB_SZ - 2));
        fab.style.left = `${left}px`;
        fab.style.top = `${top}px`;
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    };
    applyFabPos();
    window.addEventListener('resize', applyFabPos);
    window.addEventListener('orientationchange', () => setTimeout(applyFabPos, 200));

    const s = getSettings();
    if (!s.showFab || !s.isEnabled) fab.classList.add('gp-hidden');

    // ── Драг (по образцу Asta) ──
    const THR = 8;
    let down = false, moved = false, sx = 0, sy = 0, sl = 0, st = 0, rafId = null;
    const clientXY = (e) => {
        if (e.touches?.[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
        if (e.changedTouches?.[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
        return { x: e.clientX, y: e.clientY };
    };
    const beginDrag = (x, y) => {
        down = true; moved = false; sx = x; sy = y;
        const r = fab.getBoundingClientRect();
        sl = r.left; st = r.top;
        fab.style.left = `${sl}px`; fab.style.top = `${st}px`;
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
    };
    const applyMove = (nx, ny) => {
        const cx = Math.max(2, Math.min(nx, window.innerWidth - fab.offsetWidth - 2));
        const cy = Math.max(2, Math.min(ny, window.innerHeight - fab.offsetHeight - 2));
        fab.style.left = `${cx}px`; fab.style.top = `${cy}px`;
    };
    const persist = () => {
        const r = fab.getBoundingClientRect();
        getSettings().fabPos = { left: Math.round(r.left), top: Math.round(r.top) };
        saveSettingsDebounced();
    };

    fab.addEventListener('touchstart', (e) => {
        const c = clientXY(e); beginDrag(c.x, c.y);
    }, { passive: true });
    fab.addEventListener('touchmove', (e) => {
        if (!down) return;
        const c = clientXY(e), dx = c.x - sx, dy = c.y - sy;
        if (Math.abs(dx) > THR || Math.abs(dy) > THR) moved = true;
        if (!moved) return;
        e.preventDefault();
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => applyMove(sl + dx, st + dy));
    }, { passive: false });
    fab.addEventListener('touchend', (e) => {
        if (!down) return;
        down = false;
        if (!moved) { e.preventDefault(); togglePhone(); }
        else persist();
        rafId = null;
    }, { passive: false });

    fab.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        beginDrag(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
        if (!down) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > THR || Math.abs(dy) > THR) moved = true;
        if (!moved) return;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => applyMove(sl + dx, st + dy));
    });
    document.addEventListener('mouseup', () => {
        if (!down) return;
        down = false;
        if (moved) persist();
        else togglePhone();
        rafId = null;
    });
}

// Кнопка «Телефон» в wand-меню (палочка у поля ввода) — гарантированный вход
// на мобильных: FAB может быть не виден (позиция/прозрачность/чужой CSS),
// а меню расширений есть всегда.
function createWandButton() {
    try {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('gp-wand-open')) return;
        const item = document.createElement('div');
        item.id = 'gp-wand-open';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.innerHTML = `<i class="fa-solid fa-mobile-screen-button"></i><span>Телефон</span>`;
        item.addEventListener('click', () => {
            openPhone();
        });
        menu.appendChild(item);
    } catch (e) {
        console.warn('[GlassPhone] wand button failed:', e);
    }
}

// Напоминания банка: тост о новых наступивших/просроченных обязательных платежах
// (один раз на платёж в RP-месяц, чтобы не спамить)
let _bankReminded = new Set();
export function notifyBankReminders() {
    if (!getSettings().isEnabled) return;
    try {
        const ym = (getRpDateTime() ? `${getRpDateTime().year}-${getRpDateTime().month}` : new Date().toISOString().slice(0, 7));
        for (const r of getBankReminders()) {
            const key = r.kind + r.id + ':' + ym;
            if (_bankReminded.has(key)) continue;
            _bankReminded.add(key);
            toast(`${r.overdue ? 'Просрочен платёж' : 'Пора оплатить'}: ${r.name} — ${fmtMoney(r.amount)}`, r.kind === 'loan' ? 'fa-landmark' : 'fa-file-invoice-dollar');
        }
    } catch (e) { /* ignore */ }
}

export function updateFabBadge() {
    // Самовосстановление: если FAB пропал из DOM (чужой скрипт/перестройка) — пересоздаём
    if (!document.getElementById('gp-fab')) {
        try { createFab(); } catch (e) { /* ignore */ }
    }
    const n = getTotalUnread() + bankBadgeCount();
    const badge = document.getElementById('gp-fab-badge');
    if (badge) {
        if (n > 0) {
            badge.textContent = n > 9 ? '9+' : String(n);
            badge.classList.remove('gp-hidden');
        } else {
            badge.classList.add('gp-hidden');
        }
    }
    const fab = document.getElementById('gp-fab');
    if (fab) {
        const s = getSettings();
        fab.classList.toggle('gp-hidden', !s.showFab || !s.isEnabled);
        fab.classList.toggle('gp-fab-alert', n > 0);
        fab.classList.toggle('gp-fab-idle', n === 0);
    }
}

// ═══ Скрытие смс-переписки из ленты чата ═══
// Сообщения остаются в chat[] и в контексте модели — прячем только DOM (.mes по mesid).
// Вызывается на всех событиях рендера + из MutationObserver (index.js).
export function applyChatHiding() {
    try {
        const s = getSettings();
        const enabled = s.isEnabled && s.hideSmsInChat !== false;
        document.querySelectorAll('#chat .mes.gp-sms-hidden').forEach(el => el.classList.remove('gp-sms-hidden'));
        if (!enabled) return;
        const idxs = getHiddenMessageIndexes();
        for (const i of idxs) {
            const el = document.querySelector(`#chat .mes[mesid="${i}"]`);
            if (el) el.classList.add('gp-sms-hidden');
        }
    } catch (e) {
        console.warn('[GlassPhone] applyChatHiding failed:', e);
    }
}

// ═══ Каркас телефона ═══

function createPhone() {
    if (document.getElementById('gp-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'gp-overlay';
    ov.innerHTML = `
        <div id="gp-phone">
            <div class="gp-glass-sheen"></div>
            <div class="gp-island"></div>
            <div class="gp-statusbar">
                <span id="gp-clock">--:--</span>
                <span class="gp-status-right">
                    <span id="gp-rpdate" class="gp-rpdate"></span>
                    ${ic('fa-signal')}${ic('fa-wifi')}${ic('fa-battery-three-quarters')}
                    <button class="gp-close" id="gp-close" title="Закрыть">${ic('fa-xmark')}</button>
                </span>
            </div>
            <div id="gp-screen"></div>
            <div class="gp-homebar" title="Закрыть"></div>
        </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('pointerdown', (e) => {
        if (e.target === ov) closePhone();
    });
    // Закрытие: крестик в статус-баре и «хоумбар» (на мобильном фуллскрине фона нет)
    ov.querySelector('#gp-close')?.addEventListener('click', closePhone);
    ov.querySelector('.gp-homebar')?.addEventListener('click', closePhone);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPhoneOpen()) closePhone();
    });
}

// ═══ Скины и кастомный CSS ═══
const SKINS = ['indigo', 'sunset', 'zephyr', 'neon', 'noir', 'fern', 'lcd', 'void', 'porcelain'];
const LEGACY_SKINS = { rose: 'sunset', emerald: 'fern', mono: 'lcd' };
const THEME_BODY_CLASSES = [...SKINS, ...Object.values(LEGACY_SKINS)].map(sk => `gp-theme-${sk}`);
const THEME_INFO = [
    { id: 'indigo', name: 'Индиго', note: 'Liquid glass', colors: ['#6a8dff', '#9a6aff', '#4aaaff'] },
    { id: 'sunset', name: 'Закат', note: 'Тёплое стекло', colors: ['#ff8a5f', '#ff5a8c', '#a04a45'] },
    { id: 'zephyr', name: 'Зефир', note: 'Мягкий kawaii', colors: ['#ff9ec7', '#b79bff', '#8dcfff'] },
    { id: 'neon', name: 'Neon City', note: 'Cyberpunk', colors: ['#ff2d78', '#00e5ff', '#8d42ff'] },
    { id: 'noir', name: "Noir d'Or", note: 'Чёрное золото', colors: ['#f0d49a', '#d9ab5e', '#6f5732'] },
    { id: 'fern', name: 'Fern', note: 'Глубокий лес', colors: ['#a3e08a', '#5cbf8a', '#d5aa55'] },
    { id: 'lcd', name: 'LCD 3310', note: 'Пиксельное ретро', colors: ['#242e12', '#56642c', '#a7bd5e'] },
    { id: 'void', name: 'Void', note: 'True AMOLED', colors: ['#00ff9d', '#00d984', '#303030'] },
    { id: 'porcelain', name: 'Porcelain', note: 'Светлый день', colors: ['#5a92ff', '#3a7bfd', '#a9c2ff'] },
];

function hexRgb(hex) {
    const m = String(hex || '').trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

// Шрифты для кастомизации (только системные — без загрузок)
const THEME_FONTS = {
    '': '',
    'serif': 'Georgia, "Times New Roman", serif',
    'mono': '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace',
    'rounded': '"Comic Sans MS", "Segoe UI", cursive',
    'condensed': '"Arial Narrow", "Segoe UI", sans-serif',
};

function normalizedThemeCustom(value = getSettings().themeCustom) {
    const v = value && typeof value === 'object' ? value : {};
    const hex = (x) => /^#[0-9a-f]{6}$/i.test(x || '') ? x : null;
    return {
        accentA: hex(v.accentA),
        accentB: hex(v.accentB),
        bg: hex(v.bg),           // цвет фона телефона (null = фон темы)
        text: hex(v.text),       // цвет текста (null = цвет темы)
        iconA: hex(v.iconA),     // градиент иконок приложений (null = как в теме)
        iconB: hex(v.iconB),
        font: (v.font in THEME_FONTS) ? v.font : '',
        radius: Math.max(2, Math.min(30, Number(v.radius) || 18)),
        transparency: Math.max(3, Math.min(28, Number(v.transparency) || 10)),
        iconScale: Math.max(80, Math.min(115, Number(v.iconScale) || 100)),
    };
}

// Затемнить/осветлить hex на delta (-255..255) — для градиента из одного цвета фона
function shadeHex(hex, delta) {
    const m = String(hex || '').match(/^#([0-9a-f]{6})$/i);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const cl = (x) => Math.max(0, Math.min(255, x + delta));
    return '#' + [cl((n >> 16) & 255), cl((n >> 8) & 255), cl(n & 255)]
        .map(x => x.toString(16).padStart(2, '0')).join('');
}

export function applySkin() {
    const ph = document.getElementById('gp-phone');
    if (ph) {
        [...SKINS, ...Object.keys(LEGACY_SKINS)].forEach(sk => ph.classList.remove(`gp-skin-${sk}`));
        const savedSkin = getSettings().skin || 'indigo';
        const skin = LEGACY_SKINS[savedSkin] || (SKINS.includes(savedSkin) ? savedSkin : 'indigo');
        if (skin !== 'indigo') ph.classList.add(`gp-skin-${skin}`);
        document.body?.classList.remove(...THEME_BODY_CLASSES);
        document.body?.classList.add(`gp-theme-${skin}`);

        const c = normalizedThemeCustom();
        const theme = THEME_INFO.find(x => x.id === skin) || THEME_INFO[0];
        const accentA = c.accentA || theme.colors[0];
        const accentB = c.accentB || theme.colors[1];
        ph.style.setProperty('--gp-accent-a', accentA);
        ph.style.setProperty('--gp-accent-b', accentB);
        ph.style.setProperty('--gp-accent-a-rgb', hexRgb(accentA));
        ph.style.setProperty('--gp-accent-b-rgb', hexRgb(accentB));
        ph.style.setProperty('--gp-theme-card-radius', `${c.radius}px`);
        ph.style.setProperty('--gp-theme-icon-radius', `${Math.max(3, Math.round(c.radius * .95))}px`);
        ph.style.setProperty('--gp-theme-icon-scale', String(c.iconScale / 100));
        const alpha = c.transparency / 100;
        const light = skin === 'zephyr' || skin === 'porcelain';
        const lcd = skin === 'lcd';
        ph.style.setProperty('--gp-glass', lcd
            ? `rgba(255,255,230,${Math.min(.45, alpha + .12)})`
            : light ? `rgba(255,255,255,${Math.min(.9, alpha + .5)})` : `rgba(255,255,255,${alpha})`);
        ph.style.setProperty('--gp-glass-strong', lcd
            ? `rgba(255,255,230,${Math.min(.55, alpha + .22)})`
            : light ? `rgba(255,255,255,${Math.min(.96, alpha + .68)})` : `rgba(255,255,255,${Math.min(.4, alpha + .06)})`);

        // ── Глубокая кастомизация: фон / цвет текста / шрифт ──
        // Фон: свой цвет ПЕРЕКРЫВАЕТ фон темы (мягкий градиент из одного цвета)
        if (c.bg) {
            ph.style.background = `linear-gradient(165deg, ${shadeHex(c.bg, 22)}, ${c.bg} 45%, ${shadeHex(c.bg, -26)})`;
        } else {
            ph.style.background = '';
        }
        // Цвет текста: основной + приглушённый (55% прозрачности того же цвета)
        if (c.text) {
            ph.style.setProperty('--gp-text', c.text);
            ph.style.setProperty('--gp-text-dim', `rgba(${hexRgb(c.text)}, 0.55)`);
            ph.style.color = c.text;
        } else {
            ph.style.removeProperty('--gp-text');
            ph.style.removeProperty('--gp-text-dim');
            ph.style.color = '';
        }
        // Шрифт всего телефона
        ph.style.fontFamily = THEME_FONTS[c.font] || '';
        // Маркер-классы кастомизации: темы хардкодят цвета пузырей/кнопок в своих
        // классах — эти классы дают !important-оверрайды через переменные,
        // чтобы выбранный акцент/цвет текста РЕАЛЬНО перекрашивал интерфейс
        ph.classList.toggle('gp-custom-accent', !!(c.accentA || c.accentB));
        ph.classList.toggle('gp-custom-text', !!c.text);
        // Свои цвета иконок приложений (перекрывают тему)
        if (c.iconA || c.iconB) {
            ph.style.setProperty('--gp-icon-a', c.iconA || c.iconB);
            ph.style.setProperty('--gp-icon-b', c.iconB || c.iconA);
            ph.classList.add('gp-custom-icons');
        } else {
            ph.style.removeProperty('--gp-icon-a');
            ph.style.removeProperty('--gp-icon-b');
            ph.classList.remove('gp-custom-icons');
        }
    }
    // Кастомный CSS юзера
    let styleEl = document.getElementById('gp-custom-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'gp-custom-css';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = getSettings().customCss || '';
    applyWallpaper();
}

// ═══ Обои телефона ═══
// Картинка-обои кладётся отдельным слоем ПОД экраном (не через background
// самого #gp-phone, чтобы не конфликтовать со скинами). Класс gp-has-wall
// приглушает стеклянные градиенты, чтобы фото было видно.
export function applyWallpaper() {
    const ph = document.getElementById('gp-phone');
    if (!ph) return;
    const url = getSettings().wallpaper || '';
    let layer = ph.querySelector('.gp-wallpaper');
    if (url) {
        if (!layer) {
            layer = document.createElement('div');
            layer.className = 'gp-wallpaper';
            ph.insertBefore(layer, ph.firstChild);
        }
        const cssUrl = url.replace(/'/g, "\\'");
        layer.style.backgroundImage = `url('${cssUrl}')`;
        layer.classList.toggle('gp-wall-blur', !!getSettings().wallpaperBlur);
        ph.classList.add('gp-has-wall');
    } else {
        if (layer) layer.remove();
        ph.classList.remove('gp-has-wall');
    }
}

export function isPhoneOpen() {
    return document.getElementById('gp-overlay')?.classList.contains('gp-open') || false;
}

export function openPhone(threadKey = null) {
    createPhone();
    applySkin();
    const ov = document.getElementById('gp-overlay');
    ov.classList.add('gp-open');
    if (threadKey) {
        currentScreen = 'thread';
        currentThreadKey = threadKey;
    }
    render();
    tickClock();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(tickClock, 20000);

    // Страховка от «белой полосы»: если корпус телефона схлопнулся
    // (старый Safari без inset/dvh, контейнер-квирки ST 1.18) —
    // принудительно растягиваем инлайн-стилями на весь экран.
    setTimeout(() => {
        try {
            const ph = document.getElementById('gp-phone');
            if (!ph) return;
            const r = ph.getBoundingClientRect();
            if (r.height < 200 || r.width < 200) {
                console.warn(`[GlassPhone] Phone collapsed (${Math.round(r.width)}x${Math.round(r.height)}) — forcing fullscreen fallback`);
                Object.assign(ov.style, {
                    position: 'fixed', top: '0', left: '0',
                    width: '100vw', height: '100vh', display: 'flex',
                });
                Object.assign(ph.style, {
                    width: '100vw', height: '100vh', maxHeight: 'none', borderRadius: '0',
                });
            }
        } catch (e) { /* ignore */ }
    }, 80);
}

export function closePhone() {
    flushCasinoSession(); // если закрыли телефон прямо из казино — итог всё равно уходит в журнал
    const ov = document.getElementById('gp-overlay');
    if (ov) ov.classList.remove('gp-open');
    if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
}

function togglePhone() {
    if (isPhoneOpen()) closePhone();
    else openPhone();
}

function tickClock() {
    const rpDt = getRpDateTime();
    const el = document.getElementById('gp-clock');
    if (el) {
        // RP-время если есть, иначе реальное
        const h = rpDt?.hours ?? new Date().getHours();
        const m = rpDt?.minutes ?? new Date().getMinutes();
        el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    const rp = document.getElementById('gp-rpdate');
    if (rp) {
        rp.textContent = rpDt?.label || '';
    }
}

// ═══ Рендер экранов ═══

export function render() {
    const screen = document.getElementById('gp-screen');
    if (!screen || !isPhoneOpen()) return;
    if (currentScreen === 'thread' && currentThreadKey) renderThread(screen);
    else if (currentScreen === 'add') renderAdd(screen);
    else if (currentScreen === 'list') renderList(screen);
    else if (currentScreen === 'tw') renderTw(screen);
    else if (currentScreen === 'twthread' && currentTweetId) renderTwThread(screen);
    else if (currentScreen === 'ig') renderIg(screen);
    else if (currentScreen === 'igview' && currentPostId) renderIgView(screen);
    else if (currentScreen === 'ignew') renderIgNew(screen);
    else if (currentScreen === 'ignewstory') renderIgNewStory(screen);
    else if (currentScreen === 'igstory') renderIgStory(screen);
    else if (currentScreen === 'socialhub') renderSocialHub(screen);
    else if (currentScreen === 'storyevent') renderStoryEvent(screen);
    else if (currentScreen === 'storyresult') renderStoryResult(screen);
    else if (currentScreen === 'socialjournal') renderSocialJournal(screen);
    else if (currentScreen === 'of') renderOf(screen);
    else if (currentScreen === 'ofview' && currentPostId) renderOfView(screen);
    else if (currentScreen === 'ofnew') renderOfNew(screen);
    else if (currentScreen === 'bank') renderBank(screen);
    else if (currentScreen === 'banktx') renderBankTx(screen);
    else if (currentScreen === 'bankloan') renderBankLoan(screen);
    else if (currentScreen === 'bankrec') renderBankRec(screen);
    else if (currentScreen === 'shop') renderShop(screen);
    else if (currentScreen === 'shopcat') renderShopCat(screen);
    else if (currentScreen === 'shoporders') renderShopOrders(screen);
    else if (currentScreen === 'casino') renderCasino(screen);
    else if (currentScreen === 'news') renderNews(screen);
    else if (currentScreen === 'discord') renderDiscord(screen);
    else if (currentScreen === 'dchannel') renderDChannel(screen);
    else if (currentScreen === 'twitch') renderTwitch(screen);
    else if (currentScreen === 'stream') renderStream(screen);
    else if (currentScreen === 'mystream') renderMyStream(screen);
    else if (currentScreen === 'notes') renderNotes(screen);
    else if (currentScreen === 'appearance') renderAppearance(screen);
    else renderHome(screen);
    // Перевод отрендеренного экрана (en) / восстановление оригиналов (ru)
    try { trDom(screen); } catch (e) { /* ignore */ }
}

function goto(screenName) {
    currentScreen = screenName;
    render();
}

// Сохранение позиции скролла ленты при перерисовке (innerHTML сбрасывает scrollTop,
// из-за этого клик по «Нарисовать»/лайку дёргал экран наверх)
function setHtmlKeepScroll(screen, selector, html) {
    const prev = screen.querySelector(selector)?.scrollTop ?? null;
    screen.innerHTML = html;
    if (prev !== null) {
        const el = screen.querySelector(selector);
        if (el) el.scrollTop = prev;
    }
}

function compactNum(value) {
    const n = Number(value) || 0;
    if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}м`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}к`;
    return String(n);
}

function performanceHtml(post) {
    const p = post?.performance;
    if (!p?.settled) return '';
    const delta = Number(p.followerDelta) || 0;
    return `<div class="gp-social-result">
        <div class="gp-social-result-head"><b>${esc(p.label)}</b><span>${ic('fa-eye')} ${compactNum(p.reach)} · <span class="${delta < 0 ? 'gp-social-down' : 'gp-social-up'}">${delta >= 0 ? '+' : ''}${delta}</span> ${ic('fa-user-plus')}</span></div>
        <div class="gp-sentiment" title="Позитивные ${p.positive}% · нейтральные ${p.neutral}% · негативные ${p.negative}%"><i class="gp-sent-pos" style="width:${p.positive}%"></i><i class="gp-sent-neu" style="width:${p.neutral}%"></i><i class="gp-sent-neg" style="width:${p.negative}%"></i></div>
        <div class="gp-sentiment-labels"><span>${p.positive}% позитив</span><span>${p.neutral}% нейтр.</span><span>${p.negative}% негатив</span></div>
    </div>`;
}


// Репутация: живые статусы генерятся моделью, кэш по тиру (перегенерация
// только когда репутация перешла в другой тир)
const _repBusy = new Set();
function ensureRepLabels(s) {
    for (const platform of ['twitter', 'instagram']) {
        const p = s.socialProfiles?.[platform];
        if (!p) continue;
        // Ключ кэша: тир + язык интерфейса (сменила язык → статус перегенерится)
        const tierKey = `${getReputationStatus(p.reputation)}|${lang()}`;
        if (p.repLabel && p.repTier === tierKey) continue;
        if (_repBusy.has(platform)) continue;
        _repBusy.add(platform);
        generateRepLabel(platform, p.reputation, p.followers, getReputationStatus(p.reputation)).then(label => {
            if (label) {
                p.repLabel = label;
                p.repTier = tierKey;
                saveMeta();
                if (isPhoneOpen() && currentScreen === 'socialhub') render();
            }
        }).catch(() => {}).finally(() => _repBusy.delete(platform));
    }
}
function repLabelOf(s, platform) {
    const p = s.socialProfiles?.[platform];
    if (!p) return '';
    const tierKey = `${getReputationStatus(p.reputation)}|${lang()}`;
    return (p.repTier === tierKey && p.repLabel) || getReputationStatus(p.reputation);
}

function socialImpactToast(platform, post, addedComments = 0, addedFeed = 0) {
    const p = post?.performance;
    if (!p) return;
    const contacts = (platform === 'twitter' ? post.replies : post.comments || [])
        .filter(r => typeof r.ak === 'string' && r.ak.startsWith('contact:'));
    const names = [...new Set(contacts.map(r => r.author).filter(Boolean))].slice(0, 2);
    const delta = Number(p.followerDelta) || 0;
    const reaction = names.length ? `${names.join(' и ')} отреагировали` : `${addedComments} новых реакций`;
    const feed = addedFeed > 0 ? ` · лента +${addedFeed}` : '';
    toast(`${p.label}: ${reaction} · охват ${compactNum(p.reach)} · ${delta >= 0 ? '+' : ''}${delta} подписчиков${feed}`,
        platform === 'twitter' ? 'fa-x-twitter' : 'fa-instagram');
}

async function finalizeSocialPost(platform, post, { addedComments = 0, addedFeed = 0 } = {}) {
    if (!post || post.ak !== 'user' || post.performance?.settled) return null;
    const perf = settleSocialPost(platform, post);
    updatePhoneInjection();
    if (perf) {
        socialImpactToast(platform, post, addedComments, addedFeed);
        const event = await maybeGenerateStoryEvent(platform, post);
        if (event) {
            updatePhoneInjection();
            toast('Новый сюжетный поворот', 'fa-wand-sparkles');
            // Не прячем созданный ивент за отдельной иконкой: сразу показываем
            // три варианта ответа и поле собственного действия.
            goto('storyevent');
        }
    }
    return perf;
}

function bindSocialSystemLinks(root) {
    root.querySelectorAll('[data-open-social]').forEach(b => b.addEventListener('click', () => goto('socialhub')));
    root.querySelectorAll('[data-open-story]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); goto('storyevent'); }));
}

function findStoryEvent(id) {
    const systems = getSystemsView();
    if (systems.storyEvents.active?.id === id) return systems.storyEvents.active;
    return (systems.storyEvents.recent || []).find(e => e.id === id) || null;
}

function openStoryResult(id) {
    selectedStoryEventId = id;
    goto('storyresult');
}

function renderSocialHub(screen) {
    currentScreen = 'socialhub';
    // Самовосстановление незавершённых рекламных интеграций. Это покрывает
    // сохранения, где пост уже получил реакции/результат, но активное предложение
    // осталось в состоянии published и деньги не были начислены.
    for (const post of getTweets()) {
        if (post.ak === 'user' && post.advertisement && post.performance?.settled) settleSocialPost('twitter', post);
    }
    for (const post of getIgPosts()) {
        if (post.ak === 'user' && post.advertisement && post.performance?.settled) settleSocialPost('instagram', post);
    }
    const s = getSystemsView();
    const tasks = s.postingTasks.active || [];
    ensureRepLabels(s); // живые статусы репутации (кэш по тиру)
    const event = s.storyEvents.active;
    const ads = s.advertising || { offers: [], active: null, history: [] };
    const recentEvents = s.storyEvents.recent || [];
    screen.innerHTML = `<div class="gp-header gp-thread-header">
        <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button><div class="gp-title gp-title-app">Социальный профиль</div>
        <button class="gp-iconbtn" id="gp-open-journal" title="Журнал памяти">${ic('fa-book-open')}</button>
        ${event ? `<button class="gp-iconbtn gp-event-pulse" data-open-story title="Сюжетный поворот">${ic('fa-wand-sparkles')}</button>` : ''}
    </div><div class="gp-feed gp-social-hub">
        <div class="gp-profile-grid">
            <div class="gp-profile-card"><div>${brand('fa-x-twitter')} Twitter</div><b>${compactNum(s.socialProfiles.twitter.followers)}</b><span>подписчиков · ${esc(repLabelOf(s, 'twitter'))}</span></div>
            <div class="gp-profile-card"><div>${brand('fa-instagram')} Instagram</div><b>${compactNum(s.socialProfiles.instagram.followers)}</b><span>подписчиков · ${esc(repLabelOf(s, 'instagram'))}</span></div>
        </div>
        <section class="gp-social-section gp-ad-section"><h3>${ic('fa-star')} Рекламные предложения</h3>
            ${ads.active
                ? `<div class="gp-ad-active"><b>${esc(ads.active.brand)} · ${ads.active.platform === 'twitter' ? 'Twitter' : 'Instagram'}</b><span>${esc(ads.active.product)}</span><small>${ads.active.state === 'published' ? `Публикация размещена · ожидается подсчёт реакции и выплата ${fmtMoney(ads.active.payment)}` : `Следующая публикация в этой соцсети станет рекламной · ${fmtMoney(ads.active.payment)}`}</small></div>`
                : `${(ads.offers || []).length
                    ? (ads.offers || []).map(a => `<div class="gp-ad-card gp-ad-${esc(a.risk)}"><div><b>${esc(a.title)}</b><span>${esc(a.product)}</span><small>${esc(a.brief)} · ${fmtMoney(a.payment)}</small></div><div class="gp-ad-actions"><button class="gp-ad-accept" data-ad-accept="${esc(a.id)}">${ic('fa-check')} Взять</button><button class="gp-ad-decline" data-ad-decline="${esc(a.id)}" title="Отклонить">${ic('fa-xmark')}</button></div></div>`).join('')
                    : `<div class="gp-event-empty"><b>Предложений пока нет</b><span>Запроси свежие интеграции — модель подберёт бренды, товары и оплату под сеттинг текущей ролевой.</span></div>`}
                   <button class="gp-event-generate" id="gp-ad-generate" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-wand-magic-sparkles')} ${(ads.offers || []).length ? 'Обновить предложения' : 'Найти предложения'}</button>`}
        </section>
        <section class="gp-social-section gp-events-section">
            <h3>${ic('fa-wand-sparkles')} Сюжетные ивенты</h3>
            ${event
                ? `<button class="gp-event-banner" data-open-story><span>${ic('fa-wand-sparkles')}</span><div><b>${esc(event.title)}</b><small>${esc(event.hook)}</small></div>${ic('fa-chevron-right')}</button>`
                : `<div class="gp-event-empty"><b>Активного ивента пока нет</b><span>Модель соберёт три сюжетных поворота из лорбука, карточки, истории RP, журнала телефона и всех недавних постов.</span></div>
                   <button class="gp-event-generate" id="gp-event-generate" ${!genBusy ? '' : 'disabled'}>
                       ${genBusy ? ic('fa-spinner fa-spin') : ic('fa-wand-magic-sparkles')}
                       Создать три сюжетных поворота
                   </button>`}
            ${recentEvents.length ? `<div class="gp-event-history"><small>Архив</small>${recentEvents.slice(0, 8).map(e => `<button data-story-result="${esc(e.id)}" ${e.state === 'declined' ? 'disabled' : ''}><i class="fa-solid ${e.state === 'declined' ? 'fa-ban' : 'fa-check'}"></i><span><b>${esc(e.title)}</b><small>${esc(e.state === 'declined' ? 'отклонён' : 'нажми, чтобы прочитать итог')}</small></span>${e.state === 'declined' ? '' : ic('fa-chevron-right')}</button>`).join('')}</div>` : ''}
        </section>
        <section class="gp-social-section"><h3>${ic('fa-list-check')} Задания на постинг</h3>${tasks.map(t => `<div class="gp-task-card"><div><b>${esc(t.title)}</b><span>${esc(t.text)}</span></div><strong>${Math.min(t.progress, t.goal)}/${t.goal}</strong><i><em style="width:${Math.round(Math.min(1, t.progress / t.goal) * 100)}%"></em></i></div>`).join('')}</section>
    </div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-open-journal')?.addEventListener('click', () => goto('socialjournal'));
    screen.querySelectorAll('[data-ad-accept]').forEach(b => b.addEventListener('click', () => { acceptAdOffer(b.getAttribute('data-ad-accept')); toast('Рекламное задание принято', 'fa-star'); render(); }));
    screen.querySelectorAll('[data-ad-decline]').forEach(b => b.addEventListener('click', () => { declineAdOffer(b.getAttribute('data-ad-decline')); render(); }));
    screen.querySelector('#gp-ad-generate')?.addEventListener('click', async () => {
        if (genBusy) return;
        genBusy = true;
        render();
        try {
            const offers = await generateAdvertisingOffers();
            toast(offers.length ? `Новых предложений: ${offers.length}` : 'Модель не вернула подходящих предложений', offers.length ? 'fa-star' : 'fa-circle-exclamation');
        } catch (e) {
            console.error('[GlassPhone] advertising offers failed:', e);
            toast('Ошибка генерации рекламных предложений', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'socialhub') render();
        }
    });
    screen.querySelectorAll('[data-story-result]').forEach(b => b.addEventListener('click', () => openStoryResult(b.getAttribute('data-story-result'))));
    bindSocialSystemLinks(screen);
    screen.querySelector('#gp-event-generate')?.addEventListener('click', async () => {
        if (genBusy) return;
        genBusy = true;
        render();
        try {
            const created = await maybeGenerateStoryEvent('phone', null, { force: true });
            if (created) {
                updatePhoneInjection();
                toast('Сюжетный ивент создан', 'fa-wand-sparkles');
                goto('storyevent');
                return;
            }
            toast('Не удалось собрать ивент из контекста', 'fa-circle-exclamation');
        } catch (e) {
            console.error('[GlassPhone] manual story event failed:', e);
            toast('Ошибка генерации ивента', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'socialhub') render();
        }
    });
}

function renderStoryEvent(screen) {
    currentScreen = 'storyevent';
    const event = getSystemsView().storyEvents.active;
    if (!event) { goto('socialhub'); return; }
    const waiting = !!event.appliedAt;
    const alternatives = Array.isArray(event.alternatives) && event.alternatives.length ? event.alternatives : [event];
    const choosingEvent = !waiting && alternatives.length > 1 && event.selectedAlternative == null;
    if (choosingEvent) {
        screen.innerHTML = `<div class="gp-header gp-thread-header"><button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button><div class="gp-title gp-title-app">Выбрать ивент</div></div><div class="gp-feed gp-story-screen"><div class="gp-story-card">
            <div class="gp-story-kicker">${ic('fa-wand-sparkles')} Три возможных поворота</div><h2>Какую нить вплести в историю?</h2><p class="gp-story-hook">Выбери сам ивент. Следующим экраном появятся варианты реакции на него.</p>
            <div class="gp-story-choices">${alternatives.map((a, i) => `<button data-select-event="${i}"><b>${esc(a.title)}</b><span>${esc(a.hook)}</span></button>`).join('')}</div>
            <div class="gp-story-foot"><button id="gp-event-later">Не сейчас</button><button id="gp-event-decline">Отклонить все</button></div>
        </div></div>`;
        screen.querySelector('#gp-back')?.addEventListener('click', () => goto('socialhub'));
        screen.querySelectorAll('[data-select-event]').forEach(b => b.addEventListener('click', () => {
            if (selectStoryEvent(Number(b.getAttribute('data-select-event')))) render();
        }));
        screen.querySelector('#gp-event-later')?.addEventListener('click', () => { deferEvent(); goto('socialhub'); });
        screen.querySelector('#gp-event-decline')?.addEventListener('click', () => { if (confirm('Отклонить все предложенные сюжетные повороты?')) { declineEvent(); updatePhoneInjection(); goto('socialhub'); } });
        return;
    }
    screen.innerHTML = `<div class="gp-header gp-thread-header"><button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button><div class="gp-title gp-title-app">Сюжетный поворот</div></div><div class="gp-feed gp-story-screen"><div class="gp-story-card">
        <div class="gp-story-kicker">${ic('fa-wand-sparkles')} ${esc(event.urgency === 'immediate' ? 'Срочно' : 'Новая нить истории')}</div><h2>${esc(event.title)}</h2><p class="gp-story-hook">${esc(event.hook)}</p>
        ${event.openingMessage ? `<blockquote>${esc(event.openingMessage)}</blockquote>` : ''}${event.involvedActors?.length ? `<div class="gp-story-actors">${event.involvedActors.map(a => `<span>${ic('fa-user')} ${esc(a)}</span>`).join('')}</div>` : ''}
        ${waiting ? `<div class="gp-story-result"><b>${ic('fa-circle-check')} Решение принято</b><p>${esc(event.immediateResult)}</p>${event.state === 'waiting_rp' ? '<small>Продолжение естественно появится в основном RP.</small>' : ''}</div>` : `<div class="gp-story-choices">${event.choices.map((c, i) => `<button data-event-choice="${i}"><b>${esc(c.label)}</b><span>${esc(c.text)}</span></button>`).join('')}<button id="gp-custom-toggle"><b>${ic('fa-pen')} Свой ответ</b><span>Написать собственное действие или реплику</span></button></div><div class="gp-story-custom" id="gp-story-custom" hidden><textarea id="gp-story-text" rows="4" maxlength="1000" placeholder="Что вы отвечаете или делаете?"></textarea><button class="gp-primary" id="gp-story-send">Продолжить</button></div><div class="gp-story-foot"><button id="gp-event-later">Не сейчас</button><button id="gp-event-decline">Отклонить</button></div>`}
    </div></div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('socialhub'));
    const resolve = async choice => {
        if (genBusy) return;
        genBusy = true;
        screen.querySelectorAll('button, textarea').forEach(el => { el.disabled = true; });
        const loading = document.createElement('div');
        loading.className = 'gp-story-loading';
        loading.innerHTML = `<div>${ic('fa-spinner fa-spin')}</div><b>История меняется…</b><span>Ждём итог и последствия выбранного ответа</span>`;
        screen.appendChild(loading);
        try { const outcome = await resolveStoryEvent(choice); if (outcome) { await logSocialToChat(`[Сюжетный поворот из соцсети] ${event.hook} ${getUserName()}: «${outcome.choice.text}». Результат: ${outcome.event.immediateResult}`); updatePhoneInjection(); toast('Выбор изменил историю', 'fa-wand-sparkles'); selectedStoryEventId = outcome.event.id; currentScreen = 'storyresult'; } }
        catch (e) { console.error('[GlassPhone] story event failed:', e); toast('Не удалось продолжить событие', 'fa-circle-exclamation'); }
        finally { genBusy = false; render(); }
    };
    screen.querySelectorAll('[data-event-choice]').forEach(b => b.addEventListener('click', () => resolve(event.choices[Number(b.getAttribute('data-event-choice'))])));
    screen.querySelector('#gp-custom-toggle')?.addEventListener('click', () => { const el = screen.querySelector('#gp-story-custom'); el.hidden = !el.hidden; screen.querySelector('#gp-story-text')?.focus(); });
    screen.querySelector('#gp-story-send')?.addEventListener('click', () => { const text = screen.querySelector('#gp-story-text')?.value.trim(); if (text) resolve({ label: 'Свой ответ', intent: 'custom', text, custom: true }); });
    screen.querySelector('#gp-event-later')?.addEventListener('click', () => { deferEvent(); goto('socialhub'); });
    screen.querySelector('#gp-event-decline')?.addEventListener('click', () => { if (confirm('Отклонить этот сюжетный поворот?')) { declineEvent(); updatePhoneInjection(); goto('socialhub'); } });
}

function renderStoryResult(screen) {
    currentScreen = 'storyresult';
    const event = findStoryEvent(selectedStoryEventId);
    if (!event) { goto('socialhub'); return; }
    const decision = event.decisions?.[event.decisions.length - 1];
    const shift = event.audienceShift || {};
    const reactions = event.botReactions || [];
    const relations = event.relationshipSignals || [];
    screen.innerHTML = `<div class="gp-header gp-thread-header"><button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button><div class="gp-title gp-title-app">Итог ивента</div></div>
    <div class="gp-feed gp-story-screen"><article class="gp-story-card gp-story-summary">
        <div class="gp-story-kicker">${ic(event.state === 'failed' ? 'fa-triangle-exclamation' : 'fa-circle-check')} ${event.state === 'failed' ? 'Неудачный исход' : 'Ивент завершён'}</div>
        <h2>${esc(event.title)}</h2><p class="gp-story-hook">${esc(event.hook)}</p>
        ${decision ? `<section><h3>Твой выбор</h3><blockquote><b>${esc(decision.label)}</b><br>${esc(decision.text)}</blockquote></section>` : ''}
        <section><h3>Итог</h3><p>${esc(event.immediateResult || event.recap || 'Ивент завершён.')}</p></section>
        ${reactions.length ? `<section><h3>Реакции</h3><div class="gp-result-reactions">${reactions.map(r => `<div class="gp-result-reaction gp-sent-${esc(r.sentiment)}"><b>${esc(r.author || 'Аккаунт')}</b><small>${esc(r.channel)}</small><p>${esc(r.text)}</p></div>`).join('')}</div></section>` : ''}
        ${(shift.positive || shift.neutral || shift.negative) ? `<section><h3>Сдвиг аудитории</h3><div class="gp-result-stats"><span class="gp-social-up">+${Number(shift.positive) || 0} позитив</span><span>+${Number(shift.neutral) || 0} нейтр.</span><span class="gp-social-down">+${Number(shift.negative) || 0} негатив</span></div>${event.followerModifier && event.followerModifier !== 1 ? `<small>Модификатор подписчиков: ×${esc(event.followerModifier)}</small>` : ''}</section>` : ''}
        ${relations.length ? `<section><h3>Отношения</h3>${relations.map(r => `<div class="gp-result-note"><b>${esc(r.actor)}</b><small>${esc(r.direction)}</small><p>${esc(r.reason)}</p></div>`).join('')}</section>` : ''}
        ${event.rpConsequence ? `<section><h3>Последствие в RP</h3><div class="gp-result-note"><b>${esc(event.rpConsequence.actors?.join(', ') || 'Следующая сцена')}</b><small>${esc(event.rpConsequence.urgency)}</small><p>${esc(event.rpConsequence.summary)}</p></div></section>` : ''}
        ${event.nextHook ? `<section><h3>Следующий крючок</h3><p>${esc(event.nextHook)}</p></section>` : ''}
        <div class="gp-story-foot"><button id="gp-result-archive">Вернуться в архив</button></div>
    </article></div>`;
    const back = () => goto('socialhub');
    screen.querySelector('#gp-back')?.addEventListener('click', back);
    screen.querySelector('#gp-result-archive')?.addEventListener('click', back);
}

function renderSocialJournal(screen) {
    currentScreen = 'socialjournal';
    const entries = getSocialJournalEntries();
    screen.innerHTML = `<div class="gp-header gp-thread-header"><button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button><div class="gp-title gp-title-app">Журнал памяти</div></div>
    <div class="gp-feed gp-journal-screen"><div class="gp-journal-info">${ic('fa-brain')} Здесь показаны скрытые записи, которые действительно добавлены в историю чата и доступны боту и саммарайзеру.</div>
    ${entries.length ? entries.map(e => `<article class="gp-journal-entry"><div><b>Запись #${e.index + 1}</b><small>${esc(e.time)}</small></div>${e.image ? `<img src="${esc(e.image)}" alt="Фото из записи">` : ''}<p>${esc(e.text)}</p></article>`).join('') : `<div class="gp-event-empty"><b>Журнал пока пуст</b><span>Новые посты, комментарии, ответы и итоги ивентов появятся здесь после записи в чат.</span></div>`}</div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('socialhub'));
}

// ── Домашний экран ──
function renderHome(screen) {
    currentScreen = 'home';
    const unread = getTotalUnread();
    const activeStoryEvent = getSystemsView().storyEvents.active;
    const rpDt = getRpDateTime();
    const d = new Date();
    const DAYS = DAYS_I18N[lang()];
    const MONTHS = MONTHS_I18N[lang()];

    // RP-дата/время если доступно, иначе реальные
    const clockH = rpDt?.hours ?? d.getHours();
    const clockM = rpDt?.minutes ?? d.getMinutes();
    let dateStr;
    if (rpDt) {
        // Для RP-даты вычисляем день недели через Date
        const rpDate = new Date(rpDt.year, rpDt.month - 1, rpDt.day);
        dateStr = `${DAYS[rpDate.getDay()]}, ${rpDt.day} ${MONTHS[rpDt.month - 1]}`;
    } else {
        dateStr = `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    }

    screen.innerHTML = `
        <div class="gp-home">
            <div class="gp-home-clock">${String(clockH).padStart(2, '0')}:${String(clockM).padStart(2, '0')}</div>
            <div class="gp-home-date">${dateStr}</div>
            <div class="gp-home-grid">
                <div class="gp-app" data-app="list">
                    <div class="gp-app-icon gp-app-msg">${ic('fa-comment-dots')}${unread > 0 ? `<span class="gp-app-badge">${unread > 9 ? '9+' : unread}</span>` : ''}</div>
                    <div class="gp-app-name">Сообщения</div>
                </div>
                <div class="gp-app" data-app="tw">
                    <div class="gp-app-icon gp-app-tw">${brand('fa-x-twitter')}</div>
                    <div class="gp-app-name">Twitter</div>
                </div>
                <div class="gp-app" data-app="ig">
                    <div class="gp-app-icon gp-app-ig">${brand('fa-instagram')}</div>
                    <div class="gp-app-name">Instagram</div>
                </div>
                <div class="gp-app" data-app="${activeStoryEvent ? 'storyevent' : 'socialhub'}">
                    <div class="gp-app-icon gp-app-events${activeStoryEvent ? ' gp-event-pulse' : ''}">${ic('fa-wand-sparkles')}${activeStoryEvent ? '<span class="gp-app-badge">!</span>' : ''}</div>
                    <div class="gp-app-name">Ивенты</div>
                </div>
                <div class="gp-app" data-app="of">
                    <div class="gp-app-icon gp-app-of">${ic('fa-heart')}</div>
                    <div class="gp-app-name">OnlyFans</div>
                </div>
                <div class="gp-app" data-app="bank">
                    <div class="gp-app-icon gp-app-bank">${ic('fa-building-columns')}${bankBadgeCount() > 0 ? `<span class="gp-app-badge">${bankBadgeCount()}</span>` : ''}</div>
                    <div class="gp-app-name">Банк</div>
                </div>
                <div class="gp-app" data-app="shop">
                    <div class="gp-app-icon gp-app-shop">${ic('fa-bag-shopping')}</div>
                    <div class="gp-app-name">Магазин</div>
                </div>
                <div class="gp-app" data-app="casino">
                    <div class="gp-app-icon gp-app-casino">${ic('fa-dice')}</div>
                    <div class="gp-app-name">Казино</div>
                </div>
                <div class="gp-app" data-app="news">
                    <div class="gp-app-icon gp-app-news">${ic('fa-newspaper')}</div>
                    <div class="gp-app-name">Новости</div>
                </div>
                <div class="gp-app" data-app="discord">
                    <div class="gp-app-icon gp-app-discord">${brand('fa-discord')}</div>
                    <div class="gp-app-name">Discord</div>
                </div>
                <div class="gp-app" data-app="twitch">
                    <div class="gp-app-icon gp-app-twitch">${brand('fa-twitch')}${getTwitch().myStream ? '<span class="gp-app-badge gp-live-badge">LIVE</span>' : ''}</div>
                    <div class="gp-app-name">Twitch</div>
                </div>
                <div class="gp-app" data-app="notes">
                    <div class="gp-app-icon gp-app-notes">${ic('fa-note-sticky')}</div>
                    <div class="gp-app-name">Заметки</div>
                </div>
                <div class="gp-app" data-app="appearance">
                    <div class="gp-app-icon gp-app-appearance">${ic('fa-palette')}</div>
                    <div class="gp-app-name">Оформление</div>
                </div>
            </div>
        </div>`;

    screen.querySelectorAll('.gp-app').forEach(el => {
        el.addEventListener('click', () => goto(el.getAttribute('data-app')));
    });
}

// ── Экран «Оформление» ──
// Режим «Свой CSS» — последний слайд карусели тем (редактор показывается
// ТОЛЬКО когда выбран этот слайд, у обычных тем его нет)
let _appearanceCssMode = false;

function renderAppearance(screen) {
    currentScreen = 'appearance';
    const s = getSettings();
    const skin = LEGACY_SKINS[s.skin] || (SKINS.includes(s.skin) ? s.skin : 'indigo');
    const custom = normalizedThemeCustom();
    const presets = Array.isArray(s.themePresets) ? s.themePresets : [];
    const cssMode = _appearanceCssMode;
    const cards = THEME_INFO.map(t => `
        <button class="gp-theme-card${(!cssMode && t.id === skin) ? ' gp-active' : ''}" data-skin="${t.id}" type="button">
            <span class="gp-theme-preview gp-preview-${t.id}">
                <span class="gp-preview-island"></span>
                <span class="gp-preview-lines"><i></i><i></i><i></i></span>
                <span class="gp-preview-dock">${t.colors.map(c => `<i style="background:${c}"></i>`).join('')}</span>
            </span>
            <strong>${esc(t.name)}</strong>
            <small>${esc(t.note)}</small>
            <b>${(!cssMode && t.id === skin) ? 'АКТИВНА' : 'ВЫБРАТЬ'}</b>
        </button>`).join('')
        // Последний слайд — «Свой CSS»: полный контроль руками
        + `
        <button class="gp-theme-card gp-theme-card-css${cssMode ? ' gp-active' : ''}" id="gp-css-card" type="button">
            <span class="gp-theme-preview gp-preview-csscard">
                <span class="gp-preview-code">&lt;/&gt;</span>
            </span>
            <strong>Свой CSS</strong>
            <small>Полный контроль</small>
            <b>${cssMode ? 'АКТИВНА' : 'ВЫБРАТЬ'}</b>
        </button>`;
    const dots = THEME_INFO.map(t => `<button class="gp-theme-dot${(!cssMode && t.id === skin) ? ' gp-active' : ''}" data-skin="${t.id}" aria-label="${esc(t.name)}"></button>`).join('')
        + `<button class="gp-theme-dot${cssMode ? ' gp-active' : ''}" id="gp-css-dot" aria-label="Свой CSS"></button>`;
    const chips = presets.length ? presets.map(p => `
        <button class="gp-preset-chip" data-preset="${esc(p.id)}" type="button">
            <span>${esc(p.name || 'Мой пресет')}</span><i class="fa-solid fa-xmark" data-delete-preset="${esc(p.id)}"></i>
        </button>`).join('') : '<div class="gp-presets-empty">Здесь появятся ваши варианты оформления</div>';

    // CSS-режим: под каруселью ТОЛЬКО редактор своего CSS
    const cssEditorHtml = `
            <section class="gp-theme-section">
                <h3>Свой CSS</h3>
                <textarea id="gp-app-css" class="gp-theme-css" rows="10" spellcheck="false" placeholder="/* #gp-phone, .gp-bubble, .gp-tw-card, .gp-app-icon ... */"></textarea>
                <button class="gp-save-preset" id="gp-app-css-apply" type="button">${ic('fa-check')} Применить CSS</button>
            </section>`;

    screen.innerHTML = `
        <div class="gp-header gp-appearance-header">
            <button class="gp-iconbtn" id="gp-home-btn">${ic('fa-chevron-left')}</button>
            <div class="gp-title">Оформление</div>
            <button class="gp-iconbtn" id="gp-theme-reset" title="Сбросить настройки">${ic('fa-rotate-left')}</button>
        </div>
        <div class="gp-appearance-scroll">
            <div class="gp-theme-carousel" id="gp-theme-carousel">${cards}</div>
            <div class="gp-theme-dots">${dots}</div>
            ${cssMode ? cssEditorHtml : `
            <section class="gp-theme-section">
                <h3>Мои пресеты</h3>
                <div class="gp-presets">${chips}</div>
                <button class="gp-save-preset" id="gp-save-preset" type="button">${ic('fa-plus')} Сохранить текущую</button>
            </section>

            <section class="gp-theme-section gp-theme-editor">
                <h3>Настроить</h3>
                <label class="gp-theme-control gp-color-control">
                    <span>Акцент</span>
                    <span class="gp-color-pickers">
                        <input id="gp-accent-a" type="color" value="${custom.accentA || (THEME_INFO.find(x => x.id === skin)?.colors[0] || '#6a8dff')}">
                        <input id="gp-accent-b" type="color" value="${custom.accentB || (THEME_INFO.find(x => x.id === skin)?.colors[1] || '#9a6aff')}">
                    </span>
                </label>
                <label class="gp-theme-control gp-color-control" ${s.wallpaper ? 'style="opacity:.45"' : ''}>
                    <span>Цвет фона${s.wallpaper ? ' <output class="gp-ctl-note">под обоями</output>' : ''}</span>
                    <span class="gp-color-pickers">
                        <input id="gp-theme-bg" type="color" value="${custom.bg || '#1a2430'}">
                        <button class="gp-color-clear" id="gp-theme-bg-clear" title="Вернуть фон темы" type="button">${ic('fa-xmark')}</button>
                    </span>
                </label>
                <label class="gp-theme-control gp-color-control">
                    <span>Цвет текста</span>
                    <span class="gp-color-pickers">
                        <input id="gp-theme-text" type="color" value="${custom.text || '#eef2f8'}">
                        <button class="gp-color-clear" id="gp-theme-text-clear" title="Вернуть цвет темы" type="button">${ic('fa-xmark')}</button>
                    </span>
                </label>
                <label class="gp-theme-control gp-color-control">
                    <span>Цвет иконок</span>
                    <span class="gp-color-pickers">
                        <input id="gp-theme-icon-a" type="color" value="${custom.iconA || custom.accentA || (THEME_INFO.find(x => x.id === skin)?.colors[0] || '#6a8dff')}">
                        <input id="gp-theme-icon-b" type="color" value="${custom.iconB || custom.accentB || (THEME_INFO.find(x => x.id === skin)?.colors[1] || '#9a6aff')}">
                        <button class="gp-color-clear" id="gp-theme-icons-clear" title="Вернуть иконки темы" type="button">${ic('fa-xmark')}</button>
                    </span>
                </label>
                <label class="gp-theme-control">
                    <span>Шрифт</span>
                    <select id="gp-theme-font" class="gp-theme-select">
                        <option value="" ${!custom.font ? 'selected' : ''}>Как в теме</option>
                        <option value="serif" ${custom.font === 'serif' ? 'selected' : ''}>С засечками</option>
                        <option value="mono" ${custom.font === 'mono' ? 'selected' : ''}>Моноширинный</option>
                        <option value="rounded" ${custom.font === 'rounded' ? 'selected' : ''}>Округлый</option>
                        <option value="condensed" ${custom.font === 'condensed' ? 'selected' : ''}>Узкий</option>
                    </select>
                </label>
                <label class="gp-theme-control">
                    <span>Скругление <output id="gp-radius-out">${custom.radius}px</output></span>
                    <input id="gp-theme-radius" type="range" min="2" max="30" value="${custom.radius}">
                </label>
                <label class="gp-theme-control">
                    <span>Прозрачность <output id="gp-alpha-out">${custom.transparency}%</output></span>
                    <input id="gp-theme-alpha" type="range" min="3" max="28" value="${custom.transparency}">
                </label>
                <label class="gp-theme-control">
                    <span>Размер иконок <output id="gp-icons-out">${custom.iconScale}%</output></span>
                    <input id="gp-theme-icons" type="range" min="80" max="115" value="${custom.iconScale}">
                </label>
            </section>

            <section class="gp-theme-section">
                <h3>Обои</h3>
                <div class="gp-theme-wall-row">
                    <button class="gp-save-preset" id="gp-app-wall-pick" type="button">${ic('fa-image')} ${s.wallpaper ? 'Сменить фото' : 'Загрузить фото'}</button>
                    <button class="gp-iconbtn ${s.wallpaperBlur ? 'gp-btn-on' : ''}" id="gp-app-wall-blur" title="Размыть обои" type="button">${ic('fa-droplet')}</button>
                    ${s.wallpaper ? `<button class="gp-iconbtn gp-danger" id="gp-app-wall-clear" title="Убрать обои" type="button">${ic('fa-xmark')}</button>` : ''}
                    <input type="file" id="gp-app-wall-file" accept="image/*" style="display:none">
                </div>
            </section>`}
        </div>`;

    screen.querySelector('#gp-home-btn')?.addEventListener('click', () => goto('home'));
    const carousel = screen.querySelector('#gp-theme-carousel');
    const activeCard = carousel?.querySelector('.gp-theme-card.gp-active');
    requestAnimationFrame(() => activeCard?.scrollIntoView({ inline: 'center', block: 'nearest' }));

    const chooseSkin = (nextSkin) => {
        if (!SKINS.includes(nextSkin)) return;
        _appearanceCssMode = false; // выбор обычной темы выходит из CSS-режима
        getSettings().skin = nextSkin;
        saveSettingsDebounced();
        applySkin();
        const select = document.getElementById('gp-set-skin');
        if (select) select.value = nextSkin;
        renderAppearance(screen);
    };
    screen.querySelectorAll('[data-skin]').forEach(el => el.addEventListener('click', () => chooseSkin(el.dataset.skin)));
    // Последний слайд «Свой CSS»: тема не меняется, снизу открывается редактор
    const enterCssMode = () => { _appearanceCssMode = true; renderAppearance(screen); };
    screen.querySelector('#gp-css-card')?.addEventListener('click', enterCssMode);
    screen.querySelector('#gp-css-dot')?.addEventListener('click', enterCssMode);

    const updateCustom = (patch, rerender = false) => {
        const st = getSettings();
        st.themeCustom = { ...normalizedThemeCustom(st.themeCustom), ...patch };
        saveSettingsDebounced();
        applySkin();
        if (rerender) renderAppearance(screen);
    };
    const bindRange = (id, key, outId, suffix) => {
        const el = screen.querySelector(id);
        el?.addEventListener('input', () => {
            screen.querySelector(outId).textContent = `${el.value}${suffix}`;
            updateCustom({ [key]: Number(el.value) });
        });
    };
    bindRange('#gp-theme-radius', 'radius', '#gp-radius-out', 'px');
    bindRange('#gp-theme-alpha', 'transparency', '#gp-alpha-out', '%');
    bindRange('#gp-theme-icons', 'iconScale', '#gp-icons-out', '%');
    screen.querySelector('#gp-accent-a')?.addEventListener('input', e => updateCustom({ accentA: e.target.value }));
    screen.querySelector('#gp-accent-b')?.addEventListener('input', e => updateCustom({ accentB: e.target.value }));
    screen.querySelector('#gp-theme-bg')?.addEventListener('input', e => updateCustom({ bg: e.target.value }));
    screen.querySelector('#gp-theme-bg-clear')?.addEventListener('click', () => updateCustom({ bg: null }, true));
    screen.querySelector('#gp-theme-text')?.addEventListener('input', e => updateCustom({ text: e.target.value }));
    screen.querySelector('#gp-theme-text-clear')?.addEventListener('click', () => updateCustom({ text: null }, true));
    screen.querySelector('#gp-theme-icon-a')?.addEventListener('input', e => updateCustom({ iconA: e.target.value }));
    screen.querySelector('#gp-theme-icon-b')?.addEventListener('input', e => updateCustom({ iconB: e.target.value }));
    screen.querySelector('#gp-theme-icons-clear')?.addEventListener('click', () => updateCustom({ iconA: null, iconB: null }, true));
    screen.querySelector('#gp-theme-font')?.addEventListener('change', e => updateCustom({ font: e.target.value }));

    // ── Обои (перенесены из панели расширения) ──
    const wallFile = screen.querySelector('#gp-app-wall-file');
    screen.querySelector('#gp-app-wall-pick')?.addEventListener('click', () => wallFile?.click());
    wallFile?.addEventListener('change', async function () {
        const f = this.files?.[0];
        if (!f) return;
        try {
            const dataUrl = await compressImage(f, 1080, 0.85);
            let src = dataUrl;
            try {
                const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/i, '');
                src = await saveBase64AsFile(base64, 'glassphone', `wallpaper_${Date.now()}`, 'jpeg');
            } catch (e) { /* dataURL фолбэк */ }
            getSettings().wallpaper = src;
            saveSettingsDebounced();
            applyWallpaper();
            renderAppearance(screen);
            toast('Обои установлены', 'fa-image');
        } catch (e) {
            toast('Не удалось загрузить обои', 'fa-circle-exclamation');
        } finally { this.value = ''; }
    });
    screen.querySelector('#gp-app-wall-blur')?.addEventListener('click', () => {
        getSettings().wallpaperBlur = !getSettings().wallpaperBlur;
        saveSettingsDebounced();
        applyWallpaper();
        renderAppearance(screen);
    });
    screen.querySelector('#gp-app-wall-clear')?.addEventListener('click', () => {
        getSettings().wallpaper = '';
        saveSettingsDebounced();
        applyWallpaper();
        renderAppearance(screen);
        toast('Обои убраны', 'fa-check');
    });

    // ── Свой CSS (перенесён из панели расширения) ──
    const cssArea = screen.querySelector('#gp-app-css');
    if (cssArea) cssArea.value = s.customCss || '';
    screen.querySelector('#gp-app-css-apply')?.addEventListener('click', () => {
        getSettings().customCss = cssArea?.value || '';
        saveSettingsDebounced();
        applySkin();
        toast('CSS применён', 'fa-check');
    });

    screen.querySelector('#gp-theme-reset')?.addEventListener('click', () => {
        getSettings().themeCustom = { accentA: null, accentB: null, bg: null, text: null, iconA: null, iconB: null, font: '', radius: 18, transparency: 10, iconScale: 100 };
        saveSettingsDebounced();
        applySkin();
        renderAppearance(screen);
        toast('Настройки темы сброшены', 'fa-rotate-left');
    });
    screen.querySelector('#gp-save-preset')?.addEventListener('click', () => {
        const name = prompt('Название пресета:', `Мой ${THEME_INFO.find(x => x.id === skin)?.name || 'стиль'}`)?.trim();
        if (!name) return;
        const st = getSettings();
        st.themePresets.push({
            id: `theme_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: name.slice(0, 32), skin: st.skin, custom: { ...normalizedThemeCustom(st.themeCustom) },
        });
        saveSettingsDebounced();
        renderAppearance(screen);
        toast(`Пресет «${name.slice(0, 32)}» сохранён`, 'fa-bookmark');
    });
    screen.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', e => {
        if (e.target.closest('[data-delete-preset]')) return;
        const p = getSettings().themePresets.find(x => x.id === el.dataset.preset);
        if (!p) return;
        const presetSkin = LEGACY_SKINS[p.skin] || p.skin;
        getSettings().skin = SKINS.includes(presetSkin) ? presetSkin : 'indigo';
        getSettings().themeCustom = { ...normalizedThemeCustom(p.custom) };
        saveSettingsDebounced();
        applySkin();
        renderAppearance(screen);
        toast(`Пресет «${p.name}» применён`, 'fa-wand-magic-sparkles');
    }));
    screen.querySelectorAll('[data-delete-preset]').forEach(el => el.addEventListener('click', e => {
        e.stopPropagation();
        const st = getSettings();
        st.themePresets = st.themePresets.filter(x => x.id !== el.dataset.deletePreset);
        saveSettingsDebounced();
        renderAppearance(screen);
    }));

    // Экран перерисовывает СЕБЯ (мимо render()) — перевод надо накатить тут,
    // иначе после клика/пролистывания текст возвращался к русскому
    try { trDom(screen); } catch (e) { /* ignore */ }
}

// ── Экран «Сообщения» ──
function renderList(screen) {
    currentScreen = 'list';
    const list = getThreadList();

    let rows = '';
    for (const t of list) {
        const lastText = t.last ? (t.last.voice ? 'Голосовое сообщение' : (t.last.text || (t.last.img || t.last.photoDesc ? 'Фото' : ''))) : '';
        const senderPrefix = t.last
            ? (t.last.dir === 'out' ? '<span class="gp-prev-you">Ты:</span> '
                : (t.isGroup && t.last.from ? `<span class="gp-prev-you">${esc(t.last.from)}:</span> ` : ''))
            : '';
        const preview = t.last
            ? `${senderPrefix}${esc(lastText.slice(0, 60))}`
            : '<span class="gp-prev-empty">Нет сообщений — напиши первой</span>';
        const time = t.last && t.last.time ? fmtTime(t.last.time) : '';
        const ava = t.isGroup
            ? `<div class="gp-avatar gp-avatar-group">${ic('fa-users')}</div>`
            : avatarHtml(t.name, getContactAvatar(t.key));
        rows += `
        <div class="gp-row" data-key="${esc(t.key)}">
            ${ava}
            <div class="gp-row-mid">
                <div class="gp-row-name">${esc(t.name)}</div>
                <div class="gp-row-preview">${preview}</div>
            </div>
            <div class="gp-row-side">
                <div class="gp-row-time">${esc(time)}</div>
                ${t.unread > 0 ? `<div class="gp-unread">${t.unread > 9 ? '9+' : t.unread}</div>` : ''}
            </div>
        </div>`;
    }

    setHtmlKeepScroll(screen, '.gp-list', `
        <div class="gp-header">
            <button class="gp-iconbtn" id="gp-home-btn">${ic('fa-chevron-left')}</button>
            <div class="gp-title">Сообщения</div>
            <button class="gp-iconbtn" id="gp-add-btn" title="Добавить контакт">${ic('fa-plus')}</button>
        </div>
        <div class="gp-list">
            ${rows || `
            <div class="gp-empty">
                <div class="gp-empty-icon">${ic('fa-comment-slash')}</div>
                <div class="gp-empty-title">Пусто</div>
                <div class="gp-empty-text">Пока никто не дал тебе номер.<br>Получи номер в ролевой — контакт появится сам.<br>Или добавь вручную по кнопке&nbsp;${ic('fa-plus')}</div>
            </div>`}
        </div>`);

    screen.querySelector('#gp-home-btn')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-add-btn')?.addEventListener('click', () => {
        currentScreen = 'add';
        render();
    });
    screen.querySelectorAll('.gp-row').forEach(row => {
        row.addEventListener('click', () => {
            currentThreadKey = row.getAttribute('data-key');
            currentScreen = 'thread';
            render();
        });
    });
}

// ── Экран треда ──
// ── Реакции на сообщения (как в ТГ, но FontAwesome — без стандартных эмодзи) ──
const REACTIONS = [
    { id: 'heart', icon: 'fa-heart', ru: 'сердечко' },
    { id: 'like', icon: 'fa-thumbs-up', ru: 'лайк' },
    { id: 'laugh', icon: 'fa-face-laugh-squint', ru: 'смех' },
    { id: 'wow', icon: 'fa-face-surprise', ru: 'вау' },
    { id: 'sad', icon: 'fa-face-sad-tear', ru: 'грусть' },
    { id: 'angry', icon: 'fa-face-angry', ru: 'злость' },
    { id: 'fire', icon: 'fa-fire', ru: 'огонь' },
];
let _reactPickerFor = null; // mi сообщения с открытым пикером
let _reactPickerKey = null; // тред пикера (чтобы mi не «переехал» в другой чат)

// Перезапись JSON-тега сообщения по позиции (tel:sms или tel:out маркер юзера).
// После записи позиции соседних тегов устаревают — но render() пересканирует чат.
async function rewriteSmsTag(m, t, mutate) {
    try {
        const ctx = SillyTavern.getContext();
        const chatMsg = ctx?.chat?.[m.idx];
        if (!chatMsg || !Number.isInteger(m.tagStart) || !Number.isInteger(m.tagEnd)) return false;
        const tag = chatMsg.mes.slice(m.tagStart, m.tagEnd);
        const re = m.dir === 'out'
            ? /<!--\s*tel:out:(\{[\s\S]*?\})\s*-->/i
            : /<!--\s*tel:sms:(\{[\s\S]*?\})\s*-->/i;
        const jm = tag.match(re);
        if (!jm) return false; // индексы съехали — не портим чужой текст
        let j = null;
        try { j = JSON.parse(jm[1]); } catch (e) { /* битый JSON от модели — соберём заново */ }
        if (!j) {
            if (m.dir === 'out') return false; // свои маркеры пишем мы, они всегда валидны
            j = { from: m.from, text: m.text || '' };
            if (t?.isGroup) j.chat = t.name;
            if (m.photoDesc) j.photo = m.photoDesc;
            if (m.voice) j.voice = true;
            if (m.img) j.img = m.img;
        }
        mutate(j);
        const kind = m.dir === 'out' ? 'out' : 'sms';
        chatMsg.mes = chatMsg.mes.slice(0, m.tagStart) + `<!--tel:${kind}:${JSON.stringify(j)}-->` + chatMsg.mes.slice(m.tagEnd);
        await saveChatConditional();
        return true;
    } catch (e) {
        console.warn('[GlassPhone] rewriteSmsTag failed:', e);
        return false;
    }
}

// ── Голосовые: дорожка детерминирована текстом (стабильна между рендерами),
// длительность оценивается по числу слов (~2.4 слова/сек, 0:02–3:00)
function voiceBars(seed, n = 27) {
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    const bars = [];
    for (let i = 0; i < n; i++) {
        h = Math.imul(h ^ (h >>> 13), 1103515245) + 12345;
        bars.push(22 + (Math.abs(h) % 78));
    }
    return bars;
}
function voiceDurationSec(text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.min(180, Math.max(2, Math.round(words / 2.4)));
}
function fmtVoiceDur(sec) {
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function voiceBubbleHtml(m) {
    const dur = voiceDurationSec(m.text);
    const bars = voiceBars((m.from || '') + m.text)
        .map(h => `<span style="height:${h}%"></span>`).join('');
    // ВАЖНО: одной строкой, без переносов — .gp-bubble имеет white-space:pre-wrap,
    // и литеральные \n из шаблона рендерятся пустыми строками (жирный пузырь)
    return `<div class="gp-voice" style="--gp-voice-dur:${dur}s"><button class="gp-voice-play" data-voiceplay aria-label="Воспроизвести">${ic('fa-play')}</button><div class="gp-voice-wave">${bars}</div><span class="gp-voice-dur">${fmtVoiceDur(dur)}</span></div>${m.text ? `<div class="gp-voice-tr">${esc(m.text)}</div>` : ''}`;
}

function renderThread(screen) {
    const t = getThread(currentThreadKey);
    if (!t) { currentScreen = 'list'; renderList(screen); return; }
    markRead(t.key);
    updateFabBadge();

    let bubbles = '';
    let lastDay = '';
    for (let mi = 0; mi < t.messages.length; mi++) {
        const m = t.messages[mi];
        if (m.time) {
            const day = `${m.time.getDate()}.${m.time.getMonth()}.${m.time.getFullYear()}`;
            if (day !== lastDay) {
                lastDay = day;
                // m.time уже в RP-шкале — сравниваем с RP «сейчас»
                const rpDt = getRpDateTime();
                const now = rpDt
                    ? new Date(rpDt.year, rpDt.month - 1, rpDt.day)
                    : new Date();
                const isToday = now.getFullYear() === m.time.getFullYear() && now.getMonth() === m.time.getMonth() && now.getDate() === m.time.getDate();
                const label = isToday ? 'Сегодня' : `${String(m.time.getDate()).padStart(2, '0')}.${String(m.time.getMonth() + 1).padStart(2, '0')}`;
                bubbles += `<div class="gp-day"><span>${label}</span></div>`;
            }
        }
        const tm = m.time ? fmtTime(m.time) : '';
        // Фото в смс: реальное (юзер приложила) или заглушка с описанием (ММС от персонажа)
        let media = '';
        if (m.img) {
            // Переген доступен только для ММС с описанием (без описания нечего рисовать)
            const genKey = m.eventId || `${m.idx}:${m.tagStart}`;
            const busy = _mmsGenBusy.has(genKey);
            const regenBtn = m.photoDesc && m.dir === 'in'
                ? `<button class="gp-mms-gen" data-mmsgen="${mi}" title="Перегенерировать фото" ${busy ? 'disabled' : ''}>${ic(busy ? 'fa-spinner fa-spin' : 'fa-rotate-right')}</button>` : '';
            media = `<div class="gp-bubble-img"><img src="${esc(m.img)}" alt="">${regenBtn}</div>`;
        } else if (m.photoDesc) {
            const genKey = m.eventId || `${m.idx}:${m.tagStart}`;
            const busy = _mmsGenBusy.has(genKey);
            media = `<div class="gp-bubble-img gp-bubble-img-gen" style="${avatarStyle((m.from || t.name) + m.photoDesc)}"><span>${ic('fa-image')}</span><i data-mmsdesc="${esc(genKey)}">${esc(m.photoDesc)}</i><button class="gp-mms-gen" data-mmsgen="${mi}" title="Сгенерировать фото" ${busy ? 'disabled' : ''}>${ic(busy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles')}</button></div>`;
        }
        // В группе подписываем отправителя входящих — КАЖДОМУ свой цвет
        // (тот же хэш, что у аватара-градиента → цвет ника совпадает с аватаром)
        const senderLabel = t.isGroup && m.dir === 'in' && m.from
            ? `<div class="gp-bubble-sender" style="color:${senderColor(m.from)}">${esc(m.from)}</div>` : '';
        const body = m.voice ? voiceBubbleHtml(m) : esc(m.text);
        const reaction = m.react ? REACTIONS.find(r => r.id === m.react) : null;
        const reactChip = reaction ? `<span class="gp-react-chip">${ic(reaction.icon)}</span>` : '';
        const picker = (_reactPickerFor === mi && _reactPickerKey === t.key)
            ? `<div class="gp-react-picker">${REACTIONS.map(r => `<button data-react="${r.id}" data-react-mi="${mi}" class="${m.react === r.id ? 'gp-selected' : ''}" title="${r.ru}">${ic(r.icon)}</button>`).join('')}</div>` : '';
        bubbles += `
        <div class="gp-bubble-wrap ${m.dir === 'out' ? 'gp-out' : 'gp-in'}${reaction ? ' gp-has-react' : ''}">
            ${picker}
            <div class="gp-bubble${m.voice ? ' gp-bubble-voice' : ''}" data-bmi="${mi}">${senderLabel}${media}${body}<button class="gp-sms-del" data-smsdel="${mi}" title="Удалить">${ic('fa-xmark')}</button>${reactChip}</div>
            ${tm ? `<div class="gp-bubble-time">${esc(tm)}</div>` : ''}
        </div>`;
    }

    const typing = typingKey === t.key
        ? `<div class="gp-bubble-wrap gp-in gp-typing-wrap"><div class="gp-bubble gp-typing"><span></span><span></span><span></span></div></div>`
        : '';

    const headerAva = t.isGroup
        ? `<div class="gp-avatar gp-avatar-sm gp-avatar-group">${ic('fa-users')}</div>`
        : `<span id="gp-ava-btn" title="Клик — загрузить фото контакта" style="cursor:pointer">${avatarHtml(t.name, getContactAvatar(t.key), 'gp-avatar gp-avatar-sm')}</span>`;
    const blocked = !t.isGroup && isSmsBlocked(t.key);
    const subLine = t.isGroup
        ? (t.members?.length ? t.members.join(', ') : 'групповой чат')
        : `${blocked ? 'заблокирован · ' : ''}${t.number || 'номер неизвестен'} · ${handleFor(`contact:${t.key}`, t.name)}`;

    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            ${headerAva}
            <input type="file" id="gp-ava-file" accept="image/*" style="display:none">
            <div class="gp-thread-title">
                <div class="gp-row-name" id="gp-rename" title="Нажми, чтобы переименовать" style="cursor:pointer">${esc(t.name)} <i class="fa-solid fa-pen gp-rename-pen"></i></div>
                <div class="gp-thread-number">${esc(subLine)}</div>
            </div>
            ${!t.isGroup ? `<button class="gp-iconbtn" id="gp-nick" title="Ник для соцсетей">${ic('fa-at')}</button>` : ''}
            ${!t.isGroup ? `<button class="gp-iconbtn${blocked ? ' gp-danger' : ''}" id="gp-sms-block" title="${blocked ? 'Разблокировать SMS' : 'Заблокировать SMS'}">${ic(blocked ? 'fa-lock-open' : 'fa-ban')}</button>` : ''}
            <button class="gp-iconbtn gp-danger" id="gp-del" title="Удалить ${t.isGroup ? 'чат' : 'контакт'}">${ic('fa-trash-can')}</button>
        </div>
        <div class="gp-msgs" id="gp-msgs">
            ${bubbles || `<div class="gp-empty gp-empty-thread"><div class="gp-empty-icon">${ic('fa-message')}</div><div class="gp-empty-text">Начни переписку — сообщение попадёт<br>прямо в ролевую</div></div>`}
            ${typing}
        </div>
        ${_smsDraftImage ? `<div class="gp-sms-attach"><img src="${esc(_smsDraftImage)}" alt=""><span>Фото приложено</span><button class="gp-iconbtn gp-danger" id="gp-attach-clear">${ic('fa-xmark')}</button></div>` : ''}
        <div class="gp-inputbar">
            ${t.messages.length > 0 && t.messages[t.messages.length - 1].dir === 'in'
                ? `<button class="gp-iconbtn gp-regen" id="gp-regen" title="Другой ответ" ${sending ? 'disabled' : ''}>${ic('fa-rotate-right')}</button>` : ''}
            <button class="gp-iconbtn" id="gp-attach" title="Приложить фото">${ic('fa-paperclip')}</button>
            <input type="file" id="gp-attach-file" accept="image/*" style="display:none">
            <button class="gp-iconbtn${_smsDraftVoice ? ' gp-voice-armed' : ''}" id="gp-voice-toggle" title="Голосовое сообщение">${ic('fa-microphone')}</button>
            <textarea id="gp-input" rows="1" placeholder="${_smsDraftVoice ? 'Расшифровка голосового...' : 'Сообщение...'}"></textarea>
            <button class="gp-send" id="gp-send" ${sending ? 'disabled' : ''}>${ic('fa-paper-plane')}</button>
        </div>`;

    const msgs = screen.querySelector('#gp-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;

    screen.querySelector('#gp-back')?.addEventListener('click', () => {
        currentScreen = 'list';
        currentThreadKey = null;
        render();
    });
    // Аватар контакта: клик → загрузка фото (сжимается до 128px)
    const avaBtn = screen.querySelector('#gp-ava-btn');
    const avaFile = screen.querySelector('#gp-ava-file');
    avaBtn?.addEventListener('click', () => avaFile?.click());
    avaFile?.addEventListener('change', async () => {
        const file = avaFile.files?.[0];
        if (!file) return;
        try {
            const dataUrl = await compressImage(file, 128, 0.85);
            setContactAvatar(t.key, dataUrl);
            render();
        } catch (e) {
            toast('Не удалось загрузить фото', 'fa-circle-exclamation');
        }
    });
    // Переименование контакта (отображаемое имя; матч смс по исходному имени сохраняется)
    screen.querySelector('#gp-rename')?.addEventListener('click', () => {
        const nn = prompt('Новое имя контакта:', t.name);
        if (nn === null) return;
        renameContact(t.key, nn.trim());
        updatePhoneInjection();
        render();
    });
    // Ник контакта для соцсетей (@handle)
    screen.querySelector('#gp-nick')?.addEventListener('click', () => {
        const cur = handleFor(`contact:${t.key}`, t.name);
        const nick = prompt(`Ник для ${t.name} в соцсетях (без @):`, cur.replace(/^@/, ''));
        if (nick === null) return;
        setContactHandle(t.key, nick);
        updatePhoneInjection();
        render();
    });
    screen.querySelector('#gp-sms-block')?.addEventListener('click', () => {
        if (blocked) {
            if (!confirm(`Разблокировать SMS от «${t.name}»?`)) return;
            unblockSmsContact(t.key);
            toast(`SMS от «${t.name}» разблокированы`, 'fa-lock-open');
        } else {
            if (!confirm(`Заблокировать SMS от «${t.name}»? Новые сообщения не будут попадать в телефон.`)) return;
            blockSmsContact(t.key);
            toast(`SMS от «${t.name}» заблокированы`, 'fa-ban');
        }
        updatePhoneInjection();
        render();
        updateFabBadge();
    });

    // Скрепка: приложить фото к смс
    const attachBtn = screen.querySelector('#gp-attach');
    const attachFile = screen.querySelector('#gp-attach-file');
    attachBtn?.addEventListener('click', () => attachFile?.click());
    attachFile?.addEventListener('change', async () => {
        const f = attachFile.files?.[0];
        if (!f) return;
        try {
            _smsDraftImage = await compressImage(f, 720, 0.82);
            render();
        } catch (e) {
            toast('Не удалось загрузить фото', 'fa-circle-exclamation');
        }
    });
    screen.querySelector('#gp-attach-clear')?.addEventListener('click', () => {
        _smsDraftImage = null;
        render();
    });

    // Микрофон: следующее сообщение уйдёт голосовым (текст = расшифровка).
    // Сохраняем черновик текста через перерисовку.
    screen.querySelector('#gp-voice-toggle')?.addEventListener('click', () => {
        _smsDraftVoice = !_smsDraftVoice;
        const draft = screen.querySelector('#gp-input')?.value || '';
        render();
        const inp = document.getElementById('gp-input');
        if (inp) { inp.value = draft; inp.focus(); }
    });

    // «Проигрывание» голосового: подсветка бежит по дорожке ровно длительность
    screen.querySelectorAll('[data-voiceplay]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const box = btn.closest('.gp-voice');
        if (!box) return;
        const playing = box.classList.toggle('gp-playing');
        btn.innerHTML = ic(playing ? 'fa-pause' : 'fa-play');
        clearTimeout(box._gpVoiceTimer);
        if (playing) {
            const dur = parseFloat(box.style.getPropertyValue('--gp-voice-dur')) || 3;
            box._gpVoiceTimer = setTimeout(() => {
                box.classList.remove('gp-playing');
                btn.innerHTML = ic('fa-play');
            }, dur * 1000);
        }
    }));

    screen.querySelector('#gp-del')?.addEventListener('click', () => {
        if (!confirm(`Удалить ${t.isGroup ? 'групповой чат' : 'контакт'} «${t.name}» из телефона?\n(Сообщения в самом чате останутся.)`)) return;
        if (t.isGroup) delGroup(t.key);
        else hideContact(t.key);
        currentScreen = 'list';
        currentThreadKey = null;
        updatePhoneInjection();
        render();
        updateFabBadge();
    });

    const input = screen.querySelector('#gp-input');
    const sendBtn = screen.querySelector('#gp-send');
    const autoGrow = () => {
        input.style.height = 'auto';
        input.style.height = Math.min(110, input.scrollHeight) + 'px';
    };
    input?.addEventListener('input', autoGrow);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend(t.key);
        }
    });
    sendBtn?.addEventListener('click', () => doSend(t.key));
    screen.querySelector('#gp-regen')?.addEventListener('click', () => doRegen(t.key));
    // Реакции: тап по пузырю → пикер; выбор пишет react в тег + журнал
    screen.querySelectorAll('[data-bmi]').forEach(b => b.addEventListener('click', () => {
        const mi = parseInt(b.getAttribute('data-bmi'));
        const wasOpen = _reactPickerFor === mi && _reactPickerKey === t.key;
        _reactPickerFor = wasOpen ? null : mi;
        _reactPickerKey = t.key;
        render();
    }));
    screen.querySelectorAll('[data-react]').forEach(b => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = parseInt(b.getAttribute('data-react-mi'));
        const m = t.messages[mi];
        const r = REACTIONS.find(x => x.id === b.getAttribute('data-react'));
        if (!m || !r) return;
        const removing = m.react === r.id;
        _reactPickerFor = null;
        const ok = await rewriteSmsTag(m, t, (j) => {
            if (removing) delete j.react;
            else j.react = r.id;
        });
        if (!ok) {
            toast('Не получилось', 'fa-circle-exclamation');
            render();
            return;
        }
        m.react = removing ? null : r.id; // мгновенно, до перескана
        // В журнал — только НОВАЯ реакция на чужое сообщение (снятие — шум)
        if (!removing && m.dir === 'in') {
            logSocialToChat(`${getUserName()} поставила реакцию «${r.ru}» на сообщение ${m.from || t.name}: «${String(m.text || (m.photoDesc ? 'фото' : m.voice ? 'голосовое' : '')).slice(0, 80)}»`);
        }
        applyChatHiding();
        render();
    }));

    // Генерация фото по описанию ММС (заглушка → реальная картинка).
    // Результат пишем в img прямо в tel:sms тег — переживает пересканирование.
    screen.querySelectorAll('[data-mmsgen]').forEach(b => b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mi = parseInt(b.getAttribute('data-mmsgen'));
        const m = t.messages[mi];
        if (!m || !m.photoDesc) return;
        const genKey = m.eventId || `${m.idx}:${m.tagStart}`;
        if (_mmsGenBusy.has(genKey)) return;
        if (!_imgGenReady) {
            const ready = await isImageGenAvailable();
            if (!ready) {
                toast('novarakk не установлен — генерация картинок недоступна', 'fa-circle-exclamation');
                return;
            }
            _imgGenReady = true;
        }
        _mmsGenBusy.add(genKey);
        render();
        try {
            const author = m.from || t.name;
            const src = await generatePostImage(
                { imgDesc: m.photoDesc, author, ak: `contact:${keyOf(author)}`, kind: 'ig', mms: true },
                (status) => {
                    const el = document.querySelector(`[data-mmsdesc="${CSS.escape(genKey)}"]`);
                    if (el) el.textContent = status;
                },
            );
            // Персистим: перезаписываем тег по позиции (как deleteSmsFromChat)
            const ctx = SillyTavern.getContext();
            const chatMsg = ctx?.chat?.[m.idx];
            if (chatMsg && Number.isInteger(m.tagStart) && Number.isInteger(m.tagEnd)) {
                const tag = chatMsg.mes.slice(m.tagStart, m.tagEnd);
                const jm = tag.match(/<!--\s*tel:sms:(\{[\s\S]*?\})\s*-->/i);
                let j = null;
                if (jm) { try { j = JSON.parse(jm[1]); } catch (err) { /* битый JSON — соберём заново */ } }
                if (!j) {
                    j = { from: m.from, text: m.text || '', photo: m.photoDesc };
                    if (t.isGroup) j.chat = t.name;
                    if (m.voice) j.voice = true;
                }
                if (jm) {
                    j.img = src;
                    chatMsg.mes = chatMsg.mes.slice(0, m.tagStart) + `<!--tel:sms:${JSON.stringify(j)}-->` + chatMsg.mes.slice(m.tagEnd);
                    await saveChatConditional();
                }
            }
            toast('Фото готово', 'fa-image');
        } catch (err) {
            console.error('[GlassPhone] MMS image gen failed:', err);
            toast(`Не получилось: ${String(err?.message || err).slice(0, 60)}`, 'fa-circle-exclamation');
        } finally {
            _mmsGenBusy.delete(genKey);
            render();
        }
    }));

    // Удаление отдельного SMS
    screen.querySelectorAll('[data-smsdel]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const mi = parseInt(b.getAttribute('data-smsdel'));
        const msg = t.messages[mi];
        if (!msg) return;
        if (!confirm('Удалить это сообщение?')) return;
        deleteSmsFromChat(msg);
        render();
        updatePhoneInjection();
        applyChatHiding();
        updateFabBadge();
    }));
    input?.focus();
}

// ── Перегенерация последнего ответа персонажа (замена свайпа для скрытых смс) ──
async function doRegen(key) {
    if (sending) return;
    // Перегенерируем только если ПОСЛЕДНЕЕ сообщение чата — ответ бота
    // (иначе Generate('regenerate') снесёт не то)
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        const last = chat[chat.length - 1];
        if (!last || last.is_user) {
            toast('Нечего перегенерировать', 'fa-circle-exclamation');
            return;
        }
    } catch (e) { return; }

    sending = true;
    typingKey = key;
    render();
    try {
        updatePhoneInjection();
        await Generate('regenerate');
    } catch (e) {
        console.error('[GlassPhone] regen failed:', e);
        toast('Не удалось перегенерировать', 'fa-circle-exclamation');
    } finally {
        sending = false;
        typingKey = null;
        render();
        updateFabBadge();
        applyChatHiding();
    }
}

// ── Экран «Новый контакт» ──
function renderAdd(screen) {
    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title" style="flex:1">Новый контакт</div>
        </div>
        <div class="gp-add-form">
            <div class="gp-add-avatar">${ic('fa-user')}</div>
            <label class="gp-field">
                <span>Имя</span>
                <input type="text" id="gp-add-name" maxlength="60" placeholder="Как в ролевой, точно">
            </label>
            <label class="gp-field">
                <span>Номер</span>
                <input type="text" id="gp-add-number" maxlength="24" placeholder="Пусто = случайный">
            </label>
            <label class="gp-field">
                <span>Ник (@) для соцсетей</span>
                <input type="text" id="gp-add-handle" maxlength="20" placeholder="Пусто = авто из имени">
            </label>
            <button class="gp-primary" id="gp-add-save">${ic('fa-check')} Сохранить</button>
            <div class="gp-add-hint">Имя должно совпадать с именем персонажа в чате — тогда его смс попадут в этот тред. Ник и аватар подтянутся в Твиттер/Инсту.</div>
            <div class="gp-field" style="margin-top:10px">
                <span>Групповой чат</span>
            </div>
            <label class="gp-field">
                <span>Название</span>
                <input type="text" id="gp-group-name" maxlength="40" placeholder="Например: Семья">
            </label>
            <div class="gp-group-members" id="gp-group-members">
                ${getThreadList().filter(x => !x.isGroup).map(c => `
                    <label class="gp-member-check"><input type="checkbox" value="${esc(c.name)}"><span>${esc(c.name)}</span></label>
                `).join('') || '<div class="gp-add-hint">Сначала добавь контакты — участники выбираются из них</div>'}
            </div>
            <button class="gp-primary" id="gp-group-save">${ic('fa-users')} Создать чат</button>
        </div>`;

    screen.querySelector('#gp-back')?.addEventListener('click', () => {
        currentScreen = 'list';
        render();
    });
    // Живой предпросмотр авто-ника: транслит из имени («Вадим» → @vadim)
    const nameInp = screen.querySelector('#gp-add-name');
    const handleInp = screen.querySelector('#gp-add-handle');
    nameInp?.addEventListener('input', () => {
        if (!handleInp) return;
        handleInp.placeholder = nameInp.value.trim() ? makeHandle(nameInp.value) : tr('Пусто = авто из имени');
    });
    screen.querySelector('#gp-add-save')?.addEventListener('click', () => {
        const name = screen.querySelector('#gp-add-name')?.value.trim();
        let number = screen.querySelector('#gp-add-number')?.value.trim();
        const handle = screen.querySelector('#gp-add-handle')?.value.trim();
        if (!name) { toast('Укажи имя контакта', 'fa-circle-exclamation'); return; }
        if (!number) number = randomNumber();
        addManualContact(name, number);
        // Ник (@) для соцсетей — по ключу контакта
        if (handle) setContactHandle(keyOf(name), handle);
        updatePhoneInjection();
        currentScreen = 'thread';
        currentThreadKey = keyOf(name);
        render();
    });
    screen.querySelector('#gp-group-save')?.addEventListener('click', () => {
        const gname = screen.querySelector('#gp-group-name')?.value.trim();
        const members = [...screen.querySelectorAll('#gp-group-members input:checked')].map(i => i.value);
        if (!gname) { toast('Назови чат', 'fa-circle-exclamation'); return; }
        if (members.length < 1) { toast('Выбери хотя бы одного участника', 'fa-circle-exclamation'); return; }
        addGroup(gname, members);
        updatePhoneInjection();
        currentScreen = 'thread';
        currentThreadKey = `group:${keyOf(gname)}`;
        render();
    });
    screen.querySelector('#gp-add-name')?.focus();
}

// ═══ TWITTER ═══

// Отображаемый ник: для юзера/контактов — кастомный из настроек, иначе сохранённый
function dispHandle(item) {
    if (item.ak === 'user' || (typeof item.ak === 'string' && item.ak.startsWith('contact:'))) {
        return handleFor(item.ak, item.author);
    }
    return item.handle || makeHandle(item.author);
}

function twCard(t, { clickable = true } = {}) {
    const isUser = t.ak === 'user';
    const replyCount = t.replies?.length || 0;
    
    // Вложенная цитата
    let quoteHtml = '';
    if (t.quotedTweet) {
        quoteHtml = `
        <div class="gp-tw-quote">
            <div class="gp-tw-meta">
                <span class="gp-tw-name">${esc(t.quotedTweet.author)}</span>
                <span class="gp-tw-handle">${esc(t.quotedTweet.handle)}</span>
            </div>
            <div class="gp-tw-text">${esc(t.quotedTweet.text)}</div>
        </div>`;
    }

    return `
    <div class="gp-tw-card${clickable ? ' gp-clickable' : ''}" data-tweet="${esc(t.id)}">
        ${avatarHtml(t.author, avatarForAuthor(t.ak), 'gp-avatar gp-avatar-sm')}
        <div class="gp-tw-body">
            <div class="gp-tw-meta">
                <span class="gp-tw-name">${esc(t.author)}</span>
                <span class="gp-tw-handle">${esc(dispHandle(t))}</span>
                <span class="gp-tw-time">· ${esc(timeAgo(t.time))}</span>
                ${isUser
                    ? `<button class="gp-tw-del" data-del="${esc(t.id)}" title="Удалить">${ic('fa-xmark')}</button>`
                    : `<button class="gp-tw-del gp-ban-btn" data-ban-tw="${esc(t.id)}" title="Заблокировать аккаунт">${ic('fa-ban')}</button>`}
            </div>
            <div class="gp-tw-text">${esc(t.text)}</div>
            ${quoteHtml}
            <div class="gp-tw-actions">
                <button class="gp-tw-act" data-open="${esc(t.id)}">${ic('fa-comment')}<span>${replyCount || ''}</span></button>
                <button class="gp-tw-act${t.rted ? ' gp-tw-on-rt' : ''}" data-rt="${esc(t.id)}">${ic('fa-retweet')}<span>${t.rts || ''}</span></button>
                <button class="gp-tw-act${t.liked ? ' gp-tw-on' : ''}" data-like="${esc(t.id)}">${ic('fa-heart')}<span>${t.likes || ''}</span></button>
            </div>
            ${performanceHtml(t)}
        </div>
    </div>`;
}

function bindTwCardActions(root, rerender) {
    bindSocialSystemLinks(root);
    root.querySelectorAll('[data-like]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation(); likeTweet(b.getAttribute('data-like')); rerender();
    }));
    root.querySelectorAll('[data-rt]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation(); rtTweet(b.getAttribute('data-rt')); rerender();
    }));
    root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Удалить твит?')) { delTweet(b.getAttribute('data-del')); rerender(); }
    }));
    root.querySelectorAll('[data-ban-tw]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const tw = getTweets().find(x => x.id === b.getAttribute('data-ban-tw'));
        if (!tw) return;
        if (!confirm(`Заблокировать «${tw.author}»? Он больше не появится в ленте.`)) return;
        banAccount(tw.author);
        delTweet(tw.id);
        rerender();
        toast(`«${tw.author}» заблокирован`, 'fa-ban');
    }));
    root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation(); currentTweetId = b.getAttribute('data-open'); goto('twthread');
    }));
    root.querySelectorAll('.gp-tw-card.gp-clickable').forEach(el => el.addEventListener('click', () => {
        currentTweetId = el.getAttribute('data-tweet'); goto('twthread');
    }));
}

function renderTw(screen) {
    currentScreen = 'tw';
    const tweets = getTweets();

    setHtmlKeepScroll(screen, '.gp-feed', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">${brand('fa-x-twitter')}</div>
            <button class="gp-iconbtn" data-open-social title="Профиль и задания">${ic('fa-chart-line')}</button>
            <button class="gp-iconbtn" id="gp-tw-gen" title="Обновить ленту" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-wand-magic-sparkles')}</button>
        </div>
        <div class="gp-tw-compose">
            ${avatarHtml(getUserName(), avatarForAuthor('user'), 'gp-avatar gp-avatar-sm')}
            <input type="text" id="gp-tw-input" maxlength="280" placeholder="Что происходит?">
            <button class="gp-tw-handle-edit" id="gp-tw-handle" title="Изменить @ник">${esc(getUserHandle())}</button>
            <button class="gp-send gp-send-sm" id="gp-tw-post" disabled>${ic('fa-feather')}</button>
        </div>
        <div class="gp-feed" id="gp-tw-feed">
            ${tweets.length === 0
                ? `<div class="gp-empty"><div class="gp-empty-icon">${brand('fa-x-twitter')}</div><div class="gp-empty-title">Лента пуста</div><div class="gp-empty-text">Нажми ${ic('fa-wand-magic-sparkles')} — лента сгенерируется<br>по событиям твоей ролевой</div></div>`
                : tweets.map(t => twCard(t)).join('')}
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    bindSocialSystemLinks(screen);

    const input = screen.querySelector('#gp-tw-input');
    const postBtn = screen.querySelector('#gp-tw-post');
    screen.querySelector('#gp-tw-handle')?.addEventListener('click', () => {
        const value = prompt('Твой @ник в Twitter', getUserHandle());
        if (value === null) return;
        setUserHandle(value);
        render();
    });
    input?.addEventListener('input', () => { postBtn.disabled = !input.value.trim(); });
    const doPost = async () => {
        const v = input?.value.trim();
        if (!v || genBusy) return;
        const userPost = postTweet(v);
        const ad = attachActiveAd('twitter', userPost);
        if (ad) toast(`Реклама ${ad.brand} опубликована`, 'fa-star');
        logSocialToChat(`${getUserName()} опубликовала твит: «${v}»`); // в историю чата (память/саммарайз)
        updatePhoneInjection(); // персонажи «видят» твит юзера
        
        genBusy = true;
        render();
        try {
            const before = (userPost.replies || []).length;
            const addedFeed = await generateTweetFeed();
            const addedComments = await generateTweetComments(userPost);
            updatePhoneInjection();
            logNewReplies('твитом', userPost.text, userPost.replies, before);
            await finalizeSocialPost('twitter', userPost, { addedComments, addedFeed });
        } catch (e) {
            console.error('[GlassPhone] tw feed auto-gen failed:', e);
            toast('Твит отправлен, но лента не обновилась', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'tw') render();
        }
    };
    postBtn?.addEventListener('click', doPost);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doPost(); } });

    screen.querySelector('#gp-tw-gen')?.addEventListener('click', async () => {
        if (genBusy) return;
        genBusy = true; render();
        try {
            const n = await generateTweetFeed();
            toast(n > 0 ? `Новых твитов: ${n}` : 'Не получилось — попробуй ещё раз', n > 0 ? 'fa-x-twitter' : 'fa-circle-exclamation');
        } catch (e) {
            console.error('[GlassPhone] tw feed failed:', e);
            toast('Ошибка генерации', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'tw') render();
        }
    });

    bindTwCardActions(screen, () => render());
}

function renderTwThread(screen) {
    const t = getTweets().find(x => x.id === currentTweetId);
    if (!t) { goto('tw'); return; }
    const replies = t.replies || [];
    const canAuthorReply = typeof t.ak === 'string' && t.ak.startsWith('contact:');

    // Локальное состояние: на какой коммент отвечаем прямо сейчас
    let replyTargetId = null;

    setHtmlKeepScroll(screen, '.gp-feed', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">Тред</div>
            <button class="gp-iconbtn" id="gp-tw-comments" title="Сгенерировать обсуждение" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-comments')}</button>
        </div>
        <div class="gp-feed">
            ${twCard(t, { clickable: false })}
            <div class="gp-replies">
                ${replies.length === 0
                    ? `<div class="gp-empty-text gp-replies-empty">Комментариев нет — нажми ${ic('fa-comments')}</div>`
                    : replies.map(r => `
                    <div class="gp-reply">
                        ${avatarHtml(r.author, r.avatar || avatarForAuthor(r.ak), 'gp-avatar gp-avatar-xs')}
                        <div class="gp-reply-body">
                            <div class="gp-tw-meta">
                                <span class="gp-tw-name">${esc(r.author)}</span>
                                <span class="gp-tw-handle">${esc(dispHandle(r))}</span>
                                <span class="gp-tw-time">· ${esc(timeAgo(r.time))}</span>
                                <button class="gp-reply-btn" data-replyto-tw="${esc(r.id)}" title="Ответить">${ic('fa-reply')}</button>
                                <button class="gp-reply-del" data-del-reply="${esc(r.id)}" title="Удалить">${ic('fa-xmark')}</button>
                            </div>
                            ${r.replyTo ? `<div class="gp-reply-to">${ic('fa-reply')} ${esc(r.replyTo.author)}</div>` : ''}
                            <div class="gp-tw-text">${esc(r.text)}</div>
                        </div>
                    </div>`).join('')}
            </div>
        </div>
        <div class="gp-inputbar">
            <textarea id="gp-input" rows="1" placeholder="Ответить..."></textarea>
            <button class="gp-send" id="gp-tw-reply" ${sending ? 'disabled' : ''}>${ic('fa-paper-plane')}</button>
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('tw'));
    bindTwCardActions(screen, () => render());

    const input = screen.querySelector('#gp-input');

    // Клик на "Ответить" у конкретного коммента
    screen.querySelectorAll('[data-replyto-tw]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const rid = b.getAttribute('data-replyto-tw');
        const r = replies.find(x => x.id === rid);
        if (r && input) {
            replyTargetId = rid;
            input.value = `${r.handle} `;
            input.focus();
        }
    }));

    // Удаление реплаев
    screen.querySelectorAll('[data-del-reply]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        delTweetReply(t.id, b.getAttribute('data-del-reply'));
        render();
    }));

    screen.querySelector('#gp-tw-comments')?.addEventListener('click', async () => {
        if (genBusy) return;
        genBusy = true; render();
        try {
            const before = (t.replies || []).length;
            const n = await generateTweetComments(t);
            if (t.ak === 'user') await finalizeSocialPost('twitter', t);
            if (!n) toast('Не получилось — попробуй ещё раз', 'fa-circle-exclamation');
            if (t.ak === 'user') logNewReplies('твитом', t.text, t.replies, before);
        } catch (e) {
            console.error('[GlassPhone] tw comments failed:', e);
            toast('Ошибка генерации', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'twthread') render();
        }
    });

    const doReply = async () => {
        const v = input?.value.trim();
        if (!v || sending) return;
        
        let targetComment = null;
        if (replyTargetId) {
            targetComment = replies.find(x => x.id === replyTargetId);
        }
        
        // Добавляем реплай юзера (с указанием кому он отвечает)
        addTweetReply(t.id, v, null, 'user', targetComment);
        input.value = '';
        replyTargetId = null;
        render();

        sending = true;
        genBusy = true;
        render();
        try {
            const beforeGen = (t.replies || []).length;
            if (targetComment) {
                // Если ответили на конкретный коммент — генерим ответ его автора (если он контакт)
                await generateReplyToComment('tw', t, targetComment, v);
            } else if (canAuthorReply) {
                // Иначе генерим ответ автора треда (если он контакт)
                await generateAuthorReply('tw', t, v);
            }
            // После ответа юзера — генерим дополнительные реакции от других
            await generateTweetComments(t);
            // Журнал: её ответ + значимые ответы одной строкой
            const added = (t.replies || []).slice(beforeGen).filter(r => r.ak !== 'user');
            const cparts = added.map(r => `${r.author || 'Аккаунт'}: «${String(r.text || '').slice(0, 120)}»`);
            let line = `${getUserName()} ответила под твитом ${t.author} («${String(t.text).slice(0, 50)}»): «${v}»`;
            if (cparts.length) line += ` — ответы: ${cparts.join('; ')}`;
            logSocialToChat(line);
        } catch (e) {
            console.error('[GlassPhone] author reply failed:', e);
        } finally {
            sending = false;
            genBusy = false;
            if (currentScreen === 'twthread') render();
        }
    };
    screen.querySelector('#gp-tw-reply')?.addEventListener('click', doReply);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doReply(); } });
}

// ═══ INSTAGRAM ═══

// Посты, для которых прямо сейчас генерится картинка (спиннер)
const _imgGenBusy = new Set();
// Посты, для которых прямо сейчас идёт вижн-описание фото
const _descBusy = new Set();

// Плашка под постом: описание фото — опциональный текст-дубль (для не-vision
// моделей и саммарайза; само фото и так уходит в чат с журнальной записью).
// Клик: вписать вручную; пустой ввод при пустом описании — описать вижном.
function imgDescNoteHtml(p) {
    if (!p.image) return '';
    if (_descBusy.has(p.id)) {
        return `<div class="gp-imgdesc-note">${ic('fa-spinner fa-spin')} <span>Смотрю на фото...</span></div>`;
    }
    return p.imgDesc
        ? `<div class="gp-imgdesc-note gp-clickable" data-editdesc="${esc(p.id)}" title="Клик — изменить">${ic('fa-eye')} <span>${esc(p.imgDesc)}</span></div>`
        : `<div class="gp-imgdesc-note gp-clickable" data-editdesc="${esc(p.id)}">${ic('fa-image')} <span>Фото ушло в чат вместе с постом. Текст-описание (для саммари) не задано — клик: вписать, или оставь пусто для вижна.</span></div>`;
}

function bindDescEdit(screen, p) {
    screen.querySelectorAll('[data-editdesc]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = prompt('Что на фото (текст для саммари и не-vision моделей).\nОставь пусто и нажми ОК — опишу вижном:', p.imgDesc || '');
        if (v === null) return;
        if (!v.trim() && !p.imgDesc) {
            _descBusy.add(p.id);
            render();
            describePostImage(p).then(() => {
                _descBusy.delete(p.id);
                updatePhoneInjection();
                render();
            }).catch(() => { _descBusy.delete(p.id); render(); });
            return;
        }
        p.imgDesc = v.trim().slice(0, 200);
        import('./state.js').then(m => m.saveMeta());
        updatePhoneInjection();
        render();
    }));
}

// Журнал веток: все новые реплики под постом/тредом юзера → одной скрытой строкой в чат.
function logNewReplies(kindLabel, postText, arr, beforeLen) {
    const added = (arr || []).slice(beforeLen).filter(r => r.ak !== 'user');
    if (!added.length) return;
    let line = `под её ${kindLabel}${postText ? ` («${String(postText).slice(0, 80)}»)` : ''}`;
    const parts = added.map(c => `${c.author || 'Аккаунт'}: «${String(c.text || '').trim()}»`);
    line += ` прокомментировали: ${parts.join('; ')}`;
    logSocialToChat(line);
}
// Доступен ли novarakk (кэш; уточняется асинхронно при первом рендере инсты)
let _imgGenReady = false;
isImageGenAvailable().then(v => { _imgGenReady = v; }).catch(() => {});

function igImageHtml(p) {
    if (p.image) {
        const busy = _imgGenBusy.has(p.id);
        // Cache-busting: если URL не data:, добавляем ?t= для принудительной перезагрузки
        const src = p.image.startsWith('data:') ? p.image : p.image + (p.image.includes('?') ? '&' : '?') + 't=' + (p._imgTs || '0');
        return `<div class="gp-ig-img gp-ig-img-has">
            <img src="${esc(src)}" alt="">
            ${busy
                ? `<div class="gp-ig-regen-overlay">${ic('fa-spinner fa-spin')}<div class="gp-ig-genstatus" data-genstatus="${esc(p.id)}">Перегенерация...</div></div>`
                : `<button class="gp-ig-regenbtn" data-regenimg="${esc(p.id)}" title="Перегенерировать">${ic('fa-rotate-right')}</button>`}
        </div>`;
    }
    const busy = _imgGenBusy.has(p.id);
    // Сгенерированный «снимок»: стеклянная заглушка с описанием кадра.
    // Кнопка «нарисовать» всегда видна — при клике проверяется доступность novarakk.
    return `<div class="gp-ig-img gp-ig-img-gen" style="${avatarStyle(p.author + (p.imgDesc || ''))}">
        <div class="gp-ig-img-inner">
            ${busy ? ic('fa-spinner fa-spin') : ic('fa-image')}
            ${p.imgDesc ? `<div class="gp-ig-img-desc">${esc(p.imgDesc)}</div>` : ''}
            ${busy ? `<div class="gp-ig-genstatus" data-genstatus="${esc(p.id)}">Генерация...</div>` : ''}
            ${!busy ? `<button class="gp-ig-genbtn" data-genimg="${esc(p.id)}">${ic('fa-wand-magic-sparkles')} Нарисовать</button>` : ''}
        </div>
    </div>`;
}

function igCard(p, { clickable = true } = {}) {
    const isUser = p.ak === 'user';
    const handle = handleFor(p.ak, p.author);
    return `
    <div class="gp-ig-card" data-post="${esc(p.id)}">
        <div class="gp-ig-head">
            ${avatarHtml(p.author, avatarForAuthor(p.ak), 'gp-avatar gp-avatar-xs')}
            <span class="gp-ig-nameblock">
                <span class="gp-ig-name">${esc(p.author)}</span>
                <span class="gp-ig-handle">${esc(handle)}</span>
            </span>
            <span class="gp-tw-time">· ${esc(timeAgo(p.time))}</span>
            ${isUser
                ? `<button class="gp-tw-del" data-del-ig="${esc(p.id)}" title="Удалить">${ic('fa-xmark')}</button>`
                : `<button class="gp-tw-del gp-ban-btn" data-ban-ig="${esc(p.id)}" title="Заблокировать аккаунт">${ic('fa-ban')}</button>`}
        </div>
        <div class="${clickable ? 'gp-clickable' : ''}" data-open-ig="${esc(p.id)}">${igImageHtml(p)}</div>
        <div class="gp-ig-actions">
            <button class="gp-tw-act${p.liked ? ' gp-tw-on' : ''}" data-like-ig="${esc(p.id)}">${ic('fa-heart')}<span>${p.likes || ''}</span></button>
            <button class="gp-tw-act" data-open-ig2="${esc(p.id)}">${ic('fa-comment')}<span>${p.comments?.length || ''}</span></button>
        </div>
        ${p.caption ? `<div class="gp-ig-caption"><b>${esc(p.author)}</b> ${esc(p.caption)}</div>` : ''}
        ${performanceHtml(p)}
    </div>`;
}

function bindIgCardActions(root) {
    bindSocialSystemLinks(root);
    root.querySelectorAll('[data-like-ig]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation(); likeIg(b.getAttribute('data-like-ig')); render();
    }));
    // Генерация/перегенерация картинки через novarakk
    const doGenImage = async (id) => {
        const post = getIgPosts().find(x => x.id === id) || getOfPosts().find(x => x.id === id);
        if (!post || _imgGenBusy.has(id)) return;
        // Проверяем доступность при клике, а не при рендере
        if (!_imgGenReady) {
            const ready = await isImageGenAvailable();
            if (!ready) {
                toast('novarakk не установлен — генерация картинок недоступна', 'fa-circle-exclamation');
                return;
            }
            _imgGenReady = true;
        }
        _imgGenBusy.add(id);
        render();
        try {
            await generatePostImage(post, (status) => {
                const el = document.querySelector(`[data-genstatus="${CSS.escape(id)}"]`);
                if (el) el.textContent = status;
            });
            post._imgTs = Date.now(); // cache-busting для перезагрузки нового фото
            toast('Фото готово', 'fa-instagram');
        } catch (err) {
            console.error('[GlassPhone] image gen failed:', err);
            toast(`Не получилось: ${String(err?.message || err).slice(0, 60)}`, 'fa-circle-exclamation');
        } finally {
            _imgGenBusy.delete(id);
            render();
        }
    };
    root.querySelectorAll('[data-genimg]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        doGenImage(b.getAttribute('data-genimg'));
    }));
    root.querySelectorAll('[data-regenimg]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        doGenImage(b.getAttribute('data-regenimg'));
    }));
    root.querySelectorAll('[data-del-ig]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Удалить пост?')) { delIg(b.getAttribute('data-del-ig')); render(); }
    }));
    // Бан аккаунта: блокируем автора и удаляем его пост (в лентах он больше не появится)
    root.querySelectorAll('[data-ban-ig]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = b.getAttribute('data-ban-ig');
        const post = getIgPosts().find(x => x.id === id) || getOfPosts().find(x => x.id === id);
        if (!post) return;
        if (!confirm(`Заблокировать «${post.author}»? Он больше не будет появляться в ленте.`)) return;
        banAccount(post.author);
        if (getIgPosts().some(x => x.id === id)) delIg(id); else delOf(id);
        if (currentScreen === 'igview' || currentScreen === 'ofview') goto(currentScreen === 'ofview' ? 'of' : 'ig');
        else render();
        toast(`«${post.author}» заблокирован`, 'fa-ban');
    }));
    const open = (id) => { currentPostId = id; goto('igview'); };
    root.querySelectorAll('[data-open-ig]').forEach(b => b.addEventListener('click', () => open(b.getAttribute('data-open-ig'))));
    root.querySelectorAll('[data-open-ig2]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation(); open(b.getAttribute('data-open-ig2'));
    }));
}

function renderIg(screen) {
    currentScreen = 'ig';
    const posts = getIgPosts();

    setHtmlKeepScroll(screen, '.gp-feed', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">${brand('fa-instagram')}</div>
            <button class="gp-iconbtn" data-open-social title="Профиль и задания">${ic('fa-chart-line')}</button>
            <button class="gp-iconbtn" id="gp-ig-new" title="Новый пост">${ic('fa-plus')}</button>
            <button class="gp-iconbtn" id="gp-ig-gen" title="Обновить ленту" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-wand-magic-sparkles')}</button>
        </div>
        <div class="gp-feed" id="gp-ig-feed">
            ${igStoriesRow()}
            ${posts.length === 0
                ? `<div class="gp-empty"><div class="gp-empty-icon">${brand('fa-instagram')}</div><div class="gp-empty-title">Лента пуста</div><div class="gp-empty-text">${ic('fa-wand-magic-sparkles')} — сгенерировать ленту<br>${ic('fa-plus')} — выложить своё фото</div></div>`
                : posts.map(p => igCard(p)).join('')}
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    bindSocialSystemLinks(screen);
    screen.querySelector('#gp-ig-new')?.addEventListener('click', () => goto('ignew'));
    screen.querySelector('#gp-ig-story-me')?.addEventListener('click', () => {
        _storyAuthor = null; // свои
        if (activeStories().some(s => s.ak === 'user')) { _storyIdx = 0; goto('igstory'); }
        else goto('ignewstory');
    });
    screen.querySelector('#gp-ig-story-add')?.addEventListener('click', () => goto('ignewstory'));
    screen.querySelectorAll('[data-storyauthor]').forEach(b => b.addEventListener('click', () => {
        _storyAuthor = b.getAttribute('data-storyauthor');
        _storyIdx = 0;
        goto('igstory');
    }));
    screen.querySelector('#gp-ig-gen')?.addEventListener('click', async () => {
        if (genBusy) return;
        genBusy = true; render();
        try {
            const n = await generateIgFeed();
            toast(n > 0 ? `Новых постов: ${n}` : 'Не получилось — попробуй ещё раз', n > 0 ? 'fa-instagram' : 'fa-circle-exclamation');
        } catch (e) {
            console.error('[GlassPhone] ig feed failed:', e);
            toast('Ошибка генерации', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'ig') render();
        }
    });
    bindIgCardActions(screen);
}

function renderIgView(screen) {
    const p = getIgPosts().find(x => x.id === currentPostId);
    if (!p) { goto('ig'); return; }
    const comments = p.comments || [];
    const canAuthorReply = typeof p.ak === 'string' && p.ak.startsWith('contact:');

    // Локальное состояние: на какой коммент отвечаем прямо сейчас
    let replyTargetId = null;

    setHtmlKeepScroll(screen, '.gp-feed', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">Пост</div>
            <button class="gp-iconbtn" id="gp-ig-comments" title="Сгенерировать реакции" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-comments')}</button>
        </div>
        <div class="gp-feed">
            ${igCard(p, { clickable: false })}
            ${imgDescNoteHtml(p)}
            <div class="gp-replies">
                ${comments.length === 0
                    ? `<div class="gp-empty-text gp-replies-empty">Комментариев нет — нажми ${ic('fa-comments')}, пусть отреагируют</div>`
                    : comments.map(c => `
                    <div class="gp-reply">
                        ${avatarHtml(c.author, c.avatar || avatarForAuthor(c.ak), 'gp-avatar gp-avatar-xs')}
                        <div class="gp-reply-body">
                            <div class="gp-tw-meta">
                                <span class="gp-tw-name">${esc(c.author)}</span>
                                <span class="gp-tw-time">· ${esc(timeAgo(c.time))}</span>
                                <button class="gp-reply-btn" data-replyto-ig="${esc(c.id)}" title="Ответить">${ic('fa-reply')}</button>
                                <button class="gp-reply-del" data-del-igcomment="${esc(c.id)}" title="Удалить">${ic('fa-xmark')}</button>
                            </div>
                            ${c.replyTo ? `<div class="gp-reply-to">${ic('fa-reply')} ${esc(c.replyTo.author)}</div>` : ''}
                            <div class="gp-tw-text">${esc(c.text)}</div>
                        </div>
                    </div>`).join('')}
            </div>
        </div>
        <div class="gp-inputbar">
            <textarea id="gp-input" rows="1" placeholder="Комментировать..."></textarea>
            <button class="gp-send" id="gp-ig-reply" ${sending ? 'disabled' : ''}>${ic('fa-paper-plane')}</button>
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('ig'));
    bindIgCardActions(screen);
    bindDescEdit(screen, p);

    const input = screen.querySelector('#gp-input');

    // Клик на "Ответить" у конкретного коммента
    screen.querySelectorAll('[data-replyto-ig]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid = b.getAttribute('data-replyto-ig');
        const c = comments.find(x => x.id === cid);
        if (c && input) {
            replyTargetId = cid;
            input.value = `@${c.author.replace(/\s+/g, '')} `;
            input.focus();
        }
    }));

    // Удаление комментариев
    screen.querySelectorAll('[data-del-igcomment]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        delIgComment(p.id, b.getAttribute('data-del-igcomment'));
        render();
    }));

    screen.querySelector('#gp-ig-comments')?.addEventListener('click', async () => {
        if (genBusy) return;
        genBusy = true; render();
        try {
            const before = (p.comments || []).length;
            const n = await generateIgComments(p);
            if (p.ak === 'user') await finalizeSocialPost('instagram', p);
            if (!n) toast('Не получилось — попробуй ещё раз', 'fa-circle-exclamation');
            if (p.ak === 'user') logNewReplies('фото в Instagram', p.caption || p.imgDesc, p.comments, before);
        } catch (e) {
            console.error('[GlassPhone] ig comments failed:', e);
            toast('Ошибка генерации', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'igview') render();
        }
    });

    const doComment = async () => {
        const v = input?.value.trim();
        if (!v || sending) return;

        let targetComment = null;
        if (replyTargetId) {
            targetComment = comments.find(x => x.id === replyTargetId);
        }

        addIgComment(p.id, v, null, 'user', targetComment);
        input.value = '';
        replyTargetId = null;
        render();

        sending = true;
        genBusy = true;
        render();
        try {
            const beforeGen = (p.comments || []).length;
            if (targetComment) {
                await generateReplyToComment('ig', p, targetComment, v);
            } else if (canAuthorReply) {
                await generateAuthorReply('ig', p, v);
            }
            // После ответа юзера — генерим дополнительные реакции от других
            await generateIgComments(p);
            // Журнал: её коммент + значимые ответы
            const added = (p.comments || []).slice(beforeGen).filter(c => c.ak !== 'user');
            const cparts = added.map(c => `${c.author || 'Аккаунт'}: «${String(c.text || '').slice(0, 120)}»`);
            let line = `${getUserName()} прокомментировала пост ${p.author} в Instagram: «${v}»`;
            if (cparts.length) line += ` — ответы: ${cparts.join('; ')}`;
            logSocialToChat(line);
        } catch (e) {
            console.error('[GlassPhone] ig author reply failed:', e);
        } finally {
            sending = false;
            genBusy = false;
            if (currentScreen === 'igview') render();
        }
    };
    screen.querySelector('#gp-ig-reply')?.addEventListener('click', doComment);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doComment(); } });
}

// Новый пост юзера с загрузкой фото
let _igDraftImage = null;
// ═══ ИНСТА-СТОРИС ═══

let _storyDraftImage = null;
let _storyGenBusy = false;
let _storyIdx = 0;
let _storyAuthor = null;   // null = свои сторис, иначе имя автора
let _othersStoriesBusy = false;

function igStoriesRow() {
    const all = activeStories();
    const mine = all.filter(s => s.ak === 'user');
    // Чужие сторис группируются по автору — один кружок на человека
    const others = [];
    const seen = new Set();
    for (const s of all) {
        if (s.ak === 'user' || !s.author || seen.has(s.author)) continue;
        seen.add(s.author);
        others.push(s);
    }
    const ava = avatarHtml(getUserName(), avatarForAuthor('user'), 'gp-avatar');
    return `
        <div class="gp-igst-row">
            <button class="gp-igst-bubble${mine.length ? ' gp-igst-has' : ''}" id="gp-ig-story-me">
                <span class="gp-igst-ring">${ava}${mine.length ? '' : `<span class="gp-igst-plus">${ic('fa-plus')}</span>`}</span>
                <i>${mine.length ? 'Твоя сторис' : 'Добавить'}</i>
            </button>
            ${mine.length ? `
            <button class="gp-igst-bubble" id="gp-ig-story-add">
                <span class="gp-igst-ring gp-igst-ring-add">${ic('fa-plus')}</span>
                <i>Ещё</i>
            </button>` : ''}
            ${others.map(o => `
            <button class="gp-igst-bubble gp-igst-has" data-storyauthor="${esc(o.author)}">
                <span class="gp-igst-ring">${avatarHtml(o.author, avatarForAuthor(o.ak), 'gp-avatar')}</span>
                <i>${esc(o.author)}</i>
            </button>`).join('')}
        </div>`;
}

function renderIgNewStory(screen) {
    currentScreen = 'ignewstory';
    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">Новая сторис</div>
        </div>
        <div class="gp-add-form">
            <div class="gp-ig-pick gp-igst-pick${_storyDraftImage ? ' gp-ig-pick-has' : ''}" id="gp-st-pick">
                ${_storyDraftImage ? `<img src="${esc(_storyDraftImage)}" alt="">` : `${ic('fa-camera')}<span>Выбрать фото</span>`}
            </div>
            <input type="file" id="gp-st-file" accept="image/*" style="display:none">
            <label class="gp-field">
                <span>Что на фото</span>
                <input type="text" id="gp-st-desc" maxlength="300" placeholder="Для генерации и реакций в ролевой">
            </label>
            <button class="gp-secondary" id="gp-st-draw" ${_storyGenBusy ? 'disabled' : ''}>${ic(_storyGenBusy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles')} Нарисовать по описанию</button>
            <label class="gp-field">
                <span>Текст на сторис <i style="opacity:0.5;text-transform:none;letter-spacing:0">(необязательно)</i></span>
                <input type="text" id="gp-st-caption" maxlength="300" placeholder="Подпись поверх фото">
            </label>
            <button class="gp-primary" id="gp-st-publish">${ic('fa-check')} Опубликовать</button>
        </div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => { _storyDraftImage = null; goto('ig'); });
    const pick = screen.querySelector('#gp-st-pick');
    const file = screen.querySelector('#gp-st-file');
    pick?.addEventListener('click', () => file?.click());
    file?.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
            _storyDraftImage = await compressImage(f, 720, 0.82);
            render();
        } catch (e) {
            toast('Не удалось загрузить фото', 'fa-circle-exclamation');
        }
    });
    screen.querySelector('#gp-st-draw')?.addEventListener('click', async () => {
        if (_storyGenBusy) return;
        const desc = screen.querySelector('#gp-st-desc')?.value.trim() || '';
        if (!desc) { toast('Опиши, что на фото — по этому и рисуем', 'fa-circle-exclamation'); return; }
        if (!_imgGenReady) {
            const ready = await isImageGenAvailable();
            if (!ready) { toast('novarakk не установлен — генерация картинок недоступна', 'fa-circle-exclamation'); return; }
            _imgGenReady = true;
        }
        _storyGenBusy = true;
        const caption = screen.querySelector('#gp-st-caption')?.value.trim() || '';
        render();
        try {
            const src2 = await generatePostImage({ ak: 'user', kind: 'ig', author: getUserName(), imgDesc: desc, caption });
            _storyDraftImage = src2;
            toast('Фото готово', 'fa-image');
        } catch (e) {
            toast(`Не получилось: ${String(e?.message || e).slice(0, 60)}`, 'fa-circle-exclamation');
        } finally {
            _storyGenBusy = false;
            const d = document.getElementById('gp-st-desc')?.value;
            const c = document.getElementById('gp-st-caption')?.value;
            render();
            const d2 = document.getElementById('gp-st-desc'); if (d2 && d) d2.value = d;
            const c2 = document.getElementById('gp-st-caption'); if (c2 && c) c2.value = c;
        }
    });
    screen.querySelector('#gp-st-publish')?.addEventListener('click', () => {
        const desc = screen.querySelector('#gp-st-desc')?.value.trim() || '';
        const caption = screen.querySelector('#gp-st-caption')?.value.trim() || '';
        if (!_storyDraftImage && !desc) {
            toast('Выбери фото или опиши, что на нём', 'fa-circle-exclamation');
            return;
        }
        const story = addStory({ image: _storyDraftImage, imgDesc: desc, caption });
        _storyDraftImage = null;
        // Журнал: ролевая знает про сторис (с фото — vision-модель видит сама)
        logSocialToChat(
            `${getUserName()} выложила сторис в Instagram${desc ? ` (на фото: ${desc})` : ''}${caption ? `, текст: «${caption}»` : ''} — исчезнет через 24 часа`,
            story.image,
        );
        applyChatHiding();
        toast('Сторис опубликована', 'fa-instagram');
        _storyAuthor = null;
        _storyIdx = 0;
        goto('igstory');
        // Знакомые тоже постят: чужие сторис подъезжают следом (без картинок —
        // рисуются по кнопке в просмотрщике)
        if (!_othersStoriesBusy) {
            _othersStoriesBusy = true;
            generateContactStories().then(n => {
                if (n > 0) toast('Появились сторис знакомых', 'fa-instagram');
            }).catch(() => {}).finally(() => {
                _othersStoriesBusy = false;
                if (currentScreen === 'ig' || currentScreen === 'igstory') render();
            });
        }
    });
}

function renderIgStory(screen) {
    currentScreen = 'igstory';
    const isMine = !_storyAuthor;
    const stories = activeStories().filter(s => isMine ? s.ak === 'user' : s.author === _storyAuthor);
    if (!stories.length) { goto('ig'); return; }
    if (_storyIdx >= stories.length) _storyIdx = stories.length - 1;
    const st = stories[_storyIdx];
    const authorName = isMine ? getUserName() : (st.author || _storyAuthor);
    const authorAva = avatarHtml(authorName, avatarForAuthor(isMine ? 'user' : st.ak), 'gp-avatar gp-avatar-sm');
    const views = isMine ? bumpStoryViews(st) : 0;
    const ageMin = Math.max(1, Math.round((Date.now() - st.time) / 60000));
    const ageLabel = ageMin < 60 ? `${ageMin} м` : `${Math.round(ageMin / 60)} ч`;
    const media = st.image
        ? `<img class="gp-igst-media" src="${esc(st.image)}" alt="">`
        : `<div class="gp-igst-media gp-igst-media-gen" style="${avatarStyle('story' + st.imgDesc)}"><span>${ic('fa-image')}</span><i>${esc(st.imgDesc)}</i></div>`;
    screen.innerHTML = `
        <div class="gp-igst-viewer">
            <div class="gp-igst-segments">${stories.map((_, i2) => `<span class="${i2 < _storyIdx ? 'gp-done' : i2 === _storyIdx ? 'gp-cur' : ''}"></span>`).join('')}</div>
            <div class="gp-igst-top">
                ${authorAva}
                <b>${esc(authorName)}</b>
                <span>${esc(ageLabel)}</span>
                ${!st.image && st.imgDesc ? `<button class="gp-iconbtn" id="gp-st-draw2" title="Нарисовать" ${_storyGenBusy ? 'disabled' : ''}>${ic(_storyGenBusy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles')}</button>` : ''}
                <button class="gp-iconbtn gp-danger" id="gp-st-del" title="Удалить сторис">${ic('fa-trash-can')}</button>
                <button class="gp-iconbtn" id="gp-st-close">${ic('fa-xmark')}</button>
            </div>
            ${media}
            ${st.caption ? `<div class="gp-igst-caption">${esc(st.caption)}</div>` : ''}
            ${isMine ? `<div class="gp-igst-bottom">${ic('fa-eye')} ${views}</div>` : ''}
            <div class="gp-igst-nav gp-igst-nav-left" id="gp-st-prev"></div>
            <div class="gp-igst-nav gp-igst-nav-right" id="gp-st-next"></div>
        </div>`;
    screen.querySelector('#gp-st-close')?.addEventListener('click', () => goto('ig'));
    screen.querySelector('#gp-st-draw2')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (_storyGenBusy) return;
        if (!_imgGenReady) {
            const ready = await isImageGenAvailable();
            if (!ready) { toast('novarakk не установлен — генерация картинок недоступна', 'fa-circle-exclamation'); return; }
            _imgGenReady = true;
        }
        _storyGenBusy = true;
        render();
        try {
            const src2 = await generatePostImage({
                ak: isMine ? 'user' : st.ak,
                author: authorName,
                imgDesc: st.imgDesc,
                caption: st.caption,
                kind: 'ig',
                stream: !isMine, // частичный неймматч с карточкой для НПС
            });
            st.image = src2;
            saveMeta();
            toast('Фото готово', 'fa-image');
        } catch (err) {
            toast(`Не получилось: ${String(err?.message || err).slice(0, 60)}`, 'fa-circle-exclamation');
        } finally {
            _storyGenBusy = false;
            if (currentScreen === 'igstory') render();
        }
    });
    screen.querySelector('#gp-st-del')?.addEventListener('click', () => {
        if (!confirm('Удалить эту сторис?')) return;
        deleteStory(st.id);
        if (_storyIdx > 0) _storyIdx--;
        const left = activeStories().filter(s => isMine ? s.ak === 'user' : s.author === _storyAuthor);
        if (!left.length) goto('ig');
        else render();
    });
    screen.querySelector('#gp-st-prev')?.addEventListener('click', () => {
        if (_storyIdx > 0) { _storyIdx--; render(); }
    });
    screen.querySelector('#gp-st-next')?.addEventListener('click', () => {
        if (_storyIdx < stories.length - 1) { _storyIdx++; render(); }
        else goto('ig');
    });
}

function renderIgNew(screen) {
    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">Новый пост</div>
        </div>
        <div class="gp-add-form">
            <div class="gp-ig-pick${_igDraftImage ? ' gp-ig-pick-has' : ''}" id="gp-ig-pick">
                ${_igDraftImage ? `<img src="${esc(_igDraftImage)}" alt="">` : `${ic('fa-camera')}<span>Выбрать фото</span>`}
            </div>
            <input type="file" id="gp-ig-file" accept="image/*" style="display:none">
            <label class="gp-field">
                <span>Что на фото <i style="opacity:0.5;text-transform:none;letter-spacing:0">(необязательно)</i></span>
                <input type="text" id="gp-ig-desc" maxlength="200" placeholder="Модели с виженом увидят фото сами">
            </label>
            <label class="gp-field">
                <span>Подпись</span>
                <input type="text" id="gp-ig-caption" maxlength="400" placeholder="Подпись к посту">
            </label>
            <button class="gp-primary" id="gp-ig-publish">${ic('fa-check')} Опубликовать</button>
            <div class="gp-add-hint">Фото прикладывается к запросу — vision-модели смотрят на него сами. Описание нужно только для моделей без вижена (и для реакций в самой ролевой).</div>
        </div>`;

    screen.querySelector('#gp-back')?.addEventListener('click', () => { _igDraftImage = null; goto('ig'); });

    const pick = screen.querySelector('#gp-ig-pick');
    const file = screen.querySelector('#gp-ig-file');
    pick?.addEventListener('click', () => file?.click());
    file?.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
            _igDraftImage = await compressImage(f, 720, 0.82);
            render();
        } catch (e) {
            toast('Не удалось загрузить фото', 'fa-circle-exclamation');
        }
    });

    screen.querySelector('#gp-ig-publish')?.addEventListener('click', async () => {
        const desc = screen.querySelector('#gp-ig-desc')?.value.trim() || '';
        const caption = screen.querySelector('#gp-ig-caption')?.value.trim() || '';
        if (!_igDraftImage && !desc) {
            toast('Выбери фото или опиши, что на нём', 'fa-circle-exclamation');
            return;
        }
        const post = postIg({ image: _igDraftImage, imgDesc: desc, caption });
        const ad = attachActiveAd('instagram', post);
        if (ad) toast(`Реклама ${ad.brand} опубликована`, 'fa-star');
        _igDraftImage = null;
        updatePhoneInjection(); // персонажи «видят» пост юзера
        currentPostId = post.id;
        goto('igview');
        toast('Опубликовано', 'fa-instagram');

        // Журнал: пост уходит в чат сразу, ВМЕСТЕ С ФОТО (extra.image) —
        // vision-модель видит снимок в РП по месту истории, описание не требуется.
        // Затем авто-комменты; их ветка тоже логируется.
        if (!genBusy) {
            genBusy = true;
            render();
            try {
                // Комбо: комменты + описание фото ОДНИМ vision-запросом
                // (generateIgComments заполнит post.imgDesc, если его нет)
                const before = (post.comments || []).length;
                await generateIgComments(post);
                updatePhoneInjection();
                render();
                // Журнал — уже с готовым описанием
                await logSocialToChat(
                    `${getUserName()} опубликовала фото в Instagram${post.imgDesc ? ` (на фото: ${post.imgDesc})` : ''}${post.caption ? `, подпись: «${post.caption}»` : ''}`,
                    post.image,
                );
                applyChatHiding();
                logNewReplies('фото в Instagram', post.caption || post.imgDesc, post.comments, before);
                await finalizeSocialPost('instagram', post);
            } catch (e) {
                console.error('[GlassPhone] auto-comments failed:', e);
                toast(`Реакции не сгенерились: ${String(e?.message || e).slice(0, 80)}`, 'fa-circle-exclamation');
            } finally {
                genBusy = false;
                if (currentScreen === 'igview') render();
            }
        }
    });
}

// ═══ ONLYFANS ═══

function ofCard(p, { clickable = true } = {}) {
    return `
    <div class="gp-ig-card gp-of-card" data-post="${esc(p.id)}">
        <div class="gp-ig-head">
            ${avatarHtml(p.author, avatarForAuthor(p.ak), 'gp-avatar gp-avatar-xs')}
            <span class="gp-ig-name">${esc(p.author)}</span>
            <span class="gp-of-badge">${ic('fa-lock')}${p.price > 0 ? ` $${p.price}` : ' подписка'}</span>
            <span class="gp-tw-time">· ${esc(timeAgo(p.time))}</span>
            <button class="gp-tw-del" data-del-of="${esc(p.id)}" title="Удалить">${ic('fa-xmark')}</button>
        </div>
        <div class="${clickable ? 'gp-clickable' : ''}" data-open-of="${esc(p.id)}">${igImageHtml(p)}</div>
        <div class="gp-ig-actions">
            <button class="gp-tw-act${p.liked ? ' gp-tw-on' : ''}" data-like-of="${esc(p.id)}">${ic('fa-heart')}<span>${p.likes || ''}</span></button>
            <button class="gp-tw-act" data-open-of2="${esc(p.id)}">${ic('fa-comment')}<span>${p.comments?.length || ''}</span></button>
            ${p.tips > 0 ? `<span class="gp-of-tips">${ic('fa-sack-dollar')} $${p.tips}</span>` : ''}
        </div>
        ${p.caption ? `<div class="gp-ig-caption"><b>${esc(p.author)}</b> ${esc(p.caption)}</div>` : ''}
    </div>`;
}

function bindOfCardActions(root) {
    root.querySelectorAll('[data-like-of]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation(); likeOf(b.getAttribute('data-like-of')); render();
    }));
    root.querySelectorAll('[data-del-of]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Удалить пост?')) { delOf(b.getAttribute('data-del-of')); render(); }
    }));
    const open = (id) => { currentPostId = id; goto('ofview'); };
    root.querySelectorAll('[data-open-of]').forEach(b => b.addEventListener('click', () => open(b.getAttribute('data-open-of'))));
    root.querySelectorAll('[data-open-of2]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation(); open(b.getAttribute('data-open-of2'));
    }));
    // Кнопки генерации картинок (те же data-genimg/data-regenimg — doGenImage ищет и в OF)
    bindIgCardActions(root);
}

function renderOf(screen) {
    currentScreen = 'of';
    const posts = getOfPosts();
    const s = getSocial();

    setHtmlKeepScroll(screen, '.gp-feed', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-of-title">${ic('fa-heart')} OnlyFans</div>
            <button class="gp-iconbtn" id="gp-of-new" title="Новый пост">${ic('fa-plus')}</button>
        </div>
        <div class="gp-of-stats">
            <div class="gp-of-stat"><b>${s.ofSubs}</b><span>подписчиков</span></div>
            <div class="gp-of-stat gp-of-stat-btn" id="gp-of-withdraw" title="Вывести на карту"><b>$${s.ofEarned}</b><span>${s.ofEarned > 0 ? `вывести ${'→'}` : 'баланс'}</span></div>
            <div class="gp-of-stat gp-of-stat-btn" id="gp-of-wallet" title="Клик — изменить (траты в РП)"><b>$${s.ofWallet}</b><span>на карте</span></div>
        </div>
        <div class="gp-feed" id="gp-of-feed">
            ${posts.length === 0
                ? `<div class="gp-empty"><div class="gp-empty-icon gp-of-title">${ic('fa-heart')}</div><div class="gp-empty-title">Твоя страничка пуста</div><div class="gp-empty-text">${ic('fa-plus')} — выложить контент для подписчиков.<br>Фанаты отреагируют и накидают чаевых.</div></div>`
                : posts.map(p => ofCard(p)).join('')}
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-of-new')?.addEventListener('click', () => goto('ofnew'));
    // Вывод заработка на карту → деньги доступны в ролевой (через инжекцию)
    screen.querySelector('#gp-of-withdraw')?.addEventListener('click', () => {
        const st = getSocial();
        if (st.ofEarned <= 0) { toast('Пока нечего выводить', 'fa-circle-exclamation'); return; }
        if (!confirm(`Вывести $${st.ofEarned} на карту?\nДеньги станут доступны тебе в ролевой (персонажи не узнают источник).`)) return;
        const amount = withdrawOf();
        updatePhoneInjection();
        toast(`Выведено $${amount} — деньги на карте`, 'fa-sack-dollar');
        render();
    });
    // Ручная правка баланса карты (потратила в РП — спиши)
    screen.querySelector('#gp-of-wallet')?.addEventListener('click', () => {
        const st = getSocial();
        const v = prompt('Баланс карты, $ (потратила в РП — уменьши):', String(st.ofWallet));
        if (v === null) return;
        setOfWallet(v);
        updatePhoneInjection();
        render();
    });
    bindOfCardActions(screen);
}

function renderOfView(screen) {
    const p = getOfPosts().find(x => x.id === currentPostId);
    if (!p) { goto('of'); return; }
    const comments = p.comments || [];

    setHtmlKeepScroll(screen, '.gp-feed', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">Пост</div>
            <button class="gp-iconbtn" id="gp-of-comments" title="Реакции фанатов" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-comments')}</button>
        </div>
        <div class="gp-feed">
            ${ofCard(p, { clickable: false })}
            ${imgDescNoteHtml(p)}
            <div class="gp-replies">
                ${comments.length === 0
                    ? `<div class="gp-empty-text gp-replies-empty">Реакций нет — нажми ${ic('fa-comments')}, фанаты налетят</div>`
                    : comments.map(c => `
                    <div class="gp-reply">
                        ${avatarHtml(c.author, avatarForAuthor(c.ak), 'gp-avatar gp-avatar-xs')}
                        <div class="gp-reply-body">
                            <div class="gp-tw-meta">
                                <span class="gp-tw-name">${esc(c.author)}</span>
                                ${c.tip ? `<span class="gp-of-tip-badge">${ic('fa-sack-dollar')} $${c.tip}</span>` : ''}
                                <span class="gp-tw-time">· ${esc(timeAgo(c.time))}</span>
                                <button class="gp-reply-del" data-del-ofcomment="${esc(c.id)}" title="Удалить">${ic('fa-xmark')}</button>
                            </div>
                            <div class="gp-tw-text">${esc(c.text)}</div>
                        </div>
                    </div>`).join('')}
            </div>
        </div>
        <div class="gp-inputbar">
            <textarea id="gp-input" rows="1" placeholder="Ответить фанатам..."></textarea>
            <button class="gp-send" id="gp-of-reply" ${sending ? 'disabled' : ''}>${ic('fa-paper-plane')}</button>
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('of'));
    bindOfCardActions(screen);
    bindDescEdit(screen, p);

    screen.querySelectorAll('[data-del-ofcomment]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        delOfComment(p.id, b.getAttribute('data-del-ofcomment'));
        render();
    }));

    screen.querySelector('#gp-of-comments')?.addEventListener('click', async () => {
        if (genBusy) return;
        genBusy = true; render();
        try {
            const before = (p.comments || []).length;
            const n = await generateOfComments(p);
            if (!n) toast('Не получилось — попробуй ещё раз', 'fa-circle-exclamation');
            logNewReplies('приватным OnlyFans-постом', p.caption || p.imgDesc, p.comments, before);
        } catch (e) {
            console.error('[GlassPhone] of comments failed:', e);
            toast('Ошибка генерации', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'ofview') render();
        }
    });

    const input = screen.querySelector('#gp-input');
    const doComment = async () => {
        const v = input?.value.trim();
        if (!v || sending) return;
        addOfComment(p.id, v);
        input.value = '';
        render();
        // Фанаты реагируют на её ответ
        if (!genBusy) {
            genBusy = true; render();
            try { await generateOfComments(p); }
            catch (e) { console.error('[GlassPhone] of fan reply failed:', e); }
            finally { genBusy = false; if (currentScreen === 'ofview') render(); }
        }
    };
    screen.querySelector('#gp-of-reply')?.addEventListener('click', doComment);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doComment(); } });
}

let _ofDraftImage = null;
function renderOfNew(screen) {
    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-of-title">Новый пост</div>
        </div>
        <div class="gp-add-form">
            <div class="gp-ig-pick${_ofDraftImage ? ' gp-ig-pick-has' : ''}" id="gp-of-pick">
                ${_ofDraftImage ? `<img src="${esc(_ofDraftImage)}" alt="">` : `${ic('fa-camera')}<span>Выбрать фото</span>`}
            </div>
            <input type="file" id="gp-of-file" accept="image/*" style="display:none">
            <label class="gp-field">
                <span>Что на фото <i style="opacity:0.5;text-transform:none;letter-spacing:0">(необязательно)</i></span>
                <input type="text" id="gp-of-desc" maxlength="200" placeholder="Или нажми «Нарисовать» после публикации">
            </label>
            <label class="gp-field">
                <span>Подпись</span>
                <input type="text" id="gp-of-caption" maxlength="400" placeholder="Подпись для подписчиков">
            </label>
            <label class="gp-field">
                <span>Цена PPV, $ <i style="opacity:0.5;text-transform:none;letter-spacing:0">(0 = по подписке)</i></span>
                <input type="number" id="gp-of-price" min="0" max="500" value="0">
            </label>
            <button class="gp-primary gp-of-primary" id="gp-of-publish">${ic('fa-check')} Опубликовать</button>
            <div class="gp-add-hint">Пост приватный: персонажи в ролевой узнают о нём, только если по сюжету тайно подписаны.</div>
        </div>`;

    screen.querySelector('#gp-back')?.addEventListener('click', () => { _ofDraftImage = null; goto('of'); });

    const pick = screen.querySelector('#gp-of-pick');
    const file = screen.querySelector('#gp-of-file');
    pick?.addEventListener('click', () => file?.click());
    file?.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        try {
            _ofDraftImage = await compressImage(f, 720, 0.82);
            render();
        } catch (e) {
            toast('Не удалось загрузить фото', 'fa-circle-exclamation');
        }
    });

    screen.querySelector('#gp-of-publish')?.addEventListener('click', async () => {
        const desc = screen.querySelector('#gp-of-desc')?.value.trim() || '';
        const caption = screen.querySelector('#gp-of-caption')?.value.trim() || '';
        const price = parseInt(screen.querySelector('#gp-of-price')?.value) || 0;
        if (!_ofDraftImage && !desc) {
            toast('Выбери фото или опиши, что на нём', 'fa-circle-exclamation');
            return;
        }
        const post = postOf({ image: _ofDraftImage, imgDesc: desc, caption, price });
        _ofDraftImage = null;
        updatePhoneInjection();
        currentPostId = post.id;
        goto('ofview');
        toast('Опубликовано для подписчиков', 'fa-heart');

        if (!genBusy) {
            genBusy = true;
            render();
            try {
                // Комбо: реакции фанатов + описание фото одним vision-запросом
                const before = (post.comments || []).length;
                await generateOfComments(post);
                updatePhoneInjection();
                render();
                // Журнал: с готовым описанием, текст жёстко помечает приватность
                await logSocialToChat(
                    `${getUserName()} опубликовала пост на своей ПРИВАТНОЙ странице OnlyFans (видят только анонимные подписчики; персонажи НЕ знают, если сюжет не установил обратное)${post.imgDesc ? ` — на фото: ${post.imgDesc}` : ''}${post.caption ? `, подпись: «${post.caption}»` : ''}`,
                    post.image,
                );
                applyChatHiding();
                logNewReplies('приватным OnlyFans-постом', post.caption || post.imgDesc, post.comments, before);
            } catch (e) {
                console.error('[GlassPhone] of auto-comments failed:', e);
                toast(`Реакции не сгенерились: ${String(e?.message || e).slice(0, 80)}`, 'fa-circle-exclamation');
            } finally {
                genBusy = false;
                if (currentScreen === 'ofview') render();
            }
        }
    });
}

let _bankTxSign = -1; // -1 трата, +1 доход (для формы)

const BANK_CATS = ['еда', 'транспорт', 'жильё', 'подписка', 'одежда', 'развлечения', 'красота', 'здоровье', 'подарок', 'зарплата', 'перевод', 'другое'];

function txIcon(cat) {
    const map = {
        'еда': 'fa-utensils', 'транспорт': 'fa-car', 'жильё': 'fa-house', 'подписка': 'fa-repeat',
        'одежда': 'fa-shirt', 'развлечения': 'fa-champagne-glasses', 'красота': 'fa-wand-magic-sparkles',
        'здоровье': 'fa-heart-pulse', 'подарок': 'fa-gift', 'зарплата': 'fa-briefcase',
        'перевод': 'fa-arrow-right-arrow-left', 'кредит': 'fa-landmark', 'ролевая': 'fa-masks-theater',
    };
    return map[cat] || 'fa-receipt';
}

function renderBank(screen) {
    currentScreen = 'bank';
    const b = getBank();
    const { income, expense } = incomeExpenseTotals();
    const debt = totalDebt();
    const reminders = getBankReminders();
    const cats = spendingByCategory(5);
    const maxCat = cats.length ? cats[0].sum : 1;

    const remBanner = reminders.length ? `
        <div class="gp-bank-remind">
            ${ic('fa-bell')} <b>Пора платить:</b>
            ${reminders.map(r => `<span class="gp-bank-remind-item${r.overdue ? ' gp-overdue' : ''}">${esc(r.name)} — ${esc(fmtMoney(r.amount))}</span>`).join('')}
        </div>` : '';

    setHtmlKeepScroll(screen, '.gp-bank-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-bank-title">Банк</div>
            <button class="gp-iconbtn" id="gp-bank-cur" title="Валюта">${esc(b.currency)}</button>
        </div>
        <div class="gp-bank-scroll">
            <div class="gp-bank-card ${b.balance < 0 ? 'gp-bank-neg' : ''}">
                <div class="gp-bank-card-label">Баланс</div>
                <div class="gp-bank-balance" id="gp-bank-balance">${esc(fmtMoney(b.balance))}</div>
                <div class="gp-bank-io">
                    <span class="gp-bank-in">+${esc(fmtMoney(income))}</span>
                    <span class="gp-bank-out">−${esc(fmtMoney(expense))}</span>
                </div>
            </div>
            ${remBanner}
            <div class="gp-bank-actions">
                <button class="gp-bank-act gp-bank-act-out" id="gp-bank-spend">${ic('fa-minus')} Трата</button>
                <button class="gp-bank-act gp-bank-act-in" id="gp-bank-income">${ic('fa-plus')} Доход</button>
                <button class="gp-bank-act" id="gp-bank-loans">${ic('fa-landmark')} Кредиты${debt > 0 ? ` <span class="gp-bank-chip">${esc(fmtMoney(debt))}</span>` : ''}</button>
                <button class="gp-bank-act" id="gp-bank-recs">${ic('fa-file-invoice-dollar')} Платежи${monthlyObligations() > 0 ? ` <span class="gp-bank-chip">${esc(fmtMoney(monthlyObligations()))}/мес</span>` : ''}</button>
            </div>
            ${cats.length ? `
            <div class="gp-bank-section">
                <div class="gp-bank-section-h">Траты по категориям</div>
                ${cats.map(c => `
                    <div class="gp-bank-cat">
                        <span class="gp-bank-cat-i">${ic(txIcon(c.category))}</span>
                        <span class="gp-bank-cat-n">${esc(c.category)}</span>
                        <span class="gp-bank-cat-bar"><span style="width:${Math.round(c.sum / maxCat * 100)}%"></span></span>
                        <span class="gp-bank-cat-s">${esc(fmtMoney(c.sum))}</span>
                    </div>`).join('')}
            </div>` : ''}
            <div class="gp-bank-section">
                <div class="gp-bank-section-h">Операции</div>
                ${b.transactions.length === 0
                    ? `<div class="gp-empty-text" style="padding:14px 8px">Пока нет операций. Добавь трату или доход, или пусть их создаёт ролевая.</div>`
                    : b.transactions.slice(0, 40).map(t => `
                        <div class="gp-bank-tx">
                            <span class="gp-bank-tx-i">${ic(txIcon(t.category))}</span>
                            <span class="gp-bank-tx-body">
                                <span class="gp-bank-tx-label">${esc(t.label)}</span>
                                <span class="gp-bank-tx-cat">${esc(t.category)}</span>
                            </span>
                            <span class="gp-bank-tx-amt ${t.amount < 0 ? 'gp-neg' : 'gp-pos'}">${t.amount > 0 ? '+' : ''}${esc(fmtMoney(t.amount))}</span>
                            <button class="gp-bank-tx-del" data-del-tx="${esc(t.id)}" title="Удалить">${ic('fa-xmark')}</button>
                        </div>`).join('')}
            </div>
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-bank-spend')?.addEventListener('click', () => { _bankTxSign = -1; goto('banktx'); });
    screen.querySelector('#gp-bank-income')?.addEventListener('click', () => { _bankTxSign = 1; goto('banktx'); });
    screen.querySelector('#gp-bank-loans')?.addEventListener('click', () => goto('bankloan'));
    screen.querySelector('#gp-bank-recs')?.addEventListener('click', () => goto('bankrec'));
    screen.querySelector('#gp-bank-cur')?.addEventListener('click', () => {
        const cur = prompt('Символ валюты (₽ $ € £ ...):', b.currency);
        if (!cur || !cur.trim()) return;
        // Смена валюты конвертирует ВСЕ суммы по примерному курсу
        const res = convertCurrency(cur.trim());
        render();
        if (res.converted) toast(`Суммы конвертированы: ${res.from} → ${res.to}`, 'fa-arrow-right-arrow-left');
        else if (res.from !== res.to) toast('Курс неизвестен — суммы не тронуты, сменён только символ', 'fa-circle-exclamation');
    });
    screen.querySelectorAll('[data-del-tx]').forEach(btn => btn.addEventListener('click', () => {
        deleteTransaction(btn.getAttribute('data-del-tx'));
        updatePhoneInjection(); render();
    }));
    updateFabBadge();
}

function renderBankTx(screen) {
    currentScreen = 'banktx';
    const income = _bankTxSign > 0;
    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title" style="flex:1">${income ? 'Новый доход' : 'Новая трата'}</div>
        </div>
        <div class="gp-add-form">
            <label class="gp-field"><span>Сумма</span>
                <input type="number" id="gp-tx-amount" inputmode="numeric" min="0" step="1" placeholder="0"></label>
            <label class="gp-field"><span>Описание</span>
                <input type="text" id="gp-tx-label" maxlength="60" placeholder="${income ? 'напр. зарплата' : 'напр. кофе'}"></label>
            <label class="gp-field"><span>Категория</span>
                <select id="gp-tx-cat" class="text_pole">${BANK_CATS.map(c => `<option value="${c}">${c}</option>`).join('')}</select></label>
            <button class="gp-primary ${income ? '' : 'gp-primary-out'}" id="gp-tx-save">${ic('fa-check')} ${income ? 'Добавить доход' : 'Добавить трату'}</button>
        </div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('bank'));
    if (!income) screen.querySelector('#gp-tx-cat').value = 'еда';
    else screen.querySelector('#gp-tx-cat').value = 'зарплата';
    screen.querySelector('#gp-tx-save')?.addEventListener('click', () => {
        const amt = Math.abs(parseInt(screen.querySelector('#gp-tx-amount').value) || 0);
        if (!amt) { toast('Укажи сумму', 'fa-circle-exclamation'); return; }
        addTransaction({
            amount: income ? amt : -amt,
            label: screen.querySelector('#gp-tx-label').value.trim(),
            category: screen.querySelector('#gp-tx-cat').value,
        });
        updatePhoneInjection();
        goto('bank');
        toast(income ? 'Доход добавлен' : 'Трата добавлена', 'fa-check');
    });
    screen.querySelector('#gp-tx-amount')?.focus();
}

function renderBankLoan(screen) {
    currentScreen = 'bankloan';
    const b = getBank();
    setHtmlKeepScroll(screen, '.gp-bank-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-bank-title">Кредиты</div>
        </div>
        <div class="gp-bank-scroll">
            <div class="gp-bank-section">
                <div class="gp-bank-section-h">Взять кредит</div>
                <div class="gp-add-form" style="padding:6px 2px">
                    <label class="gp-field"><span>Название</span><input type="text" id="gp-loan-name" maxlength="40" placeholder="напр. Айфон / Ремонт"></label>
                    <label class="gp-field"><span>Сумма</span><input type="number" id="gp-loan-amount" inputmode="numeric" min="0" placeholder="0"></label>
                    <div style="display:flex;gap:8px">
                        <label class="gp-field" style="flex:1"><span>Срок (мес.)</span><input type="number" id="gp-loan-months" inputmode="numeric" min="1" max="360" value="12"></label>
                        <label class="gp-field" style="flex:1"><span>Ставка, % год.</span><input type="number" id="gp-loan-rate" inputmode="numeric" min="0" max="200" value="18"></label>
                        <label class="gp-field" style="flex:1"><span>Число платежа</span><input type="number" id="gp-loan-day" inputmode="numeric" min="1" max="31" value="10"></label>
                    </div>
                    <div class="gp-add-hint" id="gp-loan-preview"></div>
                    <button class="gp-primary" id="gp-loan-take">Оформить</button>
                </div>
            </div>
            <div class="gp-bank-section">
                <div class="gp-bank-section-h">Мои кредиты</div>
                ${b.loans.length === 0
                    ? `<div class="gp-empty-text" style="padding:12px 8px">Кредитов нет</div>`
                    : b.loans.map(l => `
                        <div class="gp-bank-loan ${l.paidOff ? 'gp-paid' : ''}">
                            <div class="gp-bank-loan-top">
                                <span class="gp-bank-loan-name">${esc(l.name)}</span>
                                <button class="gp-bank-tx-del" data-del-loan="${esc(l.id)}" title="Удалить">${ic('fa-xmark')}</button>
                            </div>
                            <div class="gp-bank-loan-info">
                                ${l.paidOff ? `<span class="gp-pos">Погашен</span>` : `Осталось <b>${esc(fmtMoney(l.remaining))}</b> · ${esc(fmtMoney(l.monthly))}/мес${l.day ? `, ${l.day}-го числа` : ''}`}
                            </div>
                            ${l.paidOff ? '' : `<div class="gp-bank-loan-btns">
                                <button class="gp-bank-pay" data-pay-loan="${esc(l.id)}">Внести ${esc(fmtMoney(Math.min(l.remaining, l.monthly)))}</button>
                                <button class="gp-bank-pay gp-bank-early" data-early-loan="${esc(l.id)}" title="Досрочное погашение">Досрочно</button>
                            </div>`}
                        </div>`).join('')}
            </div>
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('bank'));
    const preview = () => {
        const amount = parseInt(screen.querySelector('#gp-loan-amount').value) || 0;
        const months = Math.max(1, parseInt(screen.querySelector('#gp-loan-months').value) || 12);
        const rate = (parseFloat(screen.querySelector('#gp-loan-rate').value) || 0) / 100;
        const mr = rate / 12;
        const monthly = amount <= 0 ? 0 : (mr > 0
            ? Math.round(amount * mr * Math.pow(1 + mr, months) / (Math.pow(1 + mr, months) - 1))
            : Math.round(amount / months));
        const el = screen.querySelector('#gp-loan-preview');
        if (el) el.textContent = amount > 0 ? `Платёж ~${fmtMoney(monthly)}/мес · всего вернёшь ~${fmtMoney(monthly * months)}` : '';
    };
    ['gp-loan-amount', 'gp-loan-months', 'gp-loan-rate'].forEach(id => screen.querySelector('#' + id)?.addEventListener('input', preview));
    screen.querySelector('#gp-loan-take')?.addEventListener('click', () => {
        const amount = parseInt(screen.querySelector('#gp-loan-amount').value) || 0;
        if (amount <= 0) { toast('Укажи сумму кредита', 'fa-circle-exclamation'); return; }
        takeLoan({
            name: screen.querySelector('#gp-loan-name').value.trim(),
            amount,
            months: parseInt(screen.querySelector('#gp-loan-months').value) || 12,
            rate: (parseFloat(screen.querySelector('#gp-loan-rate').value) || 0) / 100,
            day: parseInt(screen.querySelector('#gp-loan-day').value) || 10,
        });
        updatePhoneInjection();
        goto('bank');
        toast('Кредит оформлен — деньги на счету', 'fa-money-bill-wave');
    });
    screen.querySelectorAll('[data-pay-loan]').forEach(btn => btn.addEventListener('click', () => {
        payLoanInstallment(btn.getAttribute('data-pay-loan'));
        updatePhoneInjection(); render();
    }));
    // Досрочное погашение: любая сумма вплоть до полного остатка
    screen.querySelectorAll('[data-early-loan]').forEach(btn => btn.addEventListener('click', () => {
        const loan = getBank().loans.find(l => l.id === btn.getAttribute('data-early-loan'));
        if (!loan || loan.paidOff) return;
        const raw = window.prompt(`${tr('Сумма досрочного платежа')} (${tr('Осталось')} ${fmtMoney(loan.remaining)}):`, String(loan.remaining));
        if (raw === null) return;
        const amt = Math.abs(parseInt(String(raw).replace(/\s/g, '')) || 0);
        if (!amt) { toast('Укажи сумму', 'fa-circle-exclamation'); return; }
        payLoanInstallment(loan.id, amt);
        updatePhoneInjection(); render();
        toast(loan.paidOff ? 'Кредит погашен полностью' : 'Досрочный платёж внесён', loan.paidOff ? 'fa-handshake' : 'fa-bolt');
    }));
    screen.querySelectorAll('[data-del-loan]').forEach(btn => btn.addEventListener('click', () => {
        if (confirm('Удалить кредит из списка? (баланс не изменится)')) { deleteLoan(btn.getAttribute('data-del-loan')); render(); }
    }));
}

function renderBankRec(screen) {
    currentScreen = 'bankrec';
    const b = getBank();
    const rem = getBankReminders().filter(r => r.kind === 'bill').map(r => r.id);
    setHtmlKeepScroll(screen, '.gp-bank-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-bank-title">Обязательные платежи</div>
        </div>
        <div class="gp-bank-scroll">
            <div class="gp-bank-section">
                <div class="gp-bank-section-h">Добавить платёж</div>
                <div class="gp-add-form" style="padding:6px 2px">
                    <label class="gp-field"><span>Название</span><input type="text" id="gp-rec-name" maxlength="40" placeholder="напр. Аренда / Netflix"></label>
                    <div style="display:flex;gap:8px">
                        <label class="gp-field" style="flex:1"><span>Сумма/мес</span><input type="number" id="gp-rec-amount" inputmode="numeric" min="0" placeholder="0"></label>
                        <label class="gp-field" style="flex:1"><span>Число месяца</span><input type="number" id="gp-rec-day" inputmode="numeric" min="1" max="31" value="1"></label>
                    </div>
                    <label class="gp-field"><span>Категория</span><select id="gp-rec-cat" class="text_pole">${BANK_CATS.map(c => `<option value="${c}"${c === 'подписка' ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
                    <button class="gp-primary" id="gp-rec-add">${ic('fa-plus')} Добавить</button>
                </div>
            </div>
            <div class="gp-bank-section">
                <div class="gp-bank-section-h">Мои платежи${monthlyObligations() > 0 ? ` — ${esc(fmtMoney(monthlyObligations()))}/мес` : ''}</div>
                ${b.recurring.length === 0
                    ? `<div class="gp-empty-text" style="padding:12px 8px">Обязательных платежей нет</div>`
                    : b.recurring.map(r => `
                        <div class="gp-bank-rec ${rem.includes(r.id) ? 'gp-bank-rec-due' : ''}">
                            <span class="gp-bank-tx-i">${ic(txIcon(r.category))}</span>
                            <span class="gp-bank-tx-body">
                                <span class="gp-bank-tx-label">${esc(r.name)}</span>
                                <span class="gp-bank-tx-cat">${esc(fmtMoney(r.amount))} · ${r.day}-го числа${rem.includes(r.id) ? ' · пора платить' : ''}</span>
                            </span>
                            <button class="gp-bank-pay gp-bank-pay-sm" data-pay-rec="${esc(r.id)}" title="Оплатить">Оплатить</button>
                            <button class="gp-bank-tx-del" data-del-rec="${esc(r.id)}" title="Удалить">${ic('fa-xmark')}</button>
                        </div>`).join('')}
            </div>
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('bank'));
    screen.querySelector('#gp-rec-add')?.addEventListener('click', () => {
        const amount = parseInt(screen.querySelector('#gp-rec-amount').value) || 0;
        const name = screen.querySelector('#gp-rec-name').value.trim();
        if (!name) { toast('Назови платёж', 'fa-circle-exclamation'); return; }
        if (amount <= 0) { toast('Укажи сумму', 'fa-circle-exclamation'); return; }
        addRecurring({
            name, amount,
            day: parseInt(screen.querySelector('#gp-rec-day').value) || 1,
            category: screen.querySelector('#gp-rec-cat').value,
        });
        render();
        toast('Платёж добавлен', 'fa-check');
    });
    screen.querySelectorAll('[data-pay-rec]').forEach(btn => btn.addEventListener('click', () => {
        payRecurring(btn.getAttribute('data-pay-rec'));
        updatePhoneInjection(); render();
        toast('Оплачено', 'fa-check');
    }));
    screen.querySelectorAll('[data-del-rec]').forEach(btn => btn.addEventListener('click', () => {
        delRecurring(btn.getAttribute('data-del-rec')); render();
    }));
    updateFabBadge();
}

let currentShopCat = null;
const _shopBusy = new Set(); // категории в процессе генерации

function renderShop(screen) {
    currentScreen = 'shop';
    const b = getBank();
    const orders = getOrders();
    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-shop-title">${ic('fa-bag-shopping')} Магазин</div>
            <button class="gp-iconbtn" id="gp-shop-orders" title="Мои заказы">${ic('fa-receipt')}${orders.length ? `<span class="gp-app-badge">${orders.length > 9 ? '9+' : orders.length}</span>` : ''}</button>
        </div>
        <div class="gp-shop-balance">Баланс: <b>${esc(fmtMoney(b.balance))}</b></div>
        <div class="gp-shop-grid">
            ${[...SHOP_CATS, ...getCustomCats()].map(c => `
                <div class="gp-shop-cat" data-cat="${c.id}">
                    <div class="gp-shop-cat-icon">${ic(c.icon)}</div>
                    <div class="gp-shop-cat-name">${esc(c.name)}</div>
                    ${getCategory(c.id) ? `<div class="gp-shop-cat-dot" title="Каталог загружен"></div>` : ''}
                    ${c.custom ? `<button class="gp-shop-cat-del" data-delcat="${c.id}" title="Удалить">${ic('fa-xmark')}</button>` : ''}
                </div>`).join('')}
            <div class="gp-shop-cat gp-shop-cat-add" id="gp-shop-addcat">
                <div class="gp-shop-cat-icon">${ic('fa-plus')}</div>
                <div class="gp-shop-cat-name">Свой магазин</div>
            </div>
        </div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-shop-orders')?.addEventListener('click', () => goto('shoporders'));
    screen.querySelectorAll('.gp-shop-cat[data-cat]').forEach(el => el.addEventListener('click', () => {
        currentShopCat = el.getAttribute('data-cat');
        goto('shopcat');
    }));
    // Своя категория: юзер описывает, какой магазин нужен
    screen.querySelector('#gp-shop-addcat')?.addEventListener('click', () => {
        const name = prompt('Какой магазин нужен? (например: зоомагазин, оружейный, цветы, книжный...)');
        if (!name || !name.trim()) return;
        const cat = addCustomCat(name);
        if (cat) { currentShopCat = cat.id; goto('shopcat'); }
    });
    screen.querySelectorAll('[data-delcat]').forEach(btn => btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Удалить эту категорию?')) { delCustomCat(btn.getAttribute('data-delcat')); render(); }
    }));
}

async function doShopGen(catId) {
    if (_shopBusy.has(catId)) return;
    _shopBusy.add(catId);
    render();
    try {
        await generateCategory(catId, (s) => {
            const el = document.querySelector('[data-shop-status]');
            if (el) el.textContent = s;
        });
    } catch (e) {
        toast(`Не получилось: ${String(e?.message || e).slice(0, 70)}`, 'fa-circle-exclamation');
    } finally {
        _shopBusy.delete(catId);
        render();
    }
}

function renderShopCat(screen) {
    currentScreen = 'shopcat';
    const cat = catById(currentShopCat);
    if (!cat) { goto('shop'); return; }
    const data = getCategory(cat.id);
    const busy = _shopBusy.has(cat.id);
    const b = getBank();

    let body;
    if (busy) {
        body = `<div class="gp-empty"><div class="gp-empty-icon">${ic('fa-spinner fa-spin')}</div><div class="gp-empty-title" data-shop-status>Загружаю каталог...</div><div class="gp-empty-text">Магазины и товары подбираются под твою ролевую</div></div>`;
    } else if (!data || !data.stores?.length) {
        body = `<div class="gp-empty"><div class="gp-empty-icon">${ic(cat.icon)}</div><div class="gp-empty-title">${esc(cat.name)}</div><div class="gp-empty-text">Каталог пуст.<br>Нажми ${ic('fa-wand-magic-sparkles')} — магазины и цены сгенерируются<br>под город/страну твоей ролевой.</div><button class="gp-primary" id="gp-shop-gen" style="margin-top:12px">${ic('fa-wand-magic-sparkles')} Загрузить каталог</button></div>`;
    } else {
        body = data.stores.map(st => `
            <div class="gp-shop-store">
                <div class="gp-shop-store-name">${ic('fa-store')} ${esc(st.name)}</div>
                ${st.items.map(it => `
                    <div class="gp-shop-item">
                        <div class="gp-shop-item-body">
                            <div class="gp-shop-item-name">${esc(it.name)}</div>
                            ${it.desc ? `<div class="gp-shop-item-desc">${esc(it.desc)}</div>` : ''}
                        </div>
                        <div class="gp-shop-item-buy">
                            <span class="gp-shop-item-price">${esc(fmtMoney(it.price))}</span>
                            <button class="gp-shop-buy" data-buy="${esc(st.id)}|${esc(it.id)}">${ic('fa-cart-plus')}</button>
                        </div>
                    </div>`).join('')}
            </div>`).join('');
    }

    setHtmlKeepScroll(screen, '.gp-shop-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-shop-title">${ic(cat.icon)} ${esc(cat.name)}</div>
            ${data && data.stores?.length ? `<button class="gp-iconbtn" id="gp-shop-refresh" title="Обновить каталог" ${busy ? 'disabled' : ''}>${busy ? ic('fa-spinner fa-spin') : ic('fa-rotate')}</button>` : '<span style="width:32px"></span>'}
        </div>
        <div class="gp-shop-balance">Баланс: <b>${esc(fmtMoney(b.balance))}</b></div>
        <div class="gp-shop-scroll">${body}</div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('shop'));
    screen.querySelector('#gp-shop-gen')?.addEventListener('click', () => doShopGen(cat.id));
    screen.querySelector('#gp-shop-refresh')?.addEventListener('click', () => doShopGen(cat.id));
    screen.querySelectorAll('[data-buy]').forEach(btn => btn.addEventListener('click', () => {
        const [storeId, itemId] = btn.getAttribute('data-buy').split('|');
        const order = buyItem(cat.id, storeId, itemId);
        if (order) {
            updatePhoneInjection();
            render();
            toast(`Куплено: ${order.item} — ${fmtMoney(order.price)}`, 'fa-bag-shopping');
        }
    }));
}

function renderShopOrders(screen) {
    currentScreen = 'shoporders';
    const orders = getOrders();
    setHtmlKeepScroll(screen, '.gp-shop-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-shop-title">${ic('fa-receipt')} Мои заказы</div>
            <span style="width:32px"></span>
        </div>
        <div class="gp-shop-scroll">
            ${orders.length === 0
                ? `<div class="gp-empty-text" style="padding:16px 8px">Заказов пока нет</div>`
                : orders.map(o => `
                    <div class="gp-shop-order">
                        <span class="gp-bank-tx-i">${ic((catById(o.cat) || {}).icon || 'fa-bag-shopping')}</span>
                        <span class="gp-bank-tx-body">
                            <span class="gp-bank-tx-label">${esc(o.item)}</span>
                            <span class="gp-bank-tx-cat">${esc(o.store)} · ${esc(timeAgo(o.time))}</span>
                        </span>
                        <span class="gp-bank-tx-amt gp-neg">${esc(fmtMoney(o.price))}</span>
                        <button class="gp-bank-tx-del" data-del-order="${esc(o.id)}" title="Убрать из истории">${ic('fa-xmark')}</button>
                    </div>`).join('')}
        </div>`);
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('shop'));
    screen.querySelectorAll('[data-del-order]').forEach(btn => btn.addEventListener('click', () => {
        deleteOrder(btn.getAttribute('data-del-order')); render();
    }));
}

// ═══ КАЗИНО ═══

let _casinoBet = 100;
let _casinoLast = null;
let _casinoMode = 'slots';
// Сессия казино: копим спины и пишем ИТОГ одной строкой в журнал при выходе
// (каждый спин отдельно — спам в чате; крупный куш логируется сразу)
let _casinoSession = null;

function casinoTrack(bet, win) {
    if (!_casinoSession) _casinoSession = { spins: 0, wagered: 0, won: 0 };
    _casinoSession.spins++;
    _casinoSession.wagered += bet;
    _casinoSession.won += win;
}

function flushCasinoSession() {
    const s = _casinoSession;
    _casinoSession = null;
    if (!s || !s.spins) return;
    const net = s.won - s.wagered;
    const outcome = net > 0 ? `в плюсе на ${fmtMoney(net)}` : net < 0 ? `в минусе на ${fmtMoney(-net)}` : 'вышла в ноль';
    logSocialToChat(`${getUserName()} играла в онлайн-казино с телефона: ставок на ${fmtMoney(s.wagered)} (${s.spins} раунд.), итог — ${outcome}.`);
    applyChatHiding();
}
let _casinoBusy = false;
let _casinoReels = ['fa-gem', 'fa-star', 'fa-crown'];
let _casinoRouletteBet = { type: 'num', number: 17 };
let _casinoWheelRotation = 0;
let _casinoRouletteHistory = [32, 15, 19, 4, 21];

const CASINO_WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const CASINO_RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function casinoNumberColor(n) {
    return n === 0 ? 'green' : (CASINO_RED_NUMBERS.has(n) ? 'red' : 'black');
}

function casinoWheelGradient() {
    const step = 360 / CASINO_WHEEL_ORDER.length;
    return CASINO_WHEEL_ORDER.map((n, i) => {
        const color = n === 0 ? '#23865f' : (CASINO_RED_NUMBERS.has(n) ? '#a93449' : '#1d1a22');
        return `${color} ${i * step}deg ${(i + 1) * step}deg`;
    }).join(',');
}

function casinoWheelNumbers() {
    const step = 360 / CASINO_WHEEL_ORDER.length;
    return CASINO_WHEEL_ORDER.map((n, i) => {
        const angle = i * step;
        return `<span class="gp-casino-wheel-number gp-casino-wheel-number-${casinoNumberColor(n)}" style="transform:rotate(${angle}deg) translateY(-88px) rotate(${-angle}deg)">${n}</span>`;
    }).join('');
}

function casinoNumberGrid() {
    let html = `<button class="gp-casino-number gp-casino-number-green ${_casinoRouletteBet.type === 'num' && _casinoRouletteBet.number === 0 ? 'gp-selected' : ''}" data-casino-number="0">0</button>`;
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 12; col++) {
            const n = col * 3 + (3 - row);
            html += `<button class="gp-casino-number gp-casino-number-${casinoNumberColor(n)} ${_casinoRouletteBet.type === 'num' && _casinoRouletteBet.number === n ? 'gp-selected' : ''}" data-casino-number="${n}">${n}</button>`;
        }
    }
    return html;
}

function renderCasino(screen) {
    currentScreen = 'casino';
    const b = getBank();
    const st = casinoStats();
    const last = _casinoLast;
    const slotResult = last?.kind === 'slots'
        ? (last.win > 0 ? `Выигрыш ${fmtMoney(last.win)}` : 'Комбинация не сыграла')
        : 'Собери три одинаковых символа';
    const rouletteResult = last?.kind === 'roulette'
        ? `Выпало ${last.result} · ${last.win > 0 ? `выигрыш ${fmtMoney(last.win)}` : 'ставка не сыграла'}`
        : 'Выбери ставку и запусти колесо';
    const rouletteBetLabel = _casinoRouletteBet.type === 'num'
        ? `Число ${_casinoRouletteBet.number} · ×36`
        : `${_casinoRouletteBet.type === 'red' ? 'Красное' : 'Чёрное'} · ×2`;

    setHtmlKeepScroll(screen, '.gp-casino-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-casino-title">Игровой зал</div>
            <span style="width:32px"></span>
        </div>
        <div class="gp-casino-balance"><span>Баланс</span><b>${esc(fmtMoney(b.balance))}</b></div>
        <div class="gp-casino-scroll">
            <div class="gp-casino-tabs" role="tablist" aria-label="Игры">
                <button class="gp-casino-tab ${_casinoMode === 'slots' ? 'gp-active' : ''}" data-casino-mode="slots">Слоты</button>
                <button class="gp-casino-tab ${_casinoMode === 'roulette' ? 'gp-active' : ''}" data-casino-mode="roulette">Рулетка</button>
            </div>
            ${_casinoMode === 'slots' ? `
                <section class="gp-casino-game gp-casino-slots">
                    <div class="gp-casino-game-head"><b>Лунный клуб</b><span>3 барабана</span></div>
                    <div class="gp-casino-machine ${_casinoBusy ? 'gp-spinning' : ''}">
                        ${_casinoReels.map((symbol, i) => `<div class="gp-casino-reel"><div class="gp-casino-reel-strip" style="--reel-delay:${i * 90}ms"><span>${ic(symbol)}</span><span>${ic('fa-star')}</span><span>${ic('fa-gem')}</span><span>${ic('fa-crown')}</span></div></div>`).join('')}
                    </div>
                    <div class="gp-casino-paytable"><span><b>×200</b> три короны</span><span><b>×50</b> три камня</span><span><b>×4–20</b> другие тройки</span></div>
                    <div class="gp-casino-quickbets">
                        ${[50, 100, 250].map(v => `<button data-casino-bet="${v}" class="${_casinoBet === v ? 'gp-selected' : ''}">${esc(fmtMoney(v))}</button>`).join('')}
                    </div>
                    <div class="gp-casino-actionrow">
                        <input type="number" id="gp-casino-bet" class="gp-casino-bet" inputmode="numeric" min="1" value="${_casinoBet}" aria-label="Ставка">
                        <button class="gp-casino-spin" id="gp-slots-spin" ${_casinoBusy ? 'disabled' : ''}>Крутить</button>
                    </div>
                    <div class="gp-casino-status ${last?.kind === 'slots' && last.win > 0 ? 'gp-win' : ''}">${esc(slotResult)}</div>
                </section>` : `
                <section class="gp-casino-game gp-casino-roulette">
                    <div class="gp-casino-game-head"><b>Европейская рулетка</b><span>0–36</span></div>
                    <div class="gp-casino-wheel-stage">
                        <span class="gp-casino-pointer" aria-hidden="true"></span>
                        <div class="gp-casino-wheel" id="gp-casino-wheel" style="background:conic-gradient(from -4.865deg,${casinoWheelGradient()});transform:rotate(${_casinoWheelRotation}deg)">
                            ${casinoWheelNumbers()}
                            <span class="gp-casino-wheel-center">${last?.kind === 'roulette' ? last.result : ''}</span>
                        </div>
                    </div>
                    <div class="gp-casino-lastnums">${_casinoRouletteHistory.map(n => `<span class="gp-roulette-${casinoNumberColor(n)}">${n}</span>`).join('')}</div>
                    <div class="gp-casino-colors">
                        <button class="gp-casino-color gp-red ${_casinoRouletteBet.type === 'red' ? 'gp-selected' : ''}" data-roul-select="red">Красное ×2</button>
                        <button class="gp-casino-color gp-black ${_casinoRouletteBet.type === 'black' ? 'gp-selected' : ''}" data-roul-select="black">Чёрное ×2</button>
                    </div>
                    <div class="gp-casino-number-grid">${casinoNumberGrid()}</div>
                    <div class="gp-casino-choice"><span>Ставка</span><b>${rouletteBetLabel}</b></div>
                    <div class="gp-casino-actionrow">
                        <input type="number" id="gp-casino-bet" class="gp-casino-bet" inputmode="numeric" min="1" value="${_casinoBet}" aria-label="Ставка">
                        <button class="gp-casino-spin" id="gp-roulette-spin" ${_casinoBusy ? 'disabled' : ''}>Крутить</button>
                    </div>
                    <div class="gp-casino-status ${last?.kind === 'roulette' && last.win > 0 ? 'gp-win' : ''}">${esc(rouletteResult)}</div>
                </section>`}
            <div class="gp-casino-stats">
                <span>Раундов<b>${st.spins}</b></span>
                <span>Выиграно<b>${esc(fmtMoney(st.won))}</b></span>
                <span>Лучший куш<b>${esc(fmtMoney(st.bestWin))}</b></span>
            </div>
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => { flushCasinoSession(); goto('home'); });
    const betInput = screen.querySelector('#gp-casino-bet');
    betInput?.addEventListener('change', () => { _casinoBet = Math.max(1, parseInt(betInput.value) || 100); });
    const getBet = () => {
        const bet = Math.max(1, parseInt(betInput?.value) || 0);
        if (!canBet(bet)) { toast('Не хватает денег на счету', 'fa-circle-exclamation'); return null; }
        _casinoBet = bet;
        return bet;
    };
    screen.querySelectorAll('[data-casino-mode]').forEach(btn => btn.addEventListener('click', () => {
        if (_casinoBusy) return;
        _casinoMode = btn.getAttribute('data-casino-mode');
        render();
    }));
    screen.querySelectorAll('[data-casino-bet]').forEach(btn => btn.addEventListener('click', () => {
        _casinoBet = parseInt(btn.getAttribute('data-casino-bet')) || 100;
        render();
    }));
    screen.querySelector('#gp-slots-spin')?.addEventListener('click', () => {
        if (_casinoBusy) return;
        const bet = getBet(); if (!bet) return;
        const r = spinSlots(bet); if (!r) return;
        casinoTrack(r.bet, r.win);
        if (r.mult >= 20) {
            logSocialToChat(`${getUserName()} сорвала куш в онлайн-казино: ${fmtMoney(r.win)} одним спином (слоты, ×${r.mult})!`);
            applyChatHiding();
        }
        _casinoBusy = true;
        screen.querySelector('.gp-casino-machine')?.classList.add('gp-spinning');
        screen.querySelector('#gp-slots-spin')?.setAttribute('disabled', '');
        updatePhoneInjection();
        setTimeout(() => {
            _casinoReels = r.reels;
            _casinoLast = { kind: 'slots', ...r };
            _casinoBusy = false;
            if (currentScreen === 'casino') render();
            toast(r.win > 0 ? `Выигрыш ${fmtMoney(r.win)}!` : 'Комбинация не сыграла', r.win > 0 ? 'fa-dice' : 'fa-circle-minus');
        }, 1500);
    });
    screen.querySelectorAll('[data-roul-select]').forEach(btn => btn.addEventListener('click', () => {
        if (_casinoBusy) return;
        _casinoRouletteBet = { type: btn.getAttribute('data-roul-select'), number: null };
        render();
    }));
    screen.querySelectorAll('[data-casino-number]').forEach(btn => btn.addEventListener('click', () => {
        if (_casinoBusy) return;
        _casinoRouletteBet = { type: 'num', number: parseInt(btn.getAttribute('data-casino-number')) };
        render();
    }));
    screen.querySelector('#gp-roulette-spin')?.addEventListener('click', () => {
        if (_casinoBusy) return;
        const bet = getBet(); if (!bet) return;
        const r = spinRoulette(bet, _casinoRouletteBet.type, _casinoRouletteBet.number); if (!r) return;
        casinoTrack(r.bet, r.win);
        if (_casinoRouletteBet.type === 'num' && r.win > 0) {
            logSocialToChat(`${getUserName()} сорвала куш в онлайн-казино: угадала число ${r.result} в рулетке и взяла ${fmtMoney(r.win)} (×36)!`);
            applyChatHiding();
        }
        const wheel = screen.querySelector('#gp-casino-wheel');
        const index = CASINO_WHEEL_ORDER.indexOf(r.result);
        const currentTurns = Math.ceil(_casinoWheelRotation / 360);
        _casinoWheelRotation = (currentTurns + 5) * 360 - index * (360 / CASINO_WHEEL_ORDER.length);
        _casinoBusy = true;
        screen.querySelector('#gp-roulette-spin')?.setAttribute('disabled', '');
        requestAnimationFrame(() => { if (wheel) wheel.style.transform = `rotate(${_casinoWheelRotation}deg)`; });
        updatePhoneInjection();
        setTimeout(() => {
            _casinoRouletteHistory.unshift(r.result);
            _casinoRouletteHistory = _casinoRouletteHistory.slice(0, 5);
            _casinoLast = { kind: 'roulette', ...r };
            _casinoBusy = false;
            if (currentScreen === 'casino') render();
            toast(r.win > 0 ? `Выпало ${r.result} — выигрыш ${fmtMoney(r.win)}!` : `Выпало ${r.result}`, r.win > 0 ? 'fa-dice' : 'fa-circle-dot');
        }, 3300);
    });
}

// ═══ ДИСКОРД ═══
// Лейаут как в настоящем Discord mobile: рейка серверов слева, панель каналов,
// плоские сообщения с аватарками. Свой тёмный скин с блюрплом (это бренд
// приложения, как у твиттера/инсты — темы телефона его не перекрашивают).

let _dServerId = null;
let _dChannelId = null;
let _dBusy = false;

function renderDiscord(screen) {
    currentScreen = 'discord';
    const d = getDiscord();
    if (!_dServerId || !findDServer(_dServerId)) _dServerId = d.servers[0]?.id || null;
    const srv = findDServer(_dServerId);
    const rail = d.servers.map(s => `
        <button class="gp-dc-srv${s.id === _dServerId ? ' gp-active' : ''}" data-dserver="${s.id}" title="${esc(s.name)}" style="${avatarStyle('ds' + s.name)}">${esc(s.name.slice(0, 2).toUpperCase())}</button>`).join('');
    const panel = srv ? `
        <div class="gp-dc-head">
            <b>${esc(srv.name)}</b>
            <button class="gp-dc-leave" data-ddel="${srv.id}" title="Покинуть сервер">${ic('fa-right-from-bracket')}</button>
        </div>
        ${srv.desc ? `<div class="gp-dc-desc">${esc(srv.desc)}</div>` : ''}
        <div class="gp-dc-cat">Текстовые каналы</div>
        ${srv.channels.map(c => `
            <button class="gp-dc-chan" data-dchan="${c.id}">
                <span class="gp-dc-hash">#</span>
                <span class="gp-dc-chan-name">${esc(c.name)}</span>
                ${c.messages.length ? `<span class="gp-dc-chan-count">${c.messages.length}</span>` : ''}
            </button>`).join('')}
        <div class="gp-dc-cat">Участники — ${srv.members.length}</div>
        <div class="gp-dc-members">
            ${srv.members.map(mb => `<span class="gp-dc-member"><i class="gp-dc-dot"></i><b style="color:${senderColor(mb)}">${esc(mb)}</b></span>`).join('')}
        </div>` : `
        <div class="gp-empty">
            <div class="gp-empty-icon">${brand('fa-discord')}</div>
            <div class="gp-empty-text">Нажми «+» — модель придумает серверы,<br>где ты могла бы состоять</div>
        </div>`;
    screen.innerHTML = `
        <div class="gp-dc-skin">
            <div class="gp-dc-rail">
                <button class="gp-dc-home" id="gp-back">${ic('fa-chevron-left')}</button>
                <div class="gp-dc-sep"></div>
                ${rail}
                <button class="gp-dc-srv gp-dc-add" id="gp-d-refresh" title="Найти серверы" ${_dBusy ? 'disabled' : ''}>${ic(_dBusy ? 'fa-spinner fa-spin' : 'fa-plus')}</button>
            </div>
            <div class="gp-dc-panel">${panel}</div>
        </div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-d-refresh')?.addEventListener('click', async () => {
        if (_dBusy) return;
        _dBusy = true;
        render();
        try {
            await refreshDiscordServers();
            toast('Серверы найдены', 'fa-check');
        } catch (e) {
            toast(String(e?.message || e).slice(0, 60), 'fa-circle-exclamation');
        } finally {
            _dBusy = false;
            render();
        }
    });
    screen.querySelectorAll('[data-dserver]').forEach(b => b.addEventListener('click', () => {
        _dServerId = b.getAttribute('data-dserver');
        render();
    }));
    screen.querySelectorAll('[data-dchan]').forEach(b => b.addEventListener('click', () => {
        _dChannelId = b.getAttribute('data-dchan');
        goto('dchannel');
    }));
    screen.querySelectorAll('[data-ddel]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = findDServer(b.getAttribute('data-ddel'));
        if (!s || !confirm(`Выйти с сервера «${s.name}»?`)) return;
        deleteDServer(s.id);
        _dServerId = null;
        render();
    }));
}

function renderDChannel(screen) {
    currentScreen = 'dchannel';
    const s = findDServer(_dServerId);
    const c = findDChannel(_dServerId, _dChannelId);
    if (!s || !c) { goto('discord'); return; }
    const msgs = c.messages.map(mm => `
        <div class="gp-dcmsg">
            <span class="gp-dcmsg-ava" style="${avatarStyle(mm.user ? 'user' + mm.author : mm.author)}">${esc(String(mm.author).slice(0, 1).toUpperCase())}</span>
            <div class="gp-dcmsg-body">
                <b style="color:${mm.user ? 'var(--dc-blurple-light)' : senderColor(mm.author)}">${esc(mm.author)}</b>
                <span>${esc(mm.text)}</span>
            </div>
        </div>`).join('');
    setHtmlKeepScroll(screen, '.gp-dcmsg-scroll', `
        <div class="gp-dc-skin gp-dc-skin-chat">
            <div class="gp-dc-chathead">
                <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
                <span class="gp-dc-hash">#</span>
                <div class="gp-dc-chathead-title">
                    <b>${esc(c.name)}</b>
                    <span>${esc(s.name)}</span>
                </div>
                <button class="gp-iconbtn" id="gp-dc-refresh" ${_dBusy ? 'disabled' : ''}>${ic(_dBusy ? 'fa-spinner fa-spin' : 'fa-rotate-right')}</button>
            </div>
            <div class="gp-dcmsg-scroll" id="gp-dmsg-scroll">
                ${msgs || `<div class="gp-dc-welcome"><span class="gp-dc-hash-big">#</span><b>Добро пожаловать в #${esc(c.name)}!</b><span>${esc(c.topic || 'Начало канала.')}</span><span class="gp-dc-welcome-hint">Нажми ↻ — канал оживёт, или напиши первой</span></div>`}
                ${_dBusy ? `<div class="gp-dcmsg gp-dmsg-typing"><span></span><span></span><span></span></div>` : ''}
            </div>
            <div class="gp-dc-inputwrap">
                <textarea id="gp-d-input" rows="1" placeholder="Написать в #${esc(c.name)}"></textarea>
                <button class="gp-dc-send" id="gp-d-send" ${_dBusy ? 'disabled' : ''}>${ic('fa-paper-plane')}</button>
            </div>
        </div>`);
    const scroll = screen.querySelector('#gp-dmsg-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('discord'));
    const dRun = async (fn) => {
        if (_dBusy) return;
        _dBusy = true;
        render();
        try {
            await fn();
        } catch (e) {
            toast(String(e?.message || e).slice(0, 60), 'fa-circle-exclamation');
        } finally {
            _dBusy = false;
            applyChatHiding(); // журнальные строки — с глаз долой
            render();
        }
    };
    screen.querySelector('#gp-dc-refresh')?.addEventListener('click', () => dRun(() => refreshDChannel(s.id, c.id)));
    const input = screen.querySelector('#gp-d-input');
    const send = () => {
        const v = (input?.value || '').trim();
        if (!v) return;
        input.value = '';
        dRun(() => postToDChannel(s.id, c.id, v));
    };
    screen.querySelector('#gp-d-send')?.addEventListener('click', send);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
}

// ═══ ТВИЧ ═══
// Фирменный скин (тёмный + фиолетовый #9146ff), карточки эфиров с превью,
// чат твич-строками «ник: текст», донат-алерты поверх кадра.

let _twStreamId = null;
let _twBusy = false;
let _twAlert = null;      // текущий донат-алерт {from, amount, text}
let _twAlertQueue = [];
let _twAlertTimer = null;

function showTwAlert(alert) {
    _twAlertQueue.push(alert);
    if (!_twAlert) _nextTwAlert();
}
function _nextTwAlert() {
    clearTimeout(_twAlertTimer);
    _twAlert = _twAlertQueue.shift() || null;
    if (isPhoneOpen() && (currentScreen === 'stream' || currentScreen === 'mystream')) render();
    if (_twAlert) _twAlertTimer = setTimeout(_nextTwAlert, 4500);
}

// Кадр стрима: рисуем по описанию сцены через картинко-пайплайн (свой стиль/рефы)
async function drawStreamFrame(target, streamer, isMine) {
    if (!_imgGenReady) {
        const ready = await isImageGenAvailable();
        if (!ready) return; // нет картинко-расширения — живём на текстовой сцене
        _imgGenReady = true;
    }
    try {
        const src = await generatePostImage({
            imgDesc: target.scene,
            author: isMine ? getUserName() : streamer,
            ak: isMine ? 'user' : `contact:${keyOf(streamer)}`,
            kind: 'ig',
            stream: true, // рефы: частичный матч имени с карточкой + аватар контакта
            framing: isMine
                ? (getSettings().imgPromptTwMy || 'live webcam stream frame, streamer facecam view, stream overlay vibe')
                : (getSettings().imgPromptTwWatch || 'livestream video frame, what the stream camera shows, stream overlay vibe'),
        });
        target.image = src;
        target.imgTs = Date.now();
        saveMeta();
    } catch (e) {
        console.warn('[GlassPhone] stream frame gen failed:', e);
    }
}

function twAlertHtml() {
    if (!_twAlert) return '';
    return `
        <div class="gp-twch-alert">
            <span class="gp-twch-alert-icon">${ic('fa-coins')}</span>
            <div class="gp-twch-alert-body">
                <b>${esc(_twAlert.from)} — ${esc(fmtMoney(_twAlert.amount))}</b>
                ${_twAlert.text ? `<span>${esc(_twAlert.text)}</span>` : ''}
            </div>
        </div>`;
}

function twFrameHtml(target) {
    const inner = target.image
        ? `<img src="${esc(target.image)}${target.imgTs ? `?t=${target.imgTs}` : ''}" alt="">`
        : `<div class="gp-twch-frame-gen" style="${avatarStyle('stream' + (target.title || ''))}">${ic('fa-video')}</div>`;
    return `
        <div class="gp-twch-frame">
            ${inner}
            <span class="gp-twch-live-tag">LIVE</span>
            ${_twBusy ? `<div class="gp-twch-frame-busy">${ic('fa-spinner fa-spin')}</div>` : ''}
            ${twAlertHtml()}
        </div>`;
}

function twChatHtml(chat) {
    return chat.map(mm => {
        if (mm.don) {
            return `
            <div class="gp-twch-don">
                <b>${ic('fa-coins')} ${esc(mm.author)} — ${esc(fmtMoney(mm.don))}</b>
                ${mm.text ? `<span>${esc(mm.text)}</span>` : ''}
            </div>`;
        }
        return `
            <div class="gp-twch-line${mm.host ? ' gp-twch-line-host' : ''}">
                <b style="color:${mm.user ? 'var(--twch-purple-light)' : senderColor(mm.author)}">${mm.host ? ic('fa-tower-broadcast') + ' ' : ''}${esc(mm.author)}</b><span class="gp-twch-colon">:</span>
                <span>${esc(mm.text)}</span>
            </div>`;
    }).join('');
}

function renderTwitch(screen) {
    currentScreen = 'twitch';
    const t = getTwitch();
    const cards = t.streams.map(s => `
        <div class="gp-twch-card" data-stream="${s.id}">
            <div class="gp-twch-thumb" style="${avatarStyle('stream' + s.title)}">
                ${s.image ? `<img src="${esc(s.image)}" alt="">` : ic('fa-play')}
                <span class="gp-twch-live-tag">LIVE</span>
                <span class="gp-twch-viewers">${ic('fa-user')} ${s.viewers}</span>
            </div>
            <div class="gp-twch-meta">
                <span class="gp-twch-ava" style="${avatarStyle(s.streamer)}">${esc(s.streamer.slice(0, 1).toUpperCase())}</span>
                <div class="gp-twch-meta-text">
                    <b>${esc(s.title)}</b>
                    <span>${esc(s.streamer)}</span>
                    <i>${esc(s.category)}</i>
                </div>
            </div>
        </div>`).join('');
    screen.innerHTML = `
        <div class="gp-twch-skin">
            <div class="gp-twch-head">
                <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
                <b>${brand('fa-twitch')} Twitch</b>
                <button class="gp-iconbtn" id="gp-twch-refresh" ${_twBusy ? 'disabled' : ''}>${ic(_twBusy ? 'fa-spinner fa-spin' : 'fa-rotate-right')}</button>
            </div>
            <div class="gp-twch-scroll">
                <button class="gp-twch-golive" id="gp-golive">${ic('fa-tower-broadcast')} ${getTwitch().myStream ? 'Ты в эфире — открыть' : 'Начать свой стрим'}</button>
                ${cards || `<div class="gp-empty"><div class="gp-empty-icon">${brand('fa-twitch')}</div><div class="gp-empty-text">Нажми ↻ — модель придумает,<br>кто сейчас в эфире</div></div>`}
            </div>
        </div>`;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-twch-refresh')?.addEventListener('click', async () => {
        if (_twBusy) return;
        _twBusy = true;
        render();
        try {
            await refreshStreams();
        } catch (e) {
            toast(String(e?.message || e).slice(0, 60), 'fa-circle-exclamation');
        } finally {
            _twBusy = false;
            render();
        }
    });
    screen.querySelectorAll('[data-stream]').forEach(b => b.addEventListener('click', () => {
        _twStreamId = b.getAttribute('data-stream');
        goto('stream');
        const s = findStream(_twStreamId);
        if (s && !s.image && s.scene) drawStreamFrame(s, s.streamer, false).then(() => { if (currentScreen === 'stream') render(); });
    }));
    screen.querySelector('#gp-golive')?.addEventListener('click', () => {
        if (getTwitch().myStream) { goto('mystream'); return; }
        const title = prompt('Название стрима:', '');
        if (title === null || !title.trim()) return;
        const cat = prompt('Категория (IRL / игра / музыка...):', 'IRL') || 'IRL';
        startMyStream(title.trim(), cat.trim());
        goto('mystream');
        // первый тик: зрители заходят
        _twRun(() => tickMyStream(null), true);
    });
}

// Обёртка тиков твича: busy-стейт, донат-алерты, авто-перерисовка кадра
async function _twRun(fn, mine = false) {
    if (_twBusy) return;
    _twBusy = true;
    render();
    try {
        const res = await fn();
        const sceneChanged = mine ? !!res?.sceneChanged : !!res;
        for (const a of (mine ? res?.alerts || [] : [])) showTwAlert(a);
        const target = mine ? getTwitch().myStream : findStream(_twStreamId);
        // Кадр перерисовывается сам, когда сцена изменилась (визуальная новелла)
        if (target && target.scene && (sceneChanged || !target.image)) {
            await drawStreamFrame(target, mine ? getUserName() : target.streamer, mine);
        }
    } catch (e) {
        toast(String(e?.message || e).slice(0, 60), 'fa-circle-exclamation');
    } finally {
        _twBusy = false;
        applyChatHiding(); // журнальные строки — с глаз долой
        render();
    }
}

function renderStream(screen) {
    currentScreen = 'stream';
    const s = findStream(_twStreamId);
    if (!s) { goto('twitch'); return; }
    setHtmlKeepScroll(screen, '.gp-twch-chat', `
        <div class="gp-twch-skin gp-twch-skin-live">
            <div class="gp-twch-head">
                <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
                <div class="gp-twch-head-title">
                    <b>${esc(s.streamer)}</b>
                    <span>${esc(s.title)}</span>
                </div>
                <span class="gp-twch-eye">${ic('fa-user')} ${s.viewers}</span>
            </div>
            ${twFrameHtml(s)}
            <div class="gp-twch-info"><span class="gp-twch-cat">${esc(s.category)}</span></div>
            ${s.scene ? `<div class="gp-twch-scene">${esc(s.scene)}</div>` : ''}
            <div class="gp-twch-chat" id="gp-twch-chat">
                ${twChatHtml(s.chat) || `<div class="gp-twch-chat-empty">Чат подгрузится с первым событием</div>`}
            </div>
            <div class="gp-twch-inputbar">
                <button class="gp-twch-tool" id="gp-st-tick" title="Что дальше?" ${_twBusy ? 'disabled' : ''}>${ic(_twBusy ? 'fa-spinner fa-spin' : 'fa-forward')}</button>
                <button class="gp-twch-tool gp-twch-donbtn" id="gp-st-don" title="Донат" ${_twBusy ? 'disabled' : ''}>${ic('fa-coins')}</button>
                <textarea id="gp-st-input" rows="1" placeholder="Отправить сообщение"></textarea>
                <button class="gp-twch-send" id="gp-st-send" ${_twBusy ? 'disabled' : ''}>${ic('fa-paper-plane')}</button>
            </div>
        </div>`);
    const chatEl = screen.querySelector('#gp-twch-chat');
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('twitch'));
    screen.querySelector('#gp-st-tick')?.addEventListener('click', () => _twRun(() => tickStream(s.id, null)));
    const input = screen.querySelector('#gp-st-input');
    screen.querySelector('#gp-st-don')?.addEventListener('click', () => {
        const amtRaw = prompt(`Сумма доната для ${s.streamer}:`, '100');
        if (amtRaw === null) return;
        const amount = Math.round(parseFloat(String(amtRaw).replace(',', '.')) || 0);
        if (amount <= 0) { toast('Сумма доната должна быть больше нуля', 'fa-circle-exclamation'); return; }
        const text = (input?.value || '').trim() || (prompt('Сообщение к донату (можно пусто):', '') || '').trim();
        if (input) input.value = '';
        showTwAlert({ from: getUserName(), amount, text });
        _twRun(() => donateToStream(s.id, amount, text));
    });
    const send = () => {
        const v = (input?.value || '').trim();
        if (!v) return;
        input.value = '';
        _twRun(() => tickStream(s.id, v));
    };
    screen.querySelector('#gp-st-send')?.addEventListener('click', send);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
}

function renderMyStream(screen) {
    currentScreen = 'mystream';
    const my = getTwitch().myStream;
    if (!my) { goto('twitch'); return; }
    setHtmlKeepScroll(screen, '.gp-twch-chat', `
        <div class="gp-twch-skin gp-twch-skin-live">
            <div class="gp-twch-head">
                <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
                <div class="gp-twch-head-title">
                    <b>${esc(my.title)}</b>
                    <span>${esc(my.category)}${my.donTotal ? ` · донаты ${esc(fmtMoney(my.donTotal))}` : ''}</span>
                </div>
                <span class="gp-twch-eye">${ic('fa-user')} ${my.viewers}</span>
                <button class="gp-twch-endbtn" id="gp-st-end" title="Завершить стрим">${ic('fa-stop')}</button>
            </div>
            ${twFrameHtml(my)}
            ${my.scene ? `<div class="gp-twch-scene">${esc(my.scene)}</div>` : ''}
            <div class="gp-twch-chat" id="gp-twch-chat">
                ${twChatHtml(my.chat) || `<div class="gp-twch-chat-empty">Зрители заходят...</div>`}
            </div>
            <div class="gp-twch-inputbar">
                <button class="gp-twch-tool" id="gp-st-tick" title="Пауза: чат живёт сам" ${_twBusy ? 'disabled' : ''}>${ic(_twBusy ? 'fa-spinner fa-spin' : 'fa-forward')}</button>
                <textarea id="gp-st-input" rows="1" placeholder="Что говоришь / делаешь в кадре..."></textarea>
                <button class="gp-twch-send" id="gp-st-send" ${_twBusy ? 'disabled' : ''}>${ic('fa-paper-plane')}</button>
            </div>
        </div>`);
    const chatEl = screen.querySelector('#gp-twch-chat');
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('twitch'));
    screen.querySelector('#gp-st-end')?.addEventListener('click', () => {
        if (!confirm('Завершить стрим? Итог уйдёт в историю.')) return;
        endMyStream();
        applyChatHiding();
        goto('twitch');
    });
    screen.querySelector('#gp-st-tick')?.addEventListener('click', () => _twRun(() => tickMyStream(null), true));
    const input = screen.querySelector('#gp-st-input');
    const send = () => {
        const v = (input?.value || '').trim();
        if (!v) return;
        input.value = '';
        _twRun(() => tickMyStream(v), true);
    };
    screen.querySelector('#gp-st-send')?.addEventListener('click', send);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
}

// ═══ НОВОСТИ ═══

let _newsBusy = false;
function renderNews(screen) {
    currentScreen = 'news';
    const n = getNews();
    setHtmlKeepScroll(screen, '.gp-news-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-news-title">Новости</div>
            <button class="gp-iconbtn" id="gp-news-refresh" ${_newsBusy ? 'disabled' : ''}>${_newsBusy ? ic('fa-spinner fa-spin') : ic('fa-rotate')}</button>
        </div>
        <div class="gp-news-scroll">
            ${n.items.length === 0
                ? `<div class="gp-empty"><div class="gp-empty-icon">${ic('fa-newspaper')}</div><div class="gp-empty-title">Лента пуста</div><div class="gp-empty-text">Нажми ${ic('fa-rotate')} — новости города и мира<br>сгенерируются под твою ролевую</div></div>`
                : n.items.map(it => `
                <article class="gp-news-card">
                    <div class="gp-news-meta"><span class="gp-news-tag">${esc(it.tag)}</span><span class="gp-tw-time">${esc(timeAgo(it.time))}</span>
                        <button class="gp-bank-tx-del" data-del-news="${esc(it.id)}" title="Удалить">${ic('fa-xmark')}</button></div>
                    <b>${esc(it.title)}</b>
                    <p>${esc(it.text)}</p>
                    <button class="gp-news-share" data-share-news="${esc(it.id)}" title="Ролевая узнает, что ты это прочитала">${ic('fa-share')} Обсудить в ролевой</button>
                </article>`).join('')}
        </div>`);
    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-news-refresh')?.addEventListener('click', async () => {
        if (_newsBusy) return;
        _newsBusy = true; render();
        try {
            const added = await refreshNews();
            toast(`Новостей: +${added}`, 'fa-newspaper');
        } catch (e) {
            toast(String(e?.message || e).slice(0, 70), 'fa-circle-exclamation');
        } finally {
            _newsBusy = false;
            if (currentScreen === 'news') render();
        }
    });
    screen.querySelectorAll('[data-share-news]').forEach(btn => btn.addEventListener('click', () => {
        if (shareNews(btn.getAttribute('data-share-news'))) {
            applyChatHiding();
            toast('Ушло в ролевую — персонажи могут отреагировать', 'fa-share');
        }
    }));
    screen.querySelectorAll('[data-del-news]').forEach(btn => btn.addEventListener('click', () => {
        deleteNews(btn.getAttribute('data-del-news')); render();
    }));
}

// ═══ ЗАМЕТКИ ═══

let _noteEditId = null;
function renderNotes(screen) {
    currentScreen = 'notes';
    const notes = getNotes();
    const editing = _noteEditId ? notes.find(n => n.id === _noteEditId) : null;
    setHtmlKeepScroll(screen, '.gp-notes-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-notes-title">Заметки</div>
            <span style="width:32px"></span>
        </div>
        <div class="gp-notes-scroll">
            <div class="gp-notes-editor">
                <textarea id="gp-note-text" rows="3" placeholder="Новая заметка..."></textarea>
                <button class="gp-primary" id="gp-note-save">${editing ? 'Сохранить' : 'Добавить'}</button>
                ${editing ? `<button class="gp-secondary gp-unequip" id="gp-note-cancel">Отменить правку</button>` : ''}
            </div>
            ${notes.length === 0 ? `<div class="gp-empty-text" style="padding:12px 6px">Заметок пока нет. Секретные видишь только ты; с глазом — фоновое знание для нарратора.</div>`
                : notes.map(n => `
                <div class="gp-note${n.shared ? ' gp-note-shared' : ''}">
                    <div class="gp-note-text" data-edit-note="${esc(n.id)}" title="Нажми, чтобы отредактировать">${esc(n.text)}</div>
                    <div class="gp-note-meta">
                        <span class="gp-tw-time">${esc(timeAgo(n.time))}${n.shared ? ' · видна модели' : ' · секретная'}</span>
                        <button class="gp-iconbtn gp-note-eye${n.shared ? ' gp-btn-on' : ''}" data-share-note="${esc(n.id)}" title="${n.shared ? 'Сделать секретной' : 'Показать модели (фоново)'}">${ic(n.shared ? 'fa-eye' : 'fa-eye-slash')}</button>
                        <button class="gp-bank-tx-del" data-del-note="${esc(n.id)}" title="Удалить">${ic('fa-xmark')}</button>
                    </div>
                </div>`).join('')}
        </div>`);
    const area = screen.querySelector('#gp-note-text');
    if (editing && area) area.value = editing.text;
    screen.querySelector('#gp-back')?.addEventListener('click', () => { _noteEditId = null; goto('home'); });
    screen.querySelector('#gp-note-save')?.addEventListener('click', () => {
        const text = area?.value.trim();
        if (!text) return;
        if (_noteEditId) { updateNote(_noteEditId, text); _noteEditId = null; }
        else addNote(text);
        updatePhoneInjection();
        render();
    });
    screen.querySelector('#gp-note-cancel')?.addEventListener('click', () => { _noteEditId = null; render(); });
    screen.querySelectorAll('[data-edit-note]').forEach(el => el.addEventListener('click', () => {
        _noteEditId = el.getAttribute('data-edit-note'); render();
    }));
    screen.querySelectorAll('[data-share-note]').forEach(btn => btn.addEventListener('click', () => {
        toggleNoteShared(btn.getAttribute('data-share-note'));
        updatePhoneInjection();
        render();
    }));
    screen.querySelectorAll('[data-del-note]').forEach(btn => btn.addEventListener('click', () => {
        if (confirm('Удалить заметку?')) {
            const id = btn.getAttribute('data-del-note');
            deleteNote(id);
            if (_noteEditId === id) _noteEditId = null;
            updatePhoneInjection();
            render();
        }
    }));
}

// ═══ СКАМ-СМС: доставка призраком ═══

export function deliverScamSms(sms) {
    if (!sms || !sms.from || !sms.text) return;
    const mesText = `<!--tel:sms:${JSON.stringify({ from: sms.from, text: sms.text })}-->`;
    insertGhostReply(sms.from, mesText);
    setTimeout(() => {
        checkNewIncoming();
        updateFabBadge();
        applyChatHiding();
        if (isPhoneOpen()) render();
    }, 300);
}


// ═══ Удаление отдельного SMS из чата ═══
// SMS = HTML-коммент внутри сообщения чата. Вырезаем конкретный тег,
// а если сообщение стало пустым — удаляем само сообщение.

function deleteSmsFromChat(msg) {
    try {
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat;
        if (!chat || !chat[msg.idx]) return;
        const chatMsg = chat[msg.idx];
        let text = chatMsg.mes;

        if (msg.dir === 'out') {
            // Юзерское сообщение: вырезаем tel:out тег + видимую часть [СМС → ...]
            text = text.replace(/<!--\s*tel:out:\{[\s\S]*?\}\s*-->\s*/i, '');
            text = text.replace(/\[СМС\s*→\s*[^\]]+\]\s*[\s\S]*/i, '');
        } else {
            // Позиция тега получена парсером до декодирования JSON, поэтому
            // кавычки, переносы и одинаковые тексты не мешают точному удалению.
            if (Number.isInteger(msg.tagStart) && Number.isInteger(msg.tagEnd)) {
                text = text.slice(0, msg.tagStart) + text.slice(msg.tagEnd);
            } else {
                // Совместимость с объектом сообщения, открытым до обновления.
                const tags = [...text.matchAll(/<!--\s*tel:sms:(\{[\s\S]*?\})\s*-->/gi)];
                const hit = tags.find(x => {
                    try {
                        const j = JSON.parse(x[1]);
                        return String(j.from || '') === String(msg.from || '') && String(j.text || '') === String(msg.text || '');
                    } catch (e) { return false; }
                });
                if (hit) text = text.slice(0, hit.index) + text.slice(hit.index + hit[0].length);
            }
        }

        text = text.trim();
        // Если после удаления тега сообщение стало пустым (или осталось \u003c5 видимых символов) — удаляем сообщение
        const visible = text.replace(/<!--[\s\S]*?-->/g, '').trim();
        if (visible.length < 5) {
            // Удаляем сообщение из чата
            if (typeof ctx.deleteMessageByIndex === 'function') {
                ctx.deleteMessageByIndex(msg.idx, false);
            } else {
                chat.splice(msg.idx, 1);
                if (typeof ctx.saveChat === 'function') ctx.saveChat();
            }
        } else {
            // Обновляем текст сообщения
            chatMsg.mes = text;
            if (typeof ctx.saveChat === 'function') ctx.saveChat();
        }
    } catch (e) {
        console.error('[GlassPhone] deleteSmsFromChat failed:', e);
        toast('Не удалось удалить', 'fa-circle-exclamation');
    }
}

// ═══ Отправка смс ═══

// «Призрак»: вставка ответа в чат БЕЗ генерации через основной пайплайн —
// is_system:true на 1.5с, чтобы ExtBlocks/JS Runner не триггерились,
// потом флаг снимается и сообщение живёт в контексте модели как обычное.
async function insertGhostReply(name, mesText) {
    const ctx = SillyTavern.getContext();
    const chat = ctx?.chat;
    if (!chat || !mesText || !mesText.trim()) return;
    const replyMsg = {
        name: name,
        is_user: false,
        is_system: true,
        send_date: Date.now(),
        mes: mesText.trim(),
        extra: { isSmsSilent: true },
    };
    chat.push(replyMsg);
    if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    if (typeof ctx.printMessages === 'function') ctx.printMessages();
    setTimeout(async () => {
        replyMsg.is_system = false;
        const mesIdx = chat.indexOf(replyMsg);
        if (mesIdx >= 0) {
            const mesEl = document.querySelector(`.mes[mesid="${mesIdx}"]`);
            if (mesEl) mesEl.setAttribute('is_system', 'false');
        }
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    }, 1500);
}

async function doSend(key) {
    if (sending) return;
    const input = document.getElementById('gp-input');
    const text = (input?.value || '').trim();
    if (!text && !_smsDraftImage) return;
    const t = getThread(key);
    const name = t ? t.name : key;
    const isGroup = !!t?.isGroup;
    const draftImg = _smsDraftImage;
    _smsDraftImage = null;
    const asVoice = _smsDraftVoice && !!text; // голосовое без расшифровки не бывает
    _smsDraftVoice = false;

    sending = true;
    if (input) input.value = '';

    // Сообщение чата: скрытый маркер + видимый текст (модель и без инжекции поймёт формат)
    const markerBase = isGroup ? { to: `группа:${name}` } : { to: name };
    if (asVoice) markerBase.voice = true;
    const marker = `<!--tel:out:${JSON.stringify(markerBase)}-->`;
    // Видимый формат по языку интерфейса ([SMS → X] на англ); сканер понимает оба
    const en = lang() === 'en';
    const kindTok = asVoice ? (en ? 'Voice' : 'Голосовое') : (en ? 'SMS' : 'СМС');
    const visible = isGroup
        ? (en ? `[${kindTok} to chat «${name}»]` : `[${kindTok} в чат «${name}»]`)
        : `[${kindTok} → ${name}]`;
    const photoTok = en ? '*photo*' : '*фото*';
    const mes = `${marker}\n${visible} ${draftImg ? photoTok + ' ' : ''}${text}`;

    try {
        await sendMessageAsUser(mes);

        // Приложенное фото. Порядок:
        //  1) файл + img в маркер → рендер: МИНИАТЮРА СРАЗУ
        //  2) ОДИН vision-запрос: описание + ответ собеседника (экономия: картинка
        //     в API один раз; описание → в mes «*фото: ...*», ответ → призраком)
        let photoHandled = false;
        if (draftImg) {
            try {
                const ctx0 = SillyTavern.getContext();
                const lastMsg = ctx0?.chat?.[ctx0.chat.length - 1];
                if (lastMsg && lastMsg.is_user) {
                    let src = draftImg;
                    try {
                        const base64 = draftImg.replace(/^data:image\/[a-z]+;base64,/i, '');
                        src = await saveBase64AsFile(base64, 'glassphone', `sms_${Date.now()}`, 'jpeg');
                    } catch (e) {
                        console.warn('[GlassPhone] saveBase64AsFile failed, keeping dataURL:', e);
                    }
                    // extra.image в ST 1.18 — deprecated-сеттер, молча ГЛОТАЕТ запись;
                    // пишем через attachImageToMessage (в extra.media, если обёртка стоит)
                    attachImageToMessage(lastMsg, src);

                    // Надёжный путь миниатюры: img в маркере tel:out (mes переживает всё)
                    const markerJson = JSON.stringify({ ...markerBase, img: src });
                    lastMsg.mes = lastMsg.mes.replace(/<!--\s*tel:out:\{[\s\S]*?\}\s*-->/, `<!--tel:out:${markerJson}-->`);
                    await saveChatConditional();

                    // Миниатюра на экране НЕМЕДЛЕННО, до вижна
                    applyChatHiding();
                    typingKey = key;
                    render();

                    // Комбо: описание + ответ одним запросом
                    const combo = await generateSmsPhotoReply({
                        contactName: name, isGroup, members: t?.members || [],
                        userText: text, image: draftImg,
                    });
                    if (combo) {
                        if (combo.desc) {
                            lastMsg.mes = lastMsg.mes.replace(photoTok, `${photoTok.slice(0, -1)}: ${combo.desc}*`);
                            await saveChatConditional();
                        }
                        const botMes = combo.replies.length
                            ? combo.replies.map(r => `<!--tel:sms:${JSON.stringify(isGroup
                                ? { from: r.from, chat: name, text: r.text }
                                : { from: name, text: r.text })}-->`).join('\n')
                            : '<!--tel:silent-->';
                        await insertGhostReply(name, botMes);
                        photoHandled = true;
                    } else {
                        console.warn('[GlassPhone] комбо-запрос не удался — ответ пойдёт через тихий путь без описания');
                    }
                }
            } catch (e) {
                console.warn('[GlassPhone] attach image failed:', e);
            }
        }
        if (photoHandled) return; // finally всё приберёт

        applyChatHiding(); // спрятать свою смс из ленты сразу
        typingKey = key;
        render(); // своя смс уже видна (она в чате), плюс «печатает…»

        updatePhoneInjection();

        // Генерируем ответ «тихо» — generateQuietPrompt не триггерит JS Runner,
        // Extra блоки и другие скрипты. Результат вставляем призраком.
        const ctx = SillyTavern.getContext();
        const msgKind = asVoice ? 'VOICE message (they hear her voice; this is the transcript)' : 'message';
        const quietPrompt = isGroup
            ? `Continue the roleplay. The group chat «${name}» (members: ${(t.members || []).join(', ')}) just received this ${msgKind} from ${ctx?.name1 || 'User'}: "${text}"${draftImg ? ' (with a photo attached)' : ''}. Reply as the group members — ONLY hidden tel:sms tags with the "chat" field (RULE 3 — PHONE-ONLY MODE), one tag per message, several members may text. No visible prose.`
            : `Continue the roleplay. ${name} just received this ${asVoice ? msgKind : 'SMS'} from ${ctx?.name1 || 'User'}: "${text}"${draftImg ? ' (with a photo attached)' : ''}. Reply in-character with ONLY hidden tel:sms tags (RULE 3 — PHONE-ONLY MODE). No visible prose.`;
        const rawReply = await generateQuietPrompt(quietPrompt, false, false);
        if (rawReply && rawReply.trim()) {
            await insertGhostReply(name, rawReply.trim());
        }
    } catch (e) {
        console.error('[GlassPhone] send failed:', e);
        toast('Не удалось отправить', 'fa-circle-exclamation');
    } finally {
        sending = false;
        typingKey = null;
        render();
        updateFabBadge();
        applyChatHiding();
    }
}

// Индикатор «печатает» из внешних событий (регены/свайпы в основном чате)
export function setTyping(key) {
    typingKey = key;
    if (isPhoneOpen() && currentScreen === 'thread') render();
}

// ═══ Тосты и детект новых входящих ═══

export function toast(text, icon = 'fa-comment-dots', threadKey = null) {
    text = tr(text); // перевод тостов (точный словарь + regex-правила)
    const el = document.createElement('div');
    el.className = 'gp-toast';
    // Бренд-иконки (twitter/instagram) — семейство fa-brands, остальные fa-solid
    const fam = /^fa-(x-twitter|twitter|instagram)$/.test(icon) ? 'fa-brands' : 'fa-solid';
    el.innerHTML = `<span class="gp-toast-icon"><i class="${fam} ${icon}"></i></span><span class="gp-toast-text">${esc(text)}</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('gp-toast-show'));
    if (threadKey) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
            openPhone(threadKey);
            el.remove();
        });
    }
    setTimeout(() => {
        el.classList.remove('gp-toast-show');
        setTimeout(() => el.remove(), 400);
    }, 4200);
}

// Сравниваем количество входящих по тредам с прошлым замером — новые → тост.
export function checkNewIncoming({ silent = false } = {}) {
    const list = getThreadList();
    const fresh = new Map();
    for (const t of list) {
        fresh.set(t.key, t.messages.filter(m => m.dir === 'in').length);
    }
    if (!silent) {
        for (const [key, count] of fresh) {
            const prev = prevIncomingCounts.get(key) ?? count; // новый тред без замера — не спамим
            if (count > prev) {
                const t = list.find(x => x.key === key);
                const lastIn = [...t.messages].reverse().find(m => m.dir === 'in');
                const isViewing = isPhoneOpen() && currentScreen === 'thread' && currentThreadKey === key;
                if (!isViewing && lastIn) {
                    toast(`${t.name}: ${lastIn.text.slice(0, 70)}`, 'fa-comment-dots', key);
                }
            }
        }
    }
    prevIncomingCounts = fresh;
    updateFabBadge();
    if (isPhoneOpen()) render();
}

export function resetIncomingCounters() {
    prevIncomingCounts = new Map();
    checkNewIncoming({ silent: true });
}

// ═══ Инициализация ═══

export function initUI() {
    createFab();
    createPhone();
    createWandButton();
    // Wand-меню может создаваться позже нашего init — доб. отложенные попытки
    setTimeout(createWandButton, 2000);
    setTimeout(createWandButton, 6000);
    updateFabBadge();
}

// Консольные хелперы
if (typeof window !== 'undefined') {
    window.glassPhoneOpen = () => openPhone();
}
