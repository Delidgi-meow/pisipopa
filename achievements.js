import { getMeta, saveMeta, scanChat } from './state.js';
import { generateAchievementsLLM } from './social.js';

function getAch() {
    const m = getMeta();
    if (!m.ach || typeof m.ach !== 'object') m.ach = {};
    if (!Array.isArray(m.ach.list)) m.ach.list = [];
    if (typeof m.ach.sig !== 'string') m.ach.sig = '';
    if (!Number.isFinite(m.ach.lastGenAt)) m.ach.lastGenAt = 0;
    return m.ach;
}

export function getAchievements() { return getAch().list; }
export function achievementsCount() { return getAch().list.length; }

const ICON_RE = /^fa-[a-z0-9-]+$/;
const bucket = (n, size) => Math.floor((Number(n) || 0) / size);

function activityDigest() {
    const m = getMeta();
    let threads = new Map();
    try { ({ threads } = scanChat()); } catch (e) { /* ignore */ }
    let smsOut = 0, smsIn = 0, photoSms = 0;
    for (const t of threads.values()) {
        for (const msg of t.messages) {
            if (msg.dir === 'out') { smsOut++; if (msg.img) photoSms++; }
            else smsIn++;
        }
    }
    const s = (m.social && typeof m.social === 'object') ? m.social : {};
    const b = (m.bank && typeof m.bank === 'object') ? m.bank : {};
    const sh = (m.shop && typeof m.shop === 'object') ? m.shop : {};
    const userTweets = (s.tweets || []).filter(t => t.ak === 'user');
    const userIg = (s.igPosts || []).filter(p => p.ak === 'user');
    const userOf = (s.ofPosts || []).filter(p => p.ak === 'user');
    const perf = [...userTweets, ...userIg].map(p => p.performance).filter(Boolean);
    const followers = Math.max(s.socialProfiles?.twitter?.followers || 0, s.socialProfiles?.instagram?.followers || 0);
    const viral = perf.filter(p => p.viral).length;
    const backlash = perf.filter(p => p.negative >= 45).length;
    const eventsDone = (s.storyEvents?.recent || []).length;
    const adsPaid = (s.advertising?.history || []).filter(a => a.state === 'paid').length;
    const orders = (sh.orders || []);
    const loans = (b.loans || []);
    const stats = {
        smsOut, smsIn, photoSms,
        groups: (m.groups || []).length,
        banned: (m.banned || []).length,
        tweets: userTweets.length, igPosts: userIg.length, ofPosts: userOf.length,
        followers, viral, backlash, eventsDone, adsPaid,
        tasksDone: (s.postingTasks?.completed || []).length,
        ofMoney: (s.ofEarned || 0) + (s.ofWallet || 0),
        balance: b.balance || 0,
        txCount: (b.transactions || []).length,
        loans: loans.length, loansPaid: loans.filter(l => l.paidOff).length,
        orders: orders.length,
        orderCats: [...new Set(orders.map(o => o.cat))].join(','),
        customShops: (sh.customCats || []).length,
    };
    const sig = [
        bucket(stats.smsOut + stats.smsIn, 20), stats.photoSms > 0 ? 1 : 0, stats.groups, stats.banned,
        stats.tweets, stats.igPosts, stats.ofPosts, bucket(stats.followers, 100),
        stats.viral, stats.backlash, stats.eventsDone, stats.adsPaid, bucket(stats.tasksDone, 2),
        bucket(stats.ofMoney, 500), stats.balance < 0 ? 1 : 0, bucket(stats.balance, 50000),
        bucket(stats.txCount, 15), stats.loans, stats.loansPaid, stats.orders, stats.orderCats, stats.customShops,
    ].join('|');
    const lines = `SMS sent ${stats.smsOut}, received ${stats.smsIn}, photo-MMS ${stats.photoSms}; group chats ${stats.groups}; blocked accounts ${stats.banned}.
Tweets posted ${stats.tweets}; Instagram posts ${stats.igPosts}; OnlyFans posts ${stats.ofPosts}; max followers ${stats.followers}; viral posts ${stats.viral}; backlash survived ${stats.backlash}; posting tasks done ${stats.tasksDone}; story events finished ${stats.eventsDone}; paid ad integrations ${stats.adsPaid}; OnlyFans money earned ${stats.ofMoney}.
Bank: balance ${stats.balance}, transactions ${stats.txCount}, loans taken ${stats.loans} (paid off ${stats.loansPaid}).
Shop: orders ${stats.orders}${stats.orderCats ? ` (categories: ${stats.orderCats})` : ''}, custom shop categories created ${stats.customShops}.`;
    return { sig, lines };
}

let _inflight = false;
export async function maybeGenerateAchievements({ force = false } = {}) {
    const a = getAch();
    if (_inflight) return [];
    let digest;
    try { digest = activityDigest(); } catch (e) { return []; }
    if (!force) {
        if (digest.sig === a.sig) return [];
        if (Date.now() - a.lastGenAt < 5 * 60 * 1000) return [];
    }
    _inflight = true;
    try {
        const fresh = await generateAchievementsLLM(digest.lines, a.list.map(x => x.name));
        a.sig = digest.sig;
        a.lastGenAt = Date.now();
        const added = [];
        for (const it of (Array.isArray(fresh) ? fresh : [])) {
            if (!it || !it.name) continue;
            const name = String(it.name).trim().slice(0, 40);
            if (!name || a.list.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
            const def = {
                id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                name,
                desc: String(it.desc || '').trim().slice(0, 90),
                icon: ICON_RE.test(String(it.icon || '')) ? it.icon : 'fa-trophy',
                at: Date.now(),
            };
            a.list.push(def);
            added.push(def);
            if (added.length >= 3) break;
        }
        saveMeta(); 
        return added;
    } catch (e) {
        return [];
    } finally {
        _inflight = false;
    }
}

export function deleteAchievement(id) {
    const a = getAch();
    a.list = a.list.filter(x => x.id !== id);
    saveMeta();
}
