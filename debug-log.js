// Кольцевой журнал последних действий телефона: запросы к модели, генерации
// картинок и «тихие» отказы (реакции, перезапись тегов). Нужен, чтобы понять
// причину, когда в консоли ST пусто — отчёт открывается кнопкой в настройках.

const MAX = 40;
const entries = [];

function nowLabel() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function short(v, cap = 220) {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'string' ? v : (() => {
        try { return JSON.stringify(v); } catch (e) { return String(v); }
    })();
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > cap ? s.slice(0, cap) + '…' : s;
}

// kind: 'req' | 'ok' | 'fail' | 'act' | 'img'
export function logEvent(kind, what, details) {
    entries.push({ t: nowLabel(), kind, what: short(what, 90), details: short(details) });
    if (entries.length > MAX) entries.shift();
}

export const logReq = (what, details) => logEvent('req', what, details);
export const logOk = (what, details) => logEvent('ok', what, details);
export const logFail = (what, details) => logEvent('fail', what, details);
export const logAct = (what, details) => logEvent('act', what, details);

export function getLogEntries(limit = MAX) {
    return entries.slice(-limit);
}

export function clearLog() {
    entries.length = 0;
}

// Текст для копирования: последние N записей + окружение
export function buildReport(limit = 12) {
    const head = [];
    try {
        const ctx = SillyTavern.getContext();
        head.push(`ST ${ctx?.version || '?'} · main API: ${ctx?.mainApi || '?'}`);
        head.push(`чат: ${(ctx?.chat || []).length} сообщений`);
    } catch (e) { /* ignore */ }
    const lines = getLogEntries(limit).map(e => {
        const mark = { req: '→', ok: '✓', fail: '✕', act: '·', img: '◧' }[e.kind] || '·';
        return `${e.t} ${mark} ${e.what}${e.details ? ` — ${e.details}` : ''}`;
    });
    return `${head.join(' · ')}\n\n${lines.join('\n') || 'записей пока нет'}`;
}
