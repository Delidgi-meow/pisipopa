// Каналы: свой и чужие, посты с реакциями, просмотрами и обсуждением.
// Данные лежат per-chat в meta; генерация — по кнопкам и после своих постов.

import { getMeta, saveMeta, keyOf, stripThink } from './state.js';
import { logSocialToChat, getUserName } from './social.js';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export const CHAN_REACTS = ['🔥', '❤️', '😮', '😂', '💔', '👍'];

export function getChannels() {
    const m = getMeta();
    if (!m.channels || typeof m.channels !== 'object') m.channels = {};
    const c = m.channels;
    if (!('mine' in c)) c.mine = null;          // свой канал (один)
    if (!Array.isArray(c.list)) c.list = [];    // чужие: найденные и подписки
    return c;
}

export function myChannel() { return getChannels().mine; }

// Свой канал в общем списке идёт первым — экранам удобнее один массив
export function allChannels() {
    const c = getChannels();
    return c.mine ? [c.mine, ...c.list] : [...c.list];
}

export function findChannel(id) { return allChannels().find(x => x.id === id) || null; }

export function findChanPost(chanId, postId) {
    return (findChannel(chanId)?.posts || []).find(p => p.id === postId) || null;
}

export function unreadChannels() {
    return allChannels().reduce((n, ch) => n + (ch.mine ? 0 : (ch.unread || 0)), 0);
}

export function markChannelRead(id) {
    const ch = findChannel(id);
    if (!ch || !ch.unread) return;
    ch.unread = 0;
    saveMeta();
}

export function createMyChannel(name, desc) {
    const c = getChannels();
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw new Error('Назови канал');
    c.mine = {
        id: genId(),
        mine: true,
        name: n,
        desc: String(desc || '').trim().slice(0, 200),
        author: getUserName(),
        subs: 20 + Math.floor(Math.random() * 40),
        subsDelta: 0,
        posts: [],
        createdAt: Date.now(),
    };
    saveMeta();
    logSocialToChat(`${getUserName()} заводит свой канал «${c.mine.name}»${c.mine.desc ? ` (${c.mine.desc})` : ''}`);
    return c.mine;
}

export function deleteMyChannel() {
    const c = getChannels();
    if (!c.mine) return false;
    const gone = c.mine;
    c.mine = null;
    saveMeta();
    logSocialToChat(`${getUserName()} удаляет свой канал «${gone.name}»`);
    return true;
}

// ── Чужие каналы ──
export function addFoundChannels(arr) {
    const c = getChannels();
    const known = new Set(c.list.map(x => keyOf(x.name)));
    if (c.mine) known.add(keyOf(c.mine.name));
    const fresh = (Array.isArray(arr) ? arr : [])
        .filter(x => {
            if (!x || !x.name || known.has(keyOf(x.name))) return false;
            known.add(keyOf(x.name));
            return true;
        })
        .slice(0, 5)
        .map(x => ({
            id: genId(),
            mine: false,
            name: String(x.name).slice(0, 60),
            desc: String(x.desc || '').slice(0, 200),
            author: String(x.author || '').slice(0, 40),
            subs: Math.max(12, Math.round(Number(x.subs) || 500)),
            subscribed: false,
            unread: 0,
            posts: normalizePosts(x.posts),
        }));
    c.list = [...c.list, ...fresh].slice(0, 12);
    saveMeta();
    return fresh.length;
}

function normalizePosts(arr) {
    return (Array.isArray(arr) ? arr : [])
        .filter(p => p && (p.text || p.photo))
        .slice(0, 6)
        .map((p, i) => ({
            id: genId(),
            text: String(p.text || '').slice(0, 1200),
            imgDesc: String(p.photo || '').slice(0, 300),
            image: null,
            // Свежий пост сверху: чем дальше по списку, тем он старше
            time: Date.now() - i * 47 * 60000,
            views: 0,
            reacts: [],
            comments: [],
            commentsOn: p.comments_off ? false : true,
        }));
}

export function toggleSubscribe(id) {
    const ch = findChannel(id);
    if (!ch || ch.mine) return false;
    ch.subscribed = !ch.subscribed;
    if (ch.subscribed) ch.subs++;
    else { ch.subs = Math.max(0, ch.subs - 1); ch.unread = 0; }
    saveMeta();
    logSocialToChat(ch.subscribed
        ? `${getUserName()} подписывается на канал «${ch.name}»`
        : `${getUserName()} отписывается от канала «${ch.name}»`);
    return ch.subscribed;
}

export function deleteChannel(id) {
    const c = getChannels();
    c.list = c.list.filter(x => x.id !== id);
    saveMeta();
}

export function addChannelPosts(id, arr) {
    const ch = findChannel(id);
    if (!ch) return 0;
    const fresh = normalizePosts(arr);
    if (!fresh.length) return 0;
    ch.posts = [...fresh, ...(ch.posts || [])].slice(0, 40);
    if (ch.subscribed) ch.unread = (ch.unread || 0) + fresh.length;
    saveMeta();
    return fresh.length;
}

// ── Свой пост ──
export function publishToMyChannel({ text = '', image = null, imgDesc = '', commentsOn = true }) {
    const ch = myChannel();
    if (!ch) throw new Error('Сначала заведи канал');
    if (!text.trim() && !image && !imgDesc.trim()) throw new Error('Пустой пост');
    const post = {
        id: genId(),
        text: String(text).slice(0, 1200),
        image,
        imgDesc: String(imgDesc).slice(0, 300),
        time: Date.now(),
        views: 0,
        reacts: [],
        comments: [],
        commentsOn: !!commentsOn,
        mine: true,
    };
    ch.posts = [post, ...(ch.posts || [])].slice(0, 40);
    saveMeta();
    return post;
}

export function deleteChanPost(chanId, postId) {
    const ch = findChannel(chanId);
    if (!ch) return false;
    ch.posts = (ch.posts || []).filter(p => p.id !== postId);
    saveMeta();
    return true;
}

export function toggleComments(chanId, postId) {
    const p = findChanPost(chanId, postId);
    if (!p) return false;
    p.commentsOn = !p.commentsOn;
    saveMeta();
    return p.commentsOn;
}

// Реакция юзера: одна на пост, повторный тап снимает
export function toggleReact(chanId, postId, emoji) {
    const p = findChanPost(chanId, postId);
    if (!p) return;
    if (!Array.isArray(p.reacts)) p.reacts = [];
    const prev = p.reacts.find(r => r.mine);
    if (prev) {
        prev.n = Math.max(0, (prev.n || 1) - 1);
        prev.mine = false;
        if (!prev.n) p.reacts = p.reacts.filter(r => r !== prev);
        if (prev.emoji === emoji) { saveMeta(); return; }
    }
    const hit = p.reacts.find(r => r.emoji === emoji);
    if (hit) { hit.n = (hit.n || 0) + 1; hit.mine = true; }
    else p.reacts.push({ emoji, n: 1, mine: true });
    saveMeta();
}

export function addReacts(post, arr) {
    if (!post || !Array.isArray(arr)) return;
    if (!Array.isArray(post.reacts)) post.reacts = [];
    for (const r of arr.slice(0, 4)) {
        const raw = String(r?.emoji || '').trim();
        const emoji = raw && [...raw].length <= 3 && !/[\w\s]/.test(raw) ? raw : CHAN_REACTS[0];
        const n = Math.max(1, Math.min(9999, Math.round(Number(r?.n) || 1)));
        const hit = post.reacts.find(x => x.emoji === emoji);
        if (hit) hit.n = (hit.n || 0) + n;
        else post.reacts.push({ emoji, n });
    }
    post.reacts = post.reacts.slice(0, 6);
}

// ── Обсуждение ──
export function addComments(post, arr, { fromUser = false } = {}) {
    if (!post) return 0;
    if (!Array.isArray(post.comments)) post.comments = [];
    const fresh = (Array.isArray(arr) ? arr : [])
        .filter(c => c && c.author && c.text)
        .slice(0, 8)
        .map(c => ({
            id: genId(),
            author: String(c.author).slice(0, 40),
            handle: String(c.handle || '').slice(0, 32),
            text: String(c.text).slice(0, 600),
            ts: Date.now(),
            ak: fromUser ? 'user' : `contact:${keyOf(c.author)}`,
            replyTo: c.reply_to ? String(c.reply_to).slice(0, 40) : null,
            likes: Math.max(0, Math.round(Number(c.likes) || 0)),
        }));
    post.comments = [...post.comments, ...fresh].slice(-60);
    saveMeta();
    return fresh.length;
}

export function addMyComment(post, text, replyTo = null) {
    if (!post || !text.trim()) return null;
    if (!Array.isArray(post.comments)) post.comments = [];
    const c = {
        id: genId(),
        author: getUserName(),
        text: String(text).slice(0, 600),
        ts: Date.now(),
        ak: 'user',
        replyTo: replyTo ? String(replyTo).slice(0, 40) : null,
        likes: 0,
    };
    post.comments.push(c);
    post.comments = post.comments.slice(-60);
    saveMeta();
    return c;
}

export function deleteComment(post, id) {
    if (!post || !Array.isArray(post.comments)) return;
    post.comments = post.comments.filter(c => c.id !== id);
    saveMeta();
}

// Просмотры подтягиваются ко времени: свежий пост добирает охват постепенно
export function bumpViews(channel, post) {
    if (!channel || !post) return 0;
    const reach = Math.max(10, Math.round((channel.subs || 50) * 0.72));
    const ageMin = (Date.now() - (post.time || Date.now())) / 60000;
    const target = Math.round(reach * Math.min(1, 0.15 + ageMin / 600));
    if (target > (post.views || 0)) {
        post.views = target;
        saveMeta();
    }
    return post.views || 0;
}

export function addSubs(channel, n) {
    if (!channel || !n) return;
    channel.subs = Math.max(0, (channel.subs || 0) + n);
    channel.subsDelta = (channel.subsDelta || 0) + n;
    saveMeta();
}

// ── Скрин поста в лс ──
// Модель не знает id постов, поэтому ссылается на автора и текст. Ищем, что она
// имела в виду: тот же автор и заметное совпадение слов. Не нашли — карточка
// покажется серой заглушкой, а не выдумает несуществующий пост.
function words(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 4);
}

export function matchPostByText(posts, text, author = '') {
    const want = words(text);
    if (!posts?.length || !want.length) return null;
    const ak = keyOf(author);
    let best = null, bestScore = 0;
    for (const p of posts) {
        if (ak && p.author && keyOf(p.author) !== ak) continue;
        const have = new Set(words(`${p.text || ''} ${p.caption || ''} ${p.imgDesc || ''}`));
        let score = 0;
        for (const w of want) if (have.has(w)) score++;
        if (score > bestScore) { bestScore = score; best = p; }
    }
    return bestScore >= 2 ? best : null;
}


// ── Посты из ролевой ──
// Модель ведёт чужие каналы сама: <!--tel:chan:{"channel":"Имя","text":"…","photo":"…"}-->
// Свой канал пишет только она — тег с его именем игнорируется.

const CHAN_TAG_RE = /<!--\s*tel:chan:(\{[\s\S]*?\})\s*-->/gi;

function hash32(str) {
    let h = 0;
    const t = String(str);
    for (let i = 0; i < t.length; i++) h = ((h << 5) - h + t.charCodeAt(i)) | 0;
    return String(h);
}

function safeJson(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function applyChannelTag(j) {
    const name = String(j?.channel || j?.name || '').trim().slice(0, 60);
    const text = String(j?.text || '').trim();
    const photo = String(j?.photo || '').trim();
    if (!name || (!text && !photo)) return null;
    const c = getChannels();
    if (c.mine && keyOf(c.mine.name) === keyOf(name)) return null;
    let ch = c.list.find(x => keyOf(x.name) === keyOf(name));
    if (!ch) {
        // Канал, о котором ролевая заговорила впервые, появляется в списке
        // найденных — подписаться на него она решает сама
        addFoundChannels([{
            name,
            desc: String(j.desc || '').slice(0, 200),
            author: String(j.author || '').slice(0, 40),
            subs: Number(j.subs) || 0,
            posts: [],
        }]);
        ch = getChannels().list.find(x => keyOf(x.name) === keyOf(name));
        if (!ch) return null;
        ch.fromRp = true;
    }
    return addChannelPosts(ch.id, [{ text, photo }]) ? ch.name : null;
}

export function harvestChannelTags() {
    const c = getChannels();
    if (!Array.isArray(c.seenTags)) c.seenTags = [];
    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { return { n: 0, names: [] }; }
    const seen = new Set(c.seenTags);
    const names = [];
    for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        // Свои сообщения не сканируем: посты в каналы она публикует из телефона
        if (!msg || !msg.mes || msg.is_user || !/tel:chan/i.test(msg.mes)) continue;
        const text = stripThink(msg.mes);
        const occ = {};
        CHAN_TAG_RE.lastIndex = 0;
        let m;
        while ((m = CHAN_TAG_RE.exec(text)) !== null) {
            // Ключ как у банка: содержимое + сообщение + номер повтора. Позиция
            // тега не годится — она съезжает от любой правки текста
            const base = `cp${hash32(m[1])}:${String(msg.send_date || msg.extra?.gen_id || i)}`;
            const n = occ[base] = (occ[base] || 0) + 1;
            const key = `${base}#${n}`;
            if (seen.has(key)) continue;
            seen.add(key);
            c.seenTags.push(key);
            const added = applyChannelTag(safeJson(m[1]));
            if (added) names.push(added);
        }
    }
    if (c.seenTags.length > 300) c.seenTags = c.seenTags.slice(-300);
    saveMeta();
    return { n: names.length, names: [...new Set(names)] };
}

// ── Инжект ──
// Одна строка: где она ведёт канал и на что подписана. Без постов — их и так
// видно по журналу.
export function channelInjectLine() {
    const c = getChannels();
    const parts = [];
    if (c.mine) {
        parts.push(`Runs a channel «${c.mine.name}»${c.mine.desc ? ` (${c.mine.desc})` : ''} — ${c.mine.subs} subscribers`);
    }
    const subs = c.list.filter(x => x.subscribed).map(x => x.name);
    if (subs.length) parts.push(`Follows channels: ${subs.slice(0, 6).join(', ')}`);
    return parts.join('. ');
}
