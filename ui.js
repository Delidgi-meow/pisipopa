// ═══════════════════════════════════════════
// GLASSPHONE UI — кнопка, телефон, экраны, тосты
// Стиль: liquid glass / glassmorphism, иконки FontAwesome, никаких эмодзи.
// ═══════════════════════════════════════════

import { sendMessageAsUser, Generate, generateQuietPrompt, saveSettingsDebounced } from '../../../../script.js';
import {
    getSettings, getThreadList, getThread, markRead, addManualContact, hideContact,
    randomNumber, getTotalUnread, fmtTime, getRpDateLabel, keyOf, getHiddenMessageIndexes,
} from './state.js';
import { updatePhoneInjection } from './prompts.js';
import {
    getTweets, getIgPosts, postTweet, likeTweet, rtTweet, delTweet, addTweetReply, delTweetReply,
    postIg, likeIg, delIg, addIgComment, delIgComment,
    generateTweetFeed, generateTweetComments, generateAuthorReply, generateIgFeed, generateIgComments,
    compressImage, setContactAvatar, getContactAvatar, avatarForAuthor,
    timeAgo, makeHandle, getUserName, generatePostImage, isImageGenAvailable,
} from './social.js';

// ── Локальное UI-состояние (не персистится) ──
let currentScreen = 'home';     // 'home' | 'list' | 'thread' | 'add' | 'tw' | 'twthread' | 'ig' | 'igview' | 'ignew'
let currentThreadKey = null;
let currentTweetId = null;
let currentPostId = null;
let typingKey = null;           // тред, в котором «печатает…»
let sending = false;
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

function createFab() {
    if (document.getElementById('gp-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'gp-fab';
    fab.innerHTML = `${ic('fa-mobile-screen-button')}<span id="gp-fab-badge" class="gp-hidden"></span>`;
    document.body.appendChild(fab);

    // Позиция: сохранённая (после перетаскивания) ВСЕГДА зажимается в границы
    // ТЕКУЩЕГО вьюпорта. Иначе позиция, сохранённая на широком мониторе
    // (например right: 800px), на телефоне уносит кнопку за экран — «иконки нет».
    const applyFabPos = () => {
        const st = getSettings();
        if (!st.fabPos || typeof st.fabPos.right !== 'number') return; // CSS-дефолт
        const maxR = Math.max(4, window.innerWidth - 44);
        const maxB = Math.max(4, window.innerHeight - 44);
        fab.style.right = `${Math.min(Math.max(4, st.fabPos.right), maxR)}px`;
        fab.style.bottom = `${Math.min(Math.max(4, st.fabPos.bottom), maxB)}px`;
    };
    applyFabPos();
    window.addEventListener('resize', applyFabPos);
    window.addEventListener('orientationchange', () => setTimeout(applyFabPos, 200));

    const s = getSettings();
    if (!s.showFab || !s.isEnabled) fab.classList.add('gp-hidden');

    // Drag + click
    let startX = 0, startY = 0, startRight = 0, startBottom = 0, dragged = false, down = false;
    const onMove = (e) => {
        if (!down) return;
        const x = e.touches ? e.touches[0].clientX : e.clientX;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        if (Math.abs(x - startX) + Math.abs(y - startY) > 6) dragged = true;
        if (!dragged) return;
        const r = Math.max(4, Math.min(window.innerWidth - 60, startRight - (x - startX)));
        const b = Math.max(4, Math.min(window.innerHeight - 60, startBottom - (y - startY)));
        fab.style.right = `${r}px`;
        fab.style.bottom = `${b}px`;
    };
    const onUp = () => {
        if (!down) return;
        down = false;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (dragged) {
            const st = getSettings();
            st.fabPos = { right: parseInt(fab.style.right) || 20, bottom: parseInt(fab.style.bottom) || 180 };
            saveSettingsDebounced();
        } else {
            togglePhone();
        }
    };
    fab.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        down = true; dragged = false;
        startX = e.clientX; startY = e.clientY;
        const rect = fab.getBoundingClientRect();
        startRight = window.innerWidth - rect.right;
        startBottom = window.innerHeight - rect.bottom;
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
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

export function updateFabBadge() {
    // Самовосстановление: если FAB пропал из DOM (чужой скрипт/перестройка) — пересоздаём
    if (!document.getElementById('gp-fab')) {
        try { createFab(); } catch (e) { /* ignore */ }
    }
    const n = getTotalUnread();
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

export function isPhoneOpen() {
    return document.getElementById('gp-overlay')?.classList.contains('gp-open') || false;
}

export function openPhone(threadKey = null) {
    createPhone();
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
    const el = document.getElementById('gp-clock');
    if (el) {
        const d = new Date();
        el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const rp = document.getElementById('gp-rpdate');
    if (rp) {
        const label = getRpDateLabel();
        rp.textContent = label || '';
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
    const d = new Date();
    const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    screen.innerHTML = `
        <div class="gp-home">
            <div class="gp-home-clock">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</div>
            <div class="gp-home-date">${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}</div>
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
        const preview = t.last
            ? `${t.last.dir === 'out' ? '<span class="gp-prev-you">Ты:</span> ' : ''}${esc(t.last.text.slice(0, 60))}`
            : '<span class="gp-prev-empty">Нет сообщений — напиши первой</span>';
        const time = t.last && t.last.time ? fmtTime(t.last.time) : '';
        rows += `
        <div class="gp-row" data-key="${esc(t.key)}">
            ${avatarHtml(t.name, getContactAvatar(t.key))}
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
        bubbles += `
        <div class="gp-bubble-wrap ${m.dir === 'out' ? 'gp-out' : 'gp-in'}">
            <div class="gp-bubble">${esc(m.text)}<button class="gp-sms-del" data-smsdel="${mi}" title="Удалить">${ic('fa-xmark')}</button></div>
            ${tm ? `<div class="gp-bubble-time">${esc(tm)}</div>` : ''}
        </div>`;
    }

    const typing = typingKey === t.key
        ? `<div class="gp-bubble-wrap gp-in gp-typing-wrap"><div class="gp-bubble gp-typing"><span></span><span></span><span></span></div></div>`
        : '';

    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <span id="gp-ava-btn" title="Клик — загрузить фото контакта" style="cursor:pointer">${avatarHtml(t.name, getContactAvatar(t.key), 'gp-avatar gp-avatar-sm')}</span>
            <input type="file" id="gp-ava-file" accept="image/*" style="display:none">
            <div class="gp-thread-title">
                <div class="gp-row-name">${esc(t.name)}</div>
                <div class="gp-thread-number">${esc(t.number || 'номер неизвестен')}</div>
            </div>
            <button class="gp-iconbtn gp-danger" id="gp-del" title="Удалить контакт">${ic('fa-trash-can')}</button>
        </div>
        <div class="gp-msgs" id="gp-msgs">
            ${bubbles || `<div class="gp-empty gp-empty-thread"><div class="gp-empty-icon">${ic('fa-message')}</div><div class="gp-empty-text">Начни переписку — сообщение попадёт<br>прямо в ролевую</div></div>`}
            ${typing}
        </div>
        <div class="gp-inputbar">
            ${t.messages.length > 0 && t.messages[t.messages.length - 1].dir === 'in'
                ? `<button class="gp-iconbtn gp-regen" id="gp-regen" title="Другой ответ" ${sending ? 'disabled' : ''}>${ic('fa-rotate-right')}</button>` : ''}
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
    screen.querySelector('#gp-del')?.addEventListener('click', () => {
        if (!confirm(`Удалить контакт «${t.name}» из телефона?\n(Сообщения в самом чате останутся.)`)) return;
        hideContact(t.key);
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
            <button class="gp-primary" id="gp-add-save">${ic('fa-check')} Сохранить</button>
            <div class="gp-add-hint">Имя должно совпадать с именем персонажа в чате — тогда его смс попадут в этот тред.</div>
        </div>`;

    screen.querySelector('#gp-back')?.addEventListener('click', () => {
        currentScreen = 'list';
        render();
    });
    screen.querySelector('#gp-add-save')?.addEventListener('click', () => {
        const name = screen.querySelector('#gp-add-name')?.value.trim();
        let number = screen.querySelector('#gp-add-number')?.value.trim();
        if (!name) { toast('Укажи имя контакта', 'fa-circle-exclamation'); return; }
        if (!number) number = randomNumber();
        addManualContact(name, number);
        updatePhoneInjection();
        currentScreen = 'thread';
        currentThreadKey = keyOf(name);
        render();
    });
    screen.querySelector('#gp-add-name')?.focus();
}

// ═══ TWITTER ═══

function twCard(t, { clickable = true } = {}) {
    const isUser = t.ak === 'user';
    const replyCount = t.replies?.length || 0;
    return `
    <div class="gp-tw-card${clickable ? ' gp-clickable' : ''}" data-tweet="${esc(t.id)}">
        ${avatarHtml(t.author, avatarForAuthor(t.ak), 'gp-avatar gp-avatar-sm')}
        <div class="gp-tw-body">
            <div class="gp-tw-meta">
                <span class="gp-tw-name">${esc(t.author)}</span>
                <span class="gp-tw-handle">${esc(t.handle || makeHandle(t.author))}</span>
                <span class="gp-tw-time">· ${esc(timeAgo(t.time))}</span>
                ${isUser ? `<button class="gp-tw-del" data-del="${esc(t.id)}" title="Удалить">${ic('fa-xmark')}</button>` : ''}
            </div>
            <div class="gp-tw-text">${esc(t.text)}</div>
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
    const doPost = () => {
        const v = input?.value.trim();
        if (!v) return;
        postTweet(v);
        updatePhoneInjection(); // персонажи «видят» твит юзера
        render();
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
                            <div class="gp-tw-meta"><span class="gp-tw-name">${esc(r.author)}</span><span class="gp-tw-handle">${esc(r.handle || makeHandle(r.author))}</span><span class="gp-tw-time">· ${esc(timeAgo(r.time))}</span><button class="gp-reply-del" data-del-reply="${esc(r.id)}" title="Удалить">${ic('fa-xmark')}</button></div>
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
            const n = await generateTweetComments(t);
            if (!n) toast('Не получилось — попробуй ещё раз', 'fa-circle-exclamation');
        } catch (e) {
            console.error('[GlassPhone] tw comments failed:', e);
            toast('Ошибка генерации', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'twthread') render();
        }
    });

    const input = screen.querySelector('#gp-input');
    const doReply = async () => {
        const v = input?.value.trim();
        if (!v || sending) return;
        addTweetReply(t.id, v);
        input.value = '';
        render();
        if (canAuthorReply) {
            sending = true;
            try { await generateAuthorReply('tw', t, v); }
            catch (e) { console.error('[GlassPhone] author reply failed:', e); }
            finally { sending = false; if (currentScreen === 'twthread') render(); }
        }
    };
    screen.querySelector('#gp-tw-reply')?.addEventListener('click', doReply);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doReply(); } });
}

// ═══ INSTAGRAM ═══

// Посты, для которых прямо сейчас генерится картинка (спиннер)
const _imgGenBusy = new Set();
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
    return `
    <div class="gp-ig-card" data-post="${esc(p.id)}">
        <div class="gp-ig-head">
            ${avatarHtml(p.author, avatarForAuthor(p.ak), 'gp-avatar gp-avatar-xs')}
            <span class="gp-ig-name">${esc(p.author)}</span>
            <span class="gp-tw-time">· ${esc(timeAgo(p.time))}</span>
            ${isUser ? `<button class="gp-tw-del" data-del-ig="${esc(p.id)}" title="Удалить">${ic('fa-xmark')}</button>` : ''}
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
        const post = getIgPosts().find(x => x.id === id);
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

    setHtmlKeepScroll(screen, '.gp-feed', `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-title gp-title-app">Пост</div>
            <button class="gp-iconbtn" id="gp-ig-comments" title="Сгенерировать реакции" ${genBusy ? 'disabled' : ''}>${genBusy ? ic('fa-spinner fa-spin') : ic('fa-comments')}</button>
        </div>
        <div class="gp-feed">
            ${igCard(p, { clickable: false })}
            <div class="gp-replies">
                ${comments.length === 0
                    ? `<div class="gp-empty-text gp-replies-empty">Комментариев нет — нажми ${ic('fa-comments')}, пусть отреагируют</div>`
                    : comments.map(c => `
                    <div class="gp-reply">
                        ${avatarHtml(c.author, avatarForAuthor(c.ak), 'gp-avatar gp-avatar-xs')}
                        <div class="gp-reply-body">
                            <div class="gp-tw-meta"><span class="gp-tw-name">${esc(c.author)}</span><span class="gp-tw-time">· ${esc(timeAgo(c.time))}</span><button class="gp-reply-del" data-del-igcomment="${esc(c.id)}" title="Удалить">${ic('fa-xmark')}</button></div>
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
            const n = await generateIgComments(p);
            if (!n) toast('Не получилось — попробуй ещё раз', 'fa-circle-exclamation');
        } catch (e) {
            console.error('[GlassPhone] ig comments failed:', e);
            toast('Ошибка генерации', 'fa-circle-exclamation');
        } finally {
            genBusy = false;
            if (currentScreen === 'igview') render();
        }
    });

    const input = screen.querySelector('#gp-input');
    const doComment = async () => {
        const v = input?.value.trim();
        if (!v || sending) return;
        addIgComment(p.id, v);
        input.value = '';
        render();
        if (canAuthorReply) {
            sending = true;
            try { await generateAuthorReply('ig', p, v); }
            catch (e) { console.error('[GlassPhone] ig author reply failed:', e); }
            finally { sending = false; if (currentScreen === 'igview') render(); }
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

        // Авто-реакции: комменты генерятся сразу после публикации
        if (!genBusy) {
            genBusy = true;
            render();
            try {
                await generateIgComments(post);
            } catch (e) {
                console.error('[GlassPhone] auto-comments failed:', e);
            } finally {
                genBusy = false;
                if (currentScreen === 'igview') render();
            }
        }
    });
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

async function doSend(key) {
    if (sending) return;
    const input = document.getElementById('gp-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    const t = getThread(key);
    const name = t ? t.name : key;

    sending = true;
    if (input) input.value = '';

    // Сообщение чата: скрытый маркер + видимый текст (модель и без инжекции поймёт формат)
    const mes = `<!--tel:out:${JSON.stringify({ to: name })}-->\n[СМС → ${name}] ${text}`;

    try {
        await sendMessageAsUser(mes);
        applyChatHiding(); // спрятать свою смс из ленты сразу
        typingKey = key;
        render(); // своя смс уже видна (она в чате), плюс «печатает…»

        updatePhoneInjection();

        // Генерируем ответ «тихо» — generateQuietPrompt не триггерит JS Runner,
        // Extra блоки и другие скрипты. Результат вставляем в чат вручную.
        const ctx = SillyTavern.getContext();
        const quietPrompt = `Continue the roleplay. ${name} just received this SMS from ${ctx?.name1 || 'User'}: "${text}". Reply in-character with ONLY hidden tel:sms tags (RULE 3 — PHONE-ONLY MODE). No visible prose.`;
        const rawReply = await generateQuietPrompt(quietPrompt, false, false);

        if (rawReply && rawReply.trim()) {
            // Трюк с призраком: вставляем is_system:true → ExtBlocks/JS Runner
            // пропускают сообщение (их хэндлеры проверяют is_system). Через секунду
            // снимаем призрака → сообщение остаётся в контексте модели.
            const chat = ctx?.chat;
            if (chat) {
                const replyMsg = {
                    name: name,
                    is_user: false,
                    is_system: true, // призрак — расширения не триггерятся
                    send_date: Date.now(),
                    mes: rawReply.trim(),
                    extra: { isSmsSilent: true },
                };
                chat.push(replyMsg);
                if (typeof ctx.saveChat === 'function') await ctx.saveChat();
                // Подтолкнуть UI ST к обновлению
                if (typeof ctx.printMessages === 'function') {
                    ctx.printMessages();
                }
                // Снимаем призрака — сообщение попадёт в контекст модели при следующей генерации
                setTimeout(async () => {
                    replyMsg.is_system = false;
                    // Обновляем DOM: убираем призрака с элемента сообщения
                    const mesIdx = chat.indexOf(replyMsg);
                    if (mesIdx >= 0) {
                        const mesEl = document.querySelector(`.mes[mesid="${mesIdx}"]`);
                        if (mesEl) {
                            mesEl.setAttribute('is_system', 'false');
                        }
                    }
                    if (typeof ctx.saveChat === 'function') await ctx.saveChat();
                }, 1500);
            }
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
