// Заметки: личные записи в телефоне. По умолчанию СЕКРЕТНЫ (модель не видит);
// тумблер «видна модели» отправляет заметку в инжект как фоновое знание
// нарратора (персонажи всё равно не знают, пока она не покажет).

import { getMeta, saveMeta } from './state.js';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function getNotes() {
    const m = getMeta();
    if (!Array.isArray(m.notes)) m.notes = [];
    return m.notes;
}

export function addNote(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const note = { id: genId(), text: t.slice(0, 2000), time: Date.now(), shared: false };
    getNotes().unshift(note);
    saveMeta();
    return note;
}

export function updateNote(id, text) {
    const n = getNotes().find(x => x.id === id);
    if (!n) return false;
    n.text = String(text || '').trim().slice(0, 2000);
    n.time = Date.now();
    saveMeta();
    return true;
}

export function deleteNote(id) {
    const m = getMeta();
    m.notes = getNotes().filter(x => x.id !== id);
    saveMeta();
}

export function toggleNoteShared(id) {
    const n = getNotes().find(x => x.id === id);
    if (!n) return false;
    n.shared = !n.shared;
    saveMeta();
    return n.shared;
}

export function getSharedNotes() {
    return getNotes().filter(n => n.shared);
}

// Блок для инжекта — только если есть расшаренные заметки (иначе 0 токенов)
export function notesInjectBlock() {
    const shared = getSharedNotes();
    if (!shared.length) return '';
    const lines = shared.slice(0, 6).map(n => `- ${n.text.slice(0, 300)}`).join('\n');
    return `[{{user}}'S PHONE NOTES — private thoughts/plans she wrote in her notes app. Background knowledge for YOU as narrator; characters DO NOT know these unless she shows or tells them]\n${lines}`;
}
