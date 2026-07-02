// ═══════════════════════════════════════════
// GLASSPHONE STATE — данные телефона
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
    // Прятать смс-переписку из ленты чата (сообщения ОСТАЮТСЯ в истории и контексте
    // модели — скрывается только отображение; телефон это единственное «окно» в смс)
    hideSmsInChat: true,
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
    return m;
}

export function saveMeta() {
    try { saveMetadataDebounced(); } catch (e) { console.warn('[GlassPhone] saveMeta failed:', e); }
}

// ── Ключ треда/контакта: нормализованное имя ──
export function keyOf(name) {
    return String(name || '').trim().toLowerCase();
}

// ── Толерантный JSON-парсер (модели любят одинарные кавычки и висячие запятые) ──
function safeJson(raw) {
    try { return JSON.parse(raw); } catch (e) {
        try {
            const fixed = raw.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
            return JSON.parse(fixed);
        } catch (e2) { return null; }
    }
}

// ── Регэкспы тегов ──
const TAG_RE = /<!--\s*tel:(contact|sms):(\{[\s\S]*?\})\s*-->/gi;
const OUT_RE = /<!--\s*tel:out:(\{[\s\S]*?\})\s*-->/i;
// «Персонаж решил не отвечать на смс» — пустой ответ телефона
const SILENT_RE = /<!--\s*tel:silent\s*-->/i;
// Любой наш тег (для детекта смс-only сообщений)
const ANY_TEL_RE = /<!--\s*tel:(sms|contact|out|silent)/i;
// Видимый формат исходящей смс (парсим как fallback, если JSON битый)
const OUT_VISIBLE_RE = /\[СМС\s*→\s*([^\]]+)\]\s*([\s\S]*)/;

// ── Бэктик-смс в обычной RP-прозе: бот пишет смс в стиле `текст` ──
// Ловим ТОЛЬКО при наличии смс-контекста рядом (±150 симв.) — бэктики используются
// и для другого. Срабатывает только если в сообщении НЕТ явных tel:sms тегов.
const BACKTICK_RE = /`([^`\n]{2,300})`/g;
const BACKTICK_CTX_RE = /(смс|sms|сообщени|телефон|мобильн|экран[еа]?|вибр|уведомлен|написал[аи]?|отправил[аи]?|пришл[оа]|прилетел[оа]|мессендж|messenger|text(?:ed|s)?\b|notification)/i;

// НЕ телефон юзера: бот от первого лица описывает СВОЙ телефон.
// Проверяем proximity (близость), а не смежность — «В моем кармане вибрирует телефон»
// тоже ловим, хотя «моем» и «телефон» разделены словами.
// ВНИМАНИЕ: \b в JS НЕ работает с кириллицей! Используем [^а-яёА-ЯЁ] вместо \b.
function isBotsOwnPhone(text) {
    // Паттерн 1: притяжательное «мой/моём/моего/моему/моих/...» рядом с «телефон/экран/...»
    const POSS_RE = /(?:^|[^а-яёА-ЯЁ])мо[йеёию][гмй]?[а-яё]*/gi;
    const PHONE_RE = /(?:телефон|смартфон|мобильн|экран[еау]?|трубк)/i;
    let m;
    while ((m = POSS_RE.exec(text)) !== null) {
        const start = Math.max(0, m.index - 60);
        const end = Math.min(text.length, m.index + m[0].length + 120);
        if (PHONE_RE.test(text.slice(start, end))) return true;
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
    const now = new Date();
    const sameDay = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    if (sameDay) {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ── Последняя RP-дата из чата (синергия с Pregnancy — она хранит RP_DATE в сообщениях) ──
const RP_DATE_RE = /<!--[\s\S]*?\[RP_DATE[:\s]+\s*(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})\s*\][\s\S]*?-->/i;
export function getRpDateLabel() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const mes = chat[i]?.mes;
            if (!mes || chat[i].is_system) continue;
            const m = mes.match(RP_DATE_RE);
            if (m) return `${String(parseInt(m[1])).padStart(2, '0')}.${String(parseInt(m[2])).padStart(2, '0')}`;
        }
    } catch (e) { /* ignore */ }
    return null;
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

    const pushMsg = (name, entry) => {
        const k = keyOf(name);
        if (!k) return;
        if (!threads.has(k)) threads.set(k, { name: String(name).trim(), messages: [] });
        threads.get(k).messages.push(entry);
    };

    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { /* ignore */ }

    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || !msg.mes || msg.is_system) continue;
        const text = msg.mes;
        const time = parseMsgDate(msg);

        if (msg.is_user) {
            // Исходящая смс юзера
            const om = text.match(OUT_RE);
            if (om) {
                const j = safeJson(om[1]) || {};
                const vis = text.replace(OUT_RE, '').trim().match(OUT_VISIBLE_RE);
                const to = j.to || (vis ? vis[1].trim() : null);
                const body = vis ? vis[2].trim() : (j.text || '');
                if (to && body) {
                    pushMsg(to, { dir: 'out', text: body, idx: i, time });
                    // Раз юзер пишет этому имени — контакт точно есть
                    addContact(to, '', 'implicit');
                }
            }
            continue;
        }

        // ── Сообщения бота ──

        // ГЛАВНАЯ ПРОВЕРКА: бот описывает СВОЙ телефон?
        // Если да — это НЕ смс юзеру, пропускаем всё кроме contact-тегов.
        const botsPhone = isBotsOwnPhone(text);
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
            } else if (kind === 'sms' && j.from && j.text && !botsPhone) {
                pushMsg(j.from, { dir: 'in', text: String(j.text), idx: i, time });
                addContact(j.from, j.number || '', 'implicit');
                smsTagsInMsg++;
            }
        }

        // Fallback: бэктик-смс в прозе (`текст`) — только если тегов tel:sms нет
        // и это не телефон бота
        if (smsTagsInMsg === 0 && msg.name && !botsPhone) {
            const fromMatch = text.match(SMS_FROM_RE);
            const realSender = fromMatch ? fromMatch[1].trim() : msg.name;

            BACKTICK_RE.lastIndex = 0;
            let bm, caught = 0;
            while ((bm = BACKTICK_RE.exec(text)) !== null && caught < 4) {
                const start = Math.max(0, bm.index - 150);
                const end = Math.min(text.length, bm.index + bm[0].length + 150);
                if (!BACKTICK_CTX_RE.test(text.slice(start, end))) continue;
                pushMsg(realSender, { dir: 'in', text: bm[1].trim(), idx: i, time });
                addContact(realSender, '', 'implicit');
                caught++;
            }
            if (caught > 0) console.log(`[GlassPhone] Поймано ${caught} бэктик-смс из прозы (отправитель: ${realSender})`);
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
    for (const k of keys) {
        const c = contacts.get(k);
        const t = threads.get(k);
        const msgs = t ? t.messages : [];
        const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const incoming = msgs.filter(m => m.dir === 'in').length;
        const read = meta.lastRead[k] || 0;
        list.push({
            key: k,
            name: (c && c.name) || (t && t.name) || k,
            number: (c && c.number) || '',
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
        if (!msg || !msg.mes || msg.is_system) continue;
        if (msg.is_user) {
            if (OUT_RE.test(msg.mes)) out.push(i);
            continue;
        }
        if (!ANY_TEL_RE.test(msg.mes) && !SILENT_RE.test(msg.mes)) continue;
        const visible = msg.mes.replace(/<!--[\s\S]*?-->/g, '').trim();
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
