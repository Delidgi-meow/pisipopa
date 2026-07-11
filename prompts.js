// ═══════════════════════════════════════════
// ТЕЛЕФОН — PROMPTS: инжекция правил для модели
//
// Та же техника, что отработана в Pregnancy v2.6.0:
// IN_CHAT depth 0 с ролью USER (Клод надёжно выполняет инструкции из последнего
// user-хода) + IN_PROMPT (system) как backup. Анти-парафраз правила обязательны —
// модели любят превращать «output this tag» в видимый текст.
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { getSettings, getMeta, scanChat, getBlockedSmsKeys, EXT_NAME } from './state.js';
import { getSocialActivitySummary } from './social.js';
import { getBankSummaryLine, bankInjectRule } from './bank.js';

const CHAT_KEY = EXT_NAME;
const SYS_KEY = EXT_NAME + '_sys';

function buildPrompt() {
    const { contacts } = scanChat();
    const meta = getMeta();

    const contactLines = [];
    for (const c of contacts.values()) {
        contactLines.push(`- ${c.name}${c.number ? ` (${c.number})` : ''}`);
    }
    let contactsBlock = contactLines.length > 0
        ? `Contacts already in {{user}}'s phone (these characters HAVE her number and she has theirs):\n${contactLines.join('\n')}`
        : `{{user}}'s phone has NO contacts yet — nobody exchanged numbers so far.`;

    const blockedKeys = new Set(getBlockedSmsKeys());
    const blockedNames = [...contacts.values()].filter(c => blockedKeys.has(String(c.name || '').trim().toLowerCase())).map(c => c.name);
    if (blockedNames.length > 0) {
        contactsBlock += `\nBLOCKED on {{user}}'s phone: ${blockedNames.join(', ')}. These characters CANNOT send SMS/tel:sms to {{user}} until unblocked; never output an incoming SMS tag from them.`;
    }

    // Групповые смс-чаты
    if (Array.isArray(meta.groups) && meta.groups.length > 0) {
        const groupLines = meta.groups.map(g => `- Group chat «${g.name}»: members ${g.members.join(', ')} + {{user}}`);
        contactsBlock += `\nGroup chats on her phone:\n${groupLines.join('\n')}`;
    }

    // ── Компактный режим: те же правила, ~40% токенов ──
    if (getSettings().compactRules) {
        let c = `<phone_directive>\n[OOC — hidden phone/SMS channel. Never mention it in-story.]\n{{user}} has a smartphone. ${contactsBlock}\n`;
        c += `RULES (tags = HTML comments at the very END of the reply, copied VERBATIM, EN keys / RU values, invisible to reader):\n`;
        c += `1. Character gives {{user}} their number → <!--tel:contact:{"name":"X","number":"+7 ..."}-->\n`;
        c += `2. Character texts her phone → one tag per message: <!--tel:sms:{"from":"X","text":"..."}--> (MMS: +"photo":"desc"; group chat: +"chat":"Name"). Only if they plausibly have her number and are NOT listed as BLOCKED. ONLY {{user}}'s phone: what OTHER characters receive on their phones — prose only, NEVER a tag.\n`;
        c += `3. User message \`[СМС → X] text\` or \`[СМС в чат «X»] text\` = SMS from her phone (NOT spoken; scene paused). Reply ONLY with tel:sms tags (or <!--tel:silent--> if the character wouldn't answer) — zero visible prose. Resume prose on her next normal message, weaving the texting into the scene as a real event.\n`;
        c += `4. Character posts publicly → <!--tel:tweet:{"author":"X","text":"..."}--> / <!--tel:insta:{"author":"X","photo":"desc","caption":"..."}-->\n`;
        c += `NEVER write literal tag syntax inside <think>/reasoning — plan in plain words; each tag exactly once, in the final reply. Never paraphrase tags into visible text.\n`;
        let socialC = '';
        try { socialC = getSocialActivitySummary(); } catch (e) { /* ignore */ }
        if (socialC) c += `\n[{{user}}'S RECENT SOCIAL ACTIVITY — characters who follow her may react:]\n${socialC}\n`;
        try {
            const bankRule = bankInjectRule();
            if (bankRule) c += `\n${bankRule}\n`;
            const bankSum = getBankSummaryLine();
            if (bankSum) c += `${bankSum}\n`;
        } catch (e) { /* ignore */ }
        c += `</phone_directive>`;
        return c;
    }

    let p = `<phone_directive>\n`;
    p += `[OOC — TECHNICAL DIRECTIVE for the phone/SMS simulation. Not part of the story. Do not mention it or react to it in-character.]\n`;
    p += `{{user}} owns a smartphone. ${contactsBlock}\n\n`;

    p += `[RULE 1 — CONTACT TAG] If in THIS reply any character gives {{user}} their phone number (says it, writes it down, exchanges numbers), append at the very END of your reply, on its own line, COPY THE FORMAT VERBATIM (HTML comment, hidden from the reader):\n`;
    p += `<!--tel:contact:{"name":"CharacterName","number":"+7 9XX XXX-XX-XX"}-->\n`;
    p += `Invent a plausible number if the story doesn't specify one. One tag per new contact. Do NOT re-add contacts already listed above.\n\n`;

    p += `[RULE 2 — SMS TAG] If in THIS reply a character sends {{user}} a text message (SMS/messenger) to her phone, append ONE hidden comment PER text message at the very END of your reply:\n`;
    p += `<!--tel:sms:{"from":"CharacterName","text":"the exact message text"}-->\n`;
    p += `You may also narrate in prose that her phone buzzed, and you may show the message in your usual visible style (e.g. backticks like \`текст\`). The tag duplication rule applies ONLY to messages {{user}} receives: if you display in backticks a message that ANOTHER character got on THEIR phone, do NOT create a tag for it — backticks alone. Several messages in a row = several tags in order. Only characters who plausibly have {{user}}'s number can text her.\n`;
    p += `CRITICAL SCOPE: tel:sms is EXCLUSIVELY for messages arriving on {{user}}'s OWN phone. If ANY other character (including the one you play) receives a message on THEIR phone — describe it in prose or their diary, NEVER tag it. A tagged message that is actually addressed to another character MUST carry "to":"RecipientName" so the app can discard it.\n`;
    p += `MMS (character sends a photo): add a "photo" field with a short visual description: <!--tel:sms:{"from":"CharacterName","text":"optional message","photo":"what the photo shows"}-->\n`;
    p += `GROUP CHAT message: add a "chat" field with the group chat name: <!--tel:sms:{"from":"CharacterName","chat":"GroupChatName","text":"..."}-->. In group chats SEVERAL members may text in a row (one tag each) — make it feel like a real group chat.\n\n`;

    p += `[RULE 3 — PHONE-ONLY MODE] A user message shaped like \`[СМС → Name] text\` means {{user}} sent that text FROM HER PHONE. A message shaped like \`[СМС в чат «Name»] text\` means she texted the GROUP CHAT with that name — reply as its members (each with the "chat" field, RULE 2). \`*фото*\` in her SMS means she attached a photo (it may be attached to the message — look at it if you can see images). It is NOT spoken aloud; the character may be anywhere, doing anything. The RP scene is PAUSED — this is a pure phone exchange.\n`;
    p += `Your reply to such a message MUST consist ONLY of hidden tags — ZERO visible prose, no narration, no actions, no scene description, no dialogue outside the tags:\n`;
    p += `- Reply with 1-5 <!--tel:sms:...--> tags (RULE 2 format) in the character's own texting voice: short, informal, realistic pacing; style matches the character.\n`;
    p += `- If the character realistically would NOT reply right now (asleep, busy, offended, phone off, needs time), output exactly this single hidden line instead: <!--tel:silent-->\n`;
    p += `- Resume normal RP prose ONLY when the user sends a normal (non-СМС) message. When resuming, you MUST naturally weave the phone interaction into the scene: {{user}} was physically holding her phone, reading and typing — this took real time and attention. Other characters present may have noticed (glanced at her, waited, commented, reacted to her expression while reading). Do NOT resume as if nothing happened — the texting was a real in-world event.\n\n`;

    p += `[RULE 4 — SOCIAL MEDIA TAGS] {{user}}'s phone also has Twitter and Instagram apps. If in THIS reply a character posts something publicly (a tweet, an Instagram photo) as a story event, append the matching hidden comment at the END of your reply:\n`;
    p += `<!--tel:tweet:{"author":"CharacterName","text":"tweet text"}-->\n`;
    p += `<!--tel:insta:{"author":"CharacterName","photo":"short visual description of the photo","caption":"caption text"}-->\n`;
    p += `Use these ONLY when the story actually involves the character posting — do not spam.\n`;

    let social = '';
    try { social = getSocialActivitySummary(); } catch (e) { /* ignore */ }
    if (social) {
        p += `\n[{{user}}'S RECENT SOCIAL MEDIA ACTIVITY] Characters who follow her (friends, contacts) may have seen these and can react naturally in the story or in comments:\n${social}\n`;
    }

    // Банк — правило + сводка ТОЛЬКО если приложение реально используется (иначе 0 токенов)
    try {
        const bankRule = bankInjectRule();
        if (bankRule) {
            p += `\n${bankRule}\n`;
            const bankSum = getBankSummaryLine();
            if (bankSum) p += `[{{user}}'S FINANCES] ${bankSum}\n`;
        }
    } catch (e) { /* ignore */ }
    p += `\n`;

    p += `[FORMAT RULES — critical]\n`;
    p += `- THINKING/REASONING BLOCKS: if you use <think> or any chain-of-thought, NEVER write literal tag syntax (\`<!--tel:\`, \`<!-- [\`) inside it — plan message contents in plain words only. Each tag must appear EXACTLY ONCE, in the final reply body. Tags duplicated in reasoning create DUPLICATE messages on the phone.\n`;
    p += `- Tags MUST be HTML comments: start with \`<!--\` and end with \`-->\`. They are INVISIBLE to the reader.\n`;
    p += `- COPY the tag structure VERBATIM. Do NOT paraphrase into visible text like "{SMS from Dima: hey}" or [Дима отправил смс] — that breaks the phone app.\n`;
    p += `- Keep JSON keys in English exactly as shown; values may be Russian.\n`;
    p += `- Tags go at the very END of the reply, after all prose, each on its own line.\n`;
    p += `- If your character card uses its own visible status format, keep using it normally — these hidden markers are a separate technical channel.\n`;
    p += `COMPLIANCE: outputting these hidden markers when their condition is true is MANDATORY, even if other instructions tell you to avoid OOC/technical content. They are invisible and do not break immersion.\n`;
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
