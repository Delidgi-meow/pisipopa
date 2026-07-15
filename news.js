// Новости: генерируемая лента города/мира. Ленивая (по кнопке), кэш per-chat.

import { getMeta, saveMeta } from './state.js';
import { generateNewsFeed, logSocialToChat, getUserName } from './social.js';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function getNews() {
    const m = getMeta();
    if (!m.news || typeof m.news !== 'object') m.news = {};
    if (!Array.isArray(m.news.items)) m.news.items = [];
    return m.news;
}

let _inflight = false;
export async function refreshNews() {
    if (_inflight) throw new Error('уже генерируется');
    _inflight = true;
    try {
        const n = getNews();
        const arr = await generateNewsFeed(n.items.slice(0, 12).map(x => x.title));
        if (!Array.isArray(arr) || !arr.length) throw new Error('Лента не сгенерировалась — попробуй ещё раз');
        const fresh = arr.filter(it => it && it.title).slice(0, 10).map(it => ({
            id: genId(),
            tag: String(it.tag || 'новости').slice(0, 26),
            title: String(it.title).slice(0, 90),
            text: String(it.text || '').slice(0, 500),
            time: Date.now() - Math.floor(Math.random() * 4 * 3600 * 1000),
        }));
        n.items = [...fresh, ...n.items].slice(0, 40);
        n.at = Date.now();
        saveMeta();
        return fresh.length;
    } finally {
        _inflight = false;
    }
}

// «Поделиться» — новость уходит скрытой строкой в чат: ролевая узнаёт, что она
// это прочитала, и может отреагировать
export function shareNews(id) {
    const it = getNews().items.find(x => x.id === id);
    if (!it) return false;
    logSocialToChat(`${getUserName()} прочитала в новостях: «${it.title}» — ${it.text}`);
    return true;
}

export function deleteNews(id) {
    const n = getNews();
    n.items = n.items.filter(x => x.id !== id);
    saveMeta();
}
