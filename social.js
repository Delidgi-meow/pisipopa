import { generateRaw, user_avatar, getThumbnailUrl, saveSettingsDebounced, getRequestHeaders } from '../../../../script.js';
import { saveBase64AsFile } from '../../../utils.js';
import { extensionNames, extension_settings } from '../../../extensions.js';
import { getMeta, saveMeta, keyOf, scanChat, getSettings, stripThink, textMentionsName, stripHandle, isBanned, displayName, getRpDateTime, extractTemporalContext, isUserName } from './state.js';
import { lang } from './i18n.js';
import { logReq, logOk, logFail } from './debug-log.js';

// Язык генерируемого UI-контента (ачивки, статусы репутации): следует выбору
// языка ИНТЕРФЕЙСА, а не языку ролевой (контент лент/смс остаётся на языке РП)
function uiLangLine() {
    return lang() === 'en'
        ? 'LANGUAGE OVERRIDE: write ALL text values in ENGLISH (the user\'s interface language), regardless of the roleplay language.'
        : 'LANGUAGE: пиши все текстовые значения ПО-РУССКИ.';
}
import { ensureSocialSystems, settlePost, validateAndOfferEvent, applyEventResolution, replaceAdOffers } from './social-events.js';

const MAX_TWEETS = 50;
const MAX_IG_POSTS = 30;
const MAX_COMMENTS = 14;
const MAX_OF_POSTS = 30;

// ── Хранилище ──
export function getSocial() {
    const m = getMeta();
    if (!m.social || typeof m.social !== 'object') m.social = {};
    const s = m.social;
    if (!Array.isArray(s.tweets)) s.tweets = [];
    if (!Array.isArray(s.igPosts)) s.igPosts = [];
    if (!Array.isArray(s.ofPosts)) s.ofPosts = [];
    if (typeof s.ofSubs !== 'number') s.ofSubs = 12 + Math.floor(Math.random() * 40);
    if (typeof s.ofEarned !== 'number') s.ofEarned = 0;
    if (typeof s.ofWallet !== 'number') s.ofWallet = 0; // выведено на карту (доступно в РП)
    if (!Array.isArray(s.seenTags)) s.seenTags = [];
    ensureSocialSystems(s);
    return s;
}
export function getTweets() { return getSocial().tweets; }
export function getIgPosts() { return getSocial().igPosts; }

// ── Инста-сторис: живут 24 часа реального времени, потом гаснут ──
export function getStories() {
    const s = getSocial();
    if (!Array.isArray(s.stories)) s.stories = [];
    return s.stories;
}
export function activeStories() {
    const now = Date.now();
    return getStories().filter(st => st && now - (st.time || 0) < 24 * 3600 * 1000);
}
export function addStory({ image = null, imgDesc = '', caption = '' }) {
    const stories = getStories();
    const story = {
        id: genId(),
        ak: 'user',
        author: getUserName(),
        image,
        imgDesc: String(imgDesc || '').slice(0, 300),
        caption: String(caption || '').slice(0, 300),
        time: Date.now(),
        views: 0,
    };
    stories.unshift(story);
    getSocial().stories = stories.slice(0, 30);
    saveMeta();
    return story;
}

// Реакции на сторис юзера: быстрые «огонёчки» + 0-2 директа, которые прилетают
// СМСками в телефон. Фото прикладывается к запросу — vision-модель реагирует
// на то, что реально видит, а не на описание.
export async function generateStoryReactions(story) {
    const m = getMeta();
    const names = [...new Set((m.contacts || []).map(c => c.name))].slice(0, 12);
    const prompt = `${await taskHeader(`react to the Instagram story ${getUserName()} just posted.`)}
Story: ${story.imgDesc || 'photo'}${story.caption ? ` — text on it: «${story.caption}»` : ''}${story.image ? ' (the ACTUAL image is attached — LOOK at it and react to what you actually SEE, details included)' : ''}
Their contacts who могли увидеть: ${names.join(', ') || 'random followers'}.
Return:
"reactions" — 2-6 quick story reactions [{"author":"Имя","icon":"fire|heart|laugh|wow|sad"}] — authors from their contacts (or 1-2 invented followers); icon matches how THAT person would react in-character.
"dms" — 0-2 direct replies that arrive as SMS on ${getUserName()}'s phone [{"from":"Имя СТРОГО из её контактов","text":"short in-character reply referencing what's ON the story"}] — ONLY if that person would really slide into DMs (close, flirty, worried, provoked); otherwise [].
${uiLangLine()}
${JSON_RULES}
Format: [{"reactions":[{"author":"Имя","icon":"fire"}],"dms":[{"from":"Имя","text":"..."}]}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 700, image: story.image || null, prefill: '[{"reactions":' });
    const r = Array.isArray(arr) ? arr[0] : null;
    if (!r) return null;
    const ICONS = ['fire', 'heart', 'laugh', 'wow', 'sad'];
    const reactions = (Array.isArray(r.reactions) ? r.reactions : [])
        .filter(x => x && x.author)
        .map(x => ({ author: String(x.author).slice(0, 32), icon: ICONS.includes(x.icon) ? x.icon : 'heart' }))
        .slice(0, 6);
    const dms = (Array.isArray(r.dms) ? r.dms : [])
        .filter(x => x && x.from && x.text && !isBanned(x.from))
        .map(x => ({ from: String(x.from).slice(0, 32), text: String(x.text).slice(0, 300) }))
        .slice(0, 2);
    if (reactions.length) {
        story.reacts = reactions;
        saveMeta();
    }
    return { reactions, dms };
}

// Чужие сторис: знакомые тоже постят (генерятся, когда юзер выкладывает свою).
// Картинка НЕ рисуется автоматически — в просмотрщике есть кнопка «нарисовать».
export async function generateContactStories() {
    const m = getMeta();
    const names = [...new Set((m.contacts || []).map(c => displayName(keyOf(c.name), c.name)))].slice(0, 12);
    const existing = activeStories().filter(s => s.ak !== 'user').map(s => s.author);
    const prompt = `${await taskHeader(`invent Instagram stories posted in the last hours by people around ${getUserName()}.`)}
People who might post (${getUserName()}'s phone contacts): ${names.join(', ') || '—'}. You may also add ONE local celebrity or acquaintance from the roleplay world.
${existing.length ? `These people ALREADY have an active story (skip them): ${existing.join(', ')}.` : ''}
Invent 2-4 stories: slice-of-life moments fitting the current story timeline and each person's character. For each: "author" — name from the list (or the celebrity), "photo" — ONE vivid sentence of what the story shows, "caption" — short overlay text or empty string.
${uiLangLine()}
${JSON_RULES}
Format: [{"author":"Имя","photo":"...","caption":"..."}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 900, prefill: '[{"author":"' });
    const s = getSocial();
    if (!Array.isArray(s.stories)) s.stories = [];
    let added = 0;
    for (const it of (Array.isArray(arr) ? arr : []).slice(0, 4)) {
        if (!it || !it.author || !it.photo) continue;
        const author = String(it.author).slice(0, 40);
        if (isBanned(author)) continue;
        s.stories.unshift({
            id: genId(),
            ak: resolveAuthorKey(author),
            author,
            image: null,
            imgDesc: String(it.photo).slice(0, 300),
            caption: String(it.caption || '').slice(0, 200),
            time: Date.now() - Math.floor(Math.random() * 3 * 3600 * 1000),
            views: 0,
        });
        added++;
    }
    s.stories = s.stories.slice(0, 30);
    saveMeta();
    return added;
}
export function deleteStory(id) {
    const s = getSocial();
    s.stories = (s.stories || []).filter(x => x.id !== id);
    saveMeta();
}
// Ленивый рост просмотров: доля подписчиков, добирается за ~4 часа
// Лайк чужой сторис. Первый лайк уходит строкой в журнал — автор в ролевой
// узнаёт, что она отреагировала (снятие лайка молча, чтобы не спамить).
export function toggleStoryLike(story) {
    if (!story) return false;
    story.liked = !story.liked;
    if (story.liked && !story.likeLogged) {
        story.likeLogged = true;
        try {
            const what = story.caption || story.imgDesc || 'сторис';
            logSocialToChat(`${getUserName()} лайкнула сторис ${story.author} («${String(what).slice(0, 60)}»)`);
        } catch (e) { /* ignore */ }
    }
    saveMeta();
    return story.liked;
}

export function bumpStoryViews(story) {
    if (!story) return 0;
    const followers = getSocial().socialProfiles?.instagram?.followers || 40;
    const ageMin = (Date.now() - (story.time || Date.now())) / 60000;
    const target = Math.round(Math.min(followers * 0.65, 2 + followers * 0.65 * Math.min(1, ageMin / 240)));
    if (target > (story.views || 0)) {
        story.views = target;
        saveMeta();
    }
    return story.views || 0;
}
export function getOfPosts() { return getSocial().ofPosts; }

export function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function hash32(str) {
    let h = 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return String(h);
}

function safeJson(raw) {
    try { return JSON.parse(raw); } catch (e) {
        try {
            const fixed = raw.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"');
            return JSON.parse(fixed);
        } catch (e2) { return null; }
    }
}

export function getUserName() {
    try { return SillyTavern.getContext()?.name1 || 'Ты'; } catch (e) { return 'Ты'; }
}

// Транслитерация RU→EN: авто-ники всегда английские («Вадим» → @vadim),
// как в настоящих соцсетях
const TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
    'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
    'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
    'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
};

export function translit(s) {
    return String(s || '').toLowerCase().split('').map(ch => TRANSLIT[ch] ?? ch).join('');
}

export function makeHandle(name) {
    const h = translit(name).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 15);
    return '@' + (h || 'user');
}

// ── Ники (@handle) с per-chat оверрайдами: юзер задаёт свои, чтобы модель не путалась ──
export function handleFor(ak, name) {
    const m = getMeta();
    if (ak === 'user') {
        return m.userHandle || makeHandle(getUserName());
    }
    if (typeof ak === 'string' && ak.startsWith('contact:')) {
        const custom = m.handles[ak.slice(8)];
        if (custom) return custom.startsWith('@') ? custom : '@' + custom;
    }
    return makeHandle(name);
}
export function setContactHandle(key, handle) {
    const m = getMeta();
    const h = String(handle || '').trim().replace(/^@+/, '');
    if (h) m.handles[key] = '@' + h.slice(0, 20);
    else delete m.handles[key];
    saveMeta();
}
export function setUserHandle(handle) {
    const m = getMeta();
    const h = String(handle || '').trim().replace(/^@+/, '');
    m.userHandle = h ? '@' + h.slice(0, 20) : '';
    saveMeta();
}
export function getUserHandle() {
    return getMeta().userHandle || makeHandle(getUserName());
}

export function timeAgo(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'сейчас';
    if (mins < 60) return `${mins}м`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}ч`;
    return `${Math.floor(hrs / 24)}д`;
}

// Имя главного персонажа чата (name2) — он ВСЕГДА известное лицо для соцсетей,
// даже без явного tel:contact тега (иначе бот не мог комментить/иметь аватар/реф).
export function mainCharName() {
    try { return SillyTavern.getContext()?.name2 || ''; } catch (e) { return ''; }
}

// authorKey: 'user' | 'contact:<key>' | 'random'
// Толерантно к @: автор может прийти как «Вадим» ИЛИ «@vadim» — матчим по имени
// И по нику контакта (иначе пост от @ника не тянул реф персонажа).
export function resolveAuthorKey(name) {
    const raw = stripHandle(name);          // «@vadim» → «vadim»
    const k = keyOf(raw);
    if (!k) return 'random';
    try {
        const { contacts } = scanChat();
        if (contacts.has(k)) return `contact:${k}`;
        // Главный персонаж чата = контакт по умолчанию
        const mc = mainCharName();
        if (mc && keyOf(mc) === k) return `contact:${k}`;
        // Матч по нику контакта: перебираем известные хэндлы
        const m = getMeta();
        for (const ckey of Object.keys(m.handles || {})) {
            if (keyOf(stripHandle(m.handles[ckey])) === k) return `contact:${ckey}`;
        }
        // Ник главного персонажа / контактов по авто-нику
        for (const c of contacts.values()) {
            if (keyOf(stripHandle(makeHandle(c.name))) === k) return `contact:${keyOf(c.name)}`;
        }
    } catch (e) { /* ignore */ }
    return 'random';
}

// ═══ Теги из чата: персонаж постит из ролевой ═══
const TW_TAG_RE = /<!--\s*tel:tweet:(\{[\s\S]*?\})\s*-->/gi;
const IG_TAG_RE = /<!--\s*tel:insta:(\{[\s\S]*?\})\s*-->/gi;

// Это сама {{user}}? Модель иногда постит от её лица — такие теги
// отбрасываем: свои посты она пишет только руками, из телефона.
// К базовой проверке добавляем авто-ник, который знает только этот модуль.
function isUserAuthor(name) {
    if (isUserName(name)) return true;
    const k = keyOf(stripHandle(name));
    return !!k && k === keyOf(stripHandle(makeHandle(getUserName())));
}

// Возвращает {tweets, posts} — сколько нового добавлено (для тостов)
export function harvestSocialTags() {
    const s = getSocial();
    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { return { tweets: 0, posts: 0 }; }

    let newTweets = 0, newPosts = 0;
    const seen = new Set(s.seenTags);

    let migratedLegacyKeys = false;
    for (let msgIndex = 0; msgIndex < chat.length; msgIndex++) {
        const msg = chat[msgIndex];
        if (!msg || !msg.mes || msg.is_system || msg.is_user) continue;
        // Теги в CoT-блоках не считаются (иначе дубли постов)
        const text = stripThink(msg.mes);

        // КЛЮЧ: контент + сообщение + ПОРЯДКОВЫЙ номер, НЕ позиция m.index —
        // позиция съезжает при любой правке текста (реакции/фото/чужие
        // расширения), и тот же пост добавлялся ПОВТОРНО
        const occ = {};
        TW_TAG_RE.lastIndex = 0;
        let m;
        while ((m = TW_TAG_RE.exec(text)) !== null) {
            const legacyH = 'tw' + hash32(m[1]);
            const base = `${legacyH}:${String(msg.send_date || msg.extra?.gen_id || msgIndex)}`;
            const n = occ[base] = (occ[base] || 0) + 1;
            const h = `${base}#${n}`;
            if (seen.has(h)) continue;
            // Миграция с позиционных ключей (base:<позиция>)
            if (n === 1 && s.seenTags.some(k => k.startsWith(base + ':'))) {
                seen.add(h); s.seenTags.push(h);
                continue;
            }
            if (seen.has(legacyH)) {
                seen.add(h); s.seenTags.push(h); migratedLegacyKeys = true;
                continue;
            }
            seen.add(h); s.seenTags.push(h);
            const j = safeJson(m[1]);
            if (!j || !j.author || !j.text) continue;
            if (isUserAuthor(j.author)) continue;   // её твиты пишет она сама
            const tw = {
                id: genId(), author: String(j.author), handle: j.handle || makeHandle(j.author),
                ak: resolveAuthorKey(j.author), text: String(j.text).slice(0, 280),
                time: Date.now(), likes: Math.floor(Math.random() * 40) + 2, liked: false,
                rts: Math.floor(Math.random() * 10), replies: [],
            };
            // Цитата: персонаж цитирует чей-то твит из ролевой
            if (j.quote && j.quote.author && j.quote.text) {
                tw.quotedTweet = {
                    author: String(j.quote.author),
                    handle: j.quote.handle || makeHandle(j.quote.author),
                    text: String(j.quote.text).slice(0, 280),
                };
            }
            s.tweets.unshift(tw);
            newTweets++;
        }

        IG_TAG_RE.lastIndex = 0;
        while ((m = IG_TAG_RE.exec(text)) !== null) {
            const legacyH = 'ig' + hash32(m[1]);
            const base = `${legacyH}:${String(msg.send_date || msg.extra?.gen_id || msgIndex)}`;
            const n = occ[base] = (occ[base] || 0) + 1;
            const h = `${base}#${n}`;
            if (seen.has(h)) continue;
            if (n === 1 && s.seenTags.some(k => k.startsWith(base + ':'))) {
                seen.add(h); s.seenTags.push(h);
                continue;
            }
            if (seen.has(legacyH)) {
                seen.add(h); s.seenTags.push(h); migratedLegacyKeys = true;
                continue;
            }
            seen.add(h); s.seenTags.push(h);
            const j = safeJson(m[1]);
            if (!j || !j.author || (!j.caption && !j.photo)) continue;
            if (isUserAuthor(j.author)) continue;   // её посты пишет она сама
            s.igPosts.unshift({
                id: genId(), author: String(j.author), ak: resolveAuthorKey(j.author),
                image: null, imgDesc: String(j.photo || '').slice(0, 200),
                caption: String(j.caption || '').slice(0, 400),
                time: Date.now(), likes: Math.floor(Math.random() * 80) + 5, liked: false, comments: [],
            });
            newPosts++;
        }
    }

    if (migratedLegacyKeys) {
        s.seenTags = s.seenTags.filter(k => !/^(?:tw|ig)-?\d+$/.test(k));
    }
    if (s.seenTags.length > 300) s.seenTags = s.seenTags.slice(-300);
    if (newTweets || newPosts || migratedLegacyKeys) {
        trimFeeds(s);
        saveMeta();
    }
    return { tweets: newTweets, posts: newPosts };
}

function trimFeeds(s) {
    if (s.tweets.length > MAX_TWEETS) s.tweets = s.tweets.slice(0, MAX_TWEETS);
    if (s.igPosts.length > MAX_IG_POSTS) s.igPosts = s.igPosts.slice(0, MAX_IG_POSTS);
}

// ═══ Действия юзера ═══

export function postTweet(text) {
    const s = getSocial();
    const post = {
        id: genId(), author: getUserName(), handle: getUserHandle(), ak: 'user',
        text: String(text).slice(0, 280), time: Date.now(),
        likes: 0, liked: false, rts: 0, replies: [],
    };
    post.temporalContext = extractTemporalContext(post.text);
    s.tweets.unshift(post);
    trimFeeds(s); saveMeta();
    return post;
}

export function likeTweet(id) {
    const t = getTweets().find(x => x.id === id);
    if (!t) return;
    t.liked = !t.liked;
    t.likes = Math.max(0, (t.likes || 0) + (t.liked ? 1 : -1));
    saveMeta();
}

export function rtTweet(id) {
    const t = getTweets().find(x => x.id === id);
    if (!t) return;
    t.rted = !t.rted;
    t.rts = Math.max(0, (t.rts || 0) + (t.rted ? 1 : -1));
    saveMeta();
}

export function delTweet(id) {
    const s = getSocial();
    s.tweets = s.tweets.filter(x => x.id !== id);
    saveMeta();
}

export function addTweetReply(tweetId, text, author = null, ak = 'user', replyTo = null) {
    const t = getTweets().find(x => x.id === tweetId);
    if (!t) return null;
    if (!Array.isArray(t.replies)) t.replies = [];
    const r = {
        id: genId(), author: author || getUserName(),
        handle: handleFor(ak, author || getUserName()), ak,
        text: String(text).slice(0, 280), time: Date.now(),
    };
    if (replyTo) r.replyTo = { id: replyTo.id, author: replyTo.author };
    t.replies.push(r);
    if (t.replies.length > MAX_COMMENTS) t.replies = t.replies.slice(-MAX_COMMENTS);
    saveMeta();
    return r;
}

export function delTweetReply(tweetId, replyId) {
    const t = getTweets().find(x => x.id === tweetId);
    if (!t || !Array.isArray(t.replies)) return;
    t.replies = t.replies.filter(r => r.id !== replyId);
    saveMeta();
}

export function postIg({ image = null, imgDesc = '', caption = '' }) {
    const s = getSocial();
    const post = {
        id: genId(), author: getUserName(), ak: 'user',
        image, imgDesc: String(imgDesc).slice(0, 200), caption: String(caption).slice(0, 400),
        time: Date.now(), likes: 0, liked: false, comments: [],
    };
    post.temporalContext = extractTemporalContext(`${post.caption} ${post.imgDesc}`);
    s.igPosts.unshift(post);
    trimFeeds(s); saveMeta();
    return post;
}

export function likeIg(id) {
    const p = getIgPosts().find(x => x.id === id);
    if (!p) return;
    p.liked = !p.liked;
    p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1));
    saveMeta();
}

export function delIg(id) {
    const s = getSocial();
    s.igPosts = s.igPosts.filter(x => x.id !== id);
    saveMeta();
}

export function addIgComment(postId, text, author = null, ak = 'user', replyTo = null) {
    const p = getIgPosts().find(x => x.id === postId);
    if (!p) return null;
    if (!Array.isArray(p.comments)) p.comments = [];
    const c = {
        id: genId(), author: author || getUserName(), ak,
        text: String(text).slice(0, 300), time: Date.now(),
    };
    if (replyTo) c.replyTo = { id: replyTo.id, author: replyTo.author };
    p.comments.push(c);
    if (p.comments.length > MAX_COMMENTS) p.comments = p.comments.slice(-MAX_COMMENTS);
    saveMeta();
    return c;
}

export function delIgComment(postId, commentId) {
    const p = getIgPosts().find(x => x.id === postId);
    if (!p || !Array.isArray(p.comments)) return;
    p.comments = p.comments.filter(c => c.id !== commentId);
    saveMeta();
}

// ═══ OnlyFans: контент юзера, фанаты, чаевые ═══

export function postOf({ image = null, imgDesc = '', caption = '', price = 0 }) {
    const s = getSocial();
    const post = {
        id: genId(), author: getUserName(), ak: 'user', kind: 'of',
        image, imgDesc: String(imgDesc).slice(0, 200), caption: String(caption).slice(0, 400),
        price: Math.max(0, parseInt(price) || 0),
        time: Date.now(), likes: 0, liked: false, tips: 0, comments: [],
    };
    s.ofPosts.unshift(post);
    if (s.ofPosts.length > MAX_OF_POSTS) s.ofPosts = s.ofPosts.slice(0, MAX_OF_POSTS);
    saveMeta();
    return post;
}

export function likeOf(id) {
    const p = getOfPosts().find(x => x.id === id);
    if (!p) return;
    p.liked = !p.liked;
    p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1));
    saveMeta();
}

export function delOf(id) {
    const s = getSocial();
    s.ofPosts = s.ofPosts.filter(x => x.id !== id);
    saveMeta();
}

export function addOfComment(postId, text, author = null, ak = 'user', tip = 0) {
    const p = getOfPosts().find(x => x.id === postId);
    if (!p) return null;
    if (!Array.isArray(p.comments)) p.comments = [];
    const c = {
        id: genId(), author: author || getUserName(), ak,
        text: String(text).slice(0, 300), time: Date.now(),
    };
    if (tip > 0) c.tip = tip;
    p.comments.push(c);
    if (p.comments.length > MAX_COMMENTS) p.comments = p.comments.slice(-MAX_COMMENTS);
    saveMeta();
    return c;
}

// Вывод заработка на карту: баланс становится «живыми деньгами» юзера в РП
// (уходит в инжекцию — модель знает, что деньги у неё есть, но не знает источник)
export function withdrawOf() {
    const s = getSocial();
    const amount = s.ofEarned;
    if (amount <= 0) return 0;
    s.ofWallet += amount;
    s.ofEarned = 0;
    saveMeta();
    return amount;
}
export function setOfWallet(v) {
    const s = getSocial();
    s.ofWallet = Math.max(0, parseInt(v) || 0);
    saveMeta();
}

export function delOfComment(postId, commentId) {
    const p = getOfPosts().find(x => x.id === postId);
    if (!p || !Array.isArray(p.comments)) return;
    p.comments = p.comments.filter(c => c.id !== commentId);
    saveMeta();
}

// Реакции фанатов: комменты + чаевые + прирост подписчиков
export async function generateOfComments(post) {
    const s = getSocial();
    const willAttach = !!post.image && (getSettings().visionInComments || !post.imgDesc);
    const wantDesc = willAttach && !post.imgDesc;
    const photoLine = willAttach
        ? `The actual photo is ATTACHED — react to what you SEE.${post.imgDesc ? ` (fallback description: ${post.imgDesc})` : ''}`
        : `Photo (description): ${post.imgDesc || '(no description)'}`;
    const existing = (post.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');

    // Имена известных персонажей — ТОЛЬКО как запрет (страница приватная!)
    let knownNames = [];
    try { knownNames = [...scanChat().contacts.values()].map(c => c.name); } catch (e) { /* ignore */ }

    const prompt = `${await taskHeader(`generate fan reactions under a post on ${getUserName()}'s OnlyFans-like page.`)}
${getUserName()} posted on their PRIVATE paid subscription page (${s.ofSubs} subscribers). ${photoLine}
Caption: "${post.caption || '(none)'}"${post.price > 0 ? `\nPay-per-view price: $${post.price}` : ''}
${existing ? `Existing comments (do not repeat):\n${existing}\n` : ''}
PRIVACY — CRITICAL: this page is anonymous and subscribers are STRANGERS. ${knownNames.length ? `The following roleplay characters must NOT appear in comments and their names must NOT be used for fan accounts: ${knownNames.join(', ')}. ` : ''}A known character may appear ONLY IF the roleplay excerpt above EXPLICITLY shows that this character knows about / subscribes to their page. No guesses, no "plausible" — when in doubt: random fans ONLY.

Generate 4-7 comments from their SUBSCRIBERS: invented fan accounts (simps, regulars, big tippers, shy lurkers who finally commented). Thirsty but human; vary tone.
Some commenters tip: add "tip": dollar amount (5-200) to 1-3 comments.
Max 200 chars each. NO emojis. Match the explicitness of the roleplay excerpt — do not sanitize, do not escalate beyond it.
${uiLangLine()}
${JSON_RULES}
${wantDesc
        ? `Format — STRICT JSON OBJECT: {"photo_description":"detailed description of the attached photo in Russian, one cohesive paragraph","comments":[{"author":"ник","text":"...","type":"random","tip":0},...]}`
        : `Format: [{"author":"ник","text":"...","type":"random","tip":0},...]`}`;

    const rawOf = await socialGen(prompt, {
        maxTokens: wantDesc ? 2048 : 1536,
        image: willAttach ? post.image : null,
        prefill: wantDesc ? '{"photo_description":"' : '[{"author":"',
    });
    let parsed;
    if (wantDesc) {
        const obj = parseJsonObject(rawOf);
        if (obj) {
            const desc = String(obj.photo_description || '').trim().replace(/\s*\n+\s*/g, ' ').slice(0, 3000);
            if (desc) post.imgDesc = desc;
            parsed = obj.comments;
        }
        if (!Array.isArray(parsed)) parsed = parseJsonArray(rawOf);
    } else {
        parsed = parseJsonArray(rawOf);
    }
    if (!Array.isArray(parsed)) return 0;
    let added = 0, tipsTotal = 0;
    if (!Array.isArray(post.comments)) post.comments = [];
    for (const it of parsed) {
        if (!it || !it.author || !it.text) continue;
        if (isBanned(it.author, it.handle)) continue;
        if (post.comments.length >= MAX_COMMENTS) break;
        const tip = Math.max(0, Math.min(500, parseInt(it.tip) || 0));
        post.comments.push({
            id: genId(), author: String(it.author),
            ak: it.type === 'contact' ? resolveAuthorKey(it.author) : 'random',
            text: String(it.text).slice(0, 300), time: Date.now() - Math.floor(Math.random() * 600000),
            ...(tip > 0 ? { tip } : {}),
        });
        tipsTotal += tip;
        added++;
    }
    post.likes = Math.max(post.likes || 0, Math.floor(Math.random() * 30) + post.comments.length * 2 + Math.floor(s.ofSubs / 4));
    post.tips = (post.tips || 0) + tipsTotal;
    s.ofEarned += tipsTotal + (post.price > 0 ? post.price * (2 + Math.floor(Math.random() * 6)) : 0);
    s.ofSubs += Math.floor(Math.random() * 5);
    saveMeta();
    return added;
}

// ═══ Генерация через основной API ═══

function cleanGenOutput(raw) {
    let t = String(raw || '');
    // Закрытые think-блоки — вырезаем целиком
    t = t.replace(/<(think|thinking|reasoning|analysis)[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Незакрытый <think> — обычно префилл пресета (актуально для quiet-пути):
    // убираем маркер, содержимое ОСТАВЛЯЕМ — там и есть ответ
    t = t.replace(/<\/?(think|thinking|reasoning|analysis)[^>]*>/gi, '');
    return t.trim();
}


// Некоторые провайдеры успевают вернуть текст candidate, а затем ST выбрасывает
// ошибку из-за finishReason / safety metadata. Ищем только известные поля
// генерации и используем текст, когда он действительно пригоден.
function textFromContentValue(value, depth = 0, seen = new Set()) {
    if (value === null || value === undefined || depth > 9) return '';
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return '';
    if (seen.has(value)) return '';
    seen.add(value);

    if (Array.isArray(value)) {
        // Массив content/parts — последовательные куски одного ответа.
        return value.map(v => textFromContentValue(v, depth + 1, seen)).filter(Boolean).join('');
    }

    // OpenAI Responses API / content parts / Gemini parts.
    if (value.thought === true || value.type === 'reasoning') return '';
    if (typeof value.output_text === 'string') return value.output_text;
    if (typeof value.generated_text === 'string') return value.generated_text;
    if (typeof value.completion === 'string') return value.completion;
    if (typeof value.text === 'string' && ['text', 'output_text', 'text_delta'].includes(String(value.type || 'text'))) return value.text;

    const read = (v) => textFromContentValue(v, depth + 1, seen);

    // Приоритет нормализованному content. Не склеиваем content с raw data:
    // сервисы ST нередко кладут один и тот же ответ в оба поля.
    if ('content' in value) {
        const found = read(value.content);
        if (found) return found;
    }
    if ('output' in value) {
        const found = read(value.output);
        if (found) return found;
    }
    if (Array.isArray(value.parts)) {
        const found = value.parts
            .filter(part => part?.thought !== true)
            .map(part => typeof part?.text === 'string' ? part.text : read(part))
            .filter(Boolean).join('');
        if (found) return found;
    }
    if (value.message && typeof value.message === 'object') {
        const found = read(value.message.content);
        if (found) return found;
    }

    // OpenAI-compatible chat/text completion: choices — альтернативы, берём
    // первый непустой вариант, а не склеиваем их между собой.
    if (Array.isArray(value.choices)) {
        for (const choice of value.choices) {
            const found = read(choice?.message?.content)
                || read(choice?.delta?.content)
                || (typeof choice?.text === 'string' ? choice.text : '');
            if (found) return found;
        }
    }

    // Gemini / Vertex candidate. Даже при PROHIBITED_CONTENT/SAFETY в parts
    // иногда уже лежит завершённый JSON, который ST успел вывести в консоль.
    if (Array.isArray(value.candidates)) {
        for (const candidate of value.candidates) {
            const parts = candidate?.content?.parts;
            if (Array.isArray(parts)) {
                const found = parts
                    .filter(part => part?.thought !== true)
                    .map(part => typeof part?.text === 'string' ? part.text : read(part))
                    .filter(Boolean).join('');
                if (found) return found;
            } else {
                const found = read(candidate?.content);
                if (found) return found;
            }
        }
    }

    if (value.candidate && typeof value.candidate === 'object') {
        const found = read(value.candidate);
        if (found) return found;
    }

    // Обёртки fetch/axios/ST. message намеренно НЕ читаем: там обычно текст
    // ошибки («Candidate blocked»), а не результат модели.
    for (const key of ['data', 'body', 'result', 'responseData', 'rawResponse', 'partialResponse', 'details']) {
        if (!(key in value)) continue;
        const nested = value[key];
        if (typeof nested === 'string') {
            const decoded = textFromSerializedPayload(nested);
            if (decoded) return decoded;
            // result иногда является уже готовым plain-text ответом. body/data/details
            // строкой чаще содержат сериализованный ответ или сообщение ошибки.
            if (key === 'result' && !ERROR_ONLY_OUTPUT.test(nested.trim())) return nested;
        } else {
            const found = read(nested);
            if (found) return found;
        }
    }

    return '';
}

function textFromSerializedPayload(raw) {
    const text = String(raw || '').trim();
    if (!text || !/^[{\[]/.test(text)) return '';
    try { return textFromContentValue(JSON.parse(text)); }
    catch (e) { return ''; }
}

async function readFetchResponsePayload(response) {
    if (!response || typeof response !== 'object') return '';
    try {
        if (typeof response.clone === 'function') {
            const copy = response.clone();
            try {
                const json = await copy.json();
                const found = textFromContentValue(json);
                if (found) return found;
            } catch (e) { /* не JSON или body уже прочитан */ }
        }
    } catch (e) { /* clone() может упасть при bodyUsed */ }
    try {
        if (typeof response.clone === 'function') {
            const text = await response.clone().text();
            return textFromSerializedPayload(text);
        }
    } catch (e) { /* ignore */ }
    return '';
}

async function extractGeneratedText(value) {
    const direct = textFromContentValue(value);
    if (direct) return direct;

    // Error.cause и Response часто non-enumerable, поэтому идём по ним явно.
    let cur = value;
    const seen = new Set();
    for (let depth = 0; cur && depth < 8 && !seen.has(cur); depth++) {
        seen.add(cur);
        for (const key of ['response', 'res', 'rawResponse', 'partialResponse']) {
            const response = cur?.[key];
            const nested = textFromContentValue(response) || await readFetchResponsePayload(response);
            if (nested) return nested;
        }
        for (const key of ['data', 'body', 'details']) {
            const nestedValue = cur?.[key];
            const nested = typeof nestedValue === 'string'
                ? textFromSerializedPayload(nestedValue)
                : textFromContentValue(nestedValue);
            if (nested) return nested;
        }
        cur = cur?.cause;
    }
    return '';
}

const ERROR_ONLY_OUTPUT = /^(?:error\b|api request failed\b|prohibited(?:_content)?\b|blocked\b|content[_ -]?filter\b|candidate\b.*(?:blocked|prohibited|safety|finish)|response blocked\b|moderation\b)/i;

function isUsableGeneratedText(raw) {
    const text = cleanGenOutput(raw);
    if (!text) return false;
    // Не превращаем сам текст исключения в «успешный ответ».
    if (ERROR_ONLY_OUTPUT.test(text) && !/[{\[]/.test(text)) return false;
    return true;
}

function isParsableForPrefill(text, prefill) {
    const start = String(prefill || '').trimStart()[0];
    if (start === '[') return Array.isArray(parseJsonArray(text));
    if (start === '{') return !!parseJsonObject(text);
    return true;
}

async function recoverGeneratedText(error, finish, prefill = '') {
    const raw = await extractGeneratedText(error);
    if (!isUsableGeneratedText(raw)) return null;
    const complete = finish(raw);
    if (!isUsableGeneratedText(complete)) return null;
    // Для структурированных генераций подавляем ошибку только если после
    // склейки префилла действительно получается читаемый JSON.
    if (prefill && !isParsableForPrefill(complete, prefill)) return null;
    return complete;
}

// Компактный срез последних сообщений чата — вместо полного контекста
export function rpContextBlock(count = 12) {
    try {
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const name1 = ctx?.name1 || 'User';
        const tail = chat.filter(m => m && m.mes && !m.is_system).slice(-count);
        if (tail.length === 0) return '';
        const lines = tail.map(m => {
            const who = m.is_user ? name1 : (m.name || 'Character');
            const text = String(m.mes)
                .replace(/<!--[\s\S]*?-->/g, '')
                .replace(/\s+/g, ' ')
                .trim().slice(0, 300);
            return text ? `${who}: ${text}` : null;
        }).filter(Boolean);
        return lines.join('\n');
    } catch (e) { return ''; }
}

// Любой источник картинки → dataURL (бэкенды вижна не умеют относительные пути
// вроде /user/images/... — картинки картинко-расширения хранятся файлами)
async function toDataUrl(src) {
    const s = String(src || '');
    if (!s) return null;
    if (s.startsWith('data:')) return s;
    try {
        const resp = await fetch(s);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(String(r.result));
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('[GlassPhone] toDataUrl failed:', e);
        return null;
    }
}

// ── Прямой запрос ТЕКУЩИМ chat-completion подключением (без профиля/пресета) ──
// Принимает готовый массив messages, поэтому поддерживает финальный assistant-prefill.
async function currentApiRequest(messages, maxTokens = 1024) {
    try {
        const ctx = SillyTavern.getContext();
        if (ctx?.mainApi !== 'openai') return null; // только chat completion
        const svc = ctx.ChatCompletionService;
        if (!svc || typeof svc.processRequest !== 'function') return null;
        const oai = ctx.chatCompletionSettings || {};
        let model = '';
        try {
            const oaiMod = await import('../../../openai.js');
            if (typeof oaiMod.getChatCompletionModel === 'function') model = oaiMod.getChatCompletionModel();
        } catch (e) { /* ignore */ }
        if (!model) model = oai.custom_model || oai.openai_model || '';

        const res = await svc.processRequest({
            stream: false,
            messages,
            max_tokens: maxTokens,
            model,
            chat_completion_source: oai.chat_completion_source,
            custom_url: oai.custom_url,
            reverse_proxy: oai.reverse_proxy,
            proxy_password: oai.proxy_password,
        }, {}, true);

        const raw = await extractGeneratedText(res);
        const out = cleanGenOutput(raw);
        return out || null;
    } catch (e) {
        const rescued = cleanGenOutput(await extractGeneratedText(e));
        if (isUsableGeneratedText(rescued)) {
            console.warn('[GlassPhone] currentApiRequest: ST сообщил об ошибке, но candidate восстановлен:', rootErrorMessage(e));
            return rescued;
        }
        console.warn('[GlassPhone] currentApiRequest failed:', e);
        return null;
    }
}

function attachImageToMessages(messages, dataUrl) {
    const out = messages.map(m => ({ ...m }));
    const userIndex = out.findIndex(m => m?.role === 'user');
    if (userIndex < 0) return out;
    const original = out[userIndex].content;
    const textPart = Array.isArray(original)
        ? original.filter(x => x?.type === 'text')
        : [{ type: 'text', text: String(original ?? '') }];
    out[userIndex].content = [
        ...textPart,
        { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
    ];
    return out;
}

// Мультимодальная обёртка: картинка добавляется в user-сообщение, а финальное
// assistant-сообщение с префиллом остаётся последним.
async function currentApiVision(promptOrMessages, image, maxTokens = 1024) {
    try {
        const dataUrl = await toDataUrl(image);
        if (!dataUrl) return null;
        const messages = Array.isArray(promptOrMessages)
            ? promptOrMessages
            : [{ role: 'user', content: String(promptOrMessages || '') }];
        return await currentApiRequest(attachImageToMessages(messages, dataUrl), maxTokens);
    } catch (e) {
        console.warn('[GlassPhone] currentApiVision failed:', e);
        return null;
    }
}

// ── Корневая причина ошибки: ConnectionManagerRequestService заворачивает всё
// в Error('API request failed', {cause}) — разворачиваем цепочку до сути.
export function rootErrorMessage(e) {
    let cur = e, msg = '', depth = 0;
    while (cur && depth < 6) {
        msg = String(cur?.message || cur) || msg;
        cur = cur?.cause;
        depth++;
    }
    return msg;
}

// ── Префилл и фигурные пробелы: две независимые опции ──
// Префилл отправляется настоящим финальным assistant-сообщением там, где API
// принимает chat messages. Для старых text-completion путей остаётся безопасная
// текстовая эмуляция без Unicode-обфускации.
const PREAMBLES = [
    'Sure.', 'Sure,', 'Okay.', 'Okay,', 'Understood.', 'Understood,',
    'Here is the result:', "Here's the result:", 'Here is the output:',
    "Here's the output:", 'The result is:', 'Конечно.', 'Хорошо.', 'Вот результат:',
];

function removeCommonPreamble(text) {
    let out = String(text || '').trimStart();
    let changed = true;
    while (changed) {
        changed = false;
        for (const phrase of PREAMBLES) {
            if (out.toLowerCase().startsWith(phrase.toLowerCase())) {
                out = out.slice(phrase.length).trimStart();
                changed = true;
            }
        }
    }
    return out;
}

function removeRepeatedPrefill(text, prefill) {
    const normalizedText = String(text || '').trimStart();
    const normalizedPrefill = String(prefill || '').trim();
    if (!normalizedPrefill) return text;
    if (normalizedText.startsWith(normalizedPrefill)) {
        return normalizedText.slice(normalizedPrefill.length).trimStart();
    }
    return text;
}

const FIGURE_SPACE_RULE = `OUTPUT SPACING:
Use FIGURE SPACE (U+2007) wherever ordinary spaces would normally separate words.
Do not alter JSON punctuation, quotation marks, keys, numbers, or structure.
Return only the requested output.`;

// Обратный проход: фигурные (и родственные «неразрывные») пробелы → обычные.
// Делается ДО парсинга JSON — U+2007 не является валидным JSON-разделителем.
function unfigureSpaces(text) {
    return String(text || '').replace(/[     ]/g, ' ');
}

function buildGenerationMessages(prompt, prefill, usePrefill, useFigureSpaces) {
    let userPrompt = String(prompt || '').trim();
    if (useFigureSpaces) userPrompt += `\n\n${FIGURE_SPACE_RULE}`;
    const messages = [{ role: 'user', content: userPrompt }];
    // ВАЖНО: assistant-prefill обязан быть последним сообщением. Любая инструкция
    // после него создаст новый turn и превратит префилл в обычный прошлый ответ.
    if (usePrefill) messages.push({ role: 'assistant', content: String(prefill || '') });
    return messages;
}

// Фолбэк только для путей, которые физически не умеют принимать messages.
function legacyPrompt(prompt, prefill, usePrefill, useFigureSpaces) {
    let out = String(prompt || '').trim();
    if (useFigureSpaces) out += `\n\n${FIGURE_SPACE_RULE}`;
    if (usePrefill) {
        out += `\n\nOUTPUT FORMAT:\nThe response has already begun with the JSON prefix below. Write only the remaining continuation, without repeating the prefix or adding Markdown. The prefix plus your continuation must form one valid JSON value.\n\nJSON prefix:\n${prefill}`;
    }
    return out;
}

function isMessageCompatibilityError(message) {
    const t = String(message || '');
    // Google AI Studio отвечает «Requests ending with a model turn are not
    // supported» — про роль assistant там ни слова, поэтому свой шаблон
    return (/(assistant|message|messages|role|alternate|alternating|last\s+message|prefill|conversation)/i.test(t)
            || /(model\s+turn|ending with a model|turn are not supported)/i.test(t))
        && !/(prohibited|moderation|safety|policy|blocked|content filter)/i.test(t);
}

// ── Запрос ПРОФИЛЕМ подключения ──
// ВАЖНО: прокси-пресеты SillyTavern хранятся во внутреннем массиве `proxies`
// модуля openai.js и не обязаны быть доступны через getContext(). Раньше здесь
// payload собирался вручную, из-за чего связанный с профилем reverse proxy мог
// потеряться. Тогда запрос шёл напрямую к официальному endpoint с secret_id.
// Теперь профиль всегда выполняет штатный ConnectionManagerRequestService:
// именно он имеет доступ к настоящим proxy presets и корректно связывает
// профиль, endpoint, secret-id и reverse proxy. Никакого фолбэка на текущий API.
function profileInfo(profileId) {
    const ctx = SillyTavern.getContext();
    const profiles = ctx?.extensionSettings?.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return null;
    const apiMap = ctx?.CONNECT_API_MAP?.[profile.api];
    return {
        profile,
        info: `${profile.name || profile.id} · ${profile.model || '?'} @ ${profile.proxy ? `proxy:${profile.proxy}` : (profile['api-url'] || apiMap?.source || '?')}`,
    };
}

// Прямой запрос к провайдеру со СВОИМ ключом из настроек телефона.
// Не трогает глобальные секреты ST → чат и телефон работают параллельно, без гонки ключей.
async function directRequest(built, messages, maxTokens, apiKey) {
    const base = String(built.profile['api-url'] || '').replace(/\/+$/, '');
    if (!base) throw new Error('У профиля нет «api-url» — прямой режим невозможен');
    if (!built.profile.model) throw new Error('У профиля не указана модель');
    const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: built.profile.model, messages, max_tokens: maxTokens, stream: false }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(String(json.error?.message || `HTTP ${res.status}`));
    let content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? '';
    if (Array.isArray(content)) content = content.map(p => p?.text || '').join('');
    return { content: String(content), info: `${built.info} · direct` };
}

async function profileRequest(profileId, messages, maxTokens) {
    const ctx = SillyTavern.getContext();
    const cm = ctx?.ConnectionManagerRequestService;
    if (!cm?.sendRequest) {
        throw new Error('ConnectionManagerRequestService недоступен. Обновите SillyTavern: выбранный профиль не будет заменён текущим API.');
    }
    const built = profileInfo(profileId);
    if (!built) throw new Error(`Профиль подключения не найден: ${profileId}`);

    // Сервер ST берёт ключ из АКТИВНОГО секрета источника, а не из профиля —
    // поэтому профиль «работал» только когда чат стоял на нём же. Крутим
    // секрет на профильный перед запросом и возвращаем обратно после.
    const secretId = built.profile['secret-id'];
    const secretKey = secretKeyForApi(built.profile.api);
    let prevSecretId = null;
    let rotated = false;
    if (secretId && secretKey) {
        prevSecretId = await getActiveSecretId(secretKey);
        if (prevSecretId && prevSecretId !== secretId) {
            rotated = await rotateSecretServerOnly(secretKey, secretId);
            if (rotated) logReq('секрет', `переключили на профильный для ${secretKey}`);
        }
    }

    try {
        const res = await cm.sendRequest(profileId, messages, maxTokens, {
            stream: false, extractData: true, includePreset: false, includeInstruct: false,
        });
        return { content: await extractGeneratedText(res), info: `${built.info} · Connection Manager` };
    } finally {
        if (rotated && prevSecretId) {
            rotateSecretServerOnly(secretKey, prevSecretId).catch(() => {});
        }
    }
}

// api источника → имя ключа в secrets.json (у google ключ исторически makersuite)
const API_TO_SECRET_KEY = { google: 'api_key_makersuite', vertexai: 'api_key_vertexai_serviceaccount' };
function secretKeyForApi(api) {
    const a = String(api || '').toLowerCase().trim();
    if (!a) return null;
    return API_TO_SECRET_KEY[a] || `api_key_${a}`;
}

async function getActiveSecretId(secretKey) {
    try {
        const res = await fetch('/api/secrets/read', { method: 'POST', headers: getRequestHeaders() });
        if (!res.ok) return null;
        const state = await res.json();
        const list = state?.[secretKey];
        return Array.isArray(list) ? (list.find(x => x?.active)?.id || null) : null;
    } catch { return null; }
}

async function rotateSecretServerOnly(secretKey, secretId) {
    try {
        const res = await fetch('/api/secrets/rotate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key: secretKey, id: secretId }),
        });
        return res.ok;
    } catch { return false; }
}

// prefill: строка-начало ответа (учитывается только при включённой опции).
// Возвращается ВСЕГДА prefill+продолжение — JSON-парсеры получают полный текст.
// Профили, чей провайдер отказался принимать assistant-префилл (Google AI
// Studio: «Requests ending with a model turn are not supported»). Повторять
// заведомо провальный запрос каждый раз незачем — до перезагрузки страницы
// шлём им сразу текстовую эмуляцию.
const _noPrefill = new Set();

async function socialGen(prompt, { maxTokens = 1024, image = null, prefill = '' } = {}) {
    const st = getSettings();
    const profileId = st.socialProfileId;
    // Пол длины ответа (если модель рвёт JSON из-за лимита — юзер поднимает)
    const floor = parseInt(st.socialMaxTokens) || 0;
    if (floor > 0) maxTokens = Math.max(maxTokens, floor);
    const usePrefill = !!(st.usePrefill && prefill) && !_noPrefill.has(profileId || '(current)');
    const useFigureSpaces = !!st.useFigureSpaces;
    const messages = buildGenerationMessages(prompt, prefill, usePrefill, useFigureSpaces);
    const fallbackPrompt = legacyPrompt(prompt, prefill, usePrefill, useFigureSpaces);

    const finish = (raw) => {
        let out = cleanGenOutput(raw);
        if (useFigureSpaces) out = unfigureSpaces(out);
        if (!usePrefill) return out;
        out = removeCommonPreamble(out);
        out = removeRepeatedPrefill(out, prefill);
        return prefill + out;
    };

    // Путь 1: отдельный профиль подключения (изоляция + вижн)
    if (profileId) {
        let requestMessages = messages;
        if (image) {
            const dataUrl = await toDataUrl(image);
            if (dataUrl) {
                requestMessages = attachImageToMessages(messages, dataUrl);
            } else {
                console.warn('[GlassPhone] vision: не удалось прочитать картинку — запрос без фото');
            }
        }
        try {
            const built = profileInfo(profileId);
            const directKey = String(st.directApiKey || '').trim();
            const useDirect = !!(directKey && !image && built?.profile?.['api-url']);
            logReq('запрос (профиль)', `${built?.info || profileId}${useDirect ? ' · direct' : ''}${image ? ' + фото' : ''}${usePrefill ? ' · assistant-prefill' : ''}${useFigureSpaces ? ' · U+2007' : ''} · max ${maxTokens}`);
            const res = useDirect
                ? await directRequest(built, requestMessages, maxTokens, directKey)
                : await profileRequest(profileId, requestMessages, maxTokens);
            logOk('ответ (профиль)', `${String(res.content || '').length} симв.`);
            return finish(res.content);
        } catch (e) {
            const root = rootErrorMessage(e);
            const rescued = await recoverGeneratedText(e, finish, usePrefill ? prefill : '');
            if (rescued !== null) {
                console.warn(`[GlassPhone] профиль вернул ошибку «${root}», но candidate пригоден — используем его.`);
                logOk('ответ восстановлен из candidate', `${rescued.length} симв. · ${root}`);
                return rescued;
            }
            // Некоторые text-completion/прокси-профили не принимают финальную роль
            // assistant. Для них повторяем запрос один раз с безопасной эмуляцией.
            if (usePrefill && isMessageCompatibilityError(root)) {
                _noPrefill.add(profileId || '(current)');
                try {
                    let content = fallbackPrompt;
                    if (image) {
                        const dataUrl = await toDataUrl(image);
                        if (dataUrl) content = [{ type: 'text', text: fallbackPrompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } }];
                    }
                    console.warn('[GlassPhone] профиль не принял assistant-prefill; fallback к текстовой эмуляции:', root);
                    logReq('повтор (эмуляция префилла)', `${profileId} · max ${maxTokens}`);
                    const retry = await profileRequest(profileId, [{ role: 'user', content }], maxTokens);
                    logOk('ответ (эмуляция префилла)', `${String(retry.content || '').length} симв.`);
                    return finish(retry.content);
                } catch (retryError) {
                    const retryRoot = rootErrorMessage(retryError);
                    const rescuedRetry = await recoverGeneratedText(retryError, finish, usePrefill ? prefill : '');
                    if (rescuedRetry !== null) {
                        console.warn(`[GlassPhone] fallback вернул ошибку «${retryRoot}», но candidate пригоден — используем его.`);
                        logOk('ответ восстановлен из candidate', `${rescuedRetry.length} симв. · ${retryRoot}`);
                        return rescuedRetry;
                    }
                    console.error(`[GlassPhone] профиль подключения: fallback упал — ${retryRoot}`, retryError);
                    logFail('повтор (эмуляция префилла)', retryRoot);
                    throw new Error(`Профиль: ${retryRoot}`, { cause: retryError });
                }
            }
            // Разворачиваем cause-цепочку: «API request failed» сам по себе бесполезен
            console.error(`[GlassPhone] профиль подключения: запрос упал — ${root}`, e);
            logFail('запрос (профиль)', root);
            throw new Error(`Профиль: ${root}`, { cause: e });
        }
    }

    // Путь 2: есть картинка, профиля нет → прямой мультимодальный запрос текущим API
    if (image) {
        const vis = await currentApiVision(messages, image, maxTokens);
        if (vis !== null) return finish(vis);
        console.warn('[GlassPhone] vision: прямой канал не сработал — запрос уйдёт БЕЗ фото');
    }

    // Путь 3: текущий chat-completion API. При включённом префилле сначала
    // пробуем настоящий массив user + assistant, без пресета и истории ST.
    if (usePrefill) {
        logReq('запрос (текущий API)', `assistant-prefill · max ${maxTokens}${useFigureSpaces ? ' · U+2007' : ''}`);
        const direct = await currentApiRequest(messages, maxTokens);
        if (direct !== null) {
            logOk('ответ (текущий API)', `${String(direct || '').length} симв.`);
            return finish(direct);
        }
        _noPrefill.add(profileId || '(current)');
        console.warn('[GlassPhone] текущий API не принял messages-prefill; используется текстовая эмуляция');
    }

    // Путь 4: text-completion/несовместимый API через generateRaw.
    logReq('запрос (текущий API)', `max ${maxTokens}${image ? ' · фото не приложено' : ''}${usePrefill ? ' · эмуляция префилла' : ''}${useFigureSpaces ? ' · U+2007' : ''}`);
    try {
        const res = await generateRaw({ prompt: fallbackPrompt, responseLength: maxTokens });
        logOk('ответ (текущий API)', `${String(res || '').length} симв.`);
        return finish(res);
    } catch (e) {
        const root = rootErrorMessage(e);
        const rescued = await recoverGeneratedText(e, finish, usePrefill ? prefill : '');
        if (rescued !== null) {
            console.warn(`[GlassPhone] generateRaw вернул ошибку «${root}», но candidate пригоден — используем его.`);
            logOk('ответ восстановлен из candidate', `${rescued.length} симв. · ${root}`);
            return rescued;
        }
        logFail('запрос (текущий API)', root);
        throw e;
    }
}

// ── Проверка профиля из настроек: маленький запрос, наружу — реальная причина ──
export async function testSocialProfile() {
    const st = getSettings();
    if (!st.socialProfileId) throw new Error('Профиль не выбран (стоит «Текущий API»)');
    const built = profileInfo(st.socialProfileId);
    const directKey = String(st.directApiKey || '').trim();
    try {
        const res = (directKey && built?.profile?.['api-url'])
            ? await directRequest(built, [{ role: 'user', content: 'Reply with exactly: ok' }], 200, directKey)
            : await profileRequest(st.socialProfileId, [{ role: 'user', content: 'Reply with exactly: ok' }], 200);
        const out = String(res.content || '').trim();
        // Наружу — куда РЕАЛЬНО ушёл запрос (видно, что не основное подключение)
        const where = res.info || built?.info || '?';
        if (!out) throw new Error(`Пустой ответ. Запрос уходил: ${where}`);
        return `${out.slice(0, 60)} ← ${where}`;
    } catch (e) {
        throw new Error(rootErrorMessage(e), { cause: e });
    }
}

// ── Автоописание фото поста (вижн): заполняет imgDesc, если юзер его не написала.
// Без описания персонажи в ОСНОВНОЙ ролевой не знают, что на фото (в инжекцию
// картинку не приложишь) — поэтому описываем фото сами, один раз при публикации.
// Пути: профиль соцсетей (чисто) ИЛИ фолбэк через generateQuietPrompt+quietImage
// на основном API (может обрасти CoT-шумом — чистим). Так вижн работает ВСЕГДА.
// In-flight дедуп: публикация и открытие поста могли запустить описание ПАРАЛЛЕЛЬНО
// (двойной запрос к API). Один пост — один запрос, остальные ждут его же промис.
const _describeInFlight = new Map();

export async function describePostImage(post) {
    if (!post?.image || post.imgDesc) return false;
    if (_describeInFlight.has(post.id)) return _describeInFlight.get(post.id);
    const p = _describePostImageInner(post).finally(() => _describeInFlight.delete(post.id));
    _describeInFlight.set(post.id, p);
    return p;
}

// Описать ЛЮБУЮ картинку вижном (цепочка только vision-каналов: профиль →
// прямой запрос текущим API → quietImage; текстовый фолбэк запрещён —
// описание «вслепую» = галлюцинация). Возвращает строку или ''.
export async function describeImage(image) {
    if (!image) return '';
    const task = 'Describe this photo in detail in Russian: who/what is in the frame, pose, facial expressions, clothes, setting, lighting, mood, small details, and any text visible. Output ONLY the description as a cohesive paragraph — no quotes, no labels, no tags, no thinking blocks.';
    try {
        // 800 токенов: 150 обрывало генерацию на полуслове («...подчерк»).
        // quietImage-фолбэк УДАЛЁН: он гнал полный контекст с пресетом (10к+ токенов),
        // и пресет перехватывал задачу — модель отвечала ролевым ходом вместо описания.
        let raw = '';
        if (getSettings().socialProfileId) {
            raw = await socialGen(task, { maxTokens: 800, image });
        } else {
            raw = await currentApiVision(task, image, 800) || '';
        }
        // Полный текст: сколько описал — столько и в пост (абзацы схлопываются
        // в одну строку, чтобы не рвать разметку сообщения)
        return raw
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/^["'«]|["'»]$/g, '')
            .trim().replace(/\s*\n+\s*/g, ' ').slice(0, 3000);
    } catch (e) {
        console.warn('[GlassPhone] describeImage failed:', e);
        return '';
    }
}

async function _describePostImageInner(post) {
    const desc = await describeImage(post.image);
    if (!desc) return false;
    post.imgDesc = desc;
    saveMeta();
    return true;
}

// ═══ СМС с фото: описание + ответ ОДНИМ vision-запросом ═══
// Экономия: раньше картинка уходила в API дважды (describe + ответ), а фолбэк
// через quietImage гнал полный контекст с пресетом (10к+ токенов) и пресет
// перехватывал задачу. Возвращает {desc, replies:[{from,text}]} или null.
export async function generateSmsPhotoReply({ contactName, isGroup = false, members = [], userText = '', image }) {
    if (!image) return null;
    const target = isGroup
        ? `the group chat «${contactName}» (members: ${members.join(', ') || '?'})`
        : contactName;
    const prompt = `${await taskHeader(`reply to an SMS that ${getUserName()} just sent from ${getUserName()}'s phone, and describe the attached photo.`)}
${getUserName()} texted ${target}: "${userText || '(only the photo, no text)'}"
Their PHOTO is ATTACHED to this request — LOOK at it and react to what you actually see.

Output STRICT JSON object ONLY — no markdown, no backticks, no <think>, no HTML comments:
{"photo_description":"detailed description of the attached photo in Russian, one cohesive paragraph: who/what is in the frame, pose, facial expression, clothes, setting, lighting, mood, small details","replies":[{"from":"SenderName","text":"reply text"}]}
Reply rules: 1-5 short messages in the character's own texting voice, in-character reaction to the photo and their text, same language as the excerpt. ${isGroup ? 'Several members may reply in a row — "from" = member name.' : `Every reply has "from":"${contactName}".`} If the character realistically would NOT reply right now, use an empty "replies" array.
${uiLangLine()}`;

    try {
        const raw = await socialGen(prompt, { maxTokens: 1500, image, prefill: '{"photo_description":"' });
        const obj = parseJsonObject(raw);
        if (!obj) return null;
        const desc = String(obj.photo_description || '').trim().replace(/\s*\n+\s*/g, ' ').slice(0, 3000);
        const replies = Array.isArray(obj.replies)
            ? obj.replies.filter(r => r && r.text).map(r => ({
                from: String(r.from || contactName),
                text: String(r.text).slice(0, 500),
            })).slice(0, 5)
            : [];
        return { desc, replies };
    } catch (e) {
        console.warn('[GlassPhone] generateSmsPhotoReply failed:', e);
        return null;
    }
}

// Толерантный парс JSON-ОБЪЕКТА из ответа модели
function parseJsonObject(raw) {
    let text = String(raw || '').trim()
        .replace(/```json?/gi, '').replace(/```/g, '')
        .replace(/<!--[\s\S]*?-->/g, '');
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
        const j = safeJson(m[0]);
        if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    }
    return null;
}

// Толерантный парс JSON-массива из ответа модели
// Крупные структуры (группы, серверы, списки эфиров) на «думающих» моделях
// рвутся: почти весь бюджет уходит в reasoning, а на JSON остаются крохи и
// ответ обрывается на середине. Пустой разбор — один повтор с двойным лимитом.
async function socialGenArray(prompt, opts = {}) {
    const arr = parseJsonArray(await socialGen(prompt, opts));
    if (Array.isArray(arr) && arr.length) return arr;
    const bigger = Math.min(8192, (opts.maxTokens || 1024) * 2);
    logReq('повтор (ответ оборвался)', `max ${bigger}`);
    // Ровно одна попытка: рекурсивный вызов самого себя крутил бы запросы
    // по кругу, пока модель молчит
    return parseJsonArray(await socialGen(prompt, { ...opts, maxTokens: bigger }));
}

function parseJsonArray(raw) {
    let text = String(raw || '').trim()
        .replace(/```json?/gi, '').replace(/```/g, '')
        .replace(/<!--[\s\S]*?-->/g, ''); // модель может по привычке добавить наши теги
    let m = text.match(/\[[\s\S]*\]/);
    if (m) {
        const j = safeJson(m[0]);
        if (Array.isArray(j)) return j;
    }
    // Массив оборвался — дорезаем по последнему полному объекту
    const start = text.indexOf('[');
    if (start >= 0) {
        const lastBrace = text.lastIndexOf('}');
        if (lastBrace > start) {
            const j = safeJson(text.slice(start, lastBrace + 1) + ']');
            if (Array.isArray(j)) return j;
        }
    }
    return null;
}

function contactsBlock() {
    let lines = [];
    const seen = new Set();
    try {
        const { contacts } = scanChat();
        for (const c of contacts.values()) {
            lines.push(`- ${c.name} (${handleFor(`contact:${keyOf(c.name)}`, c.name)})`);
            seen.add(keyOf(c.name));
        }
    } catch (e) { /* ignore */ }
    // Главный персонаж чата — всегда среди известных лиц
    const mc = mainCharName();
    if (mc && !seen.has(keyOf(mc))) {
        lines.push(`- ${mc} (${handleFor(`contact:${keyOf(mc)}`, mc)})`);
    }
    const userLine = `${getUserName()}'s own handle: ${getUserHandle()}`;
    return (lines.length ? `Known characters (contacts in ${getUserName()}'s phone), use EXACTLY these handles for them:\n${lines.join('\n')}` : '(no known contacts yet)') + `\n${userLine}`;
}

// ── Богатый контекст: карточка персонажа + персона + триггернутый лорбук ──
// Режим 'rich' (дефолт): модель получает то же, что видит в основном чате,
// НО без пресета — персонажи в соцсетях звучат в характере, а не «вне контекста».
async function richContext() {
    const out = { charDesc: '', persona: '', wi: '' };
    try {
        const ctx = SillyTavern.getContext();
        const sub = (t) => { try { return ctx.substituteParams ? ctx.substituteParams(t) : t; } catch (e) { return t; } };

        const ch = ctx.characters?.[ctx.characterId];
        if (ch) {
            const bits = [ch.description || ''];
            if (ch.personality) bits.push(`Personality: ${ch.personality}`);
            out.charDesc = sub(bits.filter(Boolean).join('\n')).slice(0, 4000);
        }

        const personaDesc = sub('{{persona}}');
        if (personaDesc && personaDesc !== '{{persona}}') out.persona = personaDesc.slice(0, 1500);

        // Лорбук: РЕАЛЬНО триггернутые записи (тот же движок, что в основном чате,
        // dryRun — без побочных эффектов вроде sticky/cooldown таймеров)
        try {
            const wiMod = await import('../../../world-info.js');
            if (typeof wiMod.getWorldInfoPrompt === 'function') {
                const chat = (ctx.chat || []).filter(m => m && m.mes && !m.is_system);
                const chatForWI = chat.map(x => `${x.name}: ${x.mes}`).reverse();
                const scanData = {
                    personaDescription: out.persona,
                    characterDescription: out.charDesc,
                    characterPersonality: ch?.personality || '',
                    characterDepthPrompt: '',
                    scenario: ch?.scenario || '',
                    creatorNotes: '',
                    trigger: 'normal',
                };
                const res = await wiMod.getWorldInfoPrompt(chatForWI, 8192, true, scanData);
                const parts = [res.worldInfoBefore, res.worldInfoAfter];
                for (const d of (res.worldInfoDepth || [])) {
                    if (Array.isArray(d?.entries)) parts.push(d.entries.join('\n'));
                }
                out.wi = sub(parts.filter(Boolean).join('\n')).slice(0, 4000);
            }
        } catch (e) {
            console.warn('[GlassPhone] lorebook fetch failed:', e);
        }
    } catch (e) { /* ignore */ }
    return out;
}

// Общая шапка задачи. rich: карточка+персона+лорбук+история; lite: только срез чата.
async function taskHeader(what) {
    const st = getSettings();
    const rich = st.socialContextMode !== 'lite';
    let block = `You are a content generator for a phone app inside a text roleplay. Task: ${what}
This is a STANDALONE task — do NOT roleplay, do NOT write for characters outside the requested format.
`;
    let rc = { charDesc: '', persona: '', wi: '' };
    if (rich) {
        rc = await richContext();
        if (rc.charDesc) block += `\n=== MAIN CHARACTER (how they think, talk, behave — use this voice) ===\n${rc.charDesc}\n`;
        if (rc.persona) block += `\n=== ${getUserName()} (the user's persona) ===\n${rc.persona}\n`;
        if (rc.wi) block += `\n=== WORLD / LOREBOOK (relevant entries) ===\n${rc.wi}\n`;
    }
    const rp = rpContextBlock(rich ? 16 : 12);
    if (rp) block += `\n=== RECENT ROLEPLAY EXCERPT (current events) ===\n${rp}\n=== END OF EXCERPT ===\n`;
    const dt = getRpDateTime();
    if (dt) block += `\n=== AUTHORITATIVE RP CLOCK ===\nCurrent in-world date/time: ${String(dt.day).padStart(2, '0')}.${String(dt.month).padStart(2, '0')}.${dt.year}${dt.hours === undefined ? '' : ` ${String(dt.hours).padStart(2, '0')}:${String(dt.minutes || 0).padStart(2, '0')}`}. This overrides the computer/server date. Relative phrases in posts (today/tomorrow/tonight) must be interpreted from this clock.\n`;
    block += `\n=== SETTING: COUNTRY, PLACE, ERA ===\nInfer from WORLD/LOREBOOK, character card, persona and the RP excerpt: the country and city (or the world and region, if the setting is not our Earth), the era, the season and the kind of place the scene is in — a megalopolis, a small town, a village, a station, a fantasy realm. The UI/output language is NOT evidence of country: a story in Russian may be set anywhere.\nEverything you invent must belong to THAT place and time: names, handles and slang; shops, cafés, brands, delivery services, banks and mobile operators; streets, districts, transport and landmarks; prices and currency; weather, daylight and season; holidays, news topics, local habits and what people argue about. No cross-border props — no American chains in a Russian town, no rubles in medieval France, no Instagram in a world without electricity (there use whatever the setting has instead).\nIf the evidence is mixed or absent, stay neutral: generic names and places, no nationality guessed by default. Known characters keep their exact display names.\n`;
    return block;
}

const JSON_RULES = `Output STRICT JSON array ONLY. No markdown, no backticks, no commentary, no <think>, no hidden HTML comments. Text values in the same language as the roleplay excerpt (Russian). Keep it varied and alive.
CRITICAL — "author" is ALWAYS the person's real DISPLAY NAME (e.g. «Вадим Огнев», «Алиса»), NEVER an @handle/nickname. The @handle belongs ONLY in the separate "handle" field. For known characters use their EXACT name as listed above so the app links them correctly.`;

// Перегенерация ОДНОГО чужого поста: тот же автор, новая запись. Свои посты
// не трогаем — их пишет она сама.
export async function regenerateTweet(id) {
    const s = getSocial();
    const tw = s.tweets.find(x => x.id === id);
    if (!tw || tw.ak === 'user') return false;
    const others = s.tweets.filter(x => x.id !== id).slice(0, 6)
        .map(x => `- ${x.author}: "${String(x.text).slice(0, 90)}"`).join('\n');
    const prompt = `${await taskHeader(`rewrite ONE tweet by ${tw.author} for the feed on ${getUserName()}'s phone.`)}
${contactsBlock()}
Previous version of this tweet (write a DIFFERENT one, same author, same voice): "${String(tw.text).slice(0, 280)}"
${others ? `Other tweets already in the feed (do not repeat their topics):\n${others}` : ''}
One tweet, max 280 chars, short like a real tweet, no emojis. It may reference recent events from ${tw.author}'s point of view.
${uiLangLine()}
${JSON_RULES}
Format: [{"text":"..."}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 400, prefill: '[{"text":"' });
    const next = Array.isArray(arr) && arr[0] ? String(arr[0].text || '').trim() : '';
    if (!next) return false;
    tw.text = next.slice(0, 280);
    tw.replies = [];          // ответы относились к прежнему тексту
    tw.likes = Math.floor(Math.random() * 60);
    tw.rts = Math.floor(Math.random() * 15);
    saveMeta();
    return true;
}

export async function regenerateIgPost(id) {
    const s = getSocial();
    const post = s.igPosts.find(x => x.id === id) || s.ofPosts.find(x => x.id === id);
    if (!post || post.ak === 'user') return false;
    const prompt = `${await taskHeader(`rewrite ONE Instagram post by ${post.author} for the feed on ${getUserName()}'s phone.`)}
${contactsBlock()}
Previous version (write a DIFFERENT one, same author, same voice): photo was "${String(post.imgDesc || '').slice(0, 200)}", caption "${String(post.caption || '').slice(0, 200)}"
Return the new photo description (what is IN the frame, one vivid sentence) and its caption (short, the way this person writes).
${uiLangLine()}
${JSON_RULES}
Format: [{"photo":"what the frame shows","caption":"..."}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 500, prefill: '[{"photo":"' });
    const it = Array.isArray(arr) && arr[0] ? arr[0] : null;
    if (!it || (!it.photo && !it.caption)) return false;
    post.imgDesc = String(it.photo || '').slice(0, 200);
    post.caption = String(it.caption || '').slice(0, 400);
    post.image = null;        // прежняя картинка иллюстрировала другой кадр
    post.comments = [];
    saveMeta();
    return true;
}

export async function refreshFeed(kind = 'tw') {
    const s = getSocial();
    if (kind === 'ig') {
        s.igPosts = s.igPosts.filter(p => p.ak === 'user');
        return await generateIgFeed();
    }
    s.tweets = s.tweets.filter(t => t.ak === 'user');
    return await generateTweetFeed();
}

export async function generateTweetFeed() {
    // Последние твиты юзера — боты могут их цитировать (quote tweet)
    const s = getSocial();
    const userTweets = s.tweets.filter(t => t.ak === 'user').slice(0, 3);
    const userTweetsBlock = userTweets.length > 0
        ? `\n${getUserName()}'s recent tweets (characters may quote-retweet these with commentary):\n${userTweets.map(t => `- "${t.text.slice(0, 120)}"`).join('\n')}\n`
        : '';

    const prompt = `${await taskHeader(`generate tweets for the Twitter-like feed on ${getUserName()}'s phone.`)}
${contactsBlock()}
${userTweetsBlock}
Generate 8-12 tweets for ${getUserName()}'s timeline:
1. Tweets from known characters — in character, may reference recent RP events (from their point of view, no spoilers of hidden thoughts).
2. Tweets from invented accounts fitting the setting: news, local spots, memes, random strangers, drama. These make the feed feel alive.
3. 1-2 tweets MAY be quote-retweets of ${getUserName()}'s recent tweets (if they posted any) — a character reacts to their tweet with their own commentary. For these, add a "quote" field.

Rules: max 280 chars each, SHORT like real tweets; mix of tones (news, shitpost, life update, ad, hot take). NO emojis.
${uiLangLine()}
${JSON_RULES}
Format: [{"author":"Имя","handle":"@handle","text":"...","type":"contact|random"},...]  
For quote-retweets: {"author":"...","handle":"...","text":"their commentary","type":"contact|random","quote":{"author":"${getUserName()}","text":"original tweet text"}}`;

    const parsed = await socialGenArray(prompt, { maxTokens: 2048, prefill: '[{"author":"' });
    if (!Array.isArray(parsed) || parsed.length === 0) return 0;

    let added = 0;
    for (const it of parsed) {
        if (!it || !it.author || !it.text) continue;
        if (isBanned(it.author, it.handle)) continue;
        const tw = {
            id: genId(), author: String(it.author), handle: it.handle || makeHandle(it.author),
            ak: it.type === 'contact' ? resolveAuthorKey(it.author) : 'random',
            text: String(it.text).slice(0, 280),
            time: Date.now() - Math.floor(Math.random() * 5400000),
            likes: Math.floor(Math.random() * 60), liked: false,
            rts: Math.floor(Math.random() * 15), replies: [],
        };
        // Цитата (quote tweet)
        if (it.quote && it.quote.author && it.quote.text) {
            tw.quotedTweet = {
                author: String(it.quote.author),
                handle: it.quote.handle || makeHandle(it.quote.author),
                text: String(it.quote.text).slice(0, 280),
            };
        }
        s.tweets.unshift(tw);
        added++;
    }
    s.tweets.sort((a, b) => b.time - a.time);
    trimFeeds(s); saveMeta();
    return added;
}

export async function generateTweetComments(tweet) {
    const existing = (tweet.replies || []).map(r => `${r.author}: ${r.text}`).join('\n');
    const prompt = `${await taskHeader('generate replies under a tweet in the Twitter-like app.')}
Tweet by ${tweet.author} (${tweet.handle || makeHandle(tweet.author)}): "${tweet.text}"
${tweet.advertisement ? `This is a PAID AD for ${tweet.advertisement.brand} (${tweet.advertisement.product}). Brief: ${tweet.advertisement.brief}. Risk level: ${tweet.advertisement.risk}. The audience MUST notice the sponsorship: mix believable support, skepticism, jokes, criticism and questions; controversial offers should provoke stronger disagreement.` : ''}
${existing ? `Existing replies (do not repeat):\n${existing}\n` : ''}
${contactsBlock()}

Generate 4-7 replies: known characters in-character when relevant + random accounts (fans, haters, reply guys, bots). Realistic engagement — some agree, some argue, some joke. Max 280 chars each. NO emojis. Add sentiment="positive|neutral|negative" to every reply.
${uiLangLine()}
${JSON_RULES}
Format: [{"author":"Имя","handle":"@handle","text":"...","type":"contact|random","sentiment":"positive|neutral|negative"},...]`;

    const parsed = await socialGenArray(prompt, { maxTokens: 1536, prefill: '[{"author":"' });
    if (!Array.isArray(parsed)) return 0;
    let added = 0;
    if (!Array.isArray(tweet.replies)) tweet.replies = [];
    for (const it of parsed) {
        if (!it || !it.author || !it.text) continue;
        if (isBanned(it.author, it.handle)) continue;
        if (tweet.replies.length >= MAX_COMMENTS) break;
        tweet.replies.push({
            id: genId(), author: String(it.author), handle: it.handle || makeHandle(it.author),
            ak: it.type === 'contact' ? resolveAuthorKey(it.author) : 'random',
            text: String(it.text).slice(0, 280), sentiment: ['positive','neutral','negative'].includes(it.sentiment) ? it.sentiment : 'neutral', time: Date.now() - Math.floor(Math.random() * 900000),
        });
        added++;
    }
    tweet.likes = Math.max(tweet.likes || 0, Math.floor(Math.random() * 25) + tweet.replies.length * 2);
    saveMeta();
    return added;
}

// Ответ автора-персонажа на реплику юзера (твит или инста-пост)
export async function generateAuthorReply(kind, item, userText, replyTo = null) {
    const prompt = `${await taskHeader(`write ONE short social-media reply as the character ${item.author}.`)}
${item.author} posted this ${kind === 'tw' ? 'tweet' : 'Instagram post'}: "${kind === 'tw' ? item.text : (item.caption || item.imgDesc)}"
${getUserName()} replied to it: "${userText}"

Write ${item.author}'s reply to ${getUserName()}: max 280 chars, in-character (use the roleplay excerpt to match their voice), natural social media tone, same language as the excerpt. NO emojis.
Output ONLY the reply text — no quotes, no labels, no JSON, no HTML comments, no <think>.
${uiLangLine()}`;

    const raw = (await socialGen(prompt, { maxTokens: 256, image: (kind === 'ig' && item.image && (getSettings().visionInComments || !item.imgDesc)) ? item.image : null })).trim()
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^["'«]|["'»]$/g, '').trim();
    if (!raw) return null;
    const text = raw.slice(0, 280);
    const userReplyRef = replyTo || null;
    if (kind === 'tw') return addTweetReply(item.id, text, item.author, item.ak, userReplyRef);
    return addIgComment(item.id, text, item.author, item.ak, userReplyRef);
}

// Ответ конкретного персонажа на коммент юзера (юзер ответил НА конкретный коммент)
export async function generateReplyToComment(kind, item, targetComment, userText) {
    const authorName = targetComment.author;
    const ak = targetComment.ak;
    const isContact = typeof ak === 'string' && ak.startsWith('contact:');
    if (!isContact) return null; // рандомные аккаунты не отвечают

    const postDesc = kind === 'tw'
        ? `tweet by ${item.author}: "${item.text}"`
        : `Instagram post by ${item.author}: "${item.caption || item.imgDesc}"`;
    const prompt = `${await taskHeader(`write ONE short social-media reply as the character ${authorName}.`)}
${postDesc}
${authorName} commented: "${targetComment.text}"
${getUserName()} replied to ${authorName}'s comment: "${userText}"

Write ${authorName}'s response to ${getUserName()}'s reply: max 280 chars, in-character, natural social media tone, same language as the excerpt. NO emojis.
Output ONLY the reply text — no quotes, no labels, no JSON, no HTML comments, no <think>.
${uiLangLine()}`;

    const raw = (await socialGen(prompt, { maxTokens: 256 })).trim()
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^["'«]|["'»]$/g, '').trim();
    if (!raw) return null;
    const text = raw.slice(0, 280);
    // Ответ привязан к реплике юзера (которая была ответом на targetComment)
    // Но мы вставляем как ответ на юзерский коммент — указываем replyTo на юзера
    if (kind === 'tw') return addTweetReply(item.id, text, authorName, ak);
    return addIgComment(item.id, text, authorName, ak);
}

export async function generateIgFeed() {
    const prompt = `${await taskHeader(`generate posts for the Instagram-like feed on ${getUserName()}'s phone.`)}
${contactsBlock()}

Generate 5-8 Instagram posts:
1. Posts from known characters — in character (their aesthetic, their life).
2. Posts from invented accounts fitting the setting (places, food, aesthetics, memes). These are STRANGERS unrelated to ${getUserName()} — their photos must NOT feature ${getUserName()} or the main story characters.

Each post: "photo" = short visual description of the photo (what's in the frame, 5-15 words), "caption" = post caption (may include hashtags), max 200 chars. NO emojis.
${uiLangLine()}
${JSON_RULES}
Format: [{"author":"Имя","photo":"описание кадра","caption":"...","type":"contact|random"},...]`;

    const parsed = await socialGenArray(prompt, { maxTokens: 2048, prefill: '[{"author":"' });
    if (!Array.isArray(parsed) || parsed.length === 0) return 0;

    const s = getSocial();
    let added = 0;
    for (const it of parsed) {
        if (!it || !it.author || (!it.photo && !it.caption)) continue;
        if (isBanned(it.author, it.handle)) continue;
        s.igPosts.unshift({
            id: genId(), author: String(it.author),
            ak: it.type === 'contact' ? resolveAuthorKey(it.author) : 'random',
            image: null, imgDesc: String(it.photo || '').slice(0, 200),
            caption: String(it.caption || '').slice(0, 400),
            time: Date.now() - Math.floor(Math.random() * 7200000),
            likes: Math.floor(Math.random() * 120) + 3, liked: false, comments: [],
        });
        added++;
    }
    s.igPosts.sort((a, b) => b.time - a.time);
    trimFeeds(s); saveMeta();
    return added;
}

// ── Каталог магазина (для приложения «Магазин») ──
// Генерируется по требованию, изолированно от RP-пресета, но С контекстом
// (taskHeader → модель знает город/страну/сеттинг ролевой). Возвращает массив
// [{store, items:[{name, price, desc}]}] или null.
export async function generateShopContent(catLabel, catHint, currency) {
    const prompt = `${await taskHeader(`generate an online shopping catalog for the "${catLabel}" category on ${getUserName()}'s phone.`)}
Match the CITY / COUNTRY / SETTING of the roleplay — local brands, style, realistic price level in ${currency}. If the setting is fantasy/other-world, invent fitting shops.
${catHint}
Generate 2-4 realistic stores/vendors, each with 4-7 items. "price" is a plain integer number in ${currency} (no sign, no text). Short vivid item descriptions (5-12 words). NO emojis.
${uiLangLine()}
${JSON_RULES}
Format: [{"store":"Store name","items":[{"name":"Товар","price":1234,"desc":"краткое описание"}]}]`;
    return await socialGenArray(prompt, { maxTokens: 2048, prefill: '[{"store":"' });
}

// ── Поиск по каталогу: догенерация товаров под запрос пользователя ──
export async function generateShopSearch(catLabel, storeNames, query, currency) {
    const prompt = `${await taskHeader(`a customer searches the "${catLabel}" stores on ${getUserName()}'s phone for: "${query}".`)}
Match the CITY / COUNTRY / SETTING of the roleplay — local brands, realistic price level in ${currency}. If the setting is fantasy/other-world, adapt the goods to it.
Return 4-8 items matching the search query, grouped under the EXISTING stores (use these exact store names: ${storeNames.join(' | ')}). Distribute plausibly (a pharmacy item belongs to the pharmacy). "price" is a plain integer number in ${currency} (no sign, no text). Short vivid item descriptions (5-12 words). NO emojis.
${uiLangLine()}
${JSON_RULES}
Format: [{"store":"exact existing store name","items":[{"name":"Товар","price":1234,"desc":"краткое описание"}]}]`;
    return await socialGenArray(prompt, { maxTokens: 1600, prefill: '[{"store":"' });
}

// ── Подбор музыки под текущую сцену ролевой ──
export async function generateSceneMood(prefs = null) {
    const vocalRule = prefs?.vocal === 'vocal'
        ? 'The track MUST have vocals and lyrics (a song, not an instrumental).'
        : prefs?.vocal === 'instrumental'
            ? 'The track MUST be instrumental — no vocals, no lyrics.'
            : '';
    // Язык имеет смысл только когда слова вообще есть
    const langRule = (prefs?.vocal === 'instrumental') ? '' : (
        prefs?.lang === 'ru' ? 'The lyrics MUST be in Russian — pick a Russian-language artist and song.'
        : prefs?.lang === 'en' ? 'The lyrics MUST be in English — pick an English-language artist and song.'
        : prefs?.lang === 'other' ? 'Pick a song in a language OTHER than Russian or English (e.g. Japanese, French, Korean, German).'
        : '');
    const prefBlock = [vocalRule, langRule].filter(Boolean).join('\n');
    const prompt = `${await taskHeader(`pick ONE music track that fits the current roleplay scene — its mood, tempo and atmosphere.`)}
The track must be REAL and easy to find on streaming services: well-known enough, correct exact artist and title. Match the genre and language to the scene and setting; if a specific song is playing or mentioned in the scene, prefer it.${prefBlock ? '\n' + prefBlock : ''}
"query" = "Artist - Title" for a search engine. "mood" = 2-4 words describing the scene's mood.
${uiLangLine()}
${JSON_RULES}
Format: [{"query":"Artist - Title","mood":"..."}]`;
    return await socialGenArray(prompt, { maxTokens: 300, prefill: '[{"query":"' });
}

// ── Спам/мошенники: одно скам-смс под сеттинг ──
export async function generateScamSms(recent = []) {
    const seen = (recent || []).slice(0, 8).map(x => `- ${x}`).join('\n');
    const prompt = `${await taskHeader(`invent ONE scam/spam SMS that ${getUserName()} just received from an unknown number.`)}
Invent a scam or spam text fitting the setting: fake bank security alert, phishing link, casino/lottery spam, «мама, я с чужого номера, срочно нужны деньги», fake delivery fee, crypto pump, subscription trap. Scammers impersonate LOCAL institutions: the bank, delivery service, tax office, police or operator must be ones that exist where the story takes place — in Tokyo it is a Japanese bank and a Japanese courier, never a foreign one. Phone format, currency and the sender name follow the same country. If the setting is not modern — adapt the fraud to the world (guild lottery, cursed amulet seller, «маг-целитель снимет порчу»). Believable, specific, slightly off — like real scam. May include a fake link or callback number. Same language as the roleplay excerpt.
${seen ? `They ALREADY received these scam messages — invent a COMPLETELY different scheme, sender type and wording (do not rehash any of them):\n${seen}\n` : ''}${uiLangLine()}
${JSON_RULES}
Format: [{"from":"sender: short name or a phone number in the local format","text":"the scam message, max 280 chars"}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 400, prefill: '[{"from":"' });
    const it = Array.isArray(arr) ? arr[0] : null;
    if (!it || !it.from || !it.text) return null;
    return { from: String(it.from).slice(0, 40), text: String(it.text).slice(0, 300) };
}

// ── Новости: лента города/мира под лорбук и сюжет ──
export async function generateNewsFeed(existingTitles = []) {
    const prompt = `${await taskHeader(`generate a news feed for the news app on ${getUserName()}'s phone.`)}
Invent 7-10 news items for the CITY/WORLD of the roleplay: local incidents, society gossip, economy, oddities, weather warnings, culture. 1-2 items MAY obliquely echo recent roleplay events (from an outsider's/press point of view, no private details the press couldn't know). The rest — living world background.
${existingTitles.length ? `Do not repeat these existing headlines: ${existingTitles.join('; ')}` : ''}
"tag" — short category (происшествия/светская хроника/экономика/культура/странное...). "title" max 80 chars, "text" 1-3 sentences. Same language as the excerpt. NO emojis.
${uiLangLine()}
${JSON_RULES}
Format: [{"tag":"категория","title":"заголовок","text":"текст новости"}]`;
    return await socialGenArray(prompt, { maxTokens: 2048, prefill: '[{"tag":"' });
}


// ── Дискорд: серверы и жизнь каналов ──
export async function generateDiscordServers(existing = []) {
    const prompt = `${await taskHeader(`invent Discord servers that ${getUserName()} would realistically be a member of.`)}
Invent 2-4 servers fitting their interests, city, work and the roleplay setting (fandom, hobby, game, neighborhood, professional...). For each: name, one-line description, 2-4 text channels (channel name latin-lowercase-with-dashes, short topic), 8-12 member nicknames (varied and believable; story characters MAY appear under their handles if they'd plausibly be there).
${existing.length ? `Servers they already have (do NOT duplicate): ${existing.join('; ')}` : ''}
${uiLangLine()}
${JSON_RULES}
Format: [{"name":"...","desc":"...","channels":[{"name":"general","topic":"..."}],"members":["nick1","nick2"]}]`;
    return socialGenArray(prompt, { maxTokens: 2600, prefill: '[{"name":"' });
}

// Свой сервер: юзер даёт название и тему, модель наполняет каналами/участниками
export async function generateOwnDiscordServer(name, theme) {
    const prompt = `${await taskHeader(`${getUserName()} is creating their OWN Discord server called «${name}».`)}
Server theme / what it's about: ${theme || name}.
Flesh it out as its OWNER would set it up: a one-line description, 3-5 text channels (name latin-lowercase-with-dashes, short topic), and 8-14 members who would join — their friends/contacts from the roleplay MAY be here under nicknames, plus fitting strangers. They is the owner (do NOT list their among members).
${uiLangLine()}
${JSON_RULES}
Format: [{"desc":"...","channels":[{"name":"general","topic":"..."}],"members":["nick1","nick2"]}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 1400, prefill: '[{"desc":"' });
    return Array.isArray(arr) ? arr[0] : null;
}

// Группы-чаты в «Сообщениях» (как в ТГ): семейный/рабочий/дворовый/фандомный.
// Каждый — с участниками и живой стартовой перепиской.
export async function generateGroupChats(existing = []) {
    const m = getMeta();
    const contactNames = [...new Set((m.contacts || []).map(c => c.name))].slice(0, 14);
    const prompt = `${await taskHeader(`invent group chats on ${getUserName()}'s phone messenger (like Telegram/WhatsApp groups).`)}
Their known contacts (реальные участники, use their EXACT names): ${contactNames.join(', ') || '—'}.
Invent 2-3 group chats that fit their life and the roleplay: e.g. family chat, work team, close friends, neighbours, a hobby/fandom group. Each chat MUST include 2-5 members — prefer their real contacts by exact name, you may add 1-2 fitting new people per chat. Give each a short lively opening exchange (3-6 messages) between the members (NOT ${getUserName()} themselves), in their voices, fitting the current story moment.
${existing.length ? `Chats they already have (do NOT duplicate): ${existing.join('; ')}` : ''}
${uiLangLine()}
${JSON_RULES}
Format: [{"name":"Название чата","members":["Имя1","Имя2"],"messages":[{"author":"Имя1","text":"..."}]}]`;
    return await socialGenArray(prompt, { maxTokens: 1800, prefill: '[{"name":"' });
}

export async function generateDiscordFeed(server, channel, existingMsgs = [], userText = null, replyTo = null) {
    const ex = existingMsgs.slice(-10).map(x => `${x.author}: ${x.text}`).join('\n');
    const userEvent = userText
        ? (replyTo
            ? `${getUserName()} (${handleFor('user', getUserName())}) just REPLIED to ${replyTo.author}'s message «${replyTo.text}» with: "${userText}" — ${replyTo.author} SHOULD answer them back, others may chime in.`
            : `${getUserName()} (${handleFor('user', getUserName())}) just posted: "${userText}" — several replies MUST react to their message (agree, argue, joke, @-mention them).`)
        : 'Write a natural slice of ongoing conversation fitting the topic.';
    const prompt = `${await taskHeader(`write fresh messages in the «${channel.name}» channel of the «${server.name}» Discord server.`)}
Server: ${server.desc || server.name}. Channel topic: ${channel.topic || channel.name}. Members: ${(server.members || []).join(', ')}.
${ex ? `Recent channel history:\n${ex}\n` : ''}${userEvent}
4-8 messages, casual internet register matching the server vibe, authors ONLY from the member list, no timestamps. ${uiLangLine()}
${JSON_RULES}
Format: [{"author":"nick","text":"..."}]`;
    return await socialGenArray(prompt, { maxTokens: 1400, prefill: '[{"author":"' });
}

// ── Курьер: кто везёт заказ и переписка с ним в приложении магазина ──
// Имя не берём из готового списка — курьер должен быть из того же мира,
// что и ролевая (страна, язык, реалии).
export async function generateCourier(order, left, packing = false) {
    const items = (order.items || [{ name: order.item }]).map(x => x.name).join(', ');
    const firstMsg = packing
        ? 'their FIRST message to the customer: they have been assigned to this order and are waiting for the store to pack it'
        : 'their FIRST message to the customer: they picked the order up and are on the way';
    const prompt = `${await taskHeader(`invent the courier delivering ${getUserName()}'s order and their first message in the delivery app chat.`)}
Order: ${items} — from «${order.store}». ${packing ? 'The store is still packing it.' : ''} Delivery in about ${left}.
Invent the courier: a real person of this setting (name as it would show in a delivery app — usually first name, sometimes with surname initial) and ${firstMsg}.
VOICE: type it as this person would, one thumb, in a hurry — 1-2 short sentences, no literary prose, no call-centre boilerplate. A migrant courier (Uzbek/Tajik/Kyrgyz name) has no grammatical gender and different cases in his own language, so it shows: "я подошел" about himself, "жду возле подъезд", "нету", address like "сестра"/"апа"/"брат", sometimes a word in Latin letters — real hurried typing, not "моя твоя" pidgin. A local student writes in slang and lowercase; an older driver — dry and terse. In another language, reproduce the same kind of breakage.
${uiLangLine()}
${JSON_RULES}
Format: [{"name":"courier name","text":"first message"}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 400, prefill: '[{"name":"' });
    const c = Array.isArray(arr) ? arr[0] : null;
    if (!c || !c.name) throw new Error('Курьер не назначился — попробуй ещё раз');
    return { name: String(c.name).slice(0, 40), text: String(c.text || '').slice(0, 300) };
}

export async function generateCourierReply(order, courier, history = [], userText = '', arrived = false) {
    const items = (order.items || [{ name: order.item }]).map(x => x.name).join(', ');
    const ex = history.slice(-8).map(x => `${x.user ? getUserName() : courier.name}: ${x.text}`).join('\n');
    const situation = arrived
        ? 'The courier has JUST ARRIVED at their door with the order — write what they write on arrival (at the door / calling, handing it over).'
        : `${getUserName()} just wrote to the courier: "${userText}" — answer them in character.`;
    const prompt = `${await taskHeader(`write the courier's reply in the delivery app chat with ${getUserName()}.`)}
Courier: ${courier.name}. Order: ${items} — from «${order.store}».
${ex ? `Chat so far:\n${ex}\n` : ''}${situation}
ONE short message (1-2 sentences), same broken grammar and address forms as in his previous messages here — a non-native speaker does not suddenly start writing correctly. Do not roleplay their side, do not narrate.
${uiLangLine()}
${JSON_RULES}
Format: [{"text":"..."}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 300, prefill: '[{"text":"' });
    const t = Array.isArray(arr) && arr[0] ? String(arr[0].text || '').slice(0, 300) : '';
    if (!t) throw new Error('Курьер не отвечает — попробуй ещё раз');
    return t;
}

// ── Твич: список эфиров и «тики» стрима (сцена меняется от событий/комментов) ──
export async function generateStreamList(existing = []) {
    const prompt = `${await taskHeader(`invent live streams currently online in the Twitch-like app on ${getUserName()}'s phone.`)}
Invent 4-6 live channels fitting the setting: gaming, IRL, music, cooking, talk shows... 1-2 MAY be story-adjacent (a contact or local celebrity streaming) if plausible. For each: streamer nick, stream title, category, viewers (number) and "scene" — ONE vivid sentence describing what is on screen RIGHT NOW (it is used to draw the frame).
${existing.length ? `Already listed (avoid duplicates): ${existing.join('; ')}` : ''}
${uiLangLine()}
${JSON_RULES}
Format: [{"streamer":"nick","title":"...","category":"...","viewers":1234,"scene":"what the frame shows"}]`;
    return await socialGenArray(prompt, { maxTokens: 1400, prefill: '[{"streamer":"' });
}

export async function generateStreamTick(stream, chatLog = [], userComment = null, donation = null) {
    const ex = chatLog.slice(-8).map(x => `${x.author}: ${x.text}`).join('\n');
    const userEvent = donation
        ? `${getUserName()} just DONATED ${donation.amount} to the streamer${userComment ? ` with the message: "${userComment}"` : ''} — a donation alert popped on stream. The STREAMER MUST notice it and thank/react to their on stream (in their own style); chat reacts too (hype, envy, jokes).`
        : (userComment
            ? `${getUserName()} just wrote in the stream chat: "${userComment}" — the STREAMER may notice and react on stream (read it aloud, answer, laugh), and chat may reply to them.`
            : 'Advance the stream a little: something happens on screen.');
    const prompt = `${await taskHeader(`continue the live stream «${stream.title}» by ${stream.streamer} that ${getUserName()} is watching.`)}
Category: ${stream.category}. Current frame: ${stream.scene}
${ex ? `Recent stream chat:\n${ex}\n` : ''}${userEvent}
Return: "scene" — NEW one-sentence description of the frame now (changed by events${userComment ? ' and possibly their comment' : ''}); "streamer" — what the streamer says/does (1-2 sentences, their live voice); "chat" — 3-6 viewer messages (short, twitch-style, varied nicks${userComment ? ', some replying to them' : ''}); "viewers" — updated count (drift it slightly).
${uiLangLine()}
${JSON_RULES}
Format: [{"scene":"...","streamer":"...","chat":[{"author":"nick","text":"..."}],"viewers":1234}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 1400, prefill: '[{"scene":"' });
    return Array.isArray(arr) ? arr[0] : null;
}

export async function generateMyStreamTick(myStream, chatLog = [], userLine = null) {
    const ex = chatLog.slice(-8).map(x => `${x.author}: ${x.text}`).join('\n');
    const prompt = `${await taskHeader(`${getUserName()} is LIVE on their own stream «${myStream.title}» — generate their audience.`)}
Category: ${myStream.category || '—'}. Viewers now: ${myStream.viewers || 0}. On screen: ${myStream.scene || 'they just went live'}
${ex ? `Recent chat:\n${ex}\n` : ''}${userLine ? `They just said/did on stream: "${userLine}" — the chat REACTS to that.` : 'Chat lives its life: greetings, questions, emote spam, maybe a new follower.'}
Return: "chat" — 4-8 viewer messages (short, twitch-style; regulars, fans, maybe a troll; story characters MAY appear under recognizable nicks if they'd plausibly watch them); "viewers" — updated count (drifts, grows if the stream is interesting); "scene" — one-sentence description of what their frame shows now${userLine ? ' (reflecting what they just did)' : ''}; "donations" — OPTIONAL 0-2 viewer donations {from, amount, text} in the story's ordinary money scale — include one only when it feels EARNED by the moment (a highlight, a milestone, a viewer moved by them), NOT every time.
${uiLangLine()}
${JSON_RULES}
Format: [{"chat":[{"author":"nick","text":"..."}],"viewers":47,"scene":"...","donations":[{"from":"nick","amount":150,"text":"хайп!"}]}]`;
    const arr = await socialGenArray(prompt, { maxTokens: 1400, prefill: '[{"chat":' });
    return Array.isArray(arr) ? arr[0] : null;
}

export async function generateAdvertisingOffers() {
    const s = getSocial();
    if (s.advertising.active) return [];
    const previous = (s.advertising.history || []).slice(0, 12)
        .map(a => `${a.brand}: ${a.product}`).join('\n');
    const prompt = `${await taskHeader(`invent THREE fresh advertising offers for ${getUserName()}'s social-media accounts.`)}
Use the actual roleplay country, era, economy, culture, current events and the user's recent online activity. Brands may be real-looking fictional local businesses, creators, venues, products or services. Make all three substantially different; do not recycle generic placeholder brands.
Current audience: Twitter ${s.socialProfiles.twitter.followers} followers; Instagram ${s.socialProfiles.instagram.followers} followers.
${previous ? `Previously seen offers — DO NOT repeat or lightly rename them:\n${previous}` : ''}
Include a believable fee in the setting's ordinary numeric scale. Exactly one offer may be ethically controversial, but never require illegal content.
Output STRICT JSON array only:
[{"brand":"...","title":"...","product":"...","brief":"...","platform":"twitter|instagram","risk":"safe|mixed|controversial","payment":500}]
${uiLangLine()}`;
    const parsed = await socialGenArray(prompt, { maxTokens: 1800, prefill: '[{"brand":"' });
    return replaceAdOffers(parsed);
}


// ── Статус репутации: короткое живое описание вместо шаблонного тира ──
export async function generateRepLabel(platform, reputation, followers, fallback) {
    const prompt = `${await taskHeader(`invent a short vivid "audience status" label for ${getUserName()}'s ${platform} profile screen.`)}
Their ${platform}: ${followers} followers, reputation score ${reputation}/100 (roughly: "${fallback}").
Write ONE punchy status label, 2-5 words. Make it flavorful and specific to their vibe/roleplay (like «тихий омут ленты» / "menace of the comment section") and matching the score tone (${reputation}/100). ${uiLangLine()} NO quotes, NO emojis. Output ONLY the label.`;
    const raw = await socialGen(prompt, { maxTokens: 60 });
    return String(raw || '').replace(/<!--[\s\S]*?-->/g, '').replace(/["'«»]/g, '').trim().split('\n')[0].slice(0, 42);
}

export async function generateIgComments(post) {
    // Экономия: описание есть → фото не прикладываем (галочка visionInComments переопределяет)
    const willAttach = !!post.image && (getSettings().visionInComments || !post.imgDesc);
    // Комбо-режим: фото приложено и описания нет → просим В ТОМ ЖЕ запросе
    // и описание, и комменты (одна картинка в API вместо двух)
    const wantDesc = willAttach && !post.imgDesc;
    const photoLine = willAttach
        ? `The actual photo is ATTACHED to this request — LOOK at it and react to what you actually see.${post.imgDesc ? ` (fallback description if you cannot see images: ${post.imgDesc})` : ''}`
        : `Photo (description): ${post.imgDesc || (post.image ? 'their photo, no text description available' : '(no description)')}`;
    const existing = (post.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');
    const formatLine = wantDesc
        ? `Format — STRICT JSON OBJECT: {"photo_description":"detailed description of the attached photo in Russian, one cohesive paragraph (who/what, pose, clothes, setting, lighting, mood, details)","comments":[{"author":"Имя","text":"...","type":"contact|random","sentiment":"positive|neutral|negative"},...]}`
        : `Format: [{"author":"Имя","text":"...","type":"contact|random","sentiment":"positive|neutral|negative"},...]`;
    const prompt = `${await taskHeader('generate comments under an Instagram post.')}
${post.advertisement ? `This is a PAID AD for ${post.advertisement.brand} (${post.advertisement.product}). Brief: ${post.advertisement.brief}. Risk level: ${post.advertisement.risk}. The audience MUST recognize the sponsorship and react naturally; include both fans and skeptical/critical accounts, especially for controversial products.` : ''}
Post by ${post.author}. ${photoLine}
Caption: "${post.caption || '(none)'}"
${existing ? `Existing comments (do not repeat):\n${existing}\n` : ''}
${contactsBlock()}

Generate 4-7 comments: known characters in-character (reacting to the photo/caption — especially if the post is by ${getUserName()}) + random accounts. Instagram tone: compliments, questions, jokes. NO emojis at all. Max 200 chars each. Add sentiment="positive|neutral|negative" to every comment.
${uiLangLine()}
${JSON_RULES}
${formatLine}`;

    const raw = await socialGen(prompt, {
        maxTokens: wantDesc ? 2048 : 1536,
        image: willAttach ? post.image : null,
        prefill: wantDesc ? '{"photo_description":"' : '[{"author":"',
    });
    let parsed;
    if (wantDesc) {
        const obj = parseJsonObject(raw);
        if (obj) {
            const desc = String(obj.photo_description || '').trim().replace(/\s*\n+\s*/g, ' ').slice(0, 3000);
            if (desc) {
                post.imgDesc = desc;
            }
            parsed = obj.comments;
        }
        if (!Array.isArray(parsed)) parsed = parseJsonArray(raw); // модель могла ответить массивом
    } else {
        parsed = parseJsonArray(raw);
    }
    if (!Array.isArray(parsed)) return 0;
    let added = 0;
    if (!Array.isArray(post.comments)) post.comments = [];
    for (const it of parsed) {
        if (!it || !it.author || !it.text) continue;
        if (isBanned(it.author, it.handle)) continue;
        if (post.comments.length >= MAX_COMMENTS) break;
        post.comments.push({
            id: genId(), author: String(it.author),
            ak: it.type === 'contact' ? resolveAuthorKey(it.author) : 'random',
            text: String(it.text).slice(0, 300), sentiment: ['positive','neutral','negative'].includes(it.sentiment) ? it.sentiment : 'neutral', time: Date.now() - Math.floor(Math.random() * 600000),
        });
        added++;
    }
    post.likes = Math.max(post.likes || 0, Math.floor(Math.random() * 40) + post.comments.length * 3);
    saveMeta();
    return added;
}

export function settleSocialPost(platform, post, options = {}) {
    return settlePost(platform, post, options);
}

export async function maybeGenerateStoryEvent(platform = 'phone', post = null, { force = false } = {}) {
    const systems = getSocial();
    // Ивенты создаются только явной кнопкой. Источник — весь накопленный канон,
    // а не один последний пост; это также исключает случайные плашки под постами.
    if (systems.storyEvents.active || !force) return null;
    const s = getSocial();
    const recent = s.storyEvents.recent.slice(0, 5).map(e => `${e.title}: ${e.premise}`).join('\n');
    const pending = s.rpConsequences.filter(c => c.status === 'pending').map(c => c.summary).join('\n');
    const posts = [
        ...s.tweets.filter(p => p.ak === 'user').slice(0, 6).map(p => `Twitter: ${p.text}; replies: ${(p.replies || []).slice(-4).map(c => `${c.author}: ${c.text}`).join(' | ') || 'none'}`),
        ...s.igPosts.filter(p => p.ak === 'user').slice(0, 6).map(p => `Instagram: ${p.caption || ''}; photo: ${p.imgDesc || 'attached/undescribed'}; comments: ${(p.comments || []).slice(-4).map(c => `${c.author}: ${c.text}`).join(' | ') || 'none'}`),
    ].join('\n');
    const journal = getSocialJournalEntries().slice(0, 12).map(e => e.text).join('\n');
    const prompt = `${await taskHeader('propose THREE optional, canon-grounded story events for the continuing roleplay.')}
RECENT PHONE / SOCIAL ACTIVITY:\n${posts || '(no posts yet)'}
MEMORY JOURNAL:\n${journal || '(empty)'}
${pending ? `Pending established consequences (do not duplicate):\n${pending}` : ''}
${recent ? `Recent event themes (avoid repetition):\n${recent}` : ''}

Create exactly three concrete, meaningfully different event hooks. Use the character card, persona, triggered lorebook, recent RP history, phone journal and posts together. A hook may originate offline, from a character, lore faction, location, unresolved RP detail, message, rumor or social activity; it MUST NOT be artificially tied to one post. Do not reveal hidden thoughts, contradict canon, complete a scene for the user, or force the user's actions. Each hook must require a decision. For every event provide exactly three meaningfully different response choices with different intents, none obviously optimal. The fourth custom response is supplied by code.
Output STRICT JSON object only:
{"events":[{"title":"...","hook":"...","premise":"...","involved_actors":["..."],"visibility":"public|followers|known_characters","stakes":"social|relationship|mystery|danger|opportunity|comedy|reputation","urgency":"soft|next_scene|immediate","canon_evidence":["specific fact from context"],"opening_message":"...","choices":[{"id":"a","label":"...","intent":"honest","text":"..."},{"id":"b","label":"...","intent":"deflect","text":"..."},{"id":"c","label":"...","intent":"confront","text":"..."}]}]}
${uiLangLine()}`;
    const candidate = parseJsonObject(await socialGen(prompt, { maxTokens: 3600, prefill: '{"events":[{"title":"' }));
    return validateAndOfferEvent(candidate, null, 'phone');
}

export async function resolveStoryEvent(choice) {
    const s = getSocial();
    const event = s.storyEvents.active;
    if (!event) throw new Error('Нет активного события');
    const exactText = String(choice?.text || '').trim();
    if (!exactText) throw new Error('Пустой ответ');
    let classification = { intent: choice.intent || 'custom', tone: 'calm', publicness: event.visibility === 'public' ? 'public' : 'private', risk: 0.5 };
    if (choice.custom) {
        const classifyPrompt = `${await taskHeader('classify a user-written story-event response without rewriting or interpreting away its literal meaning.')}
EVENT: ${event.hook}
USER RESPONSE, preserve verbatim: ${exactText}
Output STRICT JSON object only: {"intent":"honest|deflect|confront|withdraw|cooperate|investigate|custom","tone":"warm|calm|sharp|playful|cold","publicness":"public|private|offline","risk":0.45}`;
        classification = parseJsonObject(await socialGen(classifyPrompt, { maxTokens: 220, prefill: '{"intent":"' })) || classification;
    }
    const prompt = `${await taskHeader('resolve one user decision in an existing phone-triggered story event.')}
EVENT TITLE: ${event.title}
HOOK: ${event.hook}
PREMISE: ${event.premise}
CANON EVIDENCE: ${event.canonEvidence.join(' | ')}
EXACT USER RESPONSE (do not rewrite, extend or decide extra actions): ${exactText}
CLASSIFICATION: ${JSON.stringify(classification)}

Describe only the immediate response and a future RP consequence; do not play the future scene. Private/offline choices produce no public bot reactions unless a leak is explicitly justified by the premise. Known actors may react only if visibility lets them know. Maximum 3 bot reactions.
Output STRICT JSON object only:
{"immediate_result":"...","bot_reactions":[{"author":"...","channel":"comment|tweet|instagram|sms","text":"...","sentiment":"positive|neutral|negative"}],"audience_shift":{"positive":0,"neutral":0,"negative":0},"follower_modifier":1,"relationship_signals":[{"actor":"...","direction":"up|down|complicated","reason":"..."}],"rp_consequence":{"summary":"...","urgency":"soft|next_scene|immediate","actors":["..."]},"next_hook":"","arc_state":"active|resolved|failed"}
${uiLangLine()}`;
    const result = parseJsonObject(await socialGen(prompt, { maxTokens: 1600, prefill: '{"immediate_result":"' })) || {};
    return applyEventResolution({ ...choice, text: exactText }, classification, result);
}

// ═══ Фото: сжатие до разумного размера (dataURL хранится в chat_metadata) ═══
export function compressImage(file, maxDim = 720, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('not an image'));
            img.onload = () => {
                let { width, height } = img;
                if (width > maxDim || height > maxDim) {
                    const k = maxDim / Math.max(width, height);
                    width = Math.round(width * k);
                    height = Math.round(height * k);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
    });
}

// ═══ Аватарки контактов (хранятся в meta.avatars по ключу контакта) ═══
export function setContactAvatar(key, dataUrl) {
    const m = getMeta();
    if (!m.avatars || typeof m.avatars !== 'object') m.avatars = {};
    if (dataUrl) m.avatars[key] = dataUrl;
    else delete m.avatars[key];
    saveMeta();
}
// Авто-аватар из карточки персонажа ST (по имени) — чтобы не было пустых кружков
// Контакт «Елисей» и карточка «Елисей Дельвиг» — один человек, но ключи
// разные. Считаем именем одного и того же, если совпадает значимое слово:
// имя или фамилия целиком. Короткие слова не берём — «Ян», «Ли» дали бы
// случайные совпадения с любым созвучным именем.
function nameWords(key) {
    return String(key || '').split(/[\s._-]+/).filter(w => w.length >= 4);
}
function sameHuman(aKey, bKey) {
    if (!aKey || !bKey) return false;
    if (aKey === bKey) return true;
    const a = nameWords(aKey), b = nameWords(bKey);
    if (!a.length || !b.length) return false;
    // У обоих есть имя и фамилия — сверяем ИМЕНА. Одной фамилии мало:
    // «Алиса Огнева» и «Вера Огнева» — однофамильцы, а не один человек.
    if (a.length > 1 && b.length > 1) return a[0] === b[0];
    // Короткая запись («Елисей», «Огнев») — совпадение с любым словом полной
    return a.some(w => b.includes(w));
}

function charCardAvatar(key) {
    if (!getSettings().autoAvatars) return '';
    try {
        const chars = SillyTavern.getContext()?.characters || [];
        const ch = chars.find(c => keyOf(c?.name) === key)
            || chars.find(c => sameHuman(keyOf(c?.name), key));
        if (ch?.avatar && ch.avatar !== 'none') {
            return getThumbnailUrl('avatar', ch.avatar);
        }
    } catch (e) { /* ignore */ }
    return '';
}

// Аватар персоны юзера
// Своя аватарка юзера. Ключ с решётками не столкнётся с keyOf() контакта.
const USER_AVA_KEY = '__user__';
export function setUserAvatar(dataUrl) { setContactAvatar(USER_AVA_KEY, dataUrl); }
export function getUserAvatar() { return getMeta()?.avatars?.[USER_AVA_KEY] || ''; }

export function userAvatarUrl() {
    // Загруженная вручную — всегда: тумблер авто-аватаров про подтягивание
    // из персоны/карточек, а не про то, что она поставила сама
    const own = getUserAvatar();
    if (own) return own;
    if (!getSettings().autoAvatars) return '';
    try {
        if (typeof user_avatar === 'string' && user_avatar) {
            return getThumbnailUrl('persona', user_avatar);
        }
    } catch (e) { /* ignore */ }
    return '';
}

// Реф NPC из картинко-расширения как аватар контакта. Матчим по имени и
// алиасам — тем же ключевым словам, по которым расширение цепляет реф.
// Список описанных NPC. Форки зовут его по-разному (npcList / npcReferences),
// поля картинки тоже: base64-строка или готовый путь к файлу.
function npcEntries() {
    const b = imgBucket();
    if (!b) return [];
    const list = Array.isArray(b.npcList) ? b.npcList
        : (Array.isArray(b.npcReferences) ? b.npcReferences : []);
    return list.filter(n => n && n.name && n.enabled !== false);
}

function npcNames(npc) {
    const raw = Array.isArray(npc.aliases) ? npc.aliases : String(npc.aliases || '').split(',');
    return [npc.name, ...raw].map(x => String(x || '').trim()).filter(Boolean);
}

function npcImageSrc(npc) {
    const data = npc.avatarData || npc.imageBase64 || npc.imageData || '';
    if (data) {
        const str = String(data);
        return str.startsWith('data:') ? str : `data:image/png;base64,${str}`;
    }
    return npc.imagePath ? String(npc.imagePath) : '';
}

// Готовый data-URL кэшируем: base64-строки тяжёлые, а список перерисовывается часто.
const _npcAvaCache = new Map();
function npcAvatar(key) {
    if (!getSettings().autoAvatars) return '';
    try {
        for (const npc of npcEntries()) {
            if (!npcNames(npc).some(n => sameHuman(keyOf(stripHandle(n)), key))) continue;
            const src = npcImageSrc(npc);
            if (!src) continue;
            if (!src.startsWith('data:')) return src;   // путь к файлу — как есть
            const cacheKey = `${npc.id || npc.name}:${src.length}`;
            let url = _npcAvaCache.get(cacheKey);
            if (!url) { url = src; _npcAvaCache.set(cacheKey, url); }
            return url;
        }
    } catch (e) { /* ignore */ }
    return '';
}

export function getContactAvatar(key) {
    const m = getMeta();
    // Приоритет: загруженная вручную → карточка персонажа ST → реф NPC
    return (m.avatars && m.avatars[key]) || charCardAvatar(key) || npcAvatar(key);
}
// Аватар по имени автора (для лент)
export function avatarForAuthor(ak) {
    if (ak === 'user') return userAvatarUrl();
    if (typeof ak === 'string' && ak.startsWith('contact:')) {
        return getContactAvatar(ak.slice(8));
    }
    return '';
}

// Короткий портрет для вымышленных аккаунтов-комментаторов. Сохраняется прямо
// в комментарии, поэтому повторно не генерируется и переживает перезагрузку чата.
export async function generateCommentAvatar(comment) {
    if (!comment || comment.ak !== 'random' || comment.avatar || comment.avatarPending) return comment?.avatar || '';
    comment.avatarPending = true;
    try {
        const mod = await loadImageExt();
        if (!mod) return '';
        const subject = `${comment.author || 'anonymous social media user'} (${comment.handle || makeHandle(comment.author)})`;
        const prompt = `square social-media profile avatar, close-up head-and-shoulders portrait of ${subject}, one person, clean readable face, appearance and clothing typical for the story's country and era, simple unobtrusive background, no text, no logo, no watermark`;
        const temp = { author: comment.author || 'Account', ak: 'random', kind: 'avatar' };
        let src = '';
        if (mod.builtin) {
            src = await _generateViaBuiltin(temp, { prompt, wantChar: false, isUserPost: false, onStatus: null });
        } else {
            const dataUrl = await mod.pipeline.generateImageWithRetry(prompt, null, null, { aspectRatio: '1:1' });
            src = dataUrl;
            if (typeof mod.utils?.saveImageToFile === 'function') {
                try { src = await mod.utils.saveImageToFile(dataUrl, { mode: 'glassphone-avatar' }); } catch (e) { /* dataURL */ }
            } else if (String(dataUrl || '').startsWith('data:')) {
                try {
                    const b64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/i, '');
                    src = await saveBase64AsFile(b64, 'glassphone', `avatar_${Date.now()}`, 'jpeg');
                } catch (e) { /* dataURL */ }
            }
        }
        if (src) comment.avatar = src;
        saveMeta();
        return comment.avatar || '';
    } finally {
        delete comment.avatarPending;
        saveMeta();
    }
}

// ═══ Генерация картинок — через установленное картинко-расширение ═══
// АВТООПРЕДЕЛЕНИЕ: перебираем установленные third-party расширения (ST
// extensionNames) и ищем то, у кого есть src/pipeline.js с
// generateImageWithRetry — по структуре, а не по названию папки.
// Настройка imageGenExtension пустая = авто; непустая = ручной оверрайд папки.
// Настройки расширения мутируем ЗАЩИТНО (только существующие ключи — форки
// дёргают рефы по-разному и могут не иметь sendCharAvatar/overrideAspectRatio).
let _imgExt = { key: null, mod: undefined };

// Имя собственной папки — чтобы не пробовать импортировать самого себя.
// Берём из адреса модуля: расширение переименовывали, зашитая строка устарела бы.
const SELF_FOLDER = (() => {
    try {
        return new URL('.', import.meta.url).pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
    } catch (e) { return ''; }
})();

// Проверить папку: есть ли там src/pipeline.js с generateImageWithRetry.
// allowIndexFallback — пробовать index.js (только для ручного оверрайда; в авто
// режиме НЕ импортим index.js каждого расширения ради побочек).
async function probeImageExt(folder, allowIndexFallback) {
    const base = `/scripts/extensions/third-party/${folder}`;
    try {
        const pipeline = await import(`${base}/src/pipeline.js`);
        if (typeof pipeline.generateImageWithRetry === 'function') {
            let utils = null, settings = null;
            try { utils = await import(`${base}/src/utils.js`); } catch (e) { /* нет */ }
            try { settings = await import(`${base}/src/settings.js`); } catch (e) { /* нет */ }
            return { pipeline, utils, settings, folder };
        }
    } catch (e) { /* нет src/pipeline.js */ }
    if (allowIndexFallback) {
        try {
            const idx = await import(`${base}/index.js`);
            if (typeof idx.generateImageWithRetry === 'function') {
                return { pipeline: idx, utils: idx, settings: idx, folder };
            }
        } catch (e) { /* нет */ }
    }
    return null;
}

async function loadImageExt() {
    const override = String(getSettings().imageGenExtension || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    // В ключ входят и настройки: без этого «расширение не установлено»
    // залипало в кэше после того, как его настроили или переключили
    const bucket = imgBucket();
    const key = [override || '(auto)', getSettings().imageCfgKey || '', cfgReady(bucket) ? 'ready' : 'empty'].join('|');
    if (_imgExt.key === key && _imgExt.mod !== undefined) return _imgExt.mod;

    let mod = null;
    if (override) {
        mod = await probeImageExt(override, true);
    } else {
        // Кандидаты — все установленные third-party расширения. Отбор идёт по
        // структуре (src/pipeline.js с generateImageWithRetry), а не по имени:
        // так подхватывается любой форк, как бы его ни назвали.
        const candidates = [];
        try {
            for (const n of (extensionNames || [])) {
                if (typeof n === 'string' && n.startsWith('third-party/')) {
                    const f = n.slice('third-party/'.length);
                    if (f && f !== SELF_FOLDER) candidates.push(f);
                }
            }
        } catch (e) { /* ignore */ }
        // Папки с «картиночным» именем пробуем первыми — это лишь порядок
        // перебора, чтобы не сыпать неудачными импортами всех подряд
        const looksRelevant = (f) => /imag|image|gen|draw|pic|art|rakk/i.test(f);
        candidates.sort((a, b) => (looksRelevant(b) ? 1 : 0) - (looksRelevant(a) ? 1 : 0));
        for (const f of candidates) {
            mod = await probeImageExt(f, false); // авто — только src/pipeline.js
            if (mod) break;
        }
    }
    // Фолбэк: ВСТРОЕННЫЙ драйвер. Однофайловые форки не экспортируют
    // generateImageWithRetry — импортировать их нельзя (второй инстанс
    // задублировал бы их UI). Зато их настройки (endpoint/apiKey/apiType/
    // model/styles/refs) лежат в extension_settings — генерим сами по ним
    // (мини-клиент openai/gemini ниже).
    if (!mod) {
        const imgCfg = imgBucket();
        if (cfgReady(imgCfg)) {
            mod = { builtin: true, folder: '(встроенный драйвер по настройкам расширения)' };
        }
    }
    _imgExt = { key, mod };
    return mod;
}

// Сбросить кэш автоопределения (напр. после установки расширения / смены оверрайда)
export function resetImageExtCache() { _imgExt = { key: null, mod: undefined }; }

export async function isImageGenAvailable() {
    return !!(await loadImageExt());
}

// Список моделей провайдера картинко-расширения (для кнопки ↻).
// Учитывает ТЕЛЕФОННЫЙ профиль подключения: моделей спрашиваем у того
// endpoint/провайдера, через который телефон реально будет рисовать.
export async function fetchImageModels() {
    const mod = await loadImageExt();
    if (!mod) throw new Error('картинко-расширение не найдено');
    const prof = _imgProfile(getSettings().imageGenProfileId);
    const profFields = prof
        ? Object.fromEntries(Object.entries(prof).filter(([k, v]) => k !== 'id' && k !== 'name' && v !== undefined && v !== ''))
        : null;
    if (mod.builtin) {
        const cfgBase = imgBucket() || {};
        const imgCfg = profFields ? { ...cfgBase, ...profFields } : cfgBase;
        const resp = await fetch(`${String(imgCfg.endpoint).replace(/\/$/, '')}/v1/models`, {
            headers: { 'Authorization': `Bearer ${imgCfg.apiKey}` },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const j = await resp.json();
        const models = (j.data || j.models || []).map(m => m.id || m.name || m).filter(Boolean);
        if (!models.length) throw new Error('список пуст');
        return models;
    }
    const base = `/scripts/extensions/third-party/${mod.folder}`;
    const provMod = await import(`${base}/src/providers.js`);
    const setMod = (typeof mod.settings?.getSettings === 'function') ? mod.settings : await import(`${base}/src/settings.js`);
    const s = setMod.getSettings();
    // Временная мутация (provider.fetchModels может сам перечитывать настройки) + откат
    const saved = {};
    if (profFields) {
        for (const k of Object.keys(profFields)) {
            if (k in s) { saved[k] = s[k]; s[k] = profFields[k]; }
        }
    }
    try {
        const provider = provMod.resolveActiveProvider(s);
        if (!provider) throw new Error('провайдер расширения не настроен');
        const models = await provider.fetchModels();
        if (!Array.isArray(models) || models.length === 0) throw new Error('список пуст');
        return models;
    } finally {
        for (const k of Object.keys(saved)) s[k] = saved[k];
    }
}

// Текст промпта для картинки из данных поста.
// ВАЖНО: НЕ навязываем стиль рендера («realistic», «phone camera») — иначе он
// перебивает активный стиль расширения (юзер поставила «Craig Mullins painterly»,
// а мой хардкод «realistic» давал фотореализм). Описываем только СЦЕНУ/кадр.
// Запрет на персону/главперсонажей ставится ТОЛЬКО для анонимных рандом-аккаунтов
// (anonymous) — чтобы персона юзера не «вылезала» на постах посторонних. Пост
// самого бота или ЛЮБОГО контакта-НПС = его аккаунт → запрета НЕТ, его лицо/реф
// рисуется. allowChar: даже на рандом-посте разрешить главперсонажа (фан-аккаунт
// явно постит про него).
// Картинко-расширение ищет NPC в промпте ПОДСТРОКОЙ («алиса» в тексте).
// По-русски имя склоняется — «на Алисе» такой поиск не находит, и реф NPC
// не подцепляется. Дописываем канонические имена тех, кого узнали по основе.
// searchIn — где ищем упоминания (описание + автор поста/стрима),
// promptText — что реально уйдёт в расширение. Разделять их важно: автор
// в промпт не попадает, и без этого имя стримера некому было матчить.
function npcNamesLine(searchIn, promptText = null) {
    try {
        const imgCfg = imgBucket();
        const list = npcEntries();
        if (!list.length || imgCfg?.autoDetectNames === false) return '';
        const low = String(searchIn || '').toLowerCase();
        const inPrompt = String(promptText == null ? searchIn : promptText).toLowerCase();
        const found = [];
        for (const npc of list) {
            const names = npcNames(npc);
            // Имя уже в самом промпте — расширение найдёт его само
            if (names.some(n => inPrompt.includes(n.toLowerCase()))) continue;
            // Точное вхождение в исходных данных (обычно автор поста)
            if (names.some(n => low.includes(n.toLowerCase()))) { found.push(npc.name); continue; }
            // Падежная форма: «на Алисе», «с Вадимом» — узнаём по основе.
            // Основа короче четырёх букв даёт ложные срабатывания.
            const hit = names.some(n => {
                const stem = n.toLowerCase().slice(0, -1);
                return stem.length >= 4 && low.includes(stem);
            });
            if (hit) found.push(npc.name);
        }
        // Формулировка нейтральная: узнавание по основе изредка срабатывает
        // на «Алисы нет рядом» — тогда «в кадре» было бы прямой ложью
        return found.length ? ` Mentioned: ${[...new Set(found)].join(', ')}.` : '';
    } catch (e) { return ''; }
}

function buildImagePrompt(post, { anonymous = false, allowChar = false } = {}) {
    const st = getSettings();
    const parts = [];
    if (post.imgDesc) parts.push(post.imgDesc);
    const framing = (post.framing || (post.kind === 'of'
        ? (st.imgPromptOf || 'intimate boudoir shot, self-taken framing')
        : (st.imgPromptIg || 'social media post, self-taken candid framing'))).trim();
    // Подпись поста в промпт НЕ идёт: рисуем то, что описано в кадре,
    // а не то, что написано под фотографией
    if (parts.length === 0) parts.push(`candid photo posted by ${post.author}`);
    let negLine = '';
    if (anonymous) {
        const neg = ['the protagonist / the main user'];
        if (!allowChar) neg.push('the main story characters');
        negLine = ` This photo belongs to an unrelated stranger's account — do NOT depict ${neg.join(' or ')}; only people unrelated to the main story.`;
    }
    // ММС: снимал и отправил КОНТАКТ — получательница (юзер) за кадром,
    // иначе её лицо с рефа персоны лезло на чужие фото
    if (post.mms) {
        const un = getUserName();
        negLine += ` This photo was taken and sent by ${post.author} from their own phone to ${un}. ${un} is the RECIPIENT — they are NOT in the photo. Do NOT depict them unless the description explicitly says they are in the frame.`;
    }
    // Пост юзерки, где по описанию её самой в кадре нет: она — фотограф
    if (post._behindCamera) {
        const un = getUserName();
        negLine += ` This photo was TAKEN by ${un} for their own account — they are BEHIND the camera, NOT in the frame. Depict exactly what the description says; do NOT add ${un} themselves to the picture.`;
    }
    const body = `${framing}. ${parts.join('. ')}.${negLine}`;
    // Автор — тоже кандидат в NPC: его имя в описании часто стоит в косвенном
    // падеже либо не упоминается вовсе, хотя это его фотография
    const whoText = anonymous ? body : `${body} ${post.author || ''}`;
    return body + npcNamesLine(whoText, body);
}

// ── Booru-теги: сцена → англ. danbooru-теги (для NovelAI/аниме-моделей) ──
// NAI не понимает короткие описания на русском — нужны теги вида 1girl, solo,
// long hair, ... Конвертируем сцену одним текстовым запросом.
async function sceneToBooruTags(post, { anonymous }) {
    const scene = [post.imgDesc, post.caption].filter(Boolean).join('. ') || `photo posted by ${post.author}`;
    const nsfw = post.kind === 'of'
        ? 'This is adult NSFW content — include explicit danbooru tags matching the scene, do not sanitize.'
        : '';
    let who = anonymous
        ? 'The subject is a random stranger — use generic appearance tags, NOT any specific named main character.'
        : '';
    if (post.mms) {
        who += ` The photo was taken and sent by ${post.author}; the recipient ${getUserName()} is NOT in the frame — do not add tags describing them unless the scene explicitly includes them.`;
    }
    if (post._behindCamera) {
        who += ` The photo was TAKEN by ${getUserName()} — they are behind the camera, NOT in the frame; tag ONLY what the scene describes, do not add tags describing them.`;
    }
    const prompt = `Convert this scene into ONE line of English Danbooru-style image tags for an anime image model (NovelAI).
Scene: ${scene}

Rules:
- Start with subject count (1girl / 1boy / 2girls / 1girl 1boy / etc.), add "solo" if only one person.
- Then: appearance (hair length+color, eye color, body), clothing OR state of undress, pose, facial expression, setting/background, lighting.
- End with quality tags (masterpiece, best quality, highly detailed).
- Comma-separated, lowercase, ENGLISH ONLY, tags NOT sentences, no Russian, no explanations.
- Setting matters: clothing, interior, street and season tags must fit the story's country, era and place.
${who} ${nsfw}
Output ONLY the comma-separated tags.`;
    try {
        const raw = await socialGen(prompt, { maxTokens: 400 });
        const tags = String(raw || '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/^[^:]*tags?:\s*/i, '')
            .replace(/[\n\r]+/g, ', ')
            .replace(/["'`]/g, '')
            .replace(/\s*,\s*/g, ', ')
            .replace(/(,\s*)+/g, ', ')
            .trim().replace(/^,|,$/g, '').trim();
        return tags;
    } catch (e) {
        console.warn('[GlassPhone] sceneToBooruTags failed:', e);
        return '';
    }
}

// Профиль подключения картинко-расширения, выбранный ДЛЯ ТЕЛЕФОНА
// (может отличаться от активного в основном чате). Общее ведро всех форков.
function _imgProfile(id) {
    if (!id) return null;
    try {
        const imgCfg = imgBucket();
        return (Array.isArray(imgCfg?.connectionProfiles) ? imgCfg.connectionProfiles : []).find(p => p && p.id === id) || null;
    } catch (e) { return null; }
}

export function listIigProfiles() {
    try {
        const imgCfg = imgBucket();
        return (Array.isArray(imgCfg?.connectionProfiles) ? imgCfg.connectionProfiles : [])
            .filter(p => p && p.id)
            .map(p => ({ id: p.id, name: p.name || p.id }));
    } catch (e) { return []; }
}

// Стили расширения (глобальные, НЕ входят в профили подключения)
export function listIigStyles() {
    try {
        const imgCfg = imgBucket();
        return (Array.isArray(imgCfg?.styles) ? imgCfg.styles : [])
            .filter(s => s && s.id)
            .map(s => ({ id: s.id, name: s.name || s.id }));
    } catch (e) { return []; }
}

// Последовательная очередь (мы временно мутируем чужие настройки —
// параллельные генерации увидели бы чужие флаги)
let _imgGenChain = Promise.resolve();

// Отмена генерации. Встроенный драйвер получает signal и рвёт сам запрос;
// сторонний pipeline отменять нечем — там мы перестаём ждать результат и
// выбрасываем его, когда он придёт.
const _imgAborts = new Map();

export function cancelImageGen(key) {
    const ctl = _imgAborts.get(key);
    if (!ctl) return false;
    ctl.abort();
    _imgAborts.delete(key);
    return true;
}

export function isImageGenCancelled(key) { return !_imgAborts.has(key); }

export class ImageGenCancelled extends Error {
    constructor() { super('Генерация отменена'); this.name = 'ImageGenCancelled'; }
}

export function generatePostImage(post, onStatus = null, cancelKey = null) {
    const run = () => {
        if (cancelKey) {
            const ctl = new AbortController();
            _imgAborts.set(cancelKey, ctl);
            return _generatePostImage(post, onStatus, ctl.signal)
                .then((src) => {
                    // Пока ждали, кнопку могли нажать — результат уже не нужен
                    if (ctl.signal.aborted) throw new ImageGenCancelled();
                    return src;
                })
                .finally(() => { if (_imgAborts.get(cancelKey) === ctl) _imgAborts.delete(cancelKey); });
        }
        return _generatePostImage(post, onStatus);
    };
    const p = _imgGenChain.then(run, run);
    _imgGenChain = p.then(() => {}, () => {});
    return p;
}

// РЕФЕРЕНСЫ: расширение подмешивает аватары персонажа/персоны в КАЖДУЮ генерацию →
// лица бота/юзерки лезли на посты рандомов. Логика:
//  • пост юзера → реф персоны
//  • пост главного персонажа ИЛИ пост, где в кадре/подписи упомянут главный
//    персонаж по имени → реф его аватара (Cyrillic-safe textMentionsName — \b
//    не ловил кириллицу, поэтому «Вадим Огнев» не находился и реф не слался)
//  • прочее → без авто-рефов (лорбук-рефы по ключевым словам работают)
// АСПЕКТ: по overrideAspectRatio/overrideImageSize расширение ИГНОРИРУЕТ наш аспект
// (у юзера стоял 16:9). Снимаем оверрайды на время генерации → побеждает наш 1:1.
async function _generatePostImage(post, onStatus = null, signal = null) {
    const mod = await loadImageExt();
    if (!mod) throw new Error('Картинко-расширение не найдено и картинко-API не настроен. Установи расширение генерации картинок или пропиши endpoint/key/model в его настройках.');

    const nvSettings = (typeof mod.settings?.getSettings === 'function') ? mod.settings.getSettings() : null;

    const st = getSettings();
    const isUserPost = post.ak === 'user';
    const isContactPost = typeof post.ak === 'string' && post.ak.startsWith('contact:');
    // В кадре ли САМА юзерка на её собственном посте? По умолчанию она — ФОТОГРАФ:
    // «Тёма ест бургер» — в кадре Тёма, а не она. В кадре она, если описание
    // упоминает её имя/селфи-слова, описания нет вовсе, это OF или её фейскам-стрим.
    // (\b не работает с кириллицей — ручные границы)
    const selfDesc = `${post.imgDesc || ''} ${post.caption || ''}`.trim();
    const SELF_RE = /(^|[^а-яёa-z0-9])(я|мы|меня|себя|себе|собой|селфи|selfie|me|myself|we)(?=$|[^а-яёa-z0-9])/i;
    const userInFrame = isUserPost && (
        !post.imgDesc || post.kind === 'of' || !!post.stream
        || textMentionsName(selfDesc, getUserName()) || SELF_RE.test(selfDesc)
    );
    post._behindCamera = isUserPost && !userInFrame; // для buildImagePrompt/booru
    const charName = mainCharName();
    const charKey = keyOf(charName);
    // Точное совпадение ИЛИ (для ММС/стримов) имя контакта — часть имени карточки:
    // контакт «Вадим» vs карточка «Вадим Огнев» — реф должен подтянуться
    const isCharPost = !isUserPost && charKey && (keyOf(post.author) === charKey
        || ((post.mms || post.stream) && !!charName && textMentionsName(charName, post.author)));
    const mentionsChar = !!charName && textMentionsName(`${post.imgDesc || ''} ${post.caption || ''} ${post.author || ''}`, charName);
    const wantChar = isCharPost || mentionsChar;
    // Анонимный рандом-аккаунт = НЕ юзер, НЕ контакт (НПС), НЕ главный персонаж.
    // Только для него ставим запрет на персону/главперсонажей.
    const anonymous = !isUserPost && !isContactPost && !isCharPost;

    let prompt;
    if (st.imgTagMode) {
        // Booru-режим: стиль/кадр из настроек (может быть тег-строкой) + сцена в теги
        if (onStatus) onStatus('Составляю теги...');
        const tags = await sceneToBooruTags(post, { anonymous });
        const framing = (post.framing || (post.kind === 'of' ? (st.imgPromptOf || '') : (st.imgPromptIg || ''))).trim();
        prompt = [framing, tags].filter(Boolean).join(', ') || buildImagePrompt(post, { anonymous, allowChar: wantChar });
        // Теги — англоязычные, имён в них не остаётся: без этого NPC-реф
        // в booru-режиме не подцепился бы никогда
        if (prompt && !anonymous) {
            prompt += npcNamesLine(`${post.imgDesc || ''} ${post.caption || ''} ${post.author || ''}`, prompt);
        }
    } else {
        prompt = buildImagePrompt(post, { anonymous, allowChar: wantChar });
    }

    // Встроенный драйвер (форки без экспортов)
    if (mod.builtin) {
        return _generateViaBuiltin(post, { prompt, wantChar, isUserPost: userInFrame, onStatus, signal });
    }

    // Защитная мутация: сохраняем и трогаем ТОЛЬКО существующие ключи
    // swSendOutfitImage* — гардероб: расширение подмешивает картинки одежды
    // ОТДЕЛЬНО от аватарок, поэтому платье юзерки лезло на фото контактов
    const keys = ['sendCharAvatar', 'sendUserAvatar', 'imageContextEnabled', 'overrideAspectRatio', 'overrideImageSize', 'model',
        'swSendOutfitImageBot', 'swSendOutfitImageUser'];
    // Телефонный профиль подключения: временно применяем ЕГО поля (endpoint/
    // apiKey/model/aspect/...) поверх активных, основной чат не трогаем
    const phoneProfile = _imgProfile(st.imageGenProfileId);
    if (phoneProfile && nvSettings) {
        for (const k of Object.keys(phoneProfile)) {
            if (k !== 'id' && k !== 'name' && k in nvSettings && !keys.includes(k)) keys.push(k);
        }
    }
    // Телефонный СТИЛЬ: стили глобальные, подменяем activeStyleId на время генерации
    const phoneStyleId = st.imageGenStyleId && nvSettings && 'activeStyleId' in nvSettings
        && (nvSettings.styles || []).some(x => x && x.id === st.imageGenStyleId)
        ? st.imageGenStyleId : '';
    if (phoneStyleId && !keys.includes('activeStyleId')) keys.push('activeStyleId');
    const saved = {};
    if (nvSettings) {
        for (const k of keys) if (k in nvSettings) saved[k] = nvSettings[k];
        if (phoneProfile) {
            for (const k of Object.keys(phoneProfile)) {
                if (k !== 'id' && k !== 'name' && k in nvSettings) nvSettings[k] = phoneProfile[k];
            }
        }
        if (phoneStyleId) nvSettings.activeStyleId = phoneStyleId;
        // ФОРСИРУЕМ намерение, а не уважаем чужие галочки: телефон сам решает,
        // чей реф нужен этой генерации (свой пост → персона, пост/стрим
        // главперсонажа → его карточка), и восстанавливает флаги в finally
        if ('sendCharAvatar' in nvSettings) nvSettings.sendCharAvatar = !!wantChar;
        if ('sendUserAvatar' in nvSettings) nvSettings.sendUserAvatar = !!userInFrame;
        // Одежда идёт только за тем, кто в кадре: на чужом фото ей делать нечего
        if ('swSendOutfitImageBot' in nvSettings) nvSettings.swSendOutfitImageBot = !!wantChar;
        if ('swSendOutfitImageUser' in nvSettings) nvSettings.swSendOutfitImageUser = !!userInFrame;
        if ('imageContextEnabled' in nvSettings) nvSettings.imageContextEnabled = false;
        // Аспект поста (сторис 9:16, стрим 16:9, посты 1:1) должен победить
        // оверрайды расширения — снимаем их, когда аспект задан
        if (post.aspect || st.imageGenSquare !== false) {
            if ('overrideAspectRatio' in nvSettings) nvSettings.overrideAspectRatio = false;
            if ('overrideImageSize' in nvSettings) nvSettings.overrideImageSize = false;
        }
        const useModel = effectiveModel(nvSettings);
        if (useModel && 'model' in nvSettings) nvSettings.model = useModel;
    }

    const genOptions = {};
    // post.aspect (сторис 9:16, стрим 16:9) важнее глобального квадрата
    const wantAspect = post.aspect || (st.imageGenSquare !== false ? '1:1' : null);
    if (wantAspect) genOptions.aspectRatio = wantAspect;

    try {
        // style = null → расширение подставит СВОЙ активный стиль (resolveEffectiveStyle)
        const dataUrl = await mod.pipeline.generateImageWithRetry(prompt, null, onStatus, genOptions);
        if (!dataUrl || typeof dataUrl !== 'string') throw new Error('Пустой результат генерации');
        let src = dataUrl;
        if (typeof mod.utils?.saveImageToFile === 'function') {
            try { src = await mod.utils.saveImageToFile(dataUrl, { mode: 'glassphone-ig' }); }
            catch (e) { console.warn('[GlassPhone] saveImageToFile failed, keeping dataURL:', e); }
        } else if (dataUrl.startsWith('data:')) {
            // Расширение без saveImageToFile → сохраняем средствами ST
            try {
                const b64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/i, '');
                src = await saveBase64AsFile(b64, 'glassphone', `iggen_${Date.now()}`, 'jpeg');
            } catch (e) { /* оставляем dataURL */ }
        }
        post.image = src;
        saveMeta();
        return src;
    } finally {
        if (nvSettings) for (const k of keys) if (k in saved) nvSettings[k] = saved[k];
    }
}

// ── Настройки картинко-расширения ──
// Форки хранят их под разными ключами extension_settings, поэтому ищем по
// СТРУКТУРЕ: объект с endpoint/apiKey/model — это они и есть. Заполненный
// (готовый к генерации) выигрывает у пустого.
// Признаки именно КАРТИНОЧНОГО расширения: endpoint+apiKey есть и у
// голосового (ElevenLabs), и отправлять туда запрос на картинку — гарантированный
// провал. Отличаем по полям, которых у озвучки не бывает.
const IMG_MARKERS = ['aspectRatio', 'sendCharAvatar', 'sendUserAvatar', 'npcList', 'npcReferences', 'imageContextEnabled', 'imageSize', 'styles'];

// Модель у некоторых провайдеров лежит в своём поле (naistera хранит выбор
// в naisteraModel, общее model при этом пустое) — иначе расширение выглядит
// ненастроенным, хотя рисовать готово.
function cfgModel(v) {
    if (!v) return '';
    // У naistera свой список моделей: общее поле model относится к другому
    // провайдеру и осталось там с прошлой настройки
    if (v.apiType === 'naistera') return String(v.naisteraModel || v.model || '').trim();
    return String(v.model || v.naisteraModel || '').trim();
}
// Какая модель реально пойдёт в запрос. Телефонный оверрайд действует, пока
// в самом расширении модель та же, что была при его выборе: сменила её там —
// значит хочет рисовать новой, а не той, что телефон запомнил месяц назад.
function effectiveModel(imgCfg) {
    const st = getSettings();
    const extModel = cfgModel(imgCfg);
    if (!st.imageGenModel) return extModel;
    if (extModel && st.imageGenModelBase && extModel !== st.imageGenModelBase) {
        st.imageGenModel = '';
        st.imageGenModelBase = extModel;
        try { saveSettingsDebounced(); } catch (e) { /* ignore */ }
        return extModel;
    }
    return st.imageGenModel;
}

// Модель, выбранная сейчас в самом картинко-расширении
export function currentExtModel() { return cfgModel(imgBucket()); }

function cfgReady(v) {
    return !!(v && v.apiKey && cfgModel(v) && (v.endpoint || v.apiType === 'naistera'));
}

export function listImageBuckets() {
    const out = [];
    try {
        const all = extension_settings || {};
        for (const key of Object.keys(all)) {
            const v = all[key];
            if (!v || typeof v !== 'object') continue;
            if (typeof v.endpoint !== 'string' || typeof v.apiKey !== 'string') continue;
            if (!IMG_MARKERS.some(m => m in v)) continue;
            out.push({ key, ready: cfgReady(v), model: cfgModel(v), apiType: v.apiType || '' });
        }
    } catch (e) { /* ignore */ }
    return out;
}

function imgBucket() {
    try {
        const all = extension_settings || {};
        // Явный выбор в настройках телефона — когда стоит несколько расширений
        const pinned = getSettings().imageCfgKey;
        if (pinned && all[pinned] && typeof all[pinned] === 'object') return all[pinned];
        let firstShape = null;
        for (const key of Object.keys(all)) {
            const v = all[key];
            if (!v || typeof v !== 'object') continue;
            if (typeof v.endpoint !== 'string' || typeof v.apiKey !== 'string') continue;
            if (!IMG_MARKERS.some(m => m in v)) continue;
            if (cfgReady(v)) return v;   // готовое к генерации — сразу
            if (!firstShape) firstShape = v;
        }
        return firstShape;
    } catch (e) { return null; }
}

// ── ВСТРОЕННЫЙ драйвер генерации (настройки любого форка) ──
// Мини-клиент: openai (/v1/images/generations|edits) и gemini (:generateContent).
// Стиль — активный стиль форка ([STYLE: ...]), рефы — аватары чара/персоны
// по правилам форка (sendCharAvatar/sendUserAvatar) с нашим гейтом wantChar/isUserPost.

async function _fetchB64(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const blob = await r.blob();
        return await new Promise((resolve) => {
            const fr = new FileReader();
            fr.onloadend = () => resolve(String(fr.result).split(',')[1] || null);
            fr.onerror = () => resolve(null);
            fr.readAsDataURL(blob);
        });
    } catch (e) { return null; }
}

async function _generateViaBuiltin(post, { prompt, wantChar, isUserPost, onStatus, signal = null }) {
    const cfgBase = imgBucket() || {};
    const st = getSettings();
    // Телефонный профиль подключения: его поля поверх активных (фолбэк на базу)
    const prof = _imgProfile(st.imageGenProfileId);
    const imgCfg = prof ? { ...cfgBase, ...Object.fromEntries(Object.entries(prof).filter(([k, v]) => k !== 'id' && k !== 'name' && v !== undefined && v !== '')) } : cfgBase;
    const endpoint = String(imgCfg.endpoint || '').trim().replace(/\/$/, '');
    if (!cfgReady(imgCfg)) throw new Error('Картинко-API не настроен (endpoint/key/model в настройках картинко-расширения)');

    const model = effectiveModel(imgCfg);
    // post.aspect (сторис 9:16, стрим 16:9) важнее глобального квадрата
    const aspect = post.aspect || (st.imageGenSquare !== false ? '1:1' : (imgCfg.aspectRatio || '1:1'));

    // Стиль форка: телефонный (если выбран) или активный
    let style = '';
    try {
        const styleId = st.imageGenStyleId || imgCfg.activeStyleId;
        const s = (imgCfg.styles || []).find(x => x && x.id === styleId)
            || (imgCfg.styles || []).find(x => x && x.id === imgCfg.activeStyleId);
        style = String(s?.value ?? s?.style ?? '').trim();
    } catch (e) { /* ignore */ }
    let fullPrompt = style ? `[STYLE: ${style}]\n\n${prompt}` : prompt;

    // Рефы: телефон сам решает, чей реф нужен (галочки форка не смотрим —
    // наш гейт wantChar/isUserPost уже отфильтровал, кому реф положен)
    const refs = [];
    try {
        const ctx = SillyTavern.getContext();
        if (wantChar) {
            const ch = ctx?.characters?.[ctx.characterId];
            if (ch?.avatar && ch.avatar !== 'none') {
                const b = await _fetchB64(`/characters/${encodeURIComponent(ch.avatar)}`);
                if (b) refs.push(b);
            }
        }
        if (isUserPost && typeof user_avatar === 'string' && user_avatar) {
            const b = await _fetchB64(`/User Avatars/${encodeURIComponent(user_avatar)}`);
            if (b) refs.push(b);
        }
        // НПС без карточки (контакт/стример): единственный возможный реф —
        // аватар контакта, загруженный в телефоне
        if (!refs.length && typeof post.ak === 'string' && post.ak.startsWith('contact:')) {
            const av = getContactAvatar(post.ak.slice('contact:'.length));
            if (av) {
                const b = String(av).startsWith('data:') ? (String(av).split(',')[1] || null) : await _fetchB64(av);
                if (b) refs.push(b);
            }
        }
    } catch (e) { /* без рефов */ }
    if (refs.length > 0) {
        fullPrompt = `[The reference image(s) show the EXACT appearance of the character(s) — copy face, hair, body precisely.]\n\n${fullPrompt}`;
    }

    onStatus?.('Генерация...');

    // Naistera: свой простой протокол — POST /api/generate, ответ с data_url.
    // Рефы уходят готовыми data-URL, а не голым base64.
    if (imgCfg.apiType === 'naistera') {
        const base = endpoint || 'https://naistera.org';
        const url = base.endsWith('/api/generate') ? base : `${base}/api/generate`;
        const body = { prompt: fullPrompt, aspect_ratio: aspect, model: model || undefined };
        if (imgCfg.naisteraPreset) body.preset = imgCfg.naisteraPreset;
        // Рефы принимают не все модели наистеры: novelai отвечает 400.
        // Список тот же, что показывает само расширение.
        const NAIS_REFS_OK = ['grok', 'nano banana', 'grok-pro'];
        const modelTakesRefs = NAIS_REFS_OK.includes(String(model || '').toLowerCase());
        if (refs.length && modelTakesRefs) body.reference_images = refs.map(r => `data:image/png;base64,${r}`);
        const send = (payload) => fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${imgCfg.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
        });
        let resp = await send(body);
        // Страховка на незнакомые модели: сервер сам скажет, что рефы лишние
        if (!resp.ok && body.reference_images) {
            const text = await resp.text();
            if (/reference image/i.test(text)) {
                logReq('повтор без референсов', String(model || ''));
                delete body.reference_images;
                resp = await send(body);
            } else {
                throw new Error(`Naistera ${resp.status}: ${text.slice(0, 150)}`);
            }
        }
        if (!resp.ok) throw new Error(`Naistera ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
        const j = await resp.json();
        if (!j?.data_url) throw new Error('Naistera не вернула картинку');
        // Ответ приходит готовым data-URL — раскладываем в файл тем же путём,
        // что и остальные ветки драйвера
        const nurl = String(j.data_url);
        let nsrc = nurl;
        const nb64 = nurl.replace(/^data:[^;]+;base64,/i, '');
        if (nb64 && nb64 !== nurl) {
            try { nsrc = await saveBase64AsFile(nb64, 'glassphone', `iggen_${Date.now()}`, /png/i.test(nurl) ? 'png' : 'jpeg'); }
            catch (e) { /* оставляем dataURL */ }
        }
        post.image = nsrc;
        saveMeta();
        return nsrc;
    }

    const isGemini = imgCfg.apiType === 'gemini' || /gemini|banana/i.test(String(model));
    let b64 = null, mime = 'image/png';

    if (isGemini) {
        const pathModel = String(model).includes('/') ? String(model).slice(String(model).indexOf('/') + 1) : String(model);
        const parts = refs.map(r => ({ inlineData: { mimeType: 'image/png', data: r } }));
        parts.push({ text: fullPrompt });
        const resp = await fetch(`${endpoint}/v1beta/models/${encodeURIComponent(pathModel)}:generateContent`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${imgCfg.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } },
            }),
            signal,
        });
        if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
        const j = await resp.json();
        const ps = j?.candidates?.[0]?.content?.parts || [];
        const img = ps.find(p => p.inlineData?.data);
        if (!img) throw new Error('Gemini не вернул картинку' + (ps.find(p => p.text) ? `: ${ps.find(p => p.text).text.slice(0, 100)}` : ''));
        b64 = img.inlineData.data; mime = img.inlineData.mimeType || 'image/png';
    } else {
        // OpenAI-совместимый путь: аспект → ближайший поддерживаемый размер
        const size = aspect === '1:1' ? '1024x1024'
            : aspect === '9:16' ? '1024x1536'
            : aspect === '16:9' ? '1536x1024'
            : (imgCfg.size || 'auto');
        let resp;
        if (refs.length > 0) {
            const form = new FormData();
            form.append('model', model);
            form.append('prompt', fullPrompt);
            form.append('n', '1');
            if (size && size !== 'auto') form.append('size', size);
            const toBlob = (r) => {
                const bin = atob(r); const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                return new Blob([arr], { type: 'image/png' });
            };
            if (refs.length > 1) refs.forEach((r, i) => form.append('image[]', toBlob(r), `ref${i}.png`));
            else form.append('image', toBlob(refs[0]), 'ref0.png');
            resp = await fetch(`${endpoint}/v1/images/edits`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${imgCfg.apiKey}` }, body: form, signal,
            });
        } else {
            const body = { model, prompt: fullPrompt, n: 1 };
            if (size && size !== 'auto') body.size = size;
            if (!/gpt-image/i.test(String(model))) body.response_format = 'b64_json';
            resp = await fetch(`${endpoint}/v1/images/generations`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${imgCfg.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
        }
        if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
        const j = await resp.json();
        const d = j?.data?.[0];
        if (d?.b64_json) b64 = d.b64_json;
        else if (d?.url) {
            // URL → тянем и конвертим (для сохранения файлом)
            b64 = await _fetchB64(d.url);
            if (!b64) { post.image = d.url; saveMeta(); return d.url; }
        }
        if (!b64) throw new Error('API не вернул картинку');
    }

    let src = `data:${mime};base64,${b64}`;
    try {
        src = await saveBase64AsFile(b64, 'glassphone', `iggen_${Date.now()}`, mime.includes('png') ? 'png' : 'jpeg');
    } catch (e) { /* оставляем dataURL */ }
    post.image = src;
    saveMeta();
    return src;
}

// ═══ Журнал соцсетей в чат ═══
// Пост юзера записывается СКРЫТОЙ строкой прямо в историю чата (без генерации,
// без событий — другие расширения не триггерятся). Зачем: событие остаётся в
// контексте модели ПО МЕСТУ в истории и попадает в саммарайз — долговременная
// память о соц-активности без вечного роста инжекта.
export async function logSocialToChat(text, image = null) {
    if (getSettings().socialLogToChat === false) return;
    try {
        const ctx = SillyTavern.getContext();
        if (!ctx?.chat) return;

        // Фото поста прикладывается к журнальной записи (extra.image) —
        // vision-модель видит сам снимок в РП-контексте, описание не обязательно.
        // dataURL сохраняем файлом, чтобы не раздувать файл чата.
        let imgSrc = null;
        if (image) {
            imgSrc = String(image);
            if (imgSrc.startsWith('data:')) {
                try {
                    const base64 = imgSrc.replace(/^data:image\/[a-z]+;base64,/i, '');
                    imgSrc = await saveBase64AsFile(base64, 'glassphone', `post_${Date.now()}`, 'jpeg');
                } catch (e) {
                    console.warn('[GlassPhone] журнал: не сохранилось файлом, кладу dataURL:', e);
                }
            }
        }

        // Нейтральная служебная реплика, а не пользовательский ход. Она остаётся
        // в истории и саммари, но не подменяет последнее сообщение {{user}} и не
        // выглядит как текст, который пользователь якобы отправил модели.
        ctx.chat.push({
            name: 'GlassPhone',
            is_user: false,
            is_system: false,
            is_name: true,
            send_date: new Date().toLocaleString('en-US'),
            mes: `<!--tel:log-->\n[Событие мира — соцсети/телефон] ${String(text).slice(0, 1500)}`,
            extra: {
                type: 'comment',
                gen_id: Date.now(),
                api: 'manual',
                model: 'GlassPhone',
                ...(imgSrc ? { image: imgSrc, inline_image: true } : {}),
            },
        });
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    } catch (e) {
        console.warn('[GlassPhone] logSocialToChat failed:', e);
    }
}

// Читаемая копия скрытого журнала, который реально лежит в истории чата и
// передаётся модели/саммарайзеру. Ничего не синтезируем отдельно: экран показывает
// именно те записи, на которые может опираться память бота.
export function getSocialJournalEntries() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        return chat.map((msg, index) => ({ msg, index }))
            .filter(({ msg }) => String(msg?.mes || '').includes('<!--tel:log-->'))
            .map(({ msg, index }) => ({
                index,
                time: msg?.send_date || '',
                text: String(msg?.mes || '')
                    .replace(/<!--tel:log-->/g, '')
                    .replace(/^\s*\[Событие мира — соцсети\/телефон\]\s*/i, '')
                    .trim(),
                image: msg?.extra?.image || null,
            }))
            .reverse();
    } catch (e) {
        console.warn('[GlassPhone] journal read failed:', e);
        return [];
    }
}

// ═══ Активность юзера для инжекции в основной чат ═══
// При включённом журнале события уже лежат в истории чата — сводка не дублирует их,
// в инжекте остаётся только ПОСТОЯННОЕ состояние (кошелёк). Экономия + нет двойного контекста.
export function getSocialActivitySummary() {
    const s = getSocial();

    if (getSettings().socialLogToChat !== false) {
        return s.ofWallet > 0
            ? `- They have $${s.ofWallet} of their own money available (on their personal card). The SOURCE is their secret — characters see only that they can afford things.`
            : '';
    }

    const lines = [];
    // Не заменяем реальные реплики обезличенным «ещё N»: модели полезнее видеть,
    // кто именно и что написал. Ограничиваем только общий объём свежей ветки.
    const fmtThread = (arr) => (arr || []).slice(-8).map(r => `${r.ak === 'user' ? getUserName() : (r.author || 'Account')}: "${String(r.text || '').slice(0, 120)}"`).join(' | ');

    // Её посты + ветки под ними (персонажи в РП знают и свои ответы в комментах)
    for (const t of s.tweets.filter(t => t.ak === 'user').slice(0, 2)) {
        lines.push(`- Their tweet (${timeAgo(t.time)} ago): "${t.text.slice(0, 150)}"${t.replies?.length ? ` — replies: ${fmtThread(t.replies)}` : ''}`);
    }
    for (const p of s.igPosts.filter(p => p.ak === 'user').slice(0, 2)) {
        const photo = p.imgDesc ? `photo: ${p.imgDesc.slice(0, 80)}` : 'photo';
        lines.push(`- Their Instagram post (${timeAgo(p.time)} ago): ${photo}${p.caption ? `, caption: "${p.caption.slice(0, 100)}"` : ''}${p.comments?.length ? ` — comments: ${fmtThread(p.comments)}` : ''}`);
    }

    // Её реплики под ЧУЖИМИ постами (+ ответ автора, если был)
    const interactions = [];
    for (const t of s.tweets) {
        if (t.ak === 'user' || !Array.isArray(t.replies)) continue;
        t.replies.forEach((r, i) => {
            if (r.ak !== 'user') return;
            const next = t.replies[i + 1];
            const followUp = next && next.ak !== 'user' ? ` → ${next.author}: "${String(next.text).slice(0, 80)}"` : '';
            interactions.push({ time: r.time || 0, line: `- They replied under ${t.author}'s tweet "${t.text.slice(0, 60)}...": "${String(r.text).slice(0, 80)}"${followUp}` });
        });
    }
    for (const p of s.igPosts) {
        if (p.ak === 'user' || !Array.isArray(p.comments)) continue;
        p.comments.forEach((c, i) => {
            if (c.ak !== 'user') return;
            const next = p.comments[i + 1];
            const followUp = next && next.ak !== 'user' ? ` → ${next.author}: "${String(next.text).slice(0, 80)}"` : '';
            interactions.push({ time: c.time || 0, line: `- They commented on ${p.author}'s Instagram post: "${String(c.text).slice(0, 80)}"${followUp}` });
        });
    }
    interactions.sort((a, b) => b.time - a.time);
    lines.push(...interactions.slice(0, 3).map(x => x.line));

    // OnlyFans: только последний пост, с пометкой приватности
    const lastOf = s.ofPosts.filter(p => p.ak === 'user')[0];
    if (lastOf) {
        const photo = lastOf.imgDesc ? `photo: ${lastOf.imgDesc.slice(0, 80)}` : 'photo';
        lines.push(`- Their PRIVATE OnlyFans post (${timeAgo(lastOf.time)} ago, subscribers-only): ${photo}${lastOf.caption ? `, caption: "${lastOf.caption.slice(0, 80)}"` : ''}. Characters know about it ONLY if the story established they secretly subscribe.`);
    }
    // Деньги, выведенные с OnlyFans — доступны ей в РП (источник приватен)
    if (s.ofWallet > 0) {
        lines.push(`- They have $${s.ofWallet} of their own money available (on their personal card). The SOURCE is their secret — characters see only that they can afford things, never assume they know where it came from.`);
    }

    return lines.join('\n');
}
