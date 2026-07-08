// ═══════════════════════════════════════════
// ТЕЛЕФОН — UI: кнопка, корпус, экраны (смс/твиттер/инста/OF), тосты
// Стиль: liquid glass, иконки FontAwesome, без эмодзи.
// ═══════════════════════════════════════════

import { sendMessageAsUser, Generate, generateQuietPrompt, saveSettingsDebounced, saveChatConditional } from '../../../../script.js';
import { saveBase64AsFile } from '../../../utils.js';
import {
    getSettings, getThreadList, getThread, markRead, addManualContact, hideContact,
    randomNumber, getTotalUnread, fmtTime, getRpDateTime, keyOf, getHiddenMessageIndexes,
    addGroup, delGroup, attachImageToMessage, renameContact, banAccount,
} from './state.js';
import { updatePhoneInjection } from './prompts.js';
import {
    getBank, fmtMoney, addTransaction, deleteTransaction, takeLoan, payLoanInstallment, deleteLoan,
    totalDebt, monthlyLoanPayment, addRecurring, delRecurring, payRecurring, monthlyObligations,
    getBankReminders, spendingByCategory, incomeExpenseTotals, bankBadgeCount, setCurrency,
} from './bank.js';
import {
    getTweets, getIgPosts, postTweet, likeTweet, rtTweet, delTweet, addTweetReply, delTweetReply,
    postIg, likeIg, delIg, addIgComment, delIgComment,
    getOfPosts, postOf, likeOf, delOf, addOfComment, delOfComment, generateOfComments, getSocial,
    withdrawOf, setOfWallet,
    generateTweetFeed, generateTweetComments, generateAuthorReply, generateReplyToComment, generateIgFeed, generateIgComments,
    compressImage, setContactAvatar, getContactAvatar, avatarForAuthor,
    timeAgo, makeHandle, getUserName, generatePostImage, isImageGenAvailable,
    handleFor, setContactHandle, describePostImage, generateSmsPhotoReply, logSocialToChat,
} from './social.js';

// ── Локальное UI-состояние (не персистится) ──
let currentScreen = 'home';     // + 'of' | 'ofnew' | 'ofview'
let currentThreadKey = null;
let currentTweetId = null;
let currentPostId = null;
let typingKey = null;           // тред, в котором «печатает…»
let sending = false;
let _smsDraftImage = null;      // фото, приложенное к смс (dataURL до отправки)
let genBusy = false;            // идёт генерация ленты/комментов
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
function initialOf(name) {
    const t = String(name || '?').trim();
    return esc(t.charAt(0).toUpperCase() || '?');
}

// Аватар: фото если загружено, иначе градиент с инициалом
function avatarHtml(name, avatarUrl, cls = 'gp-avatar') {
    if (avatarUrl) {
        return `<div class="${cls} gp-avatar-img"><img src="${esc(avatarUrl)}" alt=""></div>`;
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
        for (const { rec, overdue } of getBankReminders()) {
            const key = rec.id + ':' + ym;
            if (_bankReminded.has(key)) continue;
            _bankReminded.add(key);
            toast(`${overdue ? 'Просрочен платёж' : 'Пора оплатить'}: ${rec.name} — ${fmtMoney(rec.amount)}`, 'fa-file-invoice-dollar');
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
const SKINS = ['indigo', 'rose', 'emerald', 'mono'];
export function applySkin() {
    const ph = document.getElementById('gp-phone');
    if (ph) {
        SKINS.forEach(sk => ph.classList.remove(`gp-skin-${sk}`));
        const skin = getSettings().skin || 'indigo';
        if (skin !== 'indigo') ph.classList.add(`gp-skin-${skin}`);
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
    else if (currentScreen === 'of') renderOf(screen);
    else if (currentScreen === 'ofview' && currentPostId) renderOfView(screen);
    else if (currentScreen === 'ofnew') renderOfNew(screen);
    else if (currentScreen === 'bank') renderBank(screen);
    else if (currentScreen === 'banktx') renderBankTx(screen);
    else if (currentScreen === 'bankloan') renderBankLoan(screen);
    else if (currentScreen === 'bankrec') renderBankRec(screen);
    else renderHome(screen);
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

// ── Домашний экран ──
function renderHome(screen) {
    currentScreen = 'home';
    const unread = getTotalUnread();
    const rpDt = getRpDateTime();
    const d = new Date();
    const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

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
                <div class="gp-app" data-app="of">
                    <div class="gp-app-icon gp-app-of">${ic('fa-heart')}</div>
                    <div class="gp-app-name">OnlyFans</div>
                </div>
                <div class="gp-app" data-app="bank">
                    <div class="gp-app-icon gp-app-bank">${ic('fa-building-columns')}${bankBadgeCount() > 0 ? `<span class="gp-app-badge">${bankBadgeCount()}</span>` : ''}</div>
                    <div class="gp-app-name">Банк</div>
                </div>
            </div>
        </div>`;

    screen.querySelectorAll('.gp-app').forEach(el => {
        el.addEventListener('click', () => goto(el.getAttribute('data-app')));
    });
}

// ── Экран «Сообщения» ──
function renderList(screen) {
    currentScreen = 'list';
    const list = getThreadList();

    let rows = '';
    for (const t of list) {
        const lastText = t.last ? (t.last.text || (t.last.img || t.last.photoDesc ? 'Фото' : '')) : '';
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
                const now = new Date();
                const isToday = now.getFullYear() === m.time.getFullYear() && now.getMonth() === m.time.getMonth() && now.getDate() === m.time.getDate();
                const label = isToday ? 'Сегодня' : `${String(m.time.getDate()).padStart(2, '0')}.${String(m.time.getMonth() + 1).padStart(2, '0')}`;
                bubbles += `<div class="gp-day"><span>${label}</span></div>`;
            }
        }
        const tm = m.time ? fmtTime(m.time) : '';
        // Фото в смс: реальное (юзер приложила) или заглушка с описанием (ММС от персонажа)
        let media = '';
        if (m.img) {
            media = `<div class="gp-bubble-img"><img src="${esc(m.img)}" alt=""></div>`;
        } else if (m.photoDesc) {
            media = `<div class="gp-bubble-img gp-bubble-img-gen" style="${avatarStyle((m.from || t.name) + m.photoDesc)}"><span>${ic('fa-image')}</span><i>${esc(m.photoDesc)}</i></div>`;
        }
        // В группе подписываем отправителя входящих
        const senderLabel = t.isGroup && m.dir === 'in' && m.from
            ? `<div class="gp-bubble-sender">${esc(m.from)}</div>` : '';
        bubbles += `
        <div class="gp-bubble-wrap ${m.dir === 'out' ? 'gp-out' : 'gp-in'}">
            <div class="gp-bubble">${senderLabel}${media}${esc(m.text)}<button class="gp-sms-del" data-smsdel="${mi}" title="Удалить">${ic('fa-xmark')}</button></div>
            ${tm ? `<div class="gp-bubble-time">${esc(tm)}</div>` : ''}
        </div>`;
    }

    const typing = typingKey === t.key
        ? `<div class="gp-bubble-wrap gp-in gp-typing-wrap"><div class="gp-bubble gp-typing"><span></span><span></span><span></span></div></div>`
        : '';

    const headerAva = t.isGroup
        ? `<div class="gp-avatar gp-avatar-sm gp-avatar-group">${ic('fa-users')}</div>`
        : `<span id="gp-ava-btn" title="Клик — загрузить фото контакта" style="cursor:pointer">${avatarHtml(t.name, getContactAvatar(t.key), 'gp-avatar gp-avatar-sm')}</span>`;
    const subLine = t.isGroup
        ? (t.members?.length ? t.members.join(', ') : 'групповой чат')
        : `${t.number || 'номер неизвестен'} · ${handleFor(`contact:${t.key}`, t.name)}`;

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
            <textarea id="gp-input" rows="1" placeholder="Сообщение..."></textarea>
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
        </div>
    </div>`;
}

function bindTwCardActions(root, rerender) {
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
            <button class="gp-iconbtn" id="gp-tw-gen" title="Обновить ленту" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-wand-magic-sparkles')}</button>
        </div>
        <div class="gp-tw-compose">
            ${avatarHtml(getUserName(), '', 'gp-avatar gp-avatar-sm')}
            <input type="text" id="gp-tw-input" maxlength="280" placeholder="Что происходит?">
            <button class="gp-send gp-send-sm" id="gp-tw-post" disabled>${ic('fa-feather')}</button>
        </div>
        <div class="gp-feed" id="gp-tw-feed">
            ${tweets.length === 0
                ? `<div class="gp-empty"><div class="gp-empty-icon">${brand('fa-x-twitter')}</div><div class="gp-empty-title">Лента пуста</div><div class="gp-empty-text">Нажми ${ic('fa-wand-magic-sparkles')} — лента сгенерируется<br>по событиям твоей ролевой</div></div>`
                : tweets.map(t => twCard(t)).join('')}
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));

    const input = screen.querySelector('#gp-tw-input');
    const postBtn = screen.querySelector('#gp-tw-post');
    input?.addEventListener('input', () => { postBtn.disabled = !input.value.trim(); });
    const doPost = async () => {
        const v = input?.value.trim();
        if (!v || genBusy) return;
        postTweet(v);
        logSocialToChat(`${getUserName()} опубликовала твит: «${v}»`); // в историю чата (память/саммарайз)
        updatePhoneInjection(); // персонажи «видят» твит юзера
        
        genBusy = true;
        render();
        try {
            const n = await generateTweetFeed();
            toast(n > 0 ? `Новых твитов: ${n}` : 'Отправлено', n > 0 ? 'fa-x-twitter' : 'fa-check');
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
                        ${avatarHtml(r.author, avatarForAuthor(r.ak), 'gp-avatar gp-avatar-xs')}
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
            const cparts = added.filter(r => typeof r.ak === 'string' && r.ak.startsWith('contact:'))
                .map(r => `${r.author}: «${String(r.text).slice(0, 90)}»`);
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

// Журнал веток: новые реплики под постом/тредом юзера → одной скрытой строкой в чат.
// Реплики знакомых персонажей — дословно (сюжетно значимы), рандомы — счётчиком.
function logNewReplies(kindLabel, postText, arr, beforeLen) {
    const added = (arr || []).slice(beforeLen).filter(r => r.ak !== 'user');
    if (!added.length) return;
    const contacts = added.filter(r => typeof r.ak === 'string' && r.ak.startsWith('contact:'));
    const randomCount = added.length - contacts.length;
    let line = `под её ${kindLabel}${postText ? ` («${String(postText).slice(0, 80)}»)` : ''}`;
    // Комменты знакомых персонажей — ПОЛНЫМ текстом (сюжетно значимы, модель
    // должна видеть их целиком; сам коммент уже ограничен 300 симв. при создании).
    const parts = contacts.map(c => `${c.author}: «${String(c.text).trim()}»`);
    if (parts.length) line += ` прокомментировали: ${parts.join('; ')}`;
    if (randomCount > 0) line += `${parts.length ? ', и' : ''} +${randomCount} реакций от других аккаунтов`;
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
    </div>`;
}

function bindIgCardActions(root) {
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
            <button class="gp-iconbtn" id="gp-ig-new" title="Новый пост">${ic('fa-plus')}</button>
            <button class="gp-iconbtn" id="gp-ig-gen" title="Обновить ленту" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-wand-magic-sparkles')}</button>
        </div>
        <div class="gp-feed" id="gp-ig-feed">
            ${posts.length === 0
                ? `<div class="gp-empty"><div class="gp-empty-icon">${brand('fa-instagram')}</div><div class="gp-empty-title">Лента пуста</div><div class="gp-empty-text">${ic('fa-wand-magic-sparkles')} — сгенерировать ленту<br>${ic('fa-plus')} — выложить своё фото</div></div>`
                : posts.map(p => igCard(p)).join('')}
        </div>`);

    screen.querySelector('#gp-back')?.addEventListener('click', () => goto('home'));
    screen.querySelector('#gp-ig-new')?.addEventListener('click', () => goto('ignew'));
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
                        ${avatarHtml(c.author, avatarForAuthor(c.ak), 'gp-avatar gp-avatar-xs')}
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
            const cparts = added.filter(c => typeof c.ak === 'string' && c.ak.startsWith('contact:'))
                .map(c => `${c.author}: «${String(c.text).slice(0, 90)}»`);
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

// ═══════════════════════════════════════════
// БАНК
// ═══════════════════════════════════════════

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
            ${reminders.map(r => `<span class="gp-bank-remind-item${r.overdue ? ' gp-overdue' : ''}">${esc(r.rec.name)} — ${esc(fmtMoney(r.rec.amount))}</span>`).join('')}
        </div>` : '';

    setHtmlKeepScroll(screen, '.gp-bank-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-bank-title">${ic('fa-building-columns')} Банк</div>
            <button class="gp-iconbtn" id="gp-bank-cur" title="Валюта">${esc(b.currency)}</button>
        </div>
        <div class="gp-bank-scroll">
            <div class="gp-bank-card ${b.balance < 0 ? 'gp-bank-neg' : ''}">
                <div class="gp-bank-card-label">Баланс</div>
                <div class="gp-bank-balance" id="gp-bank-balance">${esc(fmtMoney(b.balance))}</div>
                <div class="gp-bank-io">
                    <span class="gp-bank-in">${ic('fa-arrow-down')} ${esc(fmtMoney(income))}</span>
                    <span class="gp-bank-out">${ic('fa-arrow-up')} ${esc(fmtMoney(expense))}</span>
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
        if (cur && cur.trim()) { setCurrency(cur.trim()); render(); }
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
            <div class="gp-title gp-title-app gp-bank-title">${ic('fa-landmark')} Кредиты</div>
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
                    </div>
                    <div class="gp-add-hint" id="gp-loan-preview"></div>
                    <button class="gp-primary" id="gp-loan-take">${ic('fa-money-bill-wave')} Оформить</button>
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
                                ${l.paidOff ? `<span class="gp-pos">Погашен</span>` : `Осталось <b>${esc(fmtMoney(l.remaining))}</b> · платёж ${esc(fmtMoney(l.monthly))}/мес`}
                            </div>
                            ${l.paidOff ? '' : `<button class="gp-bank-pay" data-pay-loan="${esc(l.id)}">${ic('fa-check')} Внести ${esc(fmtMoney(Math.min(l.remaining, l.monthly)))}</button>`}
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
        });
        updatePhoneInjection();
        goto('bank');
        toast('Кредит оформлен — деньги на счету', 'fa-money-bill-wave');
    });
    screen.querySelectorAll('[data-pay-loan]').forEach(btn => btn.addEventListener('click', () => {
        payLoanInstallment(btn.getAttribute('data-pay-loan'));
        updatePhoneInjection(); render();
    }));
    screen.querySelectorAll('[data-del-loan]').forEach(btn => btn.addEventListener('click', () => {
        if (confirm('Удалить кредит из списка? (баланс не изменится)')) { deleteLoan(btn.getAttribute('data-del-loan')); render(); }
    }));
}

function renderBankRec(screen) {
    currentScreen = 'bankrec';
    const b = getBank();
    const rem = getBankReminders().map(r => r.rec.id);
    setHtmlKeepScroll(screen, '.gp-bank-scroll', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app gp-bank-title">${ic('fa-file-invoice-dollar')} Обязательные платежи</div>
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
                            <button class="gp-bank-pay gp-bank-pay-sm" data-pay-rec="${esc(r.id)}" title="Оплатить">${ic('fa-check')}</button>
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
            // Входящее: вырезаем конкретный tel:sms тег, содержащий этот текст
            const escapedText = msg.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60);
            const tagRe = new RegExp(`<!--\\s*tel:sms:\\{[\\s\\S]*?${escapedText}[\\s\\S]*?\\}\\s*-->\\s*`, 'i');
            text = text.replace(tagRe, '');
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

    sending = true;
    if (input) input.value = '';

    // Сообщение чата: скрытый маркер + видимый текст (модель и без инжекции поймёт формат)
    const marker = isGroup
        ? `<!--tel:out:${JSON.stringify({ to: `группа:${name}` })}-->`
        : `<!--tel:out:${JSON.stringify({ to: name })}-->`;
    const visible = isGroup ? `[СМС в чат «${name}»]` : `[СМС → ${name}]`;
    const mes = `${marker}\n${visible} ${draftImg ? '*фото* ' : ''}${text}`;

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
                    const markerJson = JSON.stringify(isGroup ? { to: `группа:${name}`, img: src } : { to: name, img: src });
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
                            lastMsg.mes = lastMsg.mes.replace('*фото*', `*фото: ${combo.desc}*`);
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
        const quietPrompt = isGroup
            ? `Continue the roleplay. The group chat «${name}» (members: ${(t.members || []).join(', ')}) just received this message from ${ctx?.name1 || 'User'}: "${text}"${draftImg ? ' (with a photo attached)' : ''}. Reply as the group members — ONLY hidden tel:sms tags with the "chat" field (RULE 3 — PHONE-ONLY MODE), one tag per message, several members may text. No visible prose.`
            : `Continue the roleplay. ${name} just received this SMS from ${ctx?.name1 || 'User'}: "${text}"${draftImg ? ' (with a photo attached)' : ''}. Reply in-character with ONLY hidden tel:sms tags (RULE 3 — PHONE-ONLY MODE). No visible prose.`;
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
