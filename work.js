// Работа: объявления о вакансиях, трудоустройство, смены, карьерная лестница.
// Всё генерируется лениво (по кнопкам) и хранится per-chat в meta.

import { getMeta, saveMeta, getRpDateTime } from './state.js';
import { generateJobListings, generateShiftOutcome, generatePromotionVerdict, logSocialToChat, getUserName } from './social.js';
import { addTransaction, getBank, fmtMoney } from './bank.js';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function getWork() {
    const m = getMeta();
    if (!m.work || typeof m.work !== 'object') m.work = {};
    const w = m.work;
    if (!Array.isArray(w.listings)) w.listings = [];   // текущие объявления
    if (!('job' in w)) w.job = null;                   // где работает сейчас
    if (!Array.isArray(w.history)) w.history = [];     // прошлые места
    return w;
}

export function currentJob() { return getWork().job; }

// ── Объявления ──
let _inflight = false;

export async function refreshListings() {
    if (_inflight) throw new Error('уже генерируется');
    _inflight = true;
    try {
        const w = getWork();
        const arr = await generateJobListings(w.listings.map(l => l.title), w.job);
        if (!Array.isArray(arr) || !arr.length) throw new Error('Вакансий не нашлось — попробуй ещё раз');
        w.listings = arr.filter(j => j && j.title).slice(0, 8).map(j => ({
            id: genId(),
            title: String(j.title).slice(0, 60),
            company: String(j.company || '').slice(0, 50),
            field: String(j.field || '').slice(0, 40),
            salary: Math.max(0, Math.round(Number(j.salary) || 0)),
            schedule: String(j.schedule || '').slice(0, 60),
            requirements: String(j.requirements || '').slice(0, 200),
            duties: String(j.duties || '').slice(0, 200),
            // Лестница: куда можно дорасти на этом месте
            ladder: (Array.isArray(j.ladder) ? j.ladder : []).slice(0, 5).map((s, i) => ({
                title: String(s?.title || '').slice(0, 60),
                salary: Math.max(0, Math.round(Number(s?.salary) || 0)),
                level: i,
            })).filter(s => s.title),
        }));
        saveMeta();
        return w.listings.length;
    } finally {
        _inflight = false;
    }
}

// ── Трудоустройство ──
export function takeJob(listingId) {
    const w = getWork();
    const l = w.listings.find(x => x.id === listingId);
    if (!l) return null;
    if (w.job) leaveJob({ silent: true });
    w.job = {
        id: genId(),
        title: l.title, company: l.company, field: l.field,
        salary: l.salary, schedule: l.schedule, duties: l.duties,
        ladder: l.ladder || [],
        level: 0,              // ступень на лестнице
        shifts: 0,             // отработано смен
        performance: 50,       // как справляется, 0..100
        startedAt: Date.now(),
        lastPaidMonth: null,
        tasks: (l.tasks || []).slice(0, 4).map(t => ({ id: genId(), text: String(t).slice(0, 200), done: false, at: Date.now() })),
    };
    w.listings = w.listings.filter(x => x.id !== listingId);
    saveMeta();
    try {
        logSocialToChat(`${getUserName()} устраивается на работу: ${l.title}${l.company ? ` (${l.company})` : ''}, оклад ${fmtMoney(l.salary)}`);
    } catch (e) { /* ignore */ }
    return w.job;
}

export function leaveJob({ silent = false } = {}) {
    const w = getWork();
    if (!w.job) return false;
    w.history.unshift({ ...w.job, endedAt: Date.now() });
    w.history = w.history.slice(0, 10);
    const gone = w.job;
    w.job = null;
    saveMeta();
    if (!silent) {
        try {
            logSocialToChat(`${getUserName()} увольняется: ${gone.title}${gone.company ? ` (${gone.company})` : ''}`);
        } catch (e) { /* ignore */ }
    }
    return true;
}

// ── Смена ──
// Отработать смену: модель описывает, как прошло, это двигает показатель
// и приносит деньги. Оплата — доля оклада за смену.
export async function workShift() {
    const w = getWork();
    const job = w.job;
    if (!job) throw new Error('Ты нигде не работаешь');
    const out = await generateShiftOutcome(job);
    if (!out || !out.summary) throw new Error('Смена не описалась — попробуй ещё раз');
    const delta = Math.max(-15, Math.min(15, Math.round(Number(out.performance_delta) || 0)));
    job.performance = Math.max(0, Math.min(100, job.performance + delta));
    job.shifts++;
    const pay = Math.max(1, Math.round(job.salary / 22));   // примерно смена месяца
    addTransaction({ amount: pay, label: `Смена: ${job.title}`, category: 'зарплата', silent: true });
    job.lastShift = { summary: String(out.summary).slice(0, 600), delta, pay, at: Date.now() };
    if (Array.isArray(out.tasks) && out.tasks.length) addTasks(out.tasks);
    saveMeta();
    try {
        logSocialToChat(`${getUserName()} отработала смену: ${job.title}. ${job.lastShift.summary}`);
    } catch (e) { /* ignore */ }
    return job.lastShift;
}

// ── Повышение ──
export function nextStep(job = currentJob()) {
    if (!job || !Array.isArray(job.ladder)) return null;
    return job.ladder[job.level] || null;
}

// Готов ли к повышению: смены и показатель. Порог растёт со ступенью —
// чем выше сидишь, тем дольше ждать следующей.
export function promotionReady(job = currentJob()) {
    const step = nextStep(job);
    if (!step) return { ready: false, need: null };
    const needShifts = 5 + job.level * 4;
    const needPerf = 60 + job.level * 5;
    return {
        ready: job.shifts >= needShifts && job.performance >= needPerf,
        need: { shifts: needShifts, performance: needPerf },
        step,
    };
}

export async function askPromotion() {
    const w = getWork();
    const job = w.job;
    if (!job) throw new Error('Ты нигде не работаешь');
    const step = nextStep(job);
    if (!step) throw new Error('Выше расти некуда');
    const verdict = await generatePromotionVerdict(job, step, promotionReady(job));
    if (!verdict) throw new Error('Начальство молчит — попробуй ещё раз');
    const granted = !!verdict.granted;
    if (granted) {
        job.level++;
        job.title = step.title;
        job.salary = step.salary || Math.round(job.salary * 1.3);
        job.performance = Math.max(40, job.performance - 10);   // новая роль — снова доказывать
    }
    job.lastVerdict = { granted, text: String(verdict.text || '').slice(0, 600), at: Date.now() };
    saveMeta();
    try {
        logSocialToChat(granted
            ? `${getUserName()} получает повышение: теперь ${job.title}, оклад ${fmtMoney(job.salary)}. ${job.lastVerdict.text}`
            : `${getUserName()} просит повышение и получает отказ. ${job.lastVerdict.text}`);
    } catch (e) { /* ignore */ }
    return job.lastVerdict;
}

// ── Зарплата ──
// Оклад приходит раз в месяц ролевого времени, при первом заходе в новом месяце
function currentYearMonth() {
    const d = getRpDateTime();
    if (d && Number.isFinite(d.year)) return `${d.year}-${String(d.month).padStart(2, '0')}`;
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

export function paySalaryIfDue() {
    const job = currentJob();
    if (!job || !job.salary) return null;
    const ym = currentYearMonth();
    if (job.lastPaidMonth === ym) return null;
    // Первый месяц на работе не оплачиваем задним числом
    if (!job.lastPaidMonth) { job.lastPaidMonth = ym; saveMeta(); return null; }
    job.lastPaidMonth = ym;
    addTransaction({ amount: job.salary, label: `Зарплата: ${job.title}`, category: 'зарплата', silent: true });
    saveMeta();
    return { amount: job.salary, title: job.title };
}

// ── Задания от начальства ──
// Живут в карточке места. Отметить можно руками, а можно отыграть в ролевой:
// модель закроет задание тем же тегом, которым отмечает смену.
export function addTasks(list) {
    const job = currentJob();
    if (!job || !Array.isArray(list)) return 0;
    if (!Array.isArray(job.tasks)) job.tasks = [];
    let n = 0;
    for (const t of list) {
        const text = String(t?.text || t || '').trim().slice(0, 200);
        if (!text || job.tasks.some(x => x.text === text)) continue;
        job.tasks.push({ id: genId(), text, done: false, at: Date.now() });
        n++;
    }
    job.tasks = job.tasks.slice(-8);
    if (n) saveMeta();
    return n;
}

export function toggleTask(id) {
    const job = currentJob();
    const t = job?.tasks?.find(x => x.id === id);
    if (!t) return false;
    t.done = !t.done;
    if (t.done) { job.performance = Math.min(100, job.performance + 3); }
    saveMeta();
    return t.done;
}

// Закрыть задание по описанию из ролевой: сверяем по заметным словам,
// потому что модель перескажет его своими словами, а не дословно
function closeTaskByText(job, text) {
    const words = String(text || '').toLowerCase().split(/[^а-яёa-z0-9]+/i).filter(w => w.length >= 5);
    if (!words.length) return null;
    const hit = (job.tasks || []).find(t => {
        if (t.done) return false;
        const tw = t.text.toLowerCase();
        return words.filter(w => tw.includes(w)).length >= 2;
    });
    if (!hit) return null;
    hit.done = true;
    job.performance = Math.min(100, job.performance + 3);
    return hit;
}

// ── Смены, отыгранные в ролевой ──
// Модель ставит <!--tel:work:{...}--> когда {{user}} отработала в сцене.
const WORK_TAG_RE = /<!--\s*tel:work:(\{[\s\S]*?\})\s*-->/gi;

function safeJson(raw) {
    try { return JSON.parse(raw); } catch (e) {
        try { return JSON.parse(String(raw).replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"')); } catch (e2) { return null; }
    }
}

export function harvestWorkTags() {
    const w = getWork();
    const job = w.job;
    if (!job) return 0;
    if (!Array.isArray(w.seenTags)) w.seenTags = [];
    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { return 0; }
    const seen = new Set(w.seenTags);
    let counted = 0;
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg || !msg.mes || msg.is_user) continue;
        WORK_TAG_RE.lastIndex = 0;
        let m;
        while ((m = WORK_TAG_RE.exec(String(msg.mes))) !== null) {
            const key = `wk${m[1].length}:${String(msg.send_date || msg.extra?.gen_id || i)}:${m.index}`;
            if (seen.has(key)) continue;
            seen.add(key); w.seenTags.push(key);
            const j = safeJson(m[1]);
            if (!j) continue;
            const closed = j.task ? closeTaskByText(job, j.task) : null;
            if (j.shift !== false) {
                const delta = Math.max(-15, Math.min(15, Math.round(Number(j.delta) || 2)));
                job.performance = Math.max(0, Math.min(100, job.performance + delta));
                job.shifts++;
                const pay = Math.max(1, Math.round(job.salary / 22));
                addTransaction({ amount: pay, label: `Смена: ${job.title}`, category: 'зарплата', silent: true });
                job.lastShift = {
                    summary: String(j.summary || 'Смена отыграна в ролевой.').slice(0, 600),
                    delta, pay, at: Date.now(), fromRp: true,
                };
                counted++;
            } else if (closed) {
                counted++;
            }
        }
    }
    if (w.seenTags.length > 200) w.seenTags = w.seenTags.slice(-200);
    if (counted) saveMeta();
    return counted;
}

// Строка для инжекта: ролевая должна знать, где {{user}} работает
export function workInjectLine() {
    const job = currentJob();
    if (!job) return '';
    const step = nextStep(job);
    const open = (job.tasks || []).filter(t => !t.done).map(t => t.text);
    let out = `- Work: ${job.title}${job.company ? ` at ${job.company}` : ''}, ${fmtMoney(job.salary)}/month, ${job.schedule || 'schedule unspecified'}. `
        + `Shifts worked: ${job.shifts}; how they are coping: ${job.performance}/100.`
        + (step ? ` Next step on the ladder: ${step.title}.` : ' Top of the ladder.');
    if (open.length) out += `\n- Open work tasks: ${open.join('; ')}.`;
    out += `\n- If {{user}} actually works a shift or handles a work task IN THE SCENE, append at the very END:`
        + `\n<!--tel:work:{"summary":"one sentence about how the shift went","delta":2}-->`
        + ` — delta from -15 to +15 is how well it went. Add "task":"which task was handled" if they closed one of the open tasks;`
        + ` add "shift":false if it was only a task and not a whole shift. One tag per shift, never for merely talking about work.`;
    return out;
}

export function workActive() {
    const w = getWork();
    return !!(w.job || w.listings.length || w.history.length);
}
