// ═══════════════════════════════════════════
// ТЕЛЕФОН — STATE: контакты, треды, теги, per-chat данные
//
// АРХИТЕКТУРА: чат SillyTavern = ЕДИНСТВЕННЫЙ источник правды.
// СМС и контакты живут прямо в сообщениях чата в виде скрытых HTML-комментариев,
// телефон — просто красивое представление поверх них. Поэтому синхронизация
// чат ↔ телефон абсолютна by design: удалила/свайпнула/отредактировала сообщение
// в чате → телефон пересобрался; написала из телефона → это настоящее сообщение чата.
//
// Теги (внутри HTML-комментариев, невидимы в отрендеренном чате):
//   <!--tel:contact:{"name":"Дима","number":"+7 900 ..."}-->   персонаж дал номер
//   <!--tel:sms:{"from":"Дима","text":"привет)"}-->            смс ОТ персонажа (может быть несколько в одном ответе)
//   <!--tel:out:{"to":"Дима"}-->                                маркер исходящей смс юзера
//                                                               (за ним видимый текст `[СМС → Дима] ...`)
//
// ВАЖНО: формат `tel:` выбран сознательно — регэксп стрипа расширения Pregnancy
// (<!--\s*\[...\]-->) требует «[» сразу после <!--, поэтому наши теги он не трогает.
//
// Per-chat настройки телефона (ручные контакты, прочитанность) — в chat_metadata
// (сохраняется вместе с чатом, не утекает между чатами).
// ═══════════════════════════════════════════

import { chat_metadata } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';

export const EXT_NAME = 'glassphone';
// Версия для сверки инстансов (ПК ↔ айфон): видна в настройках и в консоли.
// БАМПАТЬ при каждом коммите вместе с manifest.json!
export const GP_VERSION = '1.11.0';
const META_KEY = 'glassphone';

// ── Глобальные настройки ──
const defaultSettings = () => ({
    isEnabled: true,
    injectPrompt: true,
    showFab: true,
    fabPos: null, // {right, bottom} — сохранённая позиция кнопки
    injectDepth: 0, // глубина инжекта (0 = последний ход)
    // Прятать смс-переписку из ленты чата (сообщения ОСТАЮТСЯ в истории и контексте
    // модели — скрывается только отображение; телефон это единственное «окно» в смс)
    hideSmsInChat: true,
    // Профиль подключения для генерации соцсетей ('' = текущий API через generateRaw,
    // изолированно от пресета). Отдельный профиль дополнительно включает вижн.
    socialProfileId: '',
    // Префилл ответа: начало ответа пишется за модель (JSON стартует сразу,
    // без болтовни/отказов). Эмуляция через инструкцию — работает с любым API.
    usePrefill: false,
    // Контекст для генерации соцсетей:
    // 'rich' — карточка бота + персона + триггернутый лорбук + история чата (дефолт)
    // 'lite' — только короткий срез чата (максимальная изоляция)
    socialContextMode: 'rich',
    // Картинко-расширение: '' = АВТООПРЕДЕЛЕНИЕ (ищем среди установленных
    // third-party расширений novarakk-подобное — src/pipeline.js с
    // generateImageWithRetry). Непустое = ручной оверрайд имени папки.
    imageGenExtension: '',
    // Генерация картинок: модель-оверрайд ('' = модель из настроек расширения)
    imageGenModel: '',
    // Макс. длина ответа для генерации соцсетей (0 = авто по задаче). Если модель
    // рвёт JSON из-за лимита токенов — поднять (действует как ПОЛ: не ниже задачи).
    socialMaxTokens: 0,
    // Квадрат 1:1 для инста-постов
    imageGenSquare: true,
    // Промпт-префикс картинок (стиль/кадр). Описание поста и запрет рисовать
    // главперсонажей на чужих аккаунтах дописываются автоматически ПОСЛЕ него.
    imgPromptIg: 'social media post, self-taken candid framing',
    imgPromptOf: 'intimate boudoir shot, self-taken framing',
    // Booru-теги: перед генерацией сцена конвертируется в англ. danbooru-теги
    // (1girl/1boy, solo, hair, ...) — для NovelAI и аниме-моделей, которые не
    // понимают короткие описания на русском. Стоит доп. текстовый запрос.
    imgTagMode: false,
    // Обои телефона (URL файла; '' = стандартный стеклянный градиент)
    wallpaper: '',
    // Размыть обои (blur-фильтр на слое обоев)
    wallpaperBlur: false,
    // Скин телефона: indigo | rose | emerald | mono
    skin: 'indigo',
    // Кастомный CSS телефона
    customCss: '',
    // Автоматически тянуть аватарки из карточек персонажей/персоны
    autoAvatars: true,
    // Прикладывать фото к генерации комментов, даже когда есть описание (дороже по токенам)
    visionInComments: false,
    // Журнал соцсетей: посты юзера пишутся скрытой строкой в чат — попадают в контекст
    // по месту в истории и в саммарайз (долговременная память без роста инжекта)
    socialLogToChat: true,
    // Компактные правила в инжекте (экономия ~60% токенов директивы)
    compactRules: false,
});

export function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = defaultSettings();
    }
    const s = extension_settings[EXT_NAME];
    const def = defaultSettings();
    for (const k in def) if (s[k] === undefined) s[k] = def[k];
    return s;
}

// ── Per-chat метаданные ──
export function getMeta() {
    const md = chat_metadata;
    if (!md[META_KEY]) {
        md[META_KEY] = { contacts: [], lastRead: {}, hidden: [] };
    }
    const m = md[META_KEY];
    if (!Array.isArray(m.contacts)) m.contacts = [];
    if (!m.lastRead || typeof m.lastRead !== 'object') m.lastRead = {};
    if (!Array.isArray(m.hidden)) m.hidden = [];
    // Ники (@handle): per-chat, override поверх авто-генерации из имени
    if (!m.handles || typeof m.handles !== 'object') m.handles = {};
    if (typeof m.userHandle !== 'string') m.userHandle = '';
    // Групповые смс-чаты: [{id, name, members: [имена]}]
    if (!Array.isArray(m.groups)) m.groups = [];
    // Переименования контактов (отображаемое имя поверх имени из чата), по ключу
    if (!m.names || typeof m.names !== 'object') m.names = {};
    // Забаненные аккаунты соцсетей (нормализованные ключи имени/ника)
    if (!Array.isArray(m.banned)) m.banned = [];
    return m;
}

// ── Убрать @ из ника/имени ──
export function stripHandle(s) {
    return String(s || '').replace(/^@+/, '').trim();
}

// ── Отображаемое имя контакта (учитывает переименование) ──
export function displayName(key, fallback) {
    const m = getMeta();
    return (m.names && m.names[key]) || fallback || key;
}
export function renameContact(key, newName) {
    const m = getMeta();
    const n = String(newName || '').trim();
    if (n) m.names[key] = n.slice(0, 60);
    else delete m.names[key];
    saveMeta();
}

// ── Бан аккаунтов соцсетей ──
export function banKey(nameOrHandle) {
    return keyOf(stripHandle(nameOrHandle));
}
export function banAccount(nameOrHandle) {
    const m = getMeta();
    const k = banKey(nameOrHandle);
    if (k && !m.banned.includes(k)) m.banned.push(k);
    saveMeta();
}
export function unbanAccount(nameOrHandle) {
    const m = getMeta();
    const k = banKey(nameOrHandle);
    m.banned = m.banned.filter(x => x !== k);
    saveMeta();
}
export function isBanned(nameOrHandle, handle) {
    const m = getMeta();
    if (!m.banned.length) return false;
    const k1 = banKey(nameOrHandle);
    const k2 = handle ? banKey(handle) : null;
    return (k1 && m.banned.includes(k1)) || (k2 && m.banned.includes(k2));
}
export function getBanned() { return getMeta().banned; }

// ── Группы ──
export function addGroup(name, members) {
    const m = getMeta();
    const id = 'g' + Date.now().toString(36);
    m.groups.push({ id, name: String(name).trim(), members: (members || []).map(x => String(x).trim()).filter(Boolean) });
    saveMeta();
    return id;
}
export function delGroup(groupKey) {
    const m = getMeta();
    m.groups = m.groups.filter(g => `group:${keyOf(g.name)}` !== groupKey);
    saveMeta();
}

export function saveMeta() {
    try { saveMetadataDebounced(); } catch (e) { console.warn('[GlassPhone] saveMeta failed:', e); }
}

// ── Ключ треда/контакта: нормализованное имя ──
export function keyOf(name) {
    return String(name || '').trim().toLowerCase();
}

// ── Упоминается ли имя (или любое его слово ≥3 симв.) в тексте ──
// КРИТИЧНО: обычный \b НЕ работает с кириллицей (JS \w = только ASCII) — из-за
// этого имена вроде «Вадим Огнев» не находились. Здесь границы проверяем вручную
// по классу буква/цифра (латиница+кириллица).
export function textMentionsName(text, name) {
    const t = String(text || '').toLowerCase();
    if (!t || !name) return false;
    const isWordChar = (c) => !!c && /[a-zа-яё0-9ё]/i.test(c);
    const words = String(name).toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    for (const w of words) {
        let from = 0, i;
        while ((i = t.indexOf(w, from)) !== -1) {
            const before = t[i - 1];
            const after = t[i + w.length];
            if (!isWordChar(before) && !isWordChar(after)) return true;
            from = i + 1;
        }
    }
    return false;
}

// ── Картинка сообщения: extra.media (ST 1.18+) с фолбэком на extra.image ──
// В ST 1.18 extra.image превращён в deprecated-геттер (console.trace при каждом
// чтении) поверх массива extra.media. Читаем массив напрямую; старый плоский
// image берём только если это обычное СВОЁ свойство (без геттера — без трейсов).
export function extraImageOf(msg) {
    const ex = msg?.extra;
    if (!ex || typeof ex !== 'object') return '';
    if (Array.isArray(ex.media)) {
        const m = ex.media.find(x => x && x.type === 'image' && typeof x.url === 'string' && x.url);
        if (m) return m.url;
    }
    const desc = Object.getOwnPropertyDescriptor(ex, 'image');
    if (desc && 'value' in desc && typeof desc.value === 'string') return desc.value;
    return '';
}

// Прикрепить картинку к сообщению. На свежем extra пишем старый плоский формат
// (ST сам мигрирует в media при рендере — совместимо и со старыми версиями);
// если ST уже поставил геттер-обёртку (сеттер молча ГЛОТАЕТ запись!) — пишем
// прямо в массив extra.media.
export function attachImageToMessage(msg, src) {
    if (!msg || !src) return;
    if (!msg.extra || typeof msg.extra !== 'object') msg.extra = {};
    const ex = msg.extra;
    const desc = Object.getOwnPropertyDescriptor(ex, 'image');
    const hasGetter = desc && (typeof desc.get === 'function' || typeof desc.set === 'function');
    if (!hasGetter && !Array.isArray(ex.media)) {
        ex.image = String(src);
        ex.inline_image = true;
        return;
    }
    if (!Array.isArray(ex.media)) ex.media = [];
    if (!ex.media.some(m => m && m.url === src)) {
        ex.media.push({ type: 'image', url: String(src) });
    }
    ex.inline_image = true;
}

// ── Вырезать CoT-блоки (<think> и подобные) ──
// КРИТИЧНО: reasoning-модели иногда пишут теги tel:sms с текстами сообщений прямо
// в цепочке размышлений → сканер видел их и ДУБЛИРОВАЛ сообщения в телефоне.
// Всё, что внутри think-блоков, для телефона не существует.
export function stripThink(text) {
    if (!text) return '';
    let res = String(text);
    // Сначала удаляем закрытые блоки, чтобы избежать дублей (модель могла написать теги и в think, и в ответе)
    res = res.replace(/<(think|thinking|reasoning|analysis|reflection)[^>]*>[\s\S]*?<\/\1>/gi, '');
    
    // Для незакрытого блока:
    const unclosedMatch = res.match(/<(think|thinking|reasoning)[^>]*>([\s\S]*)$/i);
    if (unclosedMatch) {
        const inside = unclosedMatch[2];
        // Если внутри незакрытого блока есть теги телефона, значит модель забыла закрыть блок
        // и выдала итоговые теги прямо внутри. В таком случае оставляем содержимое.
        if (/<!--\s*tel:/i.test(inside)) {
            res = res.replace(/<(think|thinking|reasoning)[^>]*>/gi, '');
        } else {
            // Тегов нет, безопасно удаляем всё до конца (видимо, модель просто оборвала мысль)
            res = res.replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*$/gi, '');
        }
    }
    return res;
}

// ── Толерантный JSON-парсер (модели любят одинарные кавычки и висячие запятые) ──
function safeJson(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {}
    try {
        const fixed = raw.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
        return JSON.parse(fixed);
    } catch (e2) {}
    try {
        // Fallback для неэкранированных переносов строк внутри значений (частая ошибка моделей)
        let f = raw.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
        f = f.replace(/([^\\])\n/g, '$1\\n').replace(/([^\\])\r/g, '$1\\r');
        return JSON.parse(f);
    } catch (e3) {}
    try {
        // Последняя надежда: извлекаем ключи регулярками
        const res = {};
        const extract = (key) => {
            const re = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'i');
            const m = raw.match(re) || raw.replace(/'/g, '"').match(re);
            if (m) return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
            return null;
        };
        res.from = extract('from');
        res.text = extract('text');
        res.to = extract('to');
        res.photo = extract('photo');
        res.chat = extract('chat');
        res.name = extract('name');
        res.number = extract('number');
        if (res.from || res.name) return res;
    } catch (e4) {}
    return null;
}

// ── Регэкспы тегов ──
const TAG_RE = /<!--\s*tel:(contact|sms):(\{[\s\S]*?\})\s*-->/gi;
const OUT_RE = /<!--\s*tel:out:(\{[\s\S]*?\})\s*-->/i;
// «Персонаж решил не отвечать на смс» — пустой ответ телефона
const SILENT_RE = /<!--\s*tel:silent\s*-->/i;
// Журнальная запись соцсетей (скрыта из ленты, но в контексте модели)
const LOG_RE = /<!--\s*tel:log\s*-->/i;
// Любой наш тег (для детекта смс-only сообщений)
const ANY_TEL_RE = /<!--\s*tel:(sms|contact|out|silent|log)/i;
// Видимый формат исходящей смс (парсим как fallback, если JSON битый)
const OUT_VISIBLE_RE = /\[СМС\s*→\s*([^\]]+)\]\s*([\s\S]*)/;
// Видимый формат групповой исходящей смс: [СМС в чат «Название»] текст
const OUT_VISIBLE_GROUP_RE = /\[СМС\s+в\s+чат\s*[«"]([^»"]+)[»"]\]\s*([\s\S]*)/

// Смс попадают в телефон ТОЛЬКО из явных tel:sms тегов — это наш протокол,
// модель ставит их осознанно. Эвристики «чей телефон» и бэктик-парсер прозы
// удалены: от тегов внутри CoT защищает stripThink, от адресованных боту — j.to.

// ── Детект номера в обычной прозе («вот мой номер: +7 900...») ──
// Контекстное слово должно быть в пределах ±120 символов от числа.
const PHONE_NUM_RE = /(?:\+?\d[\d\-\s()]{7,17}\d)/g;
const PHONE_CTX_RE = /(номер|телефон|запиши|звони|набери|позвони|пиши\s+мне|наберёшь|наберешь|смс|sms|phone|number|call\s+me|text\s+me|reach\s+me)/i;

function detectProseNumber(text) {
    if (!text) return null;
    PHONE_NUM_RE.lastIndex = 0;
    let m;
    while ((m = PHONE_NUM_RE.exec(text)) !== null) {
        const numStr = m[0].trim();
        const digits = numStr.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) continue;
        const start = Math.max(0, m.index - 120);
        const end = Math.min(text.length, m.index + numStr.length + 120);
        const ctx = text.slice(start, end);
        if (PHONE_CTX_RE.test(ctx)) return numStr;
    }
    return null;
}

// ── Форматирование времени сообщения ──
function parseMsgDate(msg) {
    if (!msg) return null;
    const sd = msg.send_date;
    if (typeof sd === 'number') return new Date(sd);
    if (typeof sd === 'string') {
        const d = new Date(sd);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

export function fmtTime(date) {
    if (!date) return '';
    // Сравниваем «сегодня» с RP-датой, а не с реальной
    const rpNow = getRpDateTime();
    let sameDay;
    if (rpNow) {
        sameDay = date.getDate() === rpNow.day
            && (date.getMonth() + 1) === rpNow.month
            && date.getFullYear() === rpNow.year;
    } else {
        const now = new Date();
        sameDay = date.getFullYear() === now.getFullYear()
            && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    }
    if (sameDay) {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ── RP-дата/время: из ЛЮБОГО источника ──
// Приоритет: (1) инжект календаря (rp-calendar и т.п. — читаем extension_prompts,
// парсим дату+время из текста), (2) тег Pregnancy [RP_DATE:DD.MM.YYYY],
// (3) дата/время в прозе последних сообщений. Иначе null → телефон берёт реальное.
const RP_DATE_RE = /\[RP_DATE[:\s]+\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?\s*\]/i;

// Русские месяцы (стемы, от специфичного к общему — «мар» до «ма»)
const RU_MONTHS = [
    ['декабр', 12], ['ноябр', 11], ['октябр', 10], ['сентябр', 9], ['август', 8],
    ['июл', 7], ['июн', 6], ['апрел', 4], ['март', 3], ['феврал', 2], ['январ', 1], ['мая', 5], ['май', 5],
];
const EN_MONTHS = [
    ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['may', 5], ['jun', 6],
    ['jul', 7], ['aug', 8], ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
];

// Толерантный парс даты+времени из произвольного текста. Возвращает
// {day,month,year,hours?,minutes?} или null.
function parseAnyDateTime(text) {
    if (!text) return null;
    const t = String(text);
    let day = null, month = null, year = null, hours, minutes;

    // Время HH:MM (24ч) — первое вхождение
    const tm = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (tm) { hours = parseInt(tm[1]); minutes = parseInt(tm[2]); }

    // 1) [RP_DATE:DD.MM.YYYY]
    let m = t.match(RP_DATE_RE);
    if (m) {
        day = parseInt(m[1]); month = parseInt(m[2]); year = parseInt(m[3]);
        if (m[4] !== undefined) { hours = parseInt(m[4]); minutes = parseInt(m[5]); }
    }
    // 2) Именованный месяц: «15 января 2025» / «January 15, 2025» / «15 January 2025»
    if (day === null) {
        const low = t.toLowerCase();
        const findMonth = () => {
            for (const [stem, num] of [...RU_MONTHS, ...EN_MONTHS]) {
                const idx = low.indexOf(stem);
                if (idx !== -1) return { stem, num, idx };
            }
            return null;
        };
        const mo = findMonth();
        if (mo) {
            month = mo.num;
            // день рядом с месяцем (до или после, в пределах ~12 симв.)
            const around = low.slice(Math.max(0, mo.idx - 12), mo.idx + mo.stem.length + 12);
            const dMatch = around.match(/\b(\d{1,2})\b/);
            if (dMatch) day = parseInt(dMatch[1]);
            // год — 4 цифры где-то в тексте
            const yMatch = low.match(/\b(19|20)\d{2}\b/);
            if (yMatch) year = parseInt(yMatch[0]);
        }
    }
    // 3) Числовая дата DD.MM.YYYY / DD/MM/YYYY / YYYY-MM-DD
    if (day === null) {
        let dm = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/); // ISO
        if (dm) { year = parseInt(dm[1]); month = parseInt(dm[2]); day = parseInt(dm[3]); }
        else {
            dm = t.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\b/);
            if (dm) { day = parseInt(dm[1]); month = parseInt(dm[2]); year = parseInt(dm[3]); }
        }
    }

    if (day === null && hours === undefined) return null; // ничего не нашли
    if (year !== null && year !== undefined && year < 100) year += 2000;
    // Валидация
    if (day !== null && (day < 1 || day > 31)) day = null;
    if (month !== null && (month < 1 || month > 12)) month = null;
    if (day === null || month === null || year === null) {
        // Есть только время — вернём его (день недели/дата с реального времени)
        if (hours === undefined) return null;
        const now = new Date();
        day = now.getDate(); month = now.getMonth() + 1; year = now.getFullYear();
        const res = { day, month, year, hours, minutes, label: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`, timeOnly: true };
        return res;
    }
    const res = {
        day, month, year,
        label: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`,
    };
    if (hours !== undefined) { res.hours = hours; res.minutes = minutes; }
    return res;
}

// Собрать текст инжектов календаря (rp-calendar и подобные) из реестра
// extension_prompts. Ключей календаря мы не знаем — берём ВСЕ инжекты, где
// есть слова про дату/время/календарь, чтобы не тащить лишнее.
function calendarInjectText() {
    try {
        const ctx = SillyTavern.getContext();
        const eps = ctx?.extensionPrompts || {};
        const chunks = [];
        for (const key of Object.keys(eps)) {
            const val = eps[key]?.value;
            if (typeof val !== 'string' || !val) continue;
            const k = key.toLowerCase();
            const looksCalendar = /calendar|date|time|день|дата|время|clock/i.test(k)
                || /\b\d{1,2}:\d{2}\b/.test(val) && /(date|дата|day|день|month|месяц|year|год)/i.test(val);
            if (looksCalendar) chunks.push(val);
        }
        return chunks.join('\n');
    } catch (e) { return ''; }
}

// Полный парсинг RP-даты/времени. Лёгкий кэш по сигнатуре (длина чата + первые
// символы календарь-инжекта), чтобы не парсить на каждый tick.
let _rpDateCache = null;
let _rpDateSig = null;
export function getRpDateTime() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        const calText = calendarInjectText();
        const sig = `${chat.length}|${calText.slice(0, 200)}|${chat.length ? (chat[chat.length - 1]?.mes || '').slice(-80) : ''}`;
        if (sig === _rpDateSig) return _rpDateCache;
        _rpDateSig = sig;

        // 1) Инжект календаря
        let res = parseAnyDateTime(calText);
        // 2) Тег/проза в последних сообщениях (Pregnancy RP_DATE или дата в тексте)
        if (!res) {
            for (let i = chat.length - 1; i >= 0 && i >= chat.length - 8; i--) {
                const mes = chat[i]?.mes;
                if (!mes || chat[i].is_system) continue;
                const r = parseAnyDateTime(mes);
                if (r && !r.timeOnly) { res = r; break; }
                if (r && !res) res = r; // time-only — запомним, но ищем дальше полную дату
            }
        }
        _rpDateCache = res || null;
        return _rpDateCache;
    } catch (e) { _rpDateCache = null; return null; }
}

// Обратная совместимость: label «ДД.ММ»
// ═══════════════════════════════════════════
// ГЛАВНОЕ: пересборка контактов и тредов из чата
// ═══════════════════════════════════════════
// Возвращает { contacts: Map(key → {name, number, source}), threads: Map(key → {name, messages[]}) }
// messages: {dir:'in'|'out', text, idx, time}
export function scanChat() {
    const contacts = new Map();
    const threads = new Map();

    const addContact = (name, number, source) => {
        const k = keyOf(name);
        if (!k) return;
        const existing = contacts.get(k);
        if (!existing) {
            contacts.set(k, { name: String(name).trim(), number: String(number || '').trim(), source });
        } else if (!existing.number && number) {
            existing.number = String(number).trim();
        }
    };

    // name может быть готовым ключом 'group:xxx' (displayName тогда обязателен)
    const pushMsg = (name, entry, displayName = null) => {
        const k = String(name).startsWith('group:') ? String(name) : keyOf(name);
        if (!k || k === 'group:') return;
        if (!threads.has(k)) {
            threads.set(k, {
                name: displayName || String(name).trim(),
                messages: [],
                isGroup: k.startsWith('group:'),
            });
        }
        threads.get(k).messages.push(entry);
    };

    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { /* ignore */ }

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || !msg.mes) continue;
        // Системные сообщения пропускаем, НО наши SMS-ответы (is_system с tel: тегами) — парсим
        if (msg.is_system && !ANY_TEL_RE.test(msg.mes)) continue;
        // Теги внутри CoT-блоков не считаются (иначе дубли сообщений)
        const text = stripThink(msg.mes);
        const time = parseMsgDate(msg);

        if (msg.is_user) {
            // Исходящая смс юзера
            const om = text.match(OUT_RE);
            if (om) {
                const j = safeJson(om[1]) || {};
                const stripped = text.replace(OUT_RE, '').trim();
                const vis = stripped.match(OUT_VISIBLE_RE);
                const visGroup = !vis ? stripped.match(OUT_VISIBLE_GROUP_RE) : null;
                let to = j.to || (vis ? vis[1].trim() : null);
                const body = vis ? vis[2].trim() : (visGroup ? visGroup[2].trim() : (j.text || ''));
                // Групповой чат: to = "группа:Название" (или поле group)
                const groupName = j.group || (typeof to === 'string' && to.match(/^группа:\s*(.+)$/i)?.[1]) || null;
                // В пузыре телефона токен «*фото...*» не показываем — там миниатюра;
                // полное описание остаётся в mes (для модели и саммари)
                const displayBody = body.replace(/\*фото:[^*]*\*\s*/i, '').replace(/\*фото\*\s*/i, '').trim();
                const entry = { dir: 'out', text: displayBody, idx: i, time };
                // Фото: путь из маркера (надёжно — часть текста) ИЛИ из extra.media (ST-нативно)
                if (j.img) entry.img = j.img;
                else {
                    const ei = extraImageOf(msg);
                    if (ei) entry.img = ei;
                }
                if (j.photo) entry.photoDesc = String(j.photo).slice(0, 200);
                if (groupName) {
                    if (body || entry.img) pushMsg(`group:${keyOf(groupName)}`, entry, groupName);
                } else if (to && (body || entry.img)) {
                    pushMsg(to, entry);
                    // Раз юзер пишет этому имени — контакт точно есть
                    addContact(to, '', 'implicit');
                }
            }
        }

        // ── Сообщения бота (или юзера) ──

        // ГЛАВНАЯ ПРОВЕРКА: бот описывает СВОЙ телефон?
        // Если да — это НЕ смс юзеру, пропускаем всё кроме contact-тегов.
        // Для сообщений юзера эта проверка всегда false, так как мы хотим парсить их тэги.
        TAG_RE.lastIndex = 0;
        let tm;
        let smsTagsInMsg = 0;
        while ((tm = TAG_RE.exec(text)) !== null) {
            const kind = tm[1].toLowerCase();
            const j = safeJson(tm[2]);
            if (!j) continue;
            if (kind === 'contact' && j.name) {
                addContact(j.name, j.number || '', 'tag');
            } else if (kind === 'sms' && j.from && (j.text || j.photo)) {
                // Явные теги = наш протокол, модель ставит их осознанно — доверяем.
                // Единственное исключение: тег явно адресован боту (j.to = имя бота).
                if (j.to && !msg.is_user && keyOf(j.to) === keyOf(msg.name)) {
                    continue;
                }
                const entry = { dir: 'in', from: String(j.from), text: String(j.text || ''), idx: i, time };
                // ММС от персонажа: описание фото → стеклянная заглушка в пузыре
                if (j.photo) entry.photoDesc = String(j.photo).slice(0, 200);
                if (j.chat) {
                    // Сообщение в групповой чат
                    pushMsg(`group:${keyOf(j.chat)}`, entry, String(j.chat));
                } else {
                    pushMsg(j.from, entry);
                    addContact(j.from, j.number || '', 'implicit');
                }
                smsTagsInMsg++;
            }
        }

        // Fallback: номер в прозе без тега («подхватываем»).
        // ТОЛЬКО видимый текст: html-комменты вырезаются — иначе таймстамп в имени
        // файла из маркера (sms_1783152188594.jpeg) ловился как «номер телефона»
        // и создавал контакт с именем автора сообщения (даже самого юзера).
        if (!msg.is_user) {
            const proseNum = detectProseNumber(text.replace(/<!--[\s\S]*?-->/g, ''));
            if (proseNum) {
                const charName = msg.name || null;
                if (charName && !contacts.has(keyOf(charName))) {
                    addContact(charName, proseNum, 'prose');
                }
            }
        }
    }

    // ── Ручные контакты из метаданных (мерж; ручной номер приоритетнее пустого) ──
    const meta = getMeta();
    for (const c of meta.contacts) {
        if (!c || !c.name) continue;
        const k = keyOf(c.name);
        const existing = contacts.get(k);
        if (!existing) {
            contacts.set(k, { name: c.name, number: c.number || '', source: 'manual' });
        } else if (c.number && !existing.number) {
            existing.number = c.number;
        }
    }

    // ── Скрытые треды: прячем контакт, если после скрытия не появилось новых смс ──
    for (const h of meta.hidden) {
        if (!h || !h.key) continue;
        const t = threads.get(h.key);
        const lastIdx = t && t.messages.length > 0 ? t.messages[t.messages.length - 1].idx : -1;
        if (lastIdx <= (h.atIdx ?? -1)) {
            threads.delete(h.key);
            contacts.delete(h.key);
        }
    }

    return { contacts, threads };
}

// ── Список для экрана «Сообщения»: контакты + треды, отсортированы по свежести ──
export function getThreadList() {
    const { contacts, threads } = scanChat();
    const meta = getMeta();
    const list = [];
    const keys = new Set([...contacts.keys(), ...threads.keys()]);
    // Группы из метаданных — даже пустые (только что созданные)
    const groupByKey = new Map();
    for (const g of meta.groups) {
        const gk = `group:${keyOf(g.name)}`;
        groupByKey.set(gk, g);
        keys.add(gk);
    }
    for (const k of keys) {
        const c = contacts.get(k);
        const t = threads.get(k);
        const g = groupByKey.get(k);
        const msgs = t ? t.messages : [];
        const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const incoming = msgs.filter(m => m.dir === 'in').length;
        const read = meta.lastRead[k] || 0;
        const isGroup = k.startsWith('group:');
        list.push({
            key: k,
            name: displayName(k, (g && g.name) || (c && c.name) || (t && t.name) || k),
            number: (c && c.number) || '',
            isGroup,
            members: g ? g.members : (isGroup ? [...new Set(msgs.filter(m => m.from).map(m => m.from))] : []),
            last,
            lastIdx: last ? last.idx : -1,
            unread: Math.max(0, incoming - read),
            messages: msgs,
        });
    }
    list.sort((a, b) => b.lastIdx - a.lastIdx);
    return list;
}

export function getThread(key) {
    return getThreadList().find(t => t.key === key) || null;
}

export function getTotalUnread() {
    return getThreadList().reduce((sum, t) => sum + t.unread, 0);
}

export function markRead(key) {
    const t = getThread(key);
    if (!t) return;
    const meta = getMeta();
    const incoming = t.messages.filter(m => m.dir === 'in').length;
    if ((meta.lastRead[key] || 0) !== incoming) {
        meta.lastRead[key] = incoming;
        saveMeta();
    }
}

export function addManualContact(name, number) {
    const meta = getMeta();
    const k = keyOf(name);
    if (!k) return false;
    // Снимаем скрытие, если было
    meta.hidden = meta.hidden.filter(h => h.key !== k);
    const existing = meta.contacts.find(c => keyOf(c.name) === k);
    if (existing) {
        if (number) existing.number = number;
    } else {
        meta.contacts.push({ name: String(name).trim(), number: String(number || '').trim() });
    }
    saveMeta();
    return true;
}

export function hideContact(key) {
    const meta = getMeta();
    meta.contacts = meta.contacts.filter(c => keyOf(c.name) !== key);
    const t = getThread(key);
    const atIdx = t && t.last ? t.last.idx : Number.MAX_SAFE_INTEGER;
    meta.hidden = meta.hidden.filter(h => h.key !== key);
    meta.hidden.push({ key, atIdx });
    saveMeta();
}

// ── Индексы сообщений чата, которые надо СПРЯТАТЬ из ленты (режим «чистый чат») ──
// Прячем: исходящие смс юзера (tel:out) и «смс-only» ответы бота — сообщения,
// где после удаления ВСЕХ html-комментариев не остаётся видимого текста
// (бот ответил только тегами tel:sms / tel:silent + служебные теги других расширений).
// Обычные RP-посты, где смс вплетена в повествование, НЕ прячутся никогда.
export function getHiddenMessageIndexes() {
    const out = [];
    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { return out; }
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || !msg.mes) continue;
        // Системные сообщения пропускаем, но наши SMS-ответы прячем
        if (msg.is_system && !ANY_TEL_RE.test(msg.mes) && !SILENT_RE.test(msg.mes)) continue;
        if (msg.is_user) {
            if (OUT_RE.test(msg.mes) || LOG_RE.test(msg.mes)) out.push(i);
            continue;
        }
        // Think-блоки не учитываем ни в детекте тегов, ни в «видимом остатке»
        const clean = stripThink(msg.mes);
        if (!ANY_TEL_RE.test(clean) && !SILENT_RE.test(clean)) continue;
        const visible = clean.replace(/<!--[\s\S]*?-->/g, '').trim();
        if (visible.length <= 4) out.push(i);
    }
    return out;
}

// ── Случайный правдоподобный номер для ручного контакта ──
export function randomNumber() {
    const p3 = () => String(Math.floor(Math.random() * 900) + 100);
    const p2 = () => String(Math.floor(Math.random() * 90) + 10);
    return `+7 9${p2()} ${p3()}-${p2()}-${p2()}`;
}
