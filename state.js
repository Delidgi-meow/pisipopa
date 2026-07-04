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
    // Контекст для генерации соцсетей:
    // 'rich' — карточка бота + персона + триггернутый лорбук + история чата (дефолт)
    // 'lite' — только короткий срез чата (максимальная изоляция)
    socialContextMode: 'rich',
    // Генерация картинок (novarakk): модель-оверрайд ('' = модель из настроек novarakk)
    imageGenModel: '',
    // Квадрат 1:1 для инста-постов
    imageGenSquare: true,
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
    return m;
}

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

// ── Бэктик-смс в обычной RP-прозе: бот пишет смс в стиле `текст` ──
// Ловим ТОЛЬКО при наличии смс-контекста рядом (±150 симв.) — бэктики используются
// и для другого. Срабатывает только если в сообщении НЕТ явных tel:sms тегов.
const BACKTICK_RE = /`([^`\n]{2,300})`/g;
const BACKTICK_CTX_RE = /(смс|sms|сообщени|телефон|мобильн|экран[еа]?|вибр|уведомлен|написал[аи]?|отправил[аи]?|пришл[оа]|прилетел[оа]|мессендж|messenger|text(?:ed|s)?\b|notification)/i;

// НЕ телефон юзера: бот от первого лица описывает СВОЙ телефон.
// Проверяем proximity (близость) В ПРЕДЕЛАХ ОДНОЙ СТРОКИ — кросс-абзацный
// матч «мой вечер» + «улыбается в телефон» (другой персонаж, дневник НПС) давал
// ложное срабатывание и глушил все tel:sms-теги в ответе бота.
// ВНИМАНИЕ: \b в JS НЕ работает с кириллицей! Используем [^а-яёА-ЯЁ] вместо \b.
function isBotsOwnPhone(text) {
    // Паттерн 1: притяжательное «мой/моём/моего/моему/моих/...» рядом с «телефон/экран/...»
    // ТОЛЬКО в пределах одной строки (не пересекаем \n)
    const POSS_RE = /(?:^|[^а-яёА-ЯЁ])мо[йеёию][гмй]?[а-яё]*/gi;
    const PHONE_RE = /(?:телефон|смартфон|мобильн|экран[еау]?|трубк)/i;
    let m;
    while ((m = POSS_RE.exec(text)) !== null) {
        // Границы строки, содержащей матч
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        let lineEnd = text.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = text.length;
        const line = text.slice(lineStart, lineEnd);
        if (PHONE_RE.test(line)) return true;
    }
    // Паттерн 2: «мне пришло/написали/звякнуло»
    if (/мне\s+(?:пришл|прилетел|написал|отправил|звякнул)/i.test(text)) return true;
    // Паттерн 3: «я достал/взял/вытащил... телефон»
    if (/(?:^|[^а-яёА-ЯЁ])я\s+\S+\s+(?:телефон|смартфон|трубку|мобильн)/i.test(text)) return true;
    return false;
}

// «сообщение от Имя Фамилия» — реальный отправитель смс (может быть НПС, не msg.name)
const SMS_FROM_RE = /(?:сообщени[ея]|смс|sms|уведомлени[ея])\s+от\s+([А-ЯЁ][а-яёА-ЯЁ\-]+(?:\s+[А-ЯЁ][а-яё\-]+)?)/i;

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

// ── Последняя RP-дата/время из чата (синергия с Pregnancy — она хранит RP_DATE в сообщениях) ──
// Расширенный regex: ловит дату DD.MM.YYYY и опционально время HH:MM (если модель дописывает)
const RP_DATE_RE = /<!--[\s\S]*?\[RP_DATE[:\s]+\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?\s*\][\s\S]*?-->/i;

// Полный парсинг RP-даты → {day, month, year, hours?, minutes?, label}
// Возвращает null если RP_DATE нет в чате
let _rpDateCache = null;
let _rpDateCacheLen = -1;
export function getRpDateTime() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        // Простой кэш: пересчитываем только если длина чата изменилась
        if (chat.length === _rpDateCacheLen && _rpDateCache !== undefined) return _rpDateCache;
        _rpDateCacheLen = chat.length;
        for (let i = chat.length - 1; i >= 0; i--) {
            const mes = chat[i]?.mes;
            if (!mes || chat[i].is_system) continue;
            const m = mes.match(RP_DATE_RE);
            if (m) {
                const day = parseInt(m[1]);
                const month = parseInt(m[2]);
                let year = parseInt(m[3]);
                if (year < 100) year += 2000;
                const result = {
                    day, month, year,
                    label: `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`,
                };
                if (m[4] !== undefined && m[5] !== undefined) {
                    result.hours = parseInt(m[4]);
                    result.minutes = parseInt(m[5]);
                }
                _rpDateCache = result;
                return result;
            }
        }
        _rpDateCache = null;
    } catch (e) { _rpDateCache = null; }
    return null;
}

// Обратная совместимость: label «ДД.ММ»
export function getRpDateLabel() {
    const rp = getRpDateTime();
    return rp ? rp.label : null;
}

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
                const entry = { dir: 'out', text: body, idx: i, time };
                // Фото: путь из маркера (надёжно — часть текста) ИЛИ из extra.image (ST-нативно)
                if (j.img) entry.img = j.img;
                else if (msg.extra?.image) entry.img = msg.extra.image;
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
        const botsPhone = msg.is_user ? false : isBotsOwnPhone(text);
        if (botsPhone) {
            console.log(`[GlassPhone] Пропущено: смс на телефон бота, не юзера (${msg.name})`);
        }

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
                // Если смс явно адресовано боту (j.to совпадает с именем бота), пропускаем,
                // так как телефон принадлежит юзеру.
                if (j.to && !msg.is_user && keyOf(j.to) === keyOf(msg.name)) {
                    console.log(`[GlassPhone] Пропущено: смс адресовано боту (${j.to})`);
                    continue;
                }
                
                // Если сработал детектор "телефон бота", блокируем чужие смс (галлюцинации входящих),
                // но РАЗРЕШАЕМ смс от самого бота (значит, он пишет юзеру, просто упомянул телефон в тексте).
                if (botsPhone && keyOf(j.from) !== keyOf(msg.name)) {
                    console.log(`[GlassPhone] Пропущена галлюцинация: смс от ${j.from} на телефон бота`);
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

        // Fallback: номер в прозе без тега («подхватываем»)
        const proseNum = detectProseNumber(text);
        if (proseNum) {
            const charName = msg.name || null;
            if (charName && !contacts.has(keyOf(charName))) {
                addContact(charName, proseNum, 'prose');
                console.log(`[GlassPhone] Номер подхвачен из прозы: ${charName} → ${proseNum}`);
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
            name: (g && g.name) || (c && c.name) || (t && t.name) || k,
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
