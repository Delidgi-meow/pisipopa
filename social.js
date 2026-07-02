// ═══════════════════════════════════════════
// GLASSPHONE SOCIAL — Twitter и Instagram
//
// В отличие от смс (чат = источник правды), лента соцсетей — генерируемый контент.
// Хранится per-chat в chat_metadata.glassphone.social (переживает перезагрузку,
// не утекает между чатами).
//
// Генерация — через generateQuietPrompt ОСНОВНОГО API (модель уже видит весь чат
// и нашу инжекцию, отдельный Connection Profile не нужен — главный фейл MellowPhone).
//
// Синхронизация с РП:
//  • из чата: теги <!--tel:tweet:{...}--> / <!--tel:insta:{...}--> — персонаж
//    «постит» из ролевой, пост появляется в ленте (harvestSocialTags, дедуп по хэшу)
//  • в чат: последние посты юзера идут в инжекцию — персонажи могут реагировать
// ═══════════════════════════════════════════

import { generateRaw } from '../../../../script.js';
import { getMeta, saveMeta, keyOf, scanChat, getSettings } from './state.js';

const MAX_TWEETS = 50;
const MAX_IG_POSTS = 30;
const MAX_COMMENTS = 14;

// ── Хранилище ──
export function getSocial() {
    const m = getMeta();
    if (!m.social || typeof m.social !== 'object') m.social = {};
    const s = m.social;
    if (!Array.isArray(s.tweets)) s.tweets = [];
    if (!Array.isArray(s.igPosts)) s.igPosts = [];
    if (!Array.isArray(s.seenTags)) s.seenTags = [];
    return s;
}
export function getTweets() { return getSocial().tweets; }
export function getIgPosts() { return getSocial().igPosts; }

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
        const text = msg.mes;

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
        id: genId(), author: getUserName(), handle: makeHandle(getUserName()), ak: 'user',
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
        handle: makeHandle(author || getUserName()), ak,
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

// ═══ Генерация через основной API ═══

// ВАЖНО: генерация соцсетей ИЗОЛИРОВАНА от RP-пресета. Раньше шла через
// generateQuietPrompt (полный контекст чата + пресет) — тяжёлые CoT-пресеты
// с префиллом <think> «съедали» задачу и модель отвечала ходом ролевой
// (смс-теги вместо твита). Теперь два пути:
//  1) Выбран профиль подключения → ConnectionManagerRequestService с
//     includePreset:false (плюс поддержка вижна через multimodal content).
//  2) Иначе → generateRaw: ТЕКУЩИЙ API, но без пресета и без истории чата.
// RP-контекст в обоих случаях подмешиваем сами, компактным блоком.

function cleanGenOutput(raw) {
    let t = String(raw || '');
    t = t.replace(/<(think|thinking|reasoning|analysis)[^>]*>[\s\S]*?<\/\1>/gi, '');
    t = t.replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*/gi, (m) => {
        // незакрытый think без ответа после — выкидываем целиком
        const close = m.match(/<\/(think|thinking|reasoning)>/i);
        return close ? m.slice(m.indexOf(close[0]) + close[0].length) : '';
    });
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

async function socialGen(prompt, { maxTokens = 1024, image = null } = {}) {
    const st = getSettings();
    const profileId = st.socialProfileId;

    // Путь 1: отдельный профиль подключения (изоляция + вижн)
    if (profileId) {
        const ctx = SillyTavern.getContext();
        const svc = ctx?.ConnectionManagerRequestService;
        if (svc && typeof svc.sendRequest === 'function') {
            const content = image
                ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }]
                : prompt;
            const res = await svc.sendRequest(profileId, [{ role: 'user', content }], maxTokens, {
                stream: false, extractData: true, includePreset: false, includeInstruct: false,
            });
            return cleanGenOutput(res?.content ?? '');
        }
        console.warn('[GlassPhone] ConnectionManagerRequestService недоступен — fallback на generateRaw');
    }

    // Путь 2: текущий API, «сырая» генерация — без пресета и истории чата.
    // (generateRaw не умеет картинки — для вижна выбери профиль в настройках.)
    const res = await generateRaw({ prompt, responseLength: maxTokens });
    return cleanGenOutput(res);
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
        for (const c of contacts.values()) lines.push(`- ${c.name}`);
    } catch (e) { /* ignore */ }
    return lines.length ? `Known characters (contacts in ${getUserName()}'s phone):\n${lines.join('\n')}` : '(no known contacts yet)';
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

    const raw = (await socialGen(prompt, { maxTokens: 256, image: (kind === 'ig' && item.image) ? item.image : null })).trim()
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
    // Вижн: картинка прикладывается к запросу ТОЛЬКО в пути через профиль подключения
    // (multimodal content). В raw-пути описание — единственный источник.
    const visionActive = !!post.image && !!getSettings().socialProfileId;
    const photoLine = visionActive
        ? `The actual photo is ATTACHED to this request — LOOK at it and react to what you actually see.${post.imgDesc ? ` (fallback description if you cannot see images: ${post.imgDesc})` : ''}`
        : `Photo (description): ${post.imgDesc || (post.image ? 'her photo, no text description available' : '(no description)')}`;
    const existing = (post.comments || []).map(c => `${c.author}: ${c.text}`).join('\n');
    const prompt = `${await taskHeader('generate comments under an Instagram post.')}
Post by ${post.author}. ${photoLine}
Caption: "${post.caption || '(none)'}"
${existing ? `Existing comments (do not repeat):\n${existing}\n` : ''}
${contactsBlock()}

Generate 4-7 comments: known characters in-character (reacting to the photo/caption — especially if the post is by ${getUserName()}) + random accounts. Instagram tone: compliments, questions, jokes. NO emojis at all. Max 200 chars each.
${JSON_RULES}
Format: [{"author":"Имя","text":"...","type":"contact|random"},...]`;

    const parsed = parseJsonArray(await socialGen(prompt, { maxTokens: 1536, image: post.image || null }));
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
export function getContactAvatar(key) {
    const m = getMeta();
    return (m.avatars && m.avatars[key]) || '';
}
// Аватар по имени автора (для лент)
export function avatarForAuthor(ak) {
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

    const parts = [];
    if (post.imgDesc) parts.push(post.imgDesc);
    if (post.caption) parts.push(`vibe of the caption: "${post.caption}"`);
    if (parts.length === 0) parts.push(`casual instagram photo posted by ${post.author}`);
    // Для «чужих» постов явно говорим модели, что это посторонний аккаунт
    if (!isUserPost && !isCharPost) {
        parts.push('random social media account content — do NOT depict the main story characters');
    }
    const prompt = `Instagram photo, phone camera aesthetic, realistic. ${parts.join('. ')}`;

    const saved = nvSettings ? {
        sendCharAvatar: nvSettings.sendCharAvatar,
        sendUserAvatar: nvSettings.sendUserAvatar,
        imageContextEnabled: nvSettings.imageContextEnabled,
    } : null;
    if (nvSettings) {
        nvSettings.sendCharAvatar = !!(isCharPost && saved.sendCharAvatar);
        nvSettings.sendUserAvatar = !!(isUserPost && saved.sendUserAvatar);
        nvSettings.imageContextEnabled = false; // контекст последних сообщений тут ни к чему
    }

    try {
        // style = null → возьмётся дефолтный стиль из настроек novarakk
        const dataUrl = await nv.pipeline.generateImageWithRetry(prompt, null, onStatus, {});
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

// ═══ Активность юзера для инжекции в основной чат ═══
export function getSocialActivitySummary() {
    const s = getSocial();
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

    return lines.join('\n');
}
