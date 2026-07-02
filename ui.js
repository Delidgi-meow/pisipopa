// ═══════════════════════════════════════════
// GLASSPHONE UI — кнопка, телефон, экраны, тосты
// Стиль: liquid glass / glassmorphism, иконки FontAwesome, никаких эмодзи.
// ═══════════════════════════════════════════

import { sendMessageAsUser, Generate, saveSettingsDebounced } from '../../../../script.js';
import {
    getSettings, getThreadList, getThread, markRead, addManualContact, hideContact,
    randomNumber, getTotalUnread, fmtTime, getRpDateLabel, keyOf, getHiddenMessageIndexes,
} from './state.js';
import { updatePhoneInjection } from './prompts.js';

// ── Локальное UI-состояние (не персистится) ──
let currentScreen = 'list';     // 'list' | 'thread' | 'add'
let currentThreadKey = null;
let typingKey = null;           // тред, в котором «печатает…»
let sending = false;
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

// ═══ FAB ═══

function createFab() {
    if (document.getElementById('gp-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'gp-fab';
    fab.innerHTML = `${ic('fa-mobile-screen-button')}<span id="gp-fab-badge" class="gp-hidden"></span>`;
    document.body.appendChild(fab);

    const s = getSettings();
    if (s.fabPos && typeof s.fabPos.right === 'number') {
        fab.style.right = `${s.fabPos.right}px`;
        fab.style.bottom = `${s.fabPos.bottom}px`;
    }
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

export function updateFabBadge() {
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
                </span>
            </div>
            <div id="gp-screen"></div>
            <div class="gp-homebar"></div>
        </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('pointerdown', (e) => {
        if (e.target === ov) closePhone();
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
    else renderList(screen);
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
            <div class="gp-avatar" style="${avatarStyle(t.name)}">${initialOf(t.name)}</div>
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

    screen.innerHTML = `
        <div class="gp-header">
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
        </div>`;

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
    for (const m of t.messages) {
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
            <div class="gp-bubble">${esc(m.text)}</div>
            ${tm ? `<div class="gp-bubble-time">${esc(tm)}</div>` : ''}
        </div>`;
    }

    const typing = typingKey === t.key
        ? `<div class="gp-bubble-wrap gp-in gp-typing-wrap"><div class="gp-bubble gp-typing"><span></span><span></span><span></span></div></div>`
        : '';

    screen.innerHTML = `
        <div class="gp-header gp-thread-header">
            <button class="gp-iconbtn" id="gp-back">${ic('fa-chevron-left')}</button>
            <div class="gp-avatar gp-avatar-sm" style="${avatarStyle(t.name)}">${initialOf(t.name)}</div>
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

        const ctx = SillyTavern.getContext();
        updatePhoneInjection();
        if (ctx.groupId && typeof ctx.executeSlashCommandsWithOptions === 'function') {
            await ctx.executeSlashCommandsWithOptions('/trigger');
        } else {
            await Generate('normal');
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
    el.innerHTML = `<span class="gp-toast-icon">${ic(icon)}</span><span class="gp-toast-text">${esc(text)}</span>`;
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
    updateFabBadge();
}

// Консольные хелперы
if (typeof window !== 'undefined') {
    window.glassPhoneOpen = () => openPhone();
}
