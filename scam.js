// Спам/мошенники: редкие скам-смс с незнакомых номеров. Генерация ленивая,
// с кулдауном и вероятностью — модель НЕ дёргается на каждое сообщение.

import { getMeta, saveMeta, getSettings } from './state.js';
import { generateScamSms } from './social.js';

const COOLDOWN_MS = 35 * 60 * 1000; // не чаще раза в ~35 минут реального времени
const CHANCE = 0.08;                // шанс на каждый ход бота (после кулдауна)
const MIN_CHAT_LEN = 8;             // в самом начале чата спам не лезет

function getScam() {
    const m = getMeta();
    if (!m.scam || typeof m.scam !== 'object') m.scam = {};
    if (!Number.isFinite(m.scam.lastAt)) m.scam.lastAt = 0;
    if (!Number.isFinite(m.scam.count)) m.scam.count = 0;
    return m.scam;
}

let _inflight = false;

// Возвращает {from, text} или null. force=true — без кулдауна/вероятности.
export async function maybeScamSms({ force = false } = {}) {
    if (_inflight) return null;
    if (getSettings().scamEnabled === false) return null;
    const sc = getScam();
    if (!force) {
        let chatLen = 0;
        try { chatLen = (SillyTavern.getContext()?.chat || []).length; } catch (e) { return null; }
        if (chatLen < MIN_CHAT_LEN) return null;
        if (Date.now() - sc.lastAt < COOLDOWN_MS) return null;
        if (Math.random() > CHANCE) return null;
    }
    _inflight = true;
    try {
        // lastAt ставим ДО генерации: неудачная попытка тоже уходит в кулдаун
        sc.lastAt = Date.now();
        saveMeta();
        const sms = await generateScamSms();
        if (sms) { sc.count++; saveMeta(); }
        return sms;
    } catch (e) {
        return null;
    } finally {
        _inflight = false;
    }
}

export function scamCount() { return getScam().count; }
