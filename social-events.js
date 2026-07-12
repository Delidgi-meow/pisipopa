// Audience, posting tasks and story-event state (charms replaced by auto-achievements).
// Numeric outcomes are deterministic and never delegated to the model.

import { getMeta, saveMeta, extractTemporalContext } from './state.js';
import { addTransaction } from './bank.js';

const PLATFORM = {
    twitter: { reach: 0.85, growth: 1.25, base: [60, 20, 20] },
    instagram: { reach: 0.62, growth: 1.0, base: [72, 18, 10] },
};

const TASK_POOL = [
    { type: 'post', platform: 'twitter', goal: 1, title: 'Сказать вслух', text: 'Опубликовать твит', set: 'twitter' },
    { type: 'post', platform: 'instagram', goal: 1, title: 'Новый кадр', text: 'Опубликовать фото в Instagram', set: 'photo' },
    { type: 'positive', goal: 1, threshold: 65, title: 'Тёплая волна', text: 'Получить не менее 65% позитивных реакций', set: 'positive' },
    { type: 'comments', goal: 5, title: 'Разговор начался', text: 'Получить 5 реакций под одним постом', set: 'positive' },
    { type: 'followers', goal: 10, title: 'Новые лица', text: 'Набрать суммарно 10 подписчиков', set: 'twitter' },
    { type: 'debate', goal: 1, title: 'Искра спора', text: 'Вызвать споры без негативной волны', set: 'twitter' },
    { type: 'crosspost', goal: 2, title: 'На двух экранах', text: 'Опубликоваться в обеих соцсетях', set: 'photo' },
];

function id(prefix = 'se') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function hashUnit(seed) {
    let h = 2166136261;
    for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

function normalizeShares(values, fallback) {
    const raw = values.map(v => Math.max(0, Number(v) || 0));
    const total = raw.reduce((a, b) => a + b, 0);
    if (!total) return [...fallback];
    const out = raw.map(v => Math.round(v * 100 / total));
    out[0] += 100 - out.reduce((a, b) => a + b, 0);
    return out;
}

export function ensureSocialSystems(social = null) {
    const root = social || (() => {
        const m = getMeta();
        if (!m.social || typeof m.social !== 'object') m.social = {};
        return m.social;
    })();
    if (!root.socialProfiles || typeof root.socialProfiles !== 'object') root.socialProfiles = {};
    for (const [platform, initial] of [['twitter', 120], ['instagram', 80]]) {
        const p = root.socialProfiles[platform] || (root.socialProfiles[platform] = {});
        if (!Number.isFinite(p.followers)) p.followers = initial;
        if (!Number.isFinite(p.reputation)) p.reputation = 50;
        if (!Number.isFinite(p.momentum)) p.momentum = 0;
        if (!Number.isFinite(p.totalPosts)) p.totalPosts = 0;
    }
    if (!root.postingTasks || typeof root.postingTasks !== 'object') root.postingTasks = {};
    if (!Array.isArray(root.postingTasks.active)) root.postingTasks.active = [];
    if (!Array.isArray(root.postingTasks.completed)) root.postingTasks.completed = [];
    if (!root.postingTasks.setProgress || typeof root.postingTasks.setProgress !== 'object') root.postingTasks.setProgress = {};
    if (!root.storyEvents || typeof root.storyEvents !== 'object') root.storyEvents = {};
    if (!Array.isArray(root.storyEvents.recent)) root.storyEvents.recent = [];
    if (!Number.isFinite(root.storyEvents.cooldownPosts)) root.storyEvents.cooldownPosts = 0;
    if (!Array.isArray(root.rpConsequences)) root.rpConsequences = [];
    if (!root.advertising || typeof root.advertising !== 'object') root.advertising = {};
    if (!Array.isArray(root.advertising.offers)) root.advertising.offers = [];
    if (!Array.isArray(root.advertising.history)) root.advertising.history = [];
    if (!('active' in root.advertising)) root.advertising.active = null;
    // Шармы-подарки заменены авто-ачивками (achievements.js); старое поле
    // charms в метаданных чатов просто игнорируется.
    ensureTasks(root);
    ensureAdOffers(root);
    return root;
}

function reputationTier(value) {
    const n = Number(value) || 0;
    if (n >= 82) return 'любимец аудитории';
    if (n >= 65) return 'хорошая репутация';
    if (n >= 45) return 'нейтральная репутация';
    if (n >= 25) return 'спорная репутация';
    return 'плохая репутация';
}

export function getReputationStatus(value) { return reputationTier(value); }

function ensureAdOffers(root) {
    // Предложения больше не собираются из циклического локального пула.
    // Их по явной кнопке создаёт модель в social.js с учётом сеттинга и контекста.
    if (!Array.isArray(root.advertising.offers)) root.advertising.offers = [];
}

export function replaceAdOffers(generated) {
    const root = ensureSocialSystems();
    if (root.advertising.active) return [];
    const followers = Math.max(root.socialProfiles.twitter.followers, root.socialProfiles.instagram.followers);
    const offers = (Array.isArray(generated) ? generated : []).slice(0, 3).map((raw, index) => {
        const risk = ['safe', 'mixed', 'controversial'].includes(raw?.risk) ? raw.risk : 'safe';
        const riskMul = risk === 'controversial' ? 2.1 : risk === 'mixed' ? 1.4 : 1;
        const suggested = Number(raw?.payment);
        const baseline = (220 + Math.sqrt(Math.max(1, followers)) * 45) * riskMul;
        const payment = Math.max(250, Math.round((Number.isFinite(suggested) ? suggested : baseline) / 50) * 50);
        const brand = String(raw?.brand || `Бренд ${index + 1}`).slice(0, 80);
        return {
            id: id('ad'), brand,
            product: String(raw?.product || 'рекламная интеграция').slice(0, 160),
            brief: String(raw?.brief || 'Создать органичную рекламную публикацию.').slice(0, 400),
            risk, platform: raw?.platform === 'instagram' ? 'instagram' : 'twitter', payment,
            title: String(raw?.title || `${brand}: рекламная интеграция`).slice(0, 120), createdAt: Date.now(),
        };
    });
    root.advertising.offers = offers;
    saveMeta();
    return offers;
}

export function acceptAdOffer(offerId) {
    const root = ensureSocialSystems();
    const offer = root.advertising.offers.find(x => x.id === offerId);
    if (!offer || root.advertising.active) return null;
    root.advertising.active = { ...offer, acceptedAt: Date.now(), state: 'accepted' };
    root.advertising.offers = root.advertising.offers.filter(x => x.id !== offerId);
    saveMeta();
    return root.advertising.active;
}

export function declineAdOffer(offerId) {
    const root = ensureSocialSystems();
    const offer = root.advertising.offers.find(x => x.id === offerId);
    if (!offer) return false;
    root.advertising.offers = root.advertising.offers.filter(x => x.id !== offerId);
    root.advertising.history.unshift({ ...offer, state: 'declined', finishedAt: Date.now() });
    saveMeta(); return true;
}

export function attachActiveAd(platform, post) {
    const root = ensureSocialSystems();
    const ad = root.advertising.active;
    if (!ad || ad.platform !== platform || !post || post.ak !== 'user') return null;
    post.advertisement = { id: ad.id, brand: ad.brand, product: ad.product, brief: ad.brief, risk: ad.risk, payment: ad.payment };
    ad.postId = post.id; ad.state = 'published'; ad.publishedAt = Date.now();
    saveMeta(); return post.advertisement;
}

function settleAdvertisement(root, post) {
    const ad = root.advertising.active;
    // postId мог не сохраниться в старых версиях/при прерванной генерации,
    // хотя рекламная метка на самом посте уже есть. Сопоставляем также по id
    // предложения, чтобы опубликованная интеграция не зависала без оплаты.
    const postAdId = post?.advertisement?.id;
    const matchesPost = ad && (ad.postId === post.id || (postAdId && postAdId === ad.id));
    if (!matchesPost || ad.state === 'paid' || !post?.performance?.settled) return null;
    if (!ad.postId) ad.postId = post.id;
    const perf = post.performance;
    const penalty = ad.risk === 'controversial' && perf.negative >= 35 ? 0.8 : 1;
    const bonus = perf.positive >= 65 ? 1.15 : 1;
    const paid = Math.max(1, Math.round(ad.payment * penalty * bonus));
    addTransaction({ amount: paid, label: `Реклама ${ad.brand}`, category: 'реклама', silent: true });
    ad.state = 'paid'; ad.paid = paid; ad.finishedAt = Date.now();
    post.performance.adPayment = paid;
    root.advertising.history.unshift({ ...ad });
    root.advertising.history = root.advertising.history.slice(0, 30);
    root.advertising.active = null;
    return paid;
}

function ensureTasks(root) {
    const tasks = root.postingTasks;
    while (tasks.active.length < 3) {
        const used = new Set(tasks.active.map(t => t.type));
        const choices = TASK_POOL.filter(t => !used.has(t.type));
        const template = choices[(tasks.completed.length + tasks.active.length * 3) % choices.length];
        tasks.active.push({ ...template, id: id('task'), progress: 0, platforms: [] });
    }
}

function classifyComment(c) {
    const explicit = String(c?.sentiment || '').toLowerCase();
    if (['positive', 'neutral', 'negative'].includes(explicit)) return explicit;
    const t = String(c?.text || '').toLowerCase();
    if (/(ненавиж|ужас|кринж|отпис|стыд|дура|идиот|hate|awful|terrible|cringe)/i.test(t)) return 'negative';
    if (/(люблю|класс|красив|прекрас|поддерж|супер|спасибо|love|great|beautiful|amazing)/i.test(t)) return 'positive';
    return 'neutral';
}

function taskBoost(root, platform) {
    return root.postingTasks.active.some(t => t.platform === platform || t.type === 'followers' || t.type === 'positive') ? 1.15 : 1;
}

export function settlePost(platform, post, options = {}) {
    if (!post || post.ak !== 'user') return null;
    const root = ensureSocialSystems();
    // Повторный вызов нужен не только как no-op: он восстанавливает оплату
    // рекламного поста, если подсчёт результата успел сохраниться, а выплата — нет.
    if (post.performance?.settled) {
        const paid = settleAdvertisement(root, post);
        if (paid !== null) saveMeta();
        return post.performance;
    }
    const cfg = PLATFORM[platform];
    if (!cfg) return null;
    const profile = root.socialProfiles[platform];
    const comments = platform === 'twitter' ? (post.replies || []) : (post.comments || []);
    const counts = { positive: 0, neutral: 0, negative: 0 };
    comments.filter(c => c.ak !== 'user').forEach(c => counts[classifyComment(c)]++);
    const visibleTotal = counts.positive + counts.neutral + counts.negative;
    const aiTone = options.tone || post.contentTone || {};
    const toneShares = normalizeShares([
        counts.positive + clamp(aiTone.positive, 0, 2),
        counts.neutral + clamp(aiTone.neutral, 0, 2),
        counts.negative + clamp(aiTone.negative, 0, 2),
    ], cfg.base);
    const priorWeight = visibleTotal ? Math.min(0.45, visibleTotal * 0.06) : 0;
    const shares = normalizeShares(cfg.base.map((v, i) => v * (1 - priorWeight) + toneShares[i] * priorWeight), cfg.base);
    const [positive, neutral, negative] = shares;
    const quality = clamp(options.quality ?? post.contentQuality ?? 1, 0.75, 1.25);
    const viral = !!options.viral;
    const random = 0.85 + hashUnit(`${post.id}:reach`) * 0.30;
    const baseReach = Math.max(30, profile.followers * cfg.reach);
    let reach = Math.round(baseReach * quality * (1 + profile.momentum * 0.025) * taskBoost(root, platform) * random);
    reach = Math.min(reach, profile.followers * (viral ? 8 : 4) + (viral ? 500 : 200));
    const interest = positive / 100 + 0.35 * neutral / 100 + 0.20 * negative / 100;
    let growth = Math.round(Math.sqrt(reach) * cfg.growth * (interest - 0.42) * (viral ? 1.65 : 1));
    if (negative < 45 || profile.totalPosts < 3) growth = Math.max(0, growth);
    const gainCap = Math.max(15, Math.round(profile.followers * 0.05)) * (viral ? 2 : 1);
    const lossCap = Math.max(3, Math.round(profile.followers * 0.01)) * (viral ? 2 : 1);
    growth = clamp(growth, -lossCap, gainCap);
    const label = negative >= 45 ? 'Негативная волна' : negative >= 28 ? 'Споры' : positive >= 65 ? 'Тёплый приём' : 'Смешанная реакция';
    post.performance = {
        settled: true, settledAt: Date.now(), label, positive, neutral, negative,
        reach, followerDelta: growth, followersBefore: profile.followers,
        followersAfter: Math.max(0, profile.followers + growth), viral,
    };
    profile.followers = post.performance.followersAfter;
    profile.totalPosts += 1;
    profile.reputation = clamp(profile.reputation + Math.round((positive - negative - 35) / 12), 0, 100);
    profile.momentum = clamp(Math.round((profile.momentum * 0.55) + (viral ? 5 : (positive - negative - 35) / 14)), -10, 10);
    const text = platform === 'twitter' ? post.text : `${post.caption || ''} ${post.imgDesc || ''}`;
    post.temporalContext = extractTemporalContext(text);
    const taskResult = advanceTasks(root, platform, post, comments.length);
    post.performance.completedTasks = taskResult.completed.map(t => t.title);
    settleAdvertisement(root, post);
    if (root.storyEvents.cooldownPosts > 0) root.storyEvents.cooldownPosts--;
    saveMeta();
    return post.performance;
}

function advanceTasks(root, platform, post, commentCount) {
    const completed = [];
    for (const task of root.postingTasks.active) {
        if (completed.length >= 2) break;
        const perf = post.performance;
        if (task.type === 'post' && task.platform === platform) task.progress++;
        else if (task.type === 'positive' && perf.positive >= task.threshold) task.progress++;
        else if (task.type === 'comments') task.progress = Math.max(task.progress, commentCount);
        else if (task.type === 'followers') task.progress += Math.max(0, perf.followerDelta);
        else if (task.type === 'debate' && perf.label === 'Споры') task.progress++;
        else if (task.type === 'crosspost') {
            if (!task.platforms.includes(platform)) task.platforms.push(platform);
            task.progress = task.platforms.length;
        }
        task.progress = Math.min(task.goal, task.progress);
        if (task.progress >= task.goal) completed.push(task);
    }
    for (const task of completed) {
        root.postingTasks.completed.push({ ...task, completedAt: Date.now() });
        root.postingTasks.active = root.postingTasks.active.filter(t => t.id !== task.id);
        root.postingTasks.setProgress[task.set] = (root.postingTasks.setProgress[task.set] || 0) + 1;
    }
    ensureTasks(root);
    return { completed };
}

export function eventChance(post) {
    const root = ensureSocialSystems();
    if (root.storyEvents.active || root.storyEvents.cooldownPosts > 0 || !post?.performance?.settled) return 0;
    const known = [...(post.replies || []), ...(post.comments || [])].some(c => String(c.ak || '').startsWith('contact:'));
    return post.performance.viral || ['Споры', 'Негативная волна'].includes(post.performance.label) ? 0.55 : known ? 0.35 : 0.20;
}

export function shouldOfferEvent(post) {
    const chance = eventChance(post);
    return chance > 0 && hashUnit(`${post.id}:story-event`) < chance;
}

export function validateAndOfferEvent(candidate, post = null, platform = 'phone') {
    const root = ensureSocialSystems();
    if (!candidate || root.storyEvents.active) return null;
    const rawCandidates = Array.isArray(candidate.events) ? candidate.events.slice(0, 3) : [candidate];
    const normalize = raw => {
        const choices = Array.isArray(raw?.choices) ? raw.choices.slice(0, 3) : [];
        const canonEvidence = Array.isArray(raw?.canon_evidence)
            ? raw.canon_evidence
            : (String(raw?.canon_evidence || '').trim() ? [raw.canon_evidence] : []);
        const intents = new Set(choices.map(c => c.intent));
        if (!raw?.title || !raw?.hook || !raw?.premise || !canonEvidence.length || choices.length !== 3) return null;
        if (intents.size < 3 || choices.some(c => !c.label || !c.text)) return null;
        return {
            title: String(raw.title).slice(0, 90), hook: String(raw.hook).slice(0, 500),
            premise: String(raw.premise).slice(0, 700), openingMessage: String(raw.opening_message || '').slice(0, 500),
            involvedActors: (Array.isArray(raw.involved_actors) ? raw.involved_actors : []).map(String).slice(0, 5),
            visibility: ['public', 'followers', 'known_characters'].includes(raw.visibility) ? raw.visibility : 'followers',
            stakes: String(raw.stakes || 'social'), urgency: ['soft', 'next_scene', 'immediate'].includes(raw.urgency) ? raw.urgency : 'soft',
            canonEvidence: canonEvidence.map(String).filter(Boolean).slice(0, 5),
            choices: choices.map((c, i) => ({ id: String(c.id || i), label: String(c.label), intent: String(c.intent), text: String(c.text) })),
        };
    };
    const alternatives = rawCandidates.map(normalize).filter(Boolean);
    if (!alternatives.length) return null;
    const first = alternatives[0];
    const event = {
        id: id('event'), state: 'offered', sourcePostId: post?.id || null, sourcePlatform: platform,
        ...first, alternatives, selectedAlternative: alternatives.length === 1 ? 0 : null,
        decisions: [], createdAt: Date.now(), recap: '',
    };
    root.storyEvents.active = event;
    if (post?.performance) post.performance.storyEventId = event.id;
    saveMeta();
    return event;
}

export function selectStoryEvent(index) {
    const root = ensureSocialSystems();
    const event = root.storyEvents.active;
    const alternatives = event?.alternatives;
    const i = Number(index);
    if (!event || !Array.isArray(alternatives) || !alternatives[i] || event.appliedAt) return false;
    Object.assign(event, alternatives[i]);
    event.selectedAlternative = i;
    event.state = 'offered';
    saveMeta();
    return true;
}

export function deferEvent() {
    const e = ensureSocialSystems().storyEvents.active;
    if (!e) return false;
    e.deferred = true; saveMeta(); return true;
}

export function declineEvent() {
    const root = ensureSocialSystems();
    const e = root.storyEvents.active;
    if (!e) return false;
    e.state = 'declined'; e.finishedAt = Date.now();
    root.storyEvents.recent.unshift(e); root.storyEvents.recent = root.storyEvents.recent.slice(0, 8);
    root.storyEvents.active = null; root.storyEvents.cooldownPosts = 2;
    saveMeta(); return true;
}

export function applyEventResolution(choice, classification, result) {
    const root = ensureSocialSystems();
    const e = root.storyEvents.active;
    if (!e || e.appliedAt) return null;
    const cleanChoice = { text: String(choice?.text || '').slice(0, 1000), label: String(choice?.label || 'Свой ответ'), intent: String(classification?.intent || choice?.intent || 'custom'), tone: String(classification?.tone || 'calm'), publicness: String(classification?.publicness || 'private') };
    const consequence = result?.rp_consequence?.summary ? {
        id: id('consequence'), source: 'story_event', visibility: e.visibility,
        actors: (result.rp_consequence.actors || e.involvedActors).map(String).slice(0, 5),
        summary: String(result.rp_consequence.summary).slice(0, 700),
        urgency: ['soft', 'next_scene', 'immediate'].includes(result.rp_consequence.urgency) ? result.rp_consequence.urgency : e.urgency,
        status: 'pending', createdAt: Date.now(), eventId: e.id,
    } : null;
    e.decisions.push(cleanChoice); e.appliedAt = Date.now();
    e.immediateResult = String(result?.immediate_result || 'Решение принято. Последствия ещё разворачиваются.').slice(0, 900);
    e.botReactions = (result?.bot_reactions || []).slice(0, 3).map(r => ({ author: String(r.author || ''), channel: String(r.channel || 'comment'), text: String(r.text || '').slice(0, 300), sentiment: String(r.sentiment || 'neutral') }));
    e.audienceShift = {
        positive: Number(result?.audience_shift?.positive) || 0,
        neutral: Number(result?.audience_shift?.neutral) || 0,
        negative: Number(result?.audience_shift?.negative) || 0,
    };
    e.followerModifier = Number(result?.follower_modifier) || 1;
    e.relationshipSignals = (result?.relationship_signals || []).slice(0, 5).map(r => ({
        actor: String(r?.actor || '').slice(0, 120),
        direction: String(r?.direction || 'complicated').slice(0, 40),
        reason: String(r?.reason || '').slice(0, 700),
    })).filter(r => r.actor || r.reason);
    e.rpConsequence = consequence ? { summary: consequence.summary, urgency: consequence.urgency, actors: [...consequence.actors] } : null;
    e.nextHook = String(result?.next_hook || '').slice(0, 900);
    e.recap = `${e.hook} Пользователь: ${cleanChoice.text}. Результат: ${e.immediateResult}`.slice(0, 1200);
    e.state = ['resolved', 'failed'].includes(result?.arc_state) ? result.arc_state : consequence ? 'waiting_rp' : 'active';
    if (consequence) { root.rpConsequences.push(consequence); e.pendingConsequenceId = consequence.id; }
    if (['resolved', 'failed'].includes(e.state)) finishEvent(root, e);
    saveMeta();
    return { event: e, consequence, choice: cleanChoice };
}

function finishEvent(root, e) {
    root.storyEvents.recent.unshift(e); root.storyEvents.recent = root.storyEvents.recent.slice(0, 8);
    root.storyEvents.active = null; root.storyEvents.cooldownPosts = 3;
}

export function markConsequenceIntroduced(consequenceId) {
    const root = ensureSocialSystems();
    const c = root.rpConsequences.find(x => x.id === consequenceId);
    if (!c) return false;
    c.status = 'introduced'; c.introducedAt = Date.now();
    const e = root.storyEvents.active;
    if (e?.pendingConsequenceId === c.id) { e.state = 'ready_next'; e.pendingConsequenceId = null; }
    saveMeta(); return true;
}

export function pendingConsequences() {
    return ensureSocialSystems().rpConsequences.filter(c => c.status === 'pending').slice(-3);
}

export function getSystemsView() {
    return ensureSocialSystems();
}