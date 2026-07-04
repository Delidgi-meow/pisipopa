// ═══════════════════════════════════════════
// SOCIAL — Twitter, Instagram, OnlyFans
//
// Ленты хранятся per-chat в chat_metadata.glassphone.social.
//
// Генерация изолирована от RP-пресета, три пути (socialGen):
//  1) профиль подключения (socialProfileId) → ConnectionManagerRequestService,
//     includePreset:false — сюда можно поставить дешёвую модель
//  2) есть фото, профиля нет → currentApiVision: прямой мультимодальный запрос
//     текущим подключением через ChatCompletionService (мимо пресета и инлайнинг-
//     проверок ST)
//  3) generateRaw — текущий API без пресета и истории (текст)
// RP-контекст подмешивается вручную: taskHeader (карточка+персона+лорбук+срез чата).
//
// Синхронизация с РП:
//  • из чата: теги tel:tweet / tel:insta — персонаж постит из ролевой
//  • в чат: журнал (logSocialToChat) — посты и ветки юзера пишутся скрытыми
//    строками в историю (с фото в extra.image), модель видит их по месту,
//    саммарайзер забирает; инжект-сводка при включённом журнале — только кошелёк
// ═══════════════════════════════════════════

import { generateRaw, user_avatar, getThumbnailUrl } from '../../../../script.js';
import { saveBase64AsFile } from '../../../utils.js';
import { getMeta, saveMeta, keyOf, scanChat, getSettings, stripThink } from './state.js';

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
    return s;
}
export function getTweets() { return getSocial().tweets; }
export function getIgPosts() { return getSocial().igPosts; }
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

export function makeHandle(name) {
    return '@' + String(name || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-zа-яё0-9_]/gi, '').slice(0, 15) || '@user';
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

// authorKey: 'user' | 'contact:<key>' | 'random'
export function resolveAuthorKey(name) {
    const k = keyOf(name);
    if (!k) return 'random';
    try {
        const { contacts } = scanChat();
        if (contacts.has(k)) return `contact:${k}`;
    } catch (e) { /* ignore */ }
    return 'random';
}

// ═══ Теги из чата: персонаж постит из ролевой ═══
const TW_TAG_RE = /<!--\s*tel:tweet:(\{[\s\S]*?\})\s*-->/gi;
const IG_TAG_RE = /<!--\s*tel:insta:(\{[\s\S]*?\})\s*-->/gi;

// Возвращает {tweets, posts} — сколько нового добавлено (для тостов)
export function harvestSocialTags() {
    const s = getSocial();
    let chat = [];
    try { chat = SillyTavern.getContext()?.chat || []; } catch (e) { return { tweets: 0, posts: 0 }; }

    let newTweets = 0, newPosts = 0;
    const seen = new Set(s.seenTags);

    for (const msg of chat) {
        if (!msg || !msg.mes || msg.is_system || msg.is_user) continue;
        // Теги в CoT-блоках не считаются (иначе дубли постов)
        const text = stripThink(msg.mes);

        TW_TAG_RE.lastIndex = 0;
        let m;
        while ((m = TW_TAG_RE.exec(text)) !== null) {
            const h = 'tw' + hash32(m[1]);
            if (seen.has(h)) continue;
            seen.add(h); s.seenTags.push(h);
            const j = safeJson(m[1]);
            if (!j || !j.author || !j.text) continue;
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
            const h = 'ig' + hash32(m[1]);
            if (seen.has(h)) continue;
            seen.add(h); s.seenTags.push(h);
            const j = safeJson(m[1]);
            if (!j || !j.author || (!j.caption && !j.photo)) continue;
            s.igPosts.unshift({
                id: genId(), author: String(j.author), ak: resolveAuthorKey(j.author),
                image: null, imgDesc: String(j.photo || '').slice(0, 200),
                caption: String(j.caption || '').slice(0, 400),
                time: Date.now(), likes: Math.floor(Math.random() * 80) + 5, liked: false, comments: [],
            });
            newPosts++;
        }
    }

    if (s.seenTags.length > 300) s.seenTags = s.seenTags.slice(-300);
    if (newTweets || newPosts) {
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
    s.tweets.unshift({
        id: genId(), author: getUserName(), handle: getUserHandle(), ak: 'user',
        text: String(text).slice(0, 280), time: Date.now(),
        likes: 0, liked: false, rts: 0, replies: [],
    });
    trimFeeds(s); saveMeta();
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
${getUserName()} posted on her PRIVATE paid subscription page (${s.ofSubs} subscribers). ${photoLine}
Caption: "${post.caption || '(none)'}"${post.price > 0 ? `\nPay-per-view price: $${post.price}` : ''}
${existing ? `Existing comments (do not repeat):\n${existing}\n` : ''}
PRIVACY — CRITICAL: this page is anonymous and subscribers are STRANGERS. ${knownNames.length ? `The following roleplay characters must NOT appear in comments and their names must NOT be used for fan accounts: ${knownNames.join(', ')}. ` : ''}A known character may appear ONLY IF the roleplay excerpt above EXPLICITLY shows that this character knows about / subscribes to her page. No guesses, no "plausible" — when in doubt: random fans ONLY.

Generate 4-7 comments from her SUBSCRIBERS: invented fan accounts (simps, regulars, big tippers, shy lurkers who finally commented). Thirsty but human; vary tone.
Some commenters tip: add "tip": dollar amount (5-200) to 1-3 comments.
Max 200 chars each. NO emojis. Match the explicitness of the roleplay excerpt — do not sanitize, do not escalate beyond it.
${JSON_RULES}
${wantDesc
        ? `Format — STRICT JSON OBJECT: {"photo_description":"detailed description of the attached photo in Russian, one cohesive paragraph","comments":[{"author":"ник","text":"...","type":"random","tip":0},...]}`
        : `Format: [{"author":"ник","text":"...","type":"random","tip":0},...]`}`;

    const rawOf = await socialGen(prompt, { maxTokens: wantDesc ? 2048 : 1536, image: willAttach ? post.image : null });
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
// вроде /user/images/... — картинки, сгенерированные novarakk, хранятся файлами)
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

// ── Прямой мультимодальный запрос ТЕКУЩИМ подключением (без профиля, без пресета) ──
// Зачем: generateQuietPrompt с quietImage зависит от ST-настройки «Send inline images»
// и allowlist моделей — картинка молча выбрасывалась. Здесь мы бьём в бэкенд напрямую
// через ChatCompletionService с настройками текущего подключения — прокси сам решает,
// умеет ли модель вижн.
async function currentApiVision(prompt, image, maxTokens = 1024) {
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
        const dataUrl = await toDataUrl(image);
        if (!dataUrl) return null;

        const res = await svc.processRequest({
            stream: false,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
                ],
            }],
            max_tokens: maxTokens,
            model,
            chat_completion_source: oai.chat_completion_source,
            custom_url: oai.custom_url,
            reverse_proxy: oai.reverse_proxy,
            proxy_password: oai.proxy_password,
        }, {}, true);

        const out = cleanGenOutput(res?.content ?? '');
        if (out) console.log(`[GlassPhone] vision: прямой запрос текущим API ок (модель ${model}, фото ~${Math.round(dataUrl.length / 1366)}KB)`);
        return out || null;
    } catch (e) {
        console.warn('[GlassPhone] currentApiVision failed:', e);
        return null;
    }
}

async function socialGen(prompt, { maxTokens = 1024, image = null } = {}) {
    const st = getSettings();
    const profileId = st.socialProfileId;

    // Путь 1: отдельный профиль подключения (изоляция + вижн)
    if (profileId) {
        const ctx = SillyTavern.getContext();
        const svc = ctx?.ConnectionManagerRequestService;
        if (svc && typeof svc.sendRequest === 'function') {
            let content = prompt;
            if (image) {
                const dataUrl = await toDataUrl(image);
                if (dataUrl) {
                    content = [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } }];
                    console.log(`[GlassPhone] vision: фото приложено к запросу (~${Math.round(dataUrl.length / 1366)}KB)`);
                } else {
                    console.warn('[GlassPhone] vision: не удалось прочитать картинку — запрос без фото');
                }
            }
            const res = await svc.sendRequest(profileId, [{ role: 'user', content }], maxTokens, {
                stream: false, extractData: true, includePreset: false, includeInstruct: false,
            });
            return cleanGenOutput(res?.content ?? '');
        }
        console.warn('[GlassPhone] ConnectionManagerRequestService недоступен — fallback на generateRaw');
    }

    // Путь 2: есть картинка, профиля нет → прямой мультимодальный запрос текущим API
    if (image) {
        const vis = await currentApiVision(prompt, image, maxTokens);
        if (vis !== null) return vis;
        console.warn('[GlassPhone] vision: прямой канал не сработал — запрос уйдёт БЕЗ фото');
    }
    // Путь 3: текущий API, «сырая» генерация — без пресета и истории чата.
    const res = await generateRaw({ prompt, responseLength: maxTokens });
    return cleanGenOutput(res);
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
    console.log(`[GlassPhone] Фото автоописано: "${desc}"`);
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
    const prompt = `${await taskHeader(`reply to an SMS that ${getUserName()} just sent from her phone, and describe her attached photo.`)}
${getUserName()} texted ${target}: "${userText || '(only the photo, no text)'}"
Her PHOTO is ATTACHED to this request — LOOK at it and react to what you actually see.

Output STRICT JSON object ONLY — no markdown, no backticks, no <think>, no HTML comments:
{"photo_description":"detailed description of the attached photo in Russian, one cohesive paragraph: who/what is in the frame, pose, facial expression, clothes, setting, lighting, mood, small details","replies":[{"from":"SenderName","text":"reply text"}]}
Reply rules: 1-5 short messages in the character's own texting voice, in-character reaction to the photo and her text, same language as the excerpt. ${isGroup ? 'Several members may reply in a row — "from" = member name.' : `Every reply has "from":"${contactName}".`} If the character realistically would NOT reply right now, use an empty "replies" array.`;

    try {
        const raw = await socialGen(prompt, { maxTokens: 1500, image });
        const obj = parseJsonObject(raw);
        if (!obj) return null;
        const desc = String(obj.photo_description || '').trim().replace(/\s*\n+\s*/g, ' ').slice(0, 3000);
        const replies = Array.isArray(obj.replies)
            ? obj.replies.filter(r => r && r.text).map(r => ({
                from: String(r.from || contactName),
                text: String(r.text).slice(0, 500),
            })).slice(0, 5)
            : [];
        console.log(`[GlassPhone] смс-фото: описание+ответ одним запросом (desc ${desc.length} симв., ответов ${replies.length})`);
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
    try {
        const { contacts } = scanChat();
        for (const c of contacts.values()) {
            lines.push(`- ${c.name} (${handleFor(`contact:${keyOf(c.name)}`, c.name)})`);
        }
    } catch (e) { /* ignore */ }
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
    if (rich) {
        const rc = await richContext();
        if (rc.charDesc) block += `\n=== MAIN CHARACTER (how they think, talk, behave — use this voice) ===\n${rc.charDesc}\n`;
        if (rc.persona) block += `\n=== ${getUserName()} (the user's persona) ===\n${rc.persona}\n`;
        if (rc.wi) block += `\n=== WORLD / LOREBOOK (relevant entries) ===\n${rc.wi}\n`;
    }
    const rp = rpContextBlock(rich ? 16 : 12);
    if (rp) block += `\n=== RECENT ROLEPLAY EXCERPT (current events) ===\n${rp}\n=== END OF EXCERPT ===\n`;
    return block;
}

const JSON_RULES = `Output STRICT JSON array ONLY. No markdown, no backticks, no commentary, no <think>, no hidden HTML comments. Text values in the same language as the roleplay excerpt (Russian). Keep it varied and alive.`;

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
3. 1-2 tweets MAY be quote-retweets of ${getUserName()}'s recent tweets (if she posted any) — a character reacts to her tweet with their own commentary. For these, add a "quote" field.

Rules: max 280 chars each, SHORT like real tweets; mix of tones (news, shitpost, life update, ad, hot take). NO emojis.
${JSON_RULES}
Format: [{"author":"Имя","handle":"@handle","text":"...","type":"contact|random"},...]  
For quote-retweets: {"author":"...","handle":"...","text":"their commentary","type":"contact|random","quote":{"author":"${getUserName()}","text":"original tweet text"}}`;

    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 2048 }));
    if (!Array.isArray(parsed) || parsed.length === 0) return 0;

    let added = 0;
    for (const it of parsed) {
        if (!it || !it.author || !it.text) continue;
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
${existing ? `Existing replies (do not repeat):\n${existing}\n` : ''}
${contactsBlock()}

Generate 4-7 replies: known characters in-character when relevant + random accounts (fans, haters, reply guys, bots). Realistic engagement — some agree, some argue, some joke. Max 280 chars each. NO emojis.
${JSON_RULES}
Format: [{"author":"Имя","handle":"@handle","text":"...","type":"contact|random"},...]`;

    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 1536 }));
    if (!Array.isArray(parsed)) return 0;
    let added = 0;
    if (!Array.isArray(tweet.replies)) tweet.replies = [];
    for (const it of parsed) {
        if (!it || !it.author || !it.text) continue;
        if (tweet.replies.length >= MAX_COMMENTS) break;
        tweet.replies.push({
            id: genId(), author: String(it.author), handle: it.handle || makeHandle(it.author),
            ak: it.type === 'contact' ? resolveAuthorKey(it.author) : 'random',
            text: String(it.text).slice(0, 280), time: Date.now() - Math.floor(Math.random() * 900000),
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
Output ONLY the reply text — no quotes, no labels, no JSON, no HTML comments, no <think>.`;

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
Output ONLY the reply text — no quotes, no labels, no JSON, no HTML comments, no <think>.`;

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
2. Posts from invented accounts fitting the setting (places, food, aesthetics, memes).

Each post: "photo" = short visual description of the photo (what's in the frame, 5-15 words), "caption" = post caption (may include hashtags), max 200 chars. NO emojis.
${JSON_RULES}
Format: [{"author":"Имя","photo":"описание кадра","caption":"...","type":"contact|random"},...]`;

    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 2048 }));
    if (!Array.isArray(parsed) || parsed.length === 0) return 0;

    const s = getSocial();
    let added = 0;
    for (const it of parsed) {
        if (!it || !it.author || (!it.photo && !it.caption)) continue;
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

export async function generateIgComments(post) {
    // Экономия: описание есть → фото не прикладываем (галочка visionInComments переопределяет)
    const willAttach = !!post.image && (getSettings().visionInComments || !post.imgDesc);
    // Комбо-режим: фото приложено и описания нет → просим В ТОМ ЖЕ запросе
    // и описание, и комменты (одна картинка в API вместо двух)
    const wantDesc = willAttach && !post.imgDesc;
    const photoLine = willAttach
        ? `The actual photo is ATTACHED to this request — LOOK at it and react to what you actually see.${post.imgDesc ? ` (fallback description if you cannot see images: ${post.imgDesc})` : ''}`
        : `Photo (description): ${post.imgDesc || (post.image ? 'her photo, no text description available' : '(no description)')}`;
    const existing = (post.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');
    const formatLine = wantDesc
        ? `Format — STRICT JSON OBJECT: {"photo_description":"detailed description of the attached photo in Russian, one cohesive paragraph (who/what, pose, clothes, setting, lighting, mood, details)","comments":[{"author":"Имя","text":"...","type":"contact|random"},...]}`
        : `Format: [{"author":"Имя","text":"...","type":"contact|random"},...]`;
    const prompt = `${await taskHeader('generate comments under an Instagram post.')}
Post by ${post.author}. ${photoLine}
Caption: "${post.caption || '(none)'}"
${existing ? `Existing comments (do not repeat):\n${existing}\n` : ''}
${contactsBlock()}

Generate 4-7 comments: known characters in-character (reacting to the photo/caption — especially if the post is by ${getUserName()}) + random accounts. Instagram tone: compliments, questions, jokes. NO emojis at all. Max 200 chars each.
${JSON_RULES}
${formatLine}`;

    const raw = await socialGen(prompt, { maxTokens: wantDesc ? 2048 : 1536, image: willAttach ? post.image : null });
    let parsed;
    if (wantDesc) {
        const obj = parseJsonObject(raw);
        if (obj) {
            const desc = String(obj.photo_description || '').trim().replace(/\s*\n+\s*/g, ' ').slice(0, 3000);
            if (desc) {
                post.imgDesc = desc;
                console.log(`[GlassPhone] Комбо: описание фото получено вместе с комментами (${desc.length} симв.)`);
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
        if (post.comments.length >= MAX_COMMENTS) break;
        post.comments.push({
            id: genId(), author: String(it.author),
            ak: it.type === 'contact' ? resolveAuthorKey(it.author) : 'random',
            text: String(it.text).slice(0, 300), time: Date.now() - Math.floor(Math.random() * 600000),
        });
        added++;
    }
    post.likes = Math.max(post.likes || 0, Math.floor(Math.random() * 40) + post.comments.length * 3);
    saveMeta();
    return added;
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
function charCardAvatar(key) {
    if (!getSettings().autoAvatars) return '';
    try {
        const ctx = SillyTavern.getContext();
        const ch = (ctx?.characters || []).find(c => keyOf(c?.name) === key);
        if (ch?.avatar && ch.avatar !== 'none') {
            return getThumbnailUrl('avatar', ch.avatar);
        }
    } catch (e) { /* ignore */ }
    return '';
}

// Аватар персоны юзера
export function userAvatarUrl() {
    if (!getSettings().autoAvatars) return '';
    try {
        if (typeof user_avatar === 'string' && user_avatar) {
            return getThumbnailUrl('persona', user_avatar);
        }
    } catch (e) { /* ignore */ }
    return '';
}

export function getContactAvatar(key) {
    const m = getMeta();
    // Приоритет: загруженная вручную → карточка персонажа ST
    return (m.avatars && m.avatars[key]) || charCardAvatar(key);
}
// Аватар по имени автора (для лент)
export function avatarForAuthor(ak) {
    if (ak === 'user') return userAvatarUrl();
    if (typeof ak === 'string' && ak.startsWith('contact:')) {
        return getContactAvatar(ak.slice(8));
    }
    return '';
}

// ═══ Novarakk (Nyaa-Rakk-Imagen / IIG) — генерация картинок для инста-постов ═══
// Опциональная интеграция: если расширение установлено, на постах без реальной
// картинки появляется кнопка генерации. Используем его пайплайн напрямую:
// generateImageWithRetry → dataURL, saveImageToFile → файл в ST (метаданные не пухнут).
let _novarakk = undefined; // undefined = не проверяли, null = недоступен

async function loadNovarakk() {
    if (_novarakk !== undefined) return _novarakk;
    try {
        const pipeline = await import('/scripts/extensions/third-party/novarakk/src/pipeline.js');
        const utils = await import('/scripts/extensions/third-party/novarakk/src/utils.js');
        _novarakk = (typeof pipeline.generateImageWithRetry === 'function') ? { pipeline, utils } : null;
    } catch (e) {
        console.log('[GlassPhone] novarakk не найден — генерация картинок недоступна');
        _novarakk = null;
    }
    return _novarakk;
}

export async function isImageGenAvailable() {
    return !!(await loadNovarakk());
}

// Последовательная очередь генераций (мы временно мутируем настройки novarakk —
// параллельные генерации могли бы увидеть чужие флаги)
let _imgGenChain = Promise.resolve();

// Сгенерировать картинку для инста-поста (из описания кадра + подписи).
// ВАЖНО ПРО РЕФЕРЕНСЫ: novarakk по своим настройкам подмешивает аватары
// персонажа/персоны КАК РЕФЕРЕНСЫ в каждую генерацию → лица юзерки и бота
// появлялись на постах рандомных аккаунтов. Поэтому на время генерации:
//  • пост юзера → оставляем только реф аватара персоны (если он включён в novarakk)
//  • пост главного персонажа чата → только реф аватара персонажа
//  • любой другой автор → БЕЗ автоматических рефов вообще
// (лорбук-рефы novarakk по триггер-словам в описании кадра продолжают работать —
// это желаемое поведение: упомянула НПС → подтянется его реф.)
export function generatePostImage(post, onStatus = null) {
    const run = () => _generatePostImage(post, onStatus);
    const p = _imgGenChain.then(run, run);
    _imgGenChain = p.then(() => {}, () => {});
    return p;
}

async function _generatePostImage(post, onStatus = null) {
    const nv = await loadNovarakk();
    if (!nv) throw new Error('Расширение novarakk не установлено');

    // Настройки novarakk для временного глушения авто-рефов
    let nvSettings = null;
    try {
        const mod = await import('/scripts/extensions/third-party/novarakk/src/settings.js');
        if (typeof mod.getSettings === 'function') nvSettings = mod.getSettings();
    } catch (e) { /* без настроек — генерим как есть */ }

    const ctx = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
    const isUserPost = post.ak === 'user';
    const isCharPost = !isUserPost && keyOf(post.author) && keyOf(post.author) === keyOf(ctx?.name2 || '');

    const st = getSettings();
    const parts = [];
    if (post.imgDesc) parts.push(post.imgDesc);
    if (post.caption) parts.push(`vibe of the caption: "${post.caption}"`);
    if (parts.length === 0) parts.push(`casual instagram photo posted by ${post.author}`);
    // Для «чужих» постов явно говорим модели, что это посторонний аккаунт
    if (!isUserPost && !isCharPost) {
        parts.push('random social media account content — do NOT depict the main story characters');
    }
    // OnlyFans-пост — другая эстетика кадра
    const flavor = post.kind === 'of'
        ? 'OnlyFans content photo, boudoir aesthetic, alluring, amateur phone camera, realistic'
        : 'Instagram photo, phone camera aesthetic, realistic';
    const prompt = `${flavor}. ${parts.join('. ')}`;

    const saved = nvSettings ? {
        sendCharAvatar: nvSettings.sendCharAvatar,
        sendUserAvatar: nvSettings.sendUserAvatar,
        imageContextEnabled: nvSettings.imageContextEnabled,
        model: nvSettings.model,
    } : null;
    if (nvSettings) {
        nvSettings.sendCharAvatar = !!(isCharPost && saved.sendCharAvatar);
        nvSettings.sendUserAvatar = !!(isUserPost && saved.sendUserAvatar);
        nvSettings.imageContextEnabled = false; // контекст последних сообщений тут ни к чему
        // Отдельная модель для телефона (чтобы не трогать модель, настроенную под RP-иллюстрации)
        if (st.imageGenModel) nvSettings.model = st.imageGenModel;
    }

    // Аспект: квадрат для инсты/OF (если включено в настройках)
    const genOptions = {};
    if (st.imageGenSquare !== false) genOptions.aspectRatio = '1:1';

    try {
        // style = null → возьмётся дефолтный стиль из настроек novarakk
        const dataUrl = await nv.pipeline.generateImageWithRetry(prompt, null, onStatus, genOptions);
        if (!dataUrl || typeof dataUrl !== 'string') throw new Error('Пустой результат генерации');

        // Сохраняем в файлы ST — в метаданных остаётся короткий URL, не base64
        let src = dataUrl;
        try {
            src = await nv.utils.saveImageToFile(dataUrl, { mode: 'glassphone-ig' });
        } catch (e) {
            console.warn('[GlassPhone] saveImageToFile failed, keeping dataURL:', e);
        }
        post.image = src;
        saveMeta();
        return src;
    } finally {
        // Возвращаем настройки novarakk как были
        if (nvSettings && saved) Object.assign(nvSettings, saved);
    }
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

        ctx.chat.push({
            name: ctx.name1 || 'User',
            is_user: true,
            is_system: false,
            send_date: new Date().toLocaleString('en-US'),
            mes: `<!--tel:log-->\n[Соцсети] ${String(text).slice(0, 500)}`,
            extra: imgSrc ? { image: imgSrc, inline_image: true } : {},
        });
        if (typeof ctx.saveChat === 'function') await ctx.saveChat();
        console.log(`[GlassPhone] Журнал → чат${imgSrc ? ' (с фото)' : ''}: ${String(text).slice(0, 80)}`);
    } catch (e) {
        console.warn('[GlassPhone] logSocialToChat failed:', e);
    }
}

// ═══ Активность юзера для инжекции в основной чат ═══
// При включённом журнале события уже лежат в истории чата — сводка не дублирует их,
// в инжекте остаётся только ПОСТОЯННОЕ состояние (кошелёк). Экономия + нет двойного контекста.
export function getSocialActivitySummary() {
    const s = getSocial();

    if (getSettings().socialLogToChat !== false) {
        return s.ofWallet > 0
            ? `- She has $${s.ofWallet} of her own money available (on her personal card). The SOURCE is her secret — characters see only that she can afford things.`
            : '';
    }

    const lines = [];
    const fmtThread = (arr) => (arr || []).slice(-3).map(r => `${r.ak === 'user' ? getUserName() : r.author}: "${String(r.text).slice(0, 80)}"`).join(' | ');

    // Её посты + ветки под ними (персонажи в РП знают и свои ответы в комментах)
    for (const t of s.tweets.filter(t => t.ak === 'user').slice(0, 2)) {
        lines.push(`- Her tweet (${timeAgo(t.time)} ago): "${t.text.slice(0, 150)}"${t.replies?.length ? ` — replies: ${fmtThread(t.replies)}` : ''}`);
    }
    for (const p of s.igPosts.filter(p => p.ak === 'user').slice(0, 2)) {
        const photo = p.imgDesc ? `photo: ${p.imgDesc.slice(0, 80)}` : 'photo';
        lines.push(`- Her Instagram post (${timeAgo(p.time)} ago): ${photo}${p.caption ? `, caption: "${p.caption.slice(0, 100)}"` : ''}${p.comments?.length ? ` — comments: ${fmtThread(p.comments)}` : ''}`);
    }

    // Её реплики под ЧУЖИМИ постами (+ ответ автора, если был)
    const interactions = [];
    for (const t of s.tweets) {
        if (t.ak === 'user' || !Array.isArray(t.replies)) continue;
        t.replies.forEach((r, i) => {
            if (r.ak !== 'user') return;
            const next = t.replies[i + 1];
            const followUp = next && next.ak !== 'user' ? ` → ${next.author}: "${String(next.text).slice(0, 80)}"` : '';
            interactions.push({ time: r.time || 0, line: `- She replied under ${t.author}'s tweet "${t.text.slice(0, 60)}...": "${String(r.text).slice(0, 80)}"${followUp}` });
        });
    }
    for (const p of s.igPosts) {
        if (p.ak === 'user' || !Array.isArray(p.comments)) continue;
        p.comments.forEach((c, i) => {
            if (c.ak !== 'user') return;
            const next = p.comments[i + 1];
            const followUp = next && next.ak !== 'user' ? ` → ${next.author}: "${String(next.text).slice(0, 80)}"` : '';
            interactions.push({ time: c.time || 0, line: `- She commented on ${p.author}'s Instagram post: "${String(c.text).slice(0, 80)}"${followUp}` });
        });
    }
    interactions.sort((a, b) => b.time - a.time);
    lines.push(...interactions.slice(0, 3).map(x => x.line));

    // OnlyFans: только последний пост, с пометкой приватности
    const lastOf = s.ofPosts.filter(p => p.ak === 'user')[0];
    if (lastOf) {
        const photo = lastOf.imgDesc ? `photo: ${lastOf.imgDesc.slice(0, 80)}` : 'photo';
        lines.push(`- Her PRIVATE OnlyFans post (${timeAgo(lastOf.time)} ago, subscribers-only): ${photo}${lastOf.caption ? `, caption: "${lastOf.caption.slice(0, 80)}"` : ''}. Characters know about it ONLY if the story established they secretly subscribe.`);
    }
    // Деньги, выведенные с OnlyFans — доступны ей в РП (источник приватен)
    if (s.ofWallet > 0) {
        lines.push(`- She has $${s.ofWallet} of her own money available (on her personal card). The SOURCE is her secret — characters see only that she can afford things, never assume they know where it came from.`);
    }

    return lines.join('\n');
}
