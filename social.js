
import { generateRaw, user_avatar, getThumbnailUrl } from '../../../../script.js';
import { saveBase64AsFile } from '../../../utils.js';
import { extensionNames, extension_settings } from '../../../extensions.js';
import { getMeta, saveMeta, keyOf, scanChat, getSettings, stripThink, textMentionsName, stripHandle, isBanned, displayName, getRpDateTime, extractTemporalContext } from './state.js';
import { lang } from './i18n.js';

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

        TW_TAG_RE.lastIndex = 0;
        let m;
        while ((m = TW_TAG_RE.exec(text)) !== null) {
            const legacyH = 'tw' + hash32(m[1]);
            const h = `${legacyH}:${String(msg.send_date || msg.extra?.gen_id || msgIndex)}:${m.index}`;
            if (seen.has(h)) continue;
            if (seen.has(legacyH)) {
                seen.add(h); s.seenTags.push(h); migratedLegacyKeys = true;
                continue;
            }
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
            const legacyH = 'ig' + hash32(m[1]);
            const h = `${legacyH}:${String(msg.send_date || msg.extra?.gen_id || msgIndex)}:${m.index}`;
            if (seen.has(h)) continue;
            if (seen.has(legacyH)) {
                seen.add(h); s.seenTags.push(h); migratedLegacyKeys = true;
                continue;
            }
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
        return out || null;
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

// ── Префилл (опция): начало ответа пишется «за модель» через инструкцию —
// не зависит от API/пресета/модели. JSON стартует сразу, без преамбул и отказов.
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

function prefillSuffix(prefill) {
    return `

You must continue the text after the prefix below.
Do not repeat the prefix.
Do not explain.
Do not add markdown unless the task requires it.
Return only the continuation.

Prefix:
${prefill}`;
}

// prefill: строка-начало ответа (учитывается только при включённой опции).
// Возвращается ВСЕГДА prefill+продолжение — JSON-парсеры получают полный текст.
async function socialGen(prompt, { maxTokens = 1024, image = null, prefill = '' } = {}) {
    const st = getSettings();
    const profileId = st.socialProfileId;
    // Пол длины ответа (если модель рвёт JSON из-за лимита — юзер поднимает)
    const floor = parseInt(st.socialMaxTokens) || 0;
    if (floor > 0) maxTokens = Math.max(maxTokens, floor);
    const usePrefill = !!(st.usePrefill && prefill);
    const finalPrompt = usePrefill ? String(prompt).trim() + prefillSuffix(prefill) : prompt;

    const finish = (raw) => {
        let out = cleanGenOutput(raw);
        if (!usePrefill) return out;
        out = removeCommonPreamble(out);
        out = removeRepeatedPrefill(out, prefill);
        return prefill + out;
    };

    // Путь 1: отдельный профиль подключения (изоляция + вижн)
    if (profileId) {
        const ctx = SillyTavern.getContext();
        const svc = ctx?.ConnectionManagerRequestService;
        if (svc && typeof svc.sendRequest === 'function') {
            let content = finalPrompt;
            if (image) {
                const dataUrl = await toDataUrl(image);
                if (dataUrl) {
                    content = [{ type: 'text', text: finalPrompt }, { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } }];
                } else {
                    console.warn('[GlassPhone] vision: не удалось прочитать картинку — запрос без фото');
                }
            }
            try {
                const res = await svc.sendRequest(profileId, [{ role: 'user', content }], maxTokens, {
                    stream: false, extractData: true,
                    includePreset: false, includeInstruct: false,
                });
                return finish(res?.content ?? '');
            } catch (e) {
                // Разворачиваем cause-цепочку: «API request failed» сам по себе бесполезен
                const root = rootErrorMessage(e);
                console.error(`[GlassPhone] профиль подключения: запрос упал — ${root}`, e);
                throw new Error(`Профиль: ${root}`, { cause: e });
            }
        }
        console.warn('[GlassPhone] ConnectionManagerRequestService недоступен — fallback на generateRaw');
    }

    // Путь 2: есть картинка, профиля нет → прямой мультимодальный запрос текущим API
    if (image) {
        const vis = await currentApiVision(finalPrompt, image, maxTokens);
        if (vis !== null) return usePrefill ? prefill + removeRepeatedPrefill(removeCommonPreamble(vis), prefill) : vis;
        console.warn('[GlassPhone] vision: прямой канал не сработал — запрос уйдёт БЕЗ фото');
    }
    // Путь 3: текущий API, «сырая» генерация — без пресета и истории чата.
    const res = await generateRaw({ prompt: finalPrompt, responseLength: maxTokens });
    return finish(res);
}

// ── Проверка профиля из настроек: маленький запрос, наружу — реальная причина ──
export async function testSocialProfile() {
    const st = getSettings();
    if (!st.socialProfileId) throw new Error('Профиль не выбран (стоит «Текущий API»)');
    const ctx = SillyTavern.getContext();
    const svc = ctx?.ConnectionManagerRequestService;
    if (!svc || typeof svc.sendRequest !== 'function') throw new Error('ConnectionManagerRequestService недоступен (старый ST?)');
    try {
        const res = await svc.sendRequest(st.socialProfileId, [{ role: 'user', content: 'Reply with exactly: ok' }], 200, {
            stream: false, extractData: true,
            includePreset: false, includeInstruct: false,
        });
        const out = String(res?.content ?? '').trim();
        if (!out) throw new Error('Пустой ответ (модель ответила, но контент не извлёкся)');
        return out.slice(0, 80);
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
    const prompt = `${await taskHeader(`reply to an SMS that ${getUserName()} just sent from her phone, and describe her attached photo.`)}
${getUserName()} texted ${target}: "${userText || '(only the photo, no text)'}"
Her PHOTO is ATTACHED to this request — LOOK at it and react to what you actually see.

Output STRICT JSON object ONLY — no markdown, no backticks, no <think>, no HTML comments:
{"photo_description":"detailed description of the attached photo in Russian, one cohesive paragraph: who/what is in the frame, pose, facial expression, clothes, setting, lighting, mood, small details","replies":[{"from":"SenderName","text":"reply text"}]}
Reply rules: 1-5 short messages in the character's own texting voice, in-character reaction to the photo and her text, same language as the excerpt. ${isGroup ? 'Several members may reply in a row — "from" = member name.' : `Every reply has "from":"${contactName}".`} If the character realistically would NOT reply right now, use an empty "replies" array.`;

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
    block += `\n=== CULTURAL / NAME CONSISTENCY ===\nInfer the story's actual country, city, language community and cultural naming pool from WORLD/LOREBOOK, character card, persona and RP excerpt. The UI/output language is NOT evidence of country. Invented stranger accounts must use names, handles, places, institutions and prices natural for that inferred setting. If evidence is mixed or absent, prefer setting-neutral handles instead of assuming Russian, American, Japanese or any other nationality. Known characters keep their exact display names.\n`;
    return block;
}

const JSON_RULES = `Output STRICT JSON array ONLY. No markdown, no backticks, no commentary, no <think>, no hidden HTML comments. Text values in the same language as the roleplay excerpt (Russian). Keep it varied and alive.
CRITICAL — "author" is ALWAYS the person's real DISPLAY NAME (e.g. «Вадим Огнев», «Алиса»), NEVER an @handle/nickname. The @handle belongs ONLY in the separate "handle" field. For known characters use their EXACT name as listed above so the app links them correctly.`;

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

    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 2048, prefill: '[{"author":"' }));
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
${JSON_RULES}
Format: [{"author":"Имя","handle":"@handle","text":"...","type":"contact|random","sentiment":"positive|neutral|negative"},...]`;

    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 1536, prefill: '[{"author":"' }));
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
2. Posts from invented accounts fitting the setting (places, food, aesthetics, memes). These are STRANGERS unrelated to ${getUserName()} — their photos must NOT feature ${getUserName()} or the main story characters.

Each post: "photo" = short visual description of the photo (what's in the frame, 5-15 words), "caption" = post caption (may include hashtags), max 200 chars. NO emojis.
${JSON_RULES}
Format: [{"author":"Имя","photo":"описание кадра","caption":"...","type":"contact|random"},...]`;

    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 2048, prefill: '[{"author":"' }));
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
${JSON_RULES}
Format: [{"store":"Store name","items":[{"name":"Товар","price":1234,"desc":"краткое описание"}]}]`;
    return parseJsonArray(await socialGen(prompt, { maxTokens: 2048, prefill: '[{"store":"' }));
}

// ── Спам/мошенники: одно скам-смс под сеттинг ──
export async function generateScamSms(recent = []) {
    const seen = (recent || []).slice(0, 8).map(x => `- ${x}`).join('\n');
    const prompt = `${await taskHeader(`invent ONE scam/spam SMS that ${getUserName()} just received from an unknown number.`)}
Invent a scam or spam text fitting the setting: fake bank security alert, phishing link, casino/lottery spam, «мама, я с чужого номера, срочно нужны деньги», fake delivery fee, crypto pump, subscription trap. If the setting is not modern — adapt the fraud to the world (guild lottery, cursed amulet seller, «маг-целитель снимет порчу»). Believable, specific, slightly off — like real scam. May include a fake link or callback number. Same language as the roleplay excerpt.
${seen ? `She ALREADY received these scam messages — invent a COMPLETELY different scheme, sender type and wording (do not rehash any of them):\n${seen}\n` : ''}${JSON_RULES}
Format: [{"from":"sender: short name or number like +7 9XX XXX-XX-XX","text":"the scam message, max 280 chars"}]`;
    const arr = parseJsonArray(await socialGen(prompt, { maxTokens: 400, prefill: '[{"from":"' }));
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
${JSON_RULES}
Format: [{"tag":"категория","title":"заголовок","text":"текст новости"}]`;
    return parseJsonArray(await socialGen(prompt, { maxTokens: 2048, prefill: '[{"tag":"' }));
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
[{"brand":"...","title":"...","product":"...","brief":"...","platform":"twitter|instagram","risk":"safe|mixed|controversial","payment":500}]`;
    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 1800, prefill: '[{"brand":"' }));
    return replaceAdOffers(parsed);
}


// ── Статус репутации: короткое живое описание вместо шаблонного тира ──
export async function generateRepLabel(platform, reputation, followers, fallback) {
    const prompt = `${await taskHeader(`invent a short vivid "audience status" label for ${getUserName()}'s ${platform} profile screen.`)}
Her ${platform}: ${followers} followers, reputation score ${reputation}/100 (roughly: "${fallback}").
Write ONE punchy status label, 2-5 words. Make it flavorful and specific to her vibe/roleplay (like «тихий омут ленты» / "menace of the comment section") and matching the score tone (${reputation}/100). ${uiLangLine()} NO quotes, NO emojis. Output ONLY the label.`;
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
        : `Photo (description): ${post.imgDesc || (post.image ? 'her photo, no text description available' : '(no description)')}`;
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
{"events":[{"title":"...","hook":"...","premise":"...","involved_actors":["..."],"visibility":"public|followers|known_characters","stakes":"social|relationship|mystery|danger|opportunity|comedy|reputation","urgency":"soft|next_scene|immediate","canon_evidence":["specific fact from context"],"opening_message":"...","choices":[{"id":"a","label":"...","intent":"honest","text":"..."},{"id":"b","label":"...","intent":"deflect","text":"..."},{"id":"c","label":"...","intent":"confront","text":"..."}]}]}`;
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
{"immediate_result":"...","bot_reactions":[{"author":"...","channel":"comment|tweet|instagram|sms","text":"...","sentiment":"positive|neutral|negative"}],"audience_shift":{"positive":0,"neutral":0,"negative":0},"follower_modifier":1,"relationship_signals":[{"actor":"...","direction":"up|down|complicated","reason":"..."}],"rp_consequence":{"summary":"...","urgency":"soft|next_scene|immediate","actors":["..."]},"next_hook":"","arc_state":"active|resolved|failed"}`;
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

// Короткий портрет для вымышленных аккаунтов-комментаторов. Сохраняется прямо
// в комментарии, поэтому повторно не генерируется и переживает перезагрузку чата.
export async function generateCommentAvatar(comment) {
    if (!comment || comment.ak !== 'random' || comment.avatar || comment.avatarPending) return comment?.avatar || '';
    comment.avatarPending = true;
    try {
        const mod = await loadImageExt();
        if (!mod) return '';
        const subject = `${comment.author || 'anonymous social media user'} (${comment.handle || makeHandle(comment.author)})`;
        const prompt = `square social-media profile avatar, close-up head-and-shoulders portrait of ${subject}, one person, clean readable face, simple unobtrusive background, no text, no logo, no watermark`;
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

// ═══ Генерация картинок — через novarakk-ПОДОБНОЕ расширение ═══
// АВТООПРЕДЕЛЕНИЕ: перебираем установленные third-party расширения (ST
// extensionNames) и ищем то, у кого есть src/pipeline.js с generateImageWithRetry
// — это структура форков Nyaa-Rakk-Imagen (novarakk / IIG / SLAYimages / …).
// Настройка imageGenExtension пустая = авто; непустая = ручной оверрайд папки.
// Настройки расширения мутируем ЗАЩИТНО (только существующие ключи — форки
// «дёргают рефы по-разному» и могут не иметь sendCharAvatar/overrideAspectRatio).
let _imgExt = { key: null, mod: undefined };

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
    const key = override || '(auto)';
    if (_imgExt.key === key && _imgExt.mod !== undefined) return _imgExt.mod;

    let mod = null;
    if (override) {
        mod = await probeImageExt(override, true);
    } else {
        // Кандидаты: все установленные third-party расширения; известные имена вперёд
        const preferred = ['novarakk', 'nyaa-rakk-imagen', 'slayimages', 'megarakk', 'iig'];
        let candidates = [];
        try {
            for (const n of (extensionNames || [])) {
                if (typeof n === 'string' && n.startsWith('third-party/')) {
                    const f = n.slice('third-party/'.length);
                    if (f && f !== 'GlassPhone') candidates.push(f);
                }
            }
        } catch (e) { /* ignore */ }
        if (!candidates.some(c => c.toLowerCase() === 'novarakk')) candidates.push('novarakk');
        candidates.sort((a, b) => {
            const ia = preferred.indexOf(a.toLowerCase()); const ib = preferred.indexOf(b.toLowerCase());
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        for (const f of candidates) {
            mod = await probeImageExt(f, false); // авто — только src/pipeline.js
            if (mod) break;
        }
    }
    // Фолбэк: ВСТРОЕННЫЙ драйвер. Однофайловые форки (vish, sillyimages и т.п.)
    // НЕ экспортируют generateImageWithRetry — импортировать нельзя (второй
    // инстанс задублировал бы их UI). Но ВСЕ форки семейства делят один ключ
    // настроек inline_image_gen (endpoint/apiKey/apiType/model/styles/refs) —
    // генерим сами их настройками (мини-клиент openai/gemini ниже).
    if (!mod) {
        const iig = extension_settings?.inline_image_gen;
        if (iig && iig.endpoint && iig.apiKey && iig.model) {
            mod = { builtin: true, folder: '(встроенный: настройки inline_image_gen)' };
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

// Список моделей активного провайдера картинко-расширения (для кнопки ↻)
export async function fetchImageModels() {
    const mod = await loadImageExt();
    if (!mod) throw new Error('картинко-расширение не найдено');
    if (mod.builtin) {
        const iig = extension_settings.inline_image_gen;
        const resp = await fetch(`${String(iig.endpoint).replace(/\/$/, '')}/v1/models`, {
            headers: { 'Authorization': `Bearer ${iig.apiKey}` },
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
    const provider = provMod.resolveActiveProvider(setMod.getSettings());
    if (!provider) throw new Error('провайдер расширения не настроен');
    const models = await provider.fetchModels();
    if (!Array.isArray(models) || models.length === 0) throw new Error('список пуст');
    return models;
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
function buildImagePrompt(post, { anonymous = false, allowChar = false } = {}) {
    const st = getSettings();
    const parts = [];
    if (post.imgDesc) parts.push(post.imgDesc);
    if (post.caption) parts.push(`caption vibe: "${post.caption}"`);
    if (parts.length === 0) parts.push(`candid photo posted by ${post.author}`);
    const framing = (post.kind === 'of'
        ? (st.imgPromptOf || 'intimate boudoir shot, self-taken framing')
        : (st.imgPromptIg || 'social media post, self-taken candid framing')).trim();
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
        negLine += ` This photo was taken and sent by ${post.author} from their own phone to ${un}. ${un} is the RECIPIENT — she is NOT in the photo. Do NOT depict her unless the description explicitly says she is in the frame.`;
    }
    return `${framing}. ${parts.join('. ')}.${negLine}`;
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
        who += ` The photo was taken and sent by ${post.author}; the recipient ${getUserName()} is NOT in the frame — do not add tags describing her unless the scene explicitly includes her.`;
    }
    const prompt = `Convert this scene into ONE line of English Danbooru-style image tags for an anime image model (NovelAI).
Scene: ${scene}

Rules:
- Start with subject count (1girl / 1boy / 2girls / 1girl 1boy / etc.), add "solo" if only one person.
- Then: appearance (hair length+color, eye color, body), clothing OR state of undress, pose, facial expression, setting/background, lighting.
- End with quality tags (masterpiece, best quality, highly detailed).
- Comma-separated, lowercase, ENGLISH ONLY, tags NOT sentences, no Russian, no explanations.
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

// Последовательная очередь (мы временно мутируем чужие настройки —
// параллельные генерации увидели бы чужие флаги)
let _imgGenChain = Promise.resolve();

export function generatePostImage(post, onStatus = null) {
    const run = () => _generatePostImage(post, onStatus);
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
// АСПЕКТ: novarakk по overrideAspectRatio/overrideImageSize ИГНОРИРУЕТ наш аспект
// (у юзера стоял 16:9). Снимаем оверрайды на время генерации → побеждает наш 1:1.
async function _generatePostImage(post, onStatus = null) {
    const mod = await loadImageExt();
    if (!mod) throw new Error('Картинко-расширение не найдено и картинко-API не настроен. Установи novarakk-подобное расширение или настрой endpoint/key/model в любом форке inline_image_gen.');

    const nvSettings = (typeof mod.settings?.getSettings === 'function') ? mod.settings.getSettings() : null;

    const st = getSettings();
    const isUserPost = post.ak === 'user';
    const isContactPost = typeof post.ak === 'string' && post.ak.startsWith('contact:');
    const charName = mainCharName();
    const charKey = keyOf(charName);
    // Точное совпадение ИЛИ (для ММС) имя контакта — часть имени карточки:
    // контакт «Вадим» vs карточка «Вадим Огнев» — реф должен подтянуться
    const isCharPost = !isUserPost && charKey && (keyOf(post.author) === charKey
        || (post.mms && !!charName && textMentionsName(charName, post.author)));
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
        const framing = (post.kind === 'of' ? (st.imgPromptOf || '') : (st.imgPromptIg || '')).trim();
        prompt = [framing, tags].filter(Boolean).join(', ') || buildImagePrompt(post, { anonymous, allowChar: wantChar });
    } else {
        prompt = buildImagePrompt(post, { anonymous, allowChar: wantChar });
    }

    // Встроенный драйвер (форки без экспортов — vish/sillyimages и т.п.)
    if (mod.builtin) {
        return _generateViaBuiltin(post, { prompt, wantChar, isUserPost, onStatus });
    }

    // Защитная мутация: сохраняем и трогаем ТОЛЬКО существующие ключи
    const keys = ['sendCharAvatar', 'sendUserAvatar', 'imageContextEnabled', 'overrideAspectRatio', 'overrideImageSize', 'model'];
    const saved = {};
    if (nvSettings) {
        for (const k of keys) if (k in nvSettings) saved[k] = nvSettings[k];
        if ('sendCharAvatar' in nvSettings) nvSettings.sendCharAvatar = !!(wantChar && saved.sendCharAvatar);
        if ('sendUserAvatar' in nvSettings) nvSettings.sendUserAvatar = !!(isUserPost && saved.sendUserAvatar);
        if ('imageContextEnabled' in nvSettings) nvSettings.imageContextEnabled = false;
        if (st.imageGenSquare !== false) {
            if ('overrideAspectRatio' in nvSettings) nvSettings.overrideAspectRatio = false;
            if ('overrideImageSize' in nvSettings) nvSettings.overrideImageSize = false;
        }
        if (st.imageGenModel && 'model' in nvSettings) nvSettings.model = st.imageGenModel;
    }

    const genOptions = {};
    if (st.imageGenSquare !== false) genOptions.aspectRatio = '1:1';

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

// ── ВСТРОЕННЫЙ драйвер генерации (настройки любого форка inline_image_gen) ──
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

async function _generateViaBuiltin(post, { prompt, wantChar, isUserPost, onStatus }) {
    const iig = extension_settings.inline_image_gen || {};
    const endpoint = String(iig.endpoint || '').trim().replace(/\/$/, '');
    if (!endpoint || !iig.apiKey || !iig.model) throw new Error('Картинко-API не настроен (endpoint/key/model в настройках картинко-расширения)');

    const st = getSettings();
    const model = st.imageGenModel || iig.model;
    const aspect = st.imageGenSquare !== false ? '1:1' : (iig.aspectRatio || '1:1');

    // Активный стиль форка
    let style = '';
    try {
        const s = (iig.styles || []).find(x => x && x.id === iig.activeStyleId);
        style = String(s?.value ?? s?.style ?? '').trim();
    } catch (e) { /* ignore */ }
    let fullPrompt = style ? `[STYLE: ${style}]\n\n${prompt}` : prompt;

    // Рефы: аватар чара/персоны (по флажкам форка + наш гейт)
    const refs = [];
    try {
        const ctx = SillyTavern.getContext();
        if (wantChar && iig.sendCharAvatar !== false) {
            const ch = ctx?.characters?.[ctx.characterId];
            if (ch?.avatar && ch.avatar !== 'none') {
                const b = await _fetchB64(`/characters/${encodeURIComponent(ch.avatar)}`);
                if (b) refs.push(b);
            }
        }
        if (isUserPost && iig.sendUserAvatar !== false && typeof user_avatar === 'string' && user_avatar) {
            const b = await _fetchB64(`/User Avatars/${encodeURIComponent(user_avatar)}`);
            if (b) refs.push(b);
        }
    } catch (e) { /* без рефов */ }
    if (refs.length > 0) {
        fullPrompt = `[The reference image(s) show the EXACT appearance of the character(s) — copy face, hair, body precisely.]\n\n${fullPrompt}`;
    }

    onStatus?.('Генерация...');
    const isGemini = iig.apiType === 'gemini' || /gemini|banana/i.test(String(model));
    let b64 = null, mime = 'image/png';

    if (isGemini) {
        const pathModel = String(model).includes('/') ? String(model).slice(String(model).indexOf('/') + 1) : String(model);
        const parts = refs.map(r => ({ inlineData: { mimeType: 'image/png', data: r } }));
        parts.push({ text: fullPrompt });
        const resp = await fetch(`${endpoint}/v1beta/models/${encodeURIComponent(pathModel)}:generateContent`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${iig.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } },
            }),
        });
        if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
        const j = await resp.json();
        const ps = j?.candidates?.[0]?.content?.parts || [];
        const img = ps.find(p => p.inlineData?.data);
        if (!img) throw new Error('Gemini не вернул картинку' + (ps.find(p => p.text) ? `: ${ps.find(p => p.text).text.slice(0, 100)}` : ''));
        b64 = img.inlineData.data; mime = img.inlineData.mimeType || 'image/png';
    } else {
        // OpenAI-совместимый путь
        const size = aspect === '1:1' ? '1024x1024' : (iig.size || 'auto');
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
                method: 'POST', headers: { 'Authorization': `Bearer ${iig.apiKey}` }, body: form,
            });
        } else {
            const body = { model, prompt: fullPrompt, n: 1 };
            if (size && size !== 'auto') body.size = size;
            if (!/gpt-image/i.test(String(model))) body.response_format = 'b64_json';
            resp = await fetch(`${endpoint}/v1/images/generations`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${iig.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
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
            ? `- She has $${s.ofWallet} of her own money available (on her personal card). The SOURCE is her secret — characters see only that she can afford things.`
            : '';
    }

    const lines = [];
    // Не заменяем реальные реплики обезличенным «ещё N»: модели полезнее видеть,
    // кто именно и что написал. Ограничиваем только общий объём свежей ветки.
    const fmtThread = (arr) => (arr || []).slice(-8).map(r => `${r.ak === 'user' ? getUserName() : (r.author || 'Account')}: "${String(r.text || '').slice(0, 120)}"`).join(' | ');

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
