// ═══════════════════════════════════════════
// ТЕЛЕФОН — БАНК: баланс, кредиты, обязательные платежи, напоминания, траты
//
// Данные per-chat в chat_metadata.glassphone.bank. Синхронизация с ролевой —
// тег <!--tel:bank:{"amount":-500,"label":"кофе"}--> (плюс = доход, минус =
// трата); харвест как у соцсетей (дедуп по хэшу). Напоминания об обязательных
// платежах привязаны к RP-дате (getRpDateTime из Pregnancy-совместимых тегов).
// ═══════════════════════════════════════════

import { getMeta, saveMeta, getRpDateTime, stripThink } from './state.js';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function hash32(str) {
    let h = 0; const s = String(str);
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return String(h);
}

function safeJson(raw) {
    try { return JSON.parse(raw); } catch (e) {
        try { return JSON.parse(String(raw).replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"')); } catch (e2) { return null; }
    }
}

// ── Хранилище ──
export function getBank() {
    const m = getMeta();
    if (!m.bank || typeof m.bank !== 'object') m.bank = {};
    const b = m.bank;
    if (typeof b.balance !== 'number') b.balance = 0;
    if (typeof b.currency !== 'string') b.currency = '₽';
    if (!Array.isArray(b.transactions)) b.transactions = [];
    if (!Array.isArray(b.loans)) b.loans = [];
    if (!Array.isArray(b.recurring)) b.recurring = [];
    if (!Array.isArray(b.seenTags)) b.seenTags = [];
    return b;
}

// «Активен» ли банк — используется, чтобы не инжектить его правила зря
export function bankActive() {
    const b = getBank();
    return b.balance !== 0 || b.transactions.length > 0 || b.loans.length > 0 || b.recurring.length > 0;
}

export function setCurrency(sym) {
    const b = getBank();
    b.currency = String(sym || '₽').slice(0, 3) || '₽';
    saveMeta();
}

// ── Форматирование денег ──
export function fmtMoney(n) {
    const b = getBank();
    const neg = n < 0;
    const num = Math.abs(Math.round(Number(n) || 0)).toLocaleString('ru-RU');
    const c = b.currency;
    const body = (c === '$' || c === '€' || c === '£') ? `${c}${num}` : `${num} ${c}`;
    return neg ? `−${body}` : body;
}

// ── Транзакции (amount: + доход / − трата) ──
export function addTransaction({ amount, label, category = 'другое', silent = false }) {
    const b = getBank();
    const amt = Math.round(Number(amount) || 0);
    if (!amt) return null;
    const tx = {
        id: genId(), amount: amt,
        label: String(label || '').slice(0, 60) || (amt > 0 ? 'Поступление' : 'Списание'),
        category: String(category || 'другое').slice(0, 24), time: Date.now(),
    };
    b.transactions.unshift(tx);
    b.balance += amt;
    if (b.transactions.length > 200) b.transactions = b.transactions.slice(0, 200);
    if (!silent) saveMeta();
    return tx;
}

export function deleteTransaction(id) {
    const b = getBank();
    const tx = b.transactions.find(t => t.id === id);
    if (!tx) return;
    b.balance -= tx.amount; // откат баланса
    b.transactions = b.transactions.filter(t => t.id !== id);
    saveMeta();
}

// ── Кредиты (аннуитет) ──
export function takeLoan({ name, amount, months, rate = 0.18, day = 1 }) {
    const b = getBank();
    const principal = Math.round(Number(amount) || 0);
    if (principal <= 0) return null;
    const m = Math.max(1, Math.min(360, parseInt(months) || 12));
    const r = Math.max(0, Number(rate) || 0);
    const mr = r / 12;
    const monthly = mr > 0
        ? Math.round(principal * mr * Math.pow(1 + mr, m) / (Math.pow(1 + mr, m) - 1))
        : Math.round(principal / m);
    const loan = {
        id: genId(), name: String(name || 'Кредит').slice(0, 40),
        principal, remaining: monthly * m, monthly, months: m, rate: r,
        day: Math.max(1, Math.min(31, parseInt(day) || 1)),
        opened: Date.now(), paidOff: false, lastPaidMonth: null,
    };
    b.loans.unshift(loan);
    // деньги приходят на баланс отдельной транзакцией
    addTransaction({ amount: principal, label: `Кредит «${loan.name}»`, category: 'кредит', silent: true });
    saveMeta();
    return loan;
}

export function payLoanInstallment(id, customAmount = null) {
    const b = getBank();
    const loan = b.loans.find(l => l.id === id);
    if (!loan || loan.paidOff) return;
    const pay = Math.min(loan.remaining, Math.round(customAmount != null ? Number(customAmount) : loan.monthly));
    if (pay <= 0) return;
    addTransaction({ amount: -pay, label: `Платёж по кредиту «${loan.name}»`, category: 'кредит', silent: true });
    loan.remaining -= pay;
    loan.lastPaidMonth = currentYearMonth();
    if (loan.remaining <= 0) { loan.remaining = 0; loan.paidOff = true; }
    saveMeta();
}

export function deleteLoan(id) {
    const b = getBank();
    b.loans = b.loans.filter(l => l.id !== id);
    saveMeta();
}

export function totalDebt() {
    return getBank().loans.reduce((s, l) => s + (l.remaining || 0), 0);
}
export function monthlyLoanPayment() {
    return getBank().loans.reduce((s, l) => s + (l.paidOff ? 0 : l.monthly), 0);
}

// ── Обязательные (регулярные) платежи ──
export function addRecurring({ name, amount, day, category = 'подписка' }) {
    const b = getBank();
    const rec = {
        id: genId(), name: String(name || '').slice(0, 40) || 'Платёж',
        amount: Math.abs(Math.round(Number(amount) || 0)),
        day: Math.max(1, Math.min(31, parseInt(day) || 1)),
        category: String(category || 'подписка').slice(0, 24), lastPaidMonth: null,
    };
    b.recurring.push(rec);
    saveMeta();
    return rec;
}

export function delRecurring(id) {
    const b = getBank();
    b.recurring = b.recurring.filter(r => r.id !== id);
    saveMeta();
}

function currentYearMonth() {
    const rp = getRpDateTime();
    if (rp) return `${rp.year}-${String(rp.month).padStart(2, '0')}`;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function currentDay() {
    const rp = getRpDateTime();
    return rp ? rp.day : new Date().getDate();
}

export function payRecurring(id) {
    const b = getBank();
    const rec = b.recurring.find(r => r.id === id);
    if (!rec) return;
    addTransaction({ amount: -rec.amount, label: rec.name, category: rec.category, silent: true });
    rec.lastPaidMonth = currentYearMonth();
    saveMeta();
}

export function monthlyObligations() {
    return getBank().recurring.reduce((s, r) => s + r.amount, 0);
}

// Напоминания: обязательные платежи И кредиты, срок которых в этом RP-месяце
// наступил и ещё не оплачены. Нормализованный вид:
// { kind:'bill'|'loan', id, name, amount, day, overdue }
export function getBankReminders() {
    const b = getBank();
    const day = currentDay();
    const ym = currentYearMonth();
    const due = [];
    for (const r of b.recurring) {
        if (r.lastPaidMonth === ym) continue;
        if (day >= r.day) due.push({ kind: 'bill', id: r.id, name: r.name, amount: r.amount, day: r.day, overdue: day > r.day });
    }
    for (const l of b.loans) {
        if (l.paidOff || !l.day) continue;
        if (l.lastPaidMonth === ym) continue;
        if (day >= l.day) due.push({ kind: 'loan', id: l.id, name: l.name, amount: Math.min(l.remaining, l.monthly), day: l.day, overdue: day > l.day });
    }
    return due;
}

// ── Траты по категориям (для сводки) ──
export function spendingByCategory(limit = 6) {
    const b = getBank();
    const map = new Map();
    for (const t of b.transactions) {
        if (t.amount >= 0) continue; // только расходы
        map.set(t.category, (map.get(t.category) || 0) + Math.abs(t.amount));
    }
    return [...map.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, limit).map(([category, sum]) => ({ category, sum }));
}

export function incomeExpenseTotals() {
    const b = getBank();
    let income = 0, expense = 0;
    for (const t of b.transactions) {
        if (t.amount >= 0) income += t.amount; else expense += -t.amount;
    }
    return { income, expense };
}

// ── Сводка для инжекции в ролевую (короткая строка, только если банк активен) ──
export function getBankSummaryLine() {
    if (!bankActive()) return '';
    const b = getBank();
    const parts = [`bank balance ${fmtMoney(b.balance)}`];
    const debt = totalDebt();
    if (debt > 0) parts.push(`loan debt ${fmtMoney(debt)} (monthly ${fmtMoney(monthlyLoanPayment())})`);
    const oblig = monthlyObligations();
    if (oblig > 0) parts.push(`fixed monthly bills ${fmtMoney(oblig)}`);
    if (b.balance < 0) parts.push('she is in overdraft / broke');
    return `- Her bank/finances: ${parts.join(', ')}. The SOURCE and details are private — characters only sense whether she can afford things.`;
}

// ── Одна компактная строка-правило для директивы (инжектится только если банк активен) ──
export function bankInjectRule() {
    if (!bankActive()) return '';
    return `[BANK] {{user}}'s phone has a bank app. If in THIS reply the story makes {{user}} spend or receive money (buys something, gets paid, someone transfers her cash), append a hidden comment at the END: <!--tel:bank:{"amount":-500,"label":"что купила"}--> (negative = spent, positive = received; amount is a number, no currency sign). One tag per transaction. This INCLUDES bank notification SMS: if you send {{user}} an SMS from a bank about money credited/debited, the tel:bank tag with the same amount is MANDATORY alongside it — the SMS alone does not move money in the app. Do NOT tag hypothetical or other characters' money — only {{user}}'s real transactions.`;
}

// ── Харвест тегов tel:bank + банковских СМС из чата ──
const BANK_TAG_RE = /<!--\s*tel:bank:(\{[\s\S]*?\})\s*-->/gi;
const SMS_TAG_RE = /<!--\s*tel:sms:(\{[\s\S]*?\})\s*-->/gi;

// «Банковская» смс: отправитель похож на банк, текст содержит сумму и слово-направление.
// Страховка на случай, когда модель написала смс от банка, но забыла tel:bank тег
// («смс о списании пришла, а в банке пусто»).
const BANK_SENDER_RE = /банк|bank|сбер|тинькофф|tinkoff|альфа|втб|райффайзен|газпром|озон|уралсиб|росбанк|совкомбанк|мтс[\s-]?банк|900/i;
const SPEND_RE = /списан|списание|покупк|оплат|платил|платеж|платёж|перевод\s+(отправлен|выполнен)|снятие|снят[оы]|аренда|штраф|комисси/i;
const INCOME_RE = /пополнен|пополнение|зачислен|поступлени|перевод\s+от|получен\s+перевод|возврат|зарплат|начислен|кэшбэк|cashback/i;
const AMOUNT_RE = /(\d[\d\s]{0,12}(?:[.,]\d{1,2})?)\s*(?:₽|руб|р\.|р\b|\$|€|£|usd|eur)/i;

function parseBankSms(smsJson) {
    const from = String(smsJson.from || '');
    const text = String(smsJson.text || '');
    if (!BANK_SENDER_RE.test(from) && !BANK_SENDER_RE.test(text.slice(0, 40))) return null;
    const am = text.match(AMOUNT_RE);
    if (!am) return null;
    const amount = Math.round(parseFloat(am[1].replace(/\s/g, '').replace(',', '.')) || 0);
    if (!amount) return null;
    let sign = 0;
    if (SPEND_RE.test(text)) sign = -1;
    else if (INCOME_RE.test(text)) sign = 1;
    if (!sign) return null;
    // Метка: кусок текста без суммы, коротко
    const label = text.replace(AMOUNT_RE, '').replace(/\s+/g, ' ').trim().slice(0, 50) || (sign < 0 ? 'Списание (смс банка)' : 'Пополнение (смс банка)');
    return { amount: sign * amount, label, category: 'смс банка' };
}

export function harvestBankTags() {
    const b = getBank();
    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { return 0; }
    let added = 0;
    const seen = new Set(b.seenTags);
    for (const msg of chat) {
        if (!msg || !msg.mes) continue;
        // is_system пропускаем, НО наши смс-призраки (is_system на 1.5с) содержат
        // tel:sms банка — их тоже сканируем
        if (msg.is_system && !/tel:(bank|sms)/i.test(msg.mes)) continue;
        const text = stripThink(msg.mes);

        // 1) Явные теги tel:bank (протокол)
        let hasBankTag = false;
        BANK_TAG_RE.lastIndex = 0;
        let m;
        while ((m = BANK_TAG_RE.exec(text)) !== null) {
            hasBankTag = true;
            const h = 'bk' + hash32(m[1]);
            if (seen.has(h)) continue;
            seen.add(h); b.seenTags.push(h);
            const j = safeJson(m[1]);
            if (!j || typeof j.amount === 'undefined' || !Number(j.amount)) continue;
            addTransaction({
                amount: Number(j.amount) || 0,
                label: j.label || j.text || 'Из ролевой',
                category: j.category || 'ролевая',
                silent: true,
            });
            added++;
        }

        // 2) Смс от банка без тега (страховка). Если в сообщении УЖЕ был tel:bank —
        // не парсим смс того же сообщения (иначе одна операция задвоится).
        if (!hasBankTag) {
            SMS_TAG_RE.lastIndex = 0;
            while ((m = SMS_TAG_RE.exec(text)) !== null) {
                const h = 'bs' + hash32(m[1]);
                if (seen.has(h)) continue;
                const j = safeJson(m[1]);
                if (!j) continue;
                const tx = parseBankSms(j);
                if (!tx) continue;
                seen.add(h); b.seenTags.push(h);
                addTransaction({ ...tx, silent: true });
                added++;
            }
        }
    }
    if (b.seenTags.length > 400) b.seenTags = b.seenTags.slice(-400);
    if (added) saveMeta();
    return added;
}

// Кол-во напоминаний (для бейджа приложения)
export function bankBadgeCount() {
    return getBankReminders().length;
}
