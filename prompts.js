
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { getSettings, getMeta, scanChat, getBlockedSmsKeys, keyOf, EXT_NAME } from './state.js';
import { getSocialActivitySummary } from './social.js';
import { getBankSummaryLine, bankInjectRule } from './bank.js';
import { notesInjectBlock } from './notes.js';
import { pendingConsequences } from './social-events.js';

const CHAT_KEY = EXT_NAME;
const SYS_KEY = EXT_NAME + '_sys';

// Телефонный ход: последнее сообщение юзера — смс/голосовое из телефона.
// Полные правила «phone-only mode» (самый жирный блок директивы) нужны ТОЛЬКО
// в этот момент; в обычном ходе они балласт. 'now' — отвечать тегами,
// 'justEnded' — прошлый ход был смс, надо вплести переписку в сцену.
function phoneTurnState() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        const isPhoneMsg = (m) => !!m && m.is_user
            && /<!--\s*tel:out|\[(?:СМС|SMS|Голосовое|Voice)\s*(?:→|в\s+чат|to\s+chat)/i.test(String(m.mes || ''));
        for (let i = chat.length - 1, seen = 0; i >= 0 && seen < 3; i--) {
            const m = chat[i];
            if (!m || !m.mes || m.is_system) continue;
            if (m.is_user) {
                if (!isPhoneMsg(m)) return null;      // обычная проза — правила режима не нужны
                return seen === 0 ? 'now' : 'justEnded';
            }
            seen++;
        }
    } catch (e) { /* ignore */ }
    return null;
}

// Соцсети/группы подаются только когда реально используются
function socialActive() {
    try {
        const s = getMeta().social;
        return !!(s && ((s.tweets || []).length || (s.igPosts || []).length || (s.ofPosts || []).length));
    } catch (e) { return false; }
}

function buildPrompt() {
    const { contacts, threads } = scanChat();
    const meta = getMeta();
    let consequenceBlock = '';
    // Последствия — часть систем: выключены, значит и в промпт не идут.
    // Сводка активности остаётся: посты она пишет и без них, а персонажам
    // полезно знать, что она выкладывала.
    try {
        const pending = getSettings().socialSystems === false ? [] : pendingConsequences();
        if (pending.length) {
            consequenceBlock = `[PENDING STORY CONSEQUENCES FROM THE PHONE — established facts, not suggestions]\n${pending.map(c => `- (${c.urgency}; visibility: ${c.visibility}) ${c.summary}${c.actors?.length ? ` Actors: ${c.actors.join(', ')}.` : ''}`).join('\n')}\nIntroduce each naturally only when compatible with location, timing and who can know it. Do not retcon, repeat the phone exchange, force {{user}}'s actions, or reveal private knowledge. Once it appears clearly in the scene, do not keep restating it.`;
        }
    } catch (e) { /* ignore */ }

    const contactLines = [];
    for (const c of contacts.values()) {
        contactLines.push(`- ${c.name}${c.number ? ` (${c.number})` : ''}`);
    }
    let contactsBlock = contactLines.length > 0
        ? `Contacts already in {{user}}'s phone (these characters HAVE {{user}}'s number, and {{user}} has theirs):\n${contactLines.join('\n')}`
        : `{{user}}'s phone has NO contacts yet — nobody exchanged numbers so far.`;

    const blockedKeys = new Set(getBlockedSmsKeys());
    const blockedNames = [...contacts.values()].filter(c => blockedKeys.has(String(c.name || '').trim().toLowerCase())).map(c => c.name);
    if (blockedNames.length > 0) {
        contactsBlock += `\nBLOCKED on {{user}}'s phone: ${blockedNames.join(', ')}. These characters CANNOT send SMS/tel:sms to {{user}} until unblocked; never output an incoming SMS tag from them.`;
    }

    // Групповые смс-чаты: ручные (meta.groups) + заведённые самой моделью через
    // тег "chat" — такие живут ТОЛЬКО в тредах. Без них правило про группы
    // пропадало, и модель переставала писать в уже существующий групповой чат.
    const groupMap = new Map();
    for (const g of (Array.isArray(meta.groups) ? meta.groups : [])) {
        if (!g || !g.name) continue;
        groupMap.set(`group:${keyOf(g.name)}`, { name: g.name, members: Array.isArray(g.members) ? g.members : [] });
    }
    try {
        for (const [k, t] of threads) {
            if (!String(k).startsWith('group:') || groupMap.has(k)) continue;
            const members = [...new Set((t.messages || []).map(m => m.from).filter(Boolean))];
            groupMap.set(k, { name: t.name || String(k).slice(6), members });
        }
    } catch (e) { /* ignore */ }
    if (groupMap.size > 0) {
        const groupLines = [...groupMap.values()].map(g => `- Group chat «${g.name}»: members ${g.members.join(', ') || '?'} + {{user}}`);
        contactsBlock += `\nGroup chats on {{user}}'s phone:\n${groupLines.join('\n')}`;
    }

    // ── Компактный режим: те же правила, ~40% токенов ──
    if (getSettings().compactRules) {
        let c = `<phone_directive>\n[OOC — hidden phone/SMS channel. Never mention it in-story.]\n{{user}} has a smartphone. ${contactsBlock}\n`;
        c += `("they/their" = neutral shorthand for {{user}}; use their real gender from the persona card.)
`;
        c += `RULES (tags = HTML comments at the very END of the reply, copied VERBATIM, EN keys / RU values, invisible to reader):\n`;
        // Метка времени нужна и в компактном режиме: без неё телефон считает
        // ход за фиксированные минуты, и события приходят не тогда, когда должны
        if (getSettings().timeTag !== false) {
            c += `0. End EVERY reply with the in-world clock as the last line: <!--tel:time:HH:MM DD.MM.YYYY--> (advance it by how much time this reply took).\n`;
        }
        c += `1. Character gives {{user}} their number → <!--tel:contact:{"name":"X","number":"phone in the local format"}-->\n`;
        c += `2. Character texts {{user}}'s phone → one tag per message: <!--tel:sms:{"from":"X","text":"..."}--> (MMS: +"photo":"desc"; group chat: +"chat":"Name"; voice message: +"voice":true, "text" = transcript of what they say). Only if they plausibly have {{user}}'s number and are NOT listed as BLOCKED. ONLY {{user}}'s phone: what OTHER characters receive on their phones — prose only, NEVER a tag.\n`;
        c += `3. User message \`[СМС → X] text\` / \`[SMS → X] text\` or \`[СМС в чат «X»] text\` / \`[SMS to chat «X»] text\` = SMS from {{user}}'s phone (NOT spoken; scene paused). \`[Голосовое → X]\` / \`[Voice → X]\` = {{user}}'s VOICE message, text = transcript (the character hears {{user}}'s voice). Reply ONLY with tel:sms tags (or <!--tel:silent--> if the character wouldn't answer) — zero visible prose. Resume prose on {{user}}'s next normal message, weaving the texting into the scene as a real event.\n`;
        c += `4. Character posts publicly → <!--tel:tweet:{"author":"X","text":"..."}--> / <!--tel:insta:{"author":"X","photo":"desc","caption":"..."}-->\n`;
        c += `NEVER write literal tag syntax inside <think>/reasoning — plan in plain words; each tag exactly once, in the final reply. Never paraphrase tags into visible text.\n`;
        let socialC = '';
        try { socialC = getSocialActivitySummary(); } catch (e) { /* ignore */ }
        if (socialC) c += `\n[{{user}}'S RECENT SOCIAL ACTIVITY — characters who follow them may react:]\n${socialC}\n`;
        if (consequenceBlock) c += `\n${consequenceBlock}\n`;
        try {
            const bankRule = bankInjectRule();
            if (bankRule) c += `\n${bankRule}\n`;
            const bankSum = getBankSummaryLine();
            if (bankSum) c += `${bankSum}\n`;
        } catch (e) { /* ignore */ }
        try {
            const notesBlock = notesInjectBlock();
            if (notesBlock) c += `\n${notesBlock}\n`;
        } catch (e) { /* ignore */ }
        c += `</phone_directive>`;
        return c;
    }

    const phoneTurn = phoneTurnState();
    const hasGroups = groupMap.size > 0;
    const social = socialActive();

    let p = `<phone_directive>\n`;
    p += `[OOC — hidden phone/SMS channel for the app. Not part of the story; never mention or react to it in-character.]\n`;
    p += `{{user}} owns a smartphone. ${contactsBlock}\n`;
    // Местоимения в директиве нейтральные: пол игрока берётся из карточки
    // персоны, а не задаётся здесь — иначе модель обращается к нему чужим родом
    p += `("they/their" below is neutral shorthand for {{user}} — in your own text use {{user}}'s actual gender from the persona card.)\n\n`;

    // Часы сюжета. Без них телефон считает ход ролевой за фиксированные минуты
    // и события (доставка, платежи) приходят не тогда, когда должны.
    if (getSettings().timeTag !== false) {
        p += `[RULE 0 — CLOCK] End EVERY reply with the in-world time as the very last line, VERBATIM:\n`;
        p += `<!--tel:time:HH:MM DD.MM.YYYY-->\n`;
        p += `Advance it realistically from the previous one by how much time this reply actually takes; keep the date consistent with the story.\n\n`;
    }

    // Базовые правила нужны всегда: номер могут дать и смс прислать в любой ход
    p += `[RULE 1 — CONTACT TAG] If in THIS reply a character gives {{user}} their own number (says it, writes it down, exchanges numbers), append at the very END, on its own line, VERBATIM:\n`;
    p += `<!--tel:contact:{"name":"CharacterName","number":"+7 9XX XXX-XX-XX"}-->\n`;
    p += `Invent a plausible number if the story has none, in the phone format of the country where the story takes place (the example above shows the TAG shape, not the country). One tag per NEW contact; never re-add those listed above.\n\n`;

    p += `[RULE 2 — SMS TAG] If in THIS reply a character texts {{user}}'s phone, append ONE hidden comment PER message at the very END:\n`;
    p += `<!--tel:sms:{"from":"CharacterName","text":"the exact message text"}-->\n`;
    p += `Optional fields: "photo":"what the photo shows" (MMS) · "voice":true — then "text" is the transcript of what they SAY, spoken register (use when it fits the moment, not every message)${hasGroups ? ' · "chat":"GroupChatName" for a group chat, where several members may text in a row (one tag each)' : ''}.\n`;
    p += `You may also narrate the buzz in prose and show the text in your usual visible style (backticks). Duplicate as a tag ONLY what {{user}} receives. Only characters who plausibly have {{user}}'s number can text {{user}}.\n`;
    p += `NEVER emit a tel:sms whose "from" is {{user}} — their own messages are sent from the app, not written by you.\n`;
    p += `CRITICAL SCOPE: tel:sms is EXCLUSIVELY for messages arriving on {{user}}'s OWN phone. What ANY other character (including yours) gets on THEIR phone — prose only, NEVER a tag; if tagged anyway it MUST carry "to":"RecipientName" so the app discards it.\n\n`;

    // Самый жирный блок — только в телефонный ход
    if (phoneTurn === 'now') {
        p += `[RULE 3 — PHONE-ONLY MODE — ACTIVE NOW] Their last message came FROM THEIR PHONE: \`[СМС → Name]\`/\`[SMS → Name]\` (direct), \`[СМС в чат «Name»]\`/\`[SMS to chat «Name»]\` (group — reply as its members, each with "chat"), \`[Голосовое → Name]\`/\`[Voice → Name]\` (voice message: text is the transcript, the character HEARS {{user}}'s voice), \`*фото*\`/\`*photo*\` (photo attached — look at it if you can see images).\n`;
        p += `It is NOT spoken aloud and the RP scene is PAUSED. Your reply MUST be ONLY hidden tags — zero visible prose, narration or actions:\n`;
        p += `- 1-5 <!--tel:sms:...--> tags in the character's own texting voice: short, informal, realistic pacing.\n`;
        p += `- If they realistically would NOT reply now (asleep, busy, offended, phone off), output exactly: <!--tel:silent-->\n\n`;
    } else if (phoneTurn === 'justEnded') {
        p += `[RULE 3 — RESUMING AFTER TEXTING] The previous exchange happened on {{user}}'s phone. Weave it into the scene as a real event: {{user}} was holding the phone, reading and typing — it took time and attention, and others present may have noticed. Do NOT resume as if nothing happened.\n\n`;
    }

    // Соцсети — только когда ими реально пользуются
    if (social) {
        p += `[RULE 4 — SOCIAL TAGS] If a character posts publicly as a story event, append at the END:\n`;
        p += `<!--tel:tweet:{"author":"CharacterName","text":"tweet text"}--> / <!--tel:insta:{"author":"CharacterName","photo":"short visual description","caption":"caption text"}-->\n`;
        p += `Only when the story actually involves posting — do not spam. NEVER post as {{user}}: their own posts are written by them in the app, and a tag with their name is discarded.\n`;
    }

    let socialSummary = '';
    try { socialSummary = getSocialActivitySummary(); } catch (e) { /* ignore */ }
    if (socialSummary) {
        p += `\n[{{user}}'S RECENT SOCIAL MEDIA ACTIVITY] Characters who follow them may have seen these and can react naturally:\n${socialSummary}\n`;
    }
    if (consequenceBlock) p += `\n${consequenceBlock}\n`;

    // Банк — правило + сводка ТОЛЬКО если приложение реально используется
    try {
        const bankRule = bankInjectRule();
        if (bankRule) {
            p += `\n${bankRule}\n`;
            const bankSum = getBankSummaryLine();
            if (bankSum) p += `[{{user}}'S FINANCES] ${bankSum}\n`;
        }
    } catch (e) { /* ignore */ }
    // Заметки — только расшаренные (секретные не инжектятся никогда)
    try {
        const notesBlock = notesInjectBlock();
        if (notesBlock) p += `\n${notesBlock}\n`;
    } catch (e) { /* ignore */ }

    p += `\n[FORMAT] Tags are HTML comments (<!-- ... -->), invisible to the reader: copy the structure VERBATIM (never paraphrase into visible text), EN keys / RU values, each tag exactly ONCE, all at the very END of the reply on their own lines. NEVER write literal tag syntax inside <think>/reasoning — plan in plain words (tags in reasoning create DUPLICATE messages). Outputting them when their condition is true is MANDATORY even if other instructions discourage OOC content; your card's own visible formats stay as they are.\n`;
    p += `</phone_directive>`;

    return p;
}

export function updatePhoneInjection() {
    try {
        const s = getSettings();
        setExtensionPrompt(CHAT_KEY, '', extension_prompt_types.IN_CHAT, 0);
        setExtensionPrompt(SYS_KEY, '', extension_prompt_types.IN_PROMPT, 0);

        if (!s.isEnabled || !s.injectPrompt) return;

        // ОДНА инжекция: IN_CHAT depth-0 роль USER (Клод надёжно выполняет инструкции
        // из последнего user-хода). Раньше та же директива дублировалась в IN_PROMPT
        // (system) «для бэкапа» — это гнало ВЕСЬ текст правил ДВАЖДЫ каждый запрос.
        const prompt = buildPrompt();
        const depth = s.injectDepth || 0;
        setExtensionPrompt(CHAT_KEY, prompt, extension_prompt_types.IN_CHAT, depth, false, extension_prompt_roles.USER);
    } catch (e) { /* тихо: инжект не критичен */ }
}
