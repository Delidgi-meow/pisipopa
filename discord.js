// Дискорд: серверы/каналы/сообщения. Всё генерируется лениво (по кнопкам),
// хранится per-chat в meta. Нагрузки на инжект нет — только строки журнала.

import { getMeta, saveMeta } from './state.js';
import { generateDiscordServers, generateOwnDiscordServer, generateDiscordFeed, logSocialToChat, getUserName } from './social.js';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function getDiscord() {
    const m = getMeta();
    if (!m.discord || typeof m.discord !== 'object') m.discord = {};
    if (!Array.isArray(m.discord.servers)) m.discord.servers = [];
    return m.discord;
}

export function findDServer(sid) { return getDiscord().servers.find(s => s.id === sid) || null; }
export function findDChannel(sid, cid) { return findDServer(sid)?.channels.find(c => c.id === cid) || null; }

let _inflight = false;

export async function refreshDiscordServers() {
    if (_inflight) throw new Error('уже генерируется');
    _inflight = true;
    try {
        const d = getDiscord();
        const arr = await generateDiscordServers(d.servers.map(s => s.name));
        if (!Array.isArray(arr) || !arr.length) throw new Error('Серверы не сгенерировались — попробуй ещё раз');
        const fresh = arr.filter(s => s && s.name).slice(0, 4).map(s => ({
            id: genId(),
            name: String(s.name).slice(0, 60),
            desc: String(s.desc || '').slice(0, 160),
            members: (Array.isArray(s.members) ? s.members : []).map(x => String(x).slice(0, 32)).slice(0, 14),
            channels: (Array.isArray(s.channels) ? s.channels : []).filter(c => c && c.name).slice(0, 5).map(c => ({
                id: genId(),
                name: String(c.name).replace(/^#/, '').slice(0, 40),
                topic: String(c.topic || '').slice(0, 120),
                messages: [],
            })),
        })).filter(s => s.channels.length);
        d.servers = [...d.servers, ...fresh].slice(0, 8);
        saveMeta();
        return fresh.length;
    } finally {
        _inflight = false;
    }
}

// Свой сервер: юзер задаёт имя+тему, модель наполняет каналами/участниками.
// mine:true — она владелец (в UI отдельная пометка, кнопка выхода = удалить).
export async function createOwnDServer(name, theme) {
    name = String(name || '').trim();
    if (!name) throw new Error('Назови сервер');
    if (_inflight) throw new Error('уже генерируется');
    _inflight = true;
    try {
        const d = getDiscord();
        const gen = await generateOwnDiscordServer(name, theme);
        const channels = (gen && Array.isArray(gen.channels) ? gen.channels : [])
            .filter(c => c && c.name).slice(0, 6).map(c => ({
                id: genId(),
                name: String(c.name).replace(/^#/, '').slice(0, 40),
                topic: String(c.topic || '').slice(0, 120),
                messages: [],
            }));
        // Фолбэк: хотя бы один канал, даже если модель не расщедрилась
        if (!channels.length) channels.push({ id: genId(), name: 'general', topic: '', messages: [] });
        const srv = {
            id: genId(),
            name: name.slice(0, 60),
            desc: String(gen?.desc || theme || '').slice(0, 160),
            mine: true,
            members: (gen && Array.isArray(gen.members) ? gen.members : [])
                .map(x => String(x).slice(0, 32)).slice(0, 16),
            channels,
        };
        d.servers = [srv, ...d.servers].slice(0, 10);
        saveMeta();
        logSocialToChat(`${getUserName()} создала свой Discord-сервер «${srv.name}»${srv.desc ? ` (${srv.desc})` : ''}`);
        return srv;
    } finally {
        _inflight = false;
    }
}

function pushMessages(ch, arr, cap = 60) {
    const fresh = (Array.isArray(arr) ? arr : []).filter(x => x && x.author && x.text).map(x => ({
        id: genId(),
        author: String(x.author).slice(0, 32),
        text: String(x.text).slice(0, 500),
        ts: Date.now(),
    }));
    ch.messages = [...ch.messages, ...fresh].slice(-cap);
    return fresh.length;
}

// Оживить канал (кнопка ↻): свежий срез разговора
export async function refreshDChannel(sid, cid) {
    if (_inflight) throw new Error('уже генерируется');
    const srv = findDServer(sid);
    const ch = findDChannel(sid, cid);
    if (!srv || !ch) return 0;
    _inflight = true;
    try {
        const n = pushMessages(ch, await generateDiscordFeed(srv, ch, ch.messages));
        if (!n) throw new Error('Канал молчит — попробуй ещё раз');
        saveMeta();
        return n;
    } finally {
        _inflight = false;
    }
}

// Пост юзера: сообщение сразу в канал + журнал, ответы участников следом.
// replyTo = {author, text} — она ответила на конкретное сообщение (реплай как в дискорде)
export async function postToDChannel(sid, cid, text, replyTo = null) {
    const srv = findDServer(sid);
    const ch = findDChannel(sid, cid);
    if (!srv || !ch || !text) return 0;
    const entry = { id: genId(), author: getUserName(), text: String(text).slice(0, 500), ts: Date.now(), user: true };
    if (replyTo && replyTo.author) {
        entry.replyTo = { author: String(replyTo.author).slice(0, 32), text: String(replyTo.text || '').slice(0, 120) };
    }
    ch.messages = [...ch.messages, entry].slice(-60);
    saveMeta();
    logSocialToChat(entry.replyTo
        ? `${getUserName()} ответила в дискорд-канале #${ch.name} («${srv.name}») на сообщение ${entry.replyTo.author} «${entry.replyTo.text}»: «${text}»`
        : `${getUserName()} написала в дискорд-канале #${ch.name} сервера «${srv.name}»: «${text}»`);
    if (_inflight) return 0;
    _inflight = true;
    try {
        const n = pushMessages(ch, await generateDiscordFeed(srv, ch, ch.messages, text, entry.replyTo));
        saveMeta();
        return n;
    } finally {
        _inflight = false;
    }
}

export function deleteDServer(sid) {
    const d = getDiscord();
    d.servers = d.servers.filter(s => s.id !== sid);
    saveMeta();
}
