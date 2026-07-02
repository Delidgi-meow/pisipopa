// ═══════════════════════════════════════════
// GLASSPHONE PROMPTS — инжекция инструкций для модели
//
// Та же техника, что отработана в Pregnancy v2.6.0:
// IN_CHAT depth 0 с ролью USER (Клод надёжно выполняет инструкции из последнего
// user-хода) + IN_PROMPT (system) как backup. Анти-парафраз правила обязательны —
// модели любят превращать «output this tag» в видимый текст.
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../script.js';
import { getSettings, scanChat, EXT_NAME } from './state.js';
import { getSocialActivitySummary } from './social.js';

const CHAT_KEY = EXT_NAME;
const SYS_KEY = EXT_NAME + '_sys';

function buildPrompt() {
    const { contacts } = scanChat();

    const contactLines = [];
    for (const c of contacts.values()) {
        contactLines.push(`- ${c.name}${c.number ? ` (${c.number})` : ''}`);
    }
    const contactsBlock = contactLines.length > 0
        ? `Contacts already in {{user}}'s phone (these characters HAVE her number and she has theirs):\n${contactLines.join('\n')}`
        : `{{user}}'s phone has NO contacts yet — nobody exchanged numbers so far.`;

    let p = `<phone_directive>\n`;
    p += `[OOC — TECHNICAL DIRECTIVE for the phone/SMS simulation. Not part of the story. Do not mention it or react to it in-character.]\n`;
    p += `{{user}} owns a smartphone. ${contactsBlock}\n\n`;

    p += `[RULE 1 — CONTACT TAG] If in THIS reply any character gives {{user}} their phone number (says it, writes it down, exchanges numbers), append at the very END of your reply, on its own line, COPY THE FORMAT VERBATIM (HTML comment, hidden from the reader):\n`;
    p += `<!--tel:contact:{"name":"CharacterName","number":"+7 9XX XXX-XX-XX"}-->\n`;
    p += `Invent a plausible number if the story doesn't specify one. One tag per new contact. Do NOT re-add contacts already listed above.\n\n`;

    p += `[RULE 2 — SMS TAG] If in THIS reply a character sends {{user}} a text message (SMS/messenger) to her phone, append ONE hidden comment PER text message at the very END of your reply:\n`;
    p += `<!--tel:sms:{"from":"CharacterName","text":"the exact message text"}-->\n`;
    p += `You may also narrate in prose that her phone buzzed, and you may show the message in your usual visible style (e.g. backticks like \`текст\`) — but the actual message content MUST ALSO be inside the tag: the tag is what the phone app reads. Several messages in a row = several tags in order. Only characters who plausibly have {{user}}'s number can text her.\n\n`;

    p += `[RULE 3 — PHONE-ONLY MODE] A user message shaped like \`[СМС → Name] text\` means {{user}} sent that text FROM HER PHONE. It is NOT spoken aloud; the character may be anywhere, doing anything. The RP scene is PAUSED — this is a pure phone exchange.\n`;
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
    p += `\n`;

    p += `[FORMAT RULES — critical]\n`;
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

        const prompt = buildPrompt();
        const depth = s.injectDepth || 0;
        setExtensionPrompt(CHAT_KEY, prompt, extension_prompt_types.IN_CHAT, depth, false, extension_prompt_roles.USER);
        setExtensionPrompt(SYS_KEY, prompt, extension_prompt_types.IN_PROMPT, depth);
    } catch (e) {
        console.error('[GlassPhone] updatePhoneInjection error:', e);
    }
}
