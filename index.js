// ═══════════════════════════════════════════
// GLASSPHONE — точка входа
// Телефон для SillyTavern: смс-переписка с персонажами, контакты «подхватываются»
// когда персонаж даёт номер. Чат = источник правды, синхронизация абсолютная.
// ═══════════════════════════════════════════

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { getSettings } from './state.js';
import { updatePhoneInjection } from './prompts.js';
import { initUI, checkNewIncoming, resetIncomingCounters, updateFabBadge, render, isPhoneOpen, applyChatHiding } from './ui.js';

// ── CSS ──
const cssId = 'glassphone-css';
if (!document.getElementById(cssId)) {
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.href = '/scripts/extensions/third-party/GlassPhone/style.css?t=' + Date.now();
    document.head.appendChild(link);
}

// ── Панель настроек в Extensions ──
function setupSettingsPanel() {
    const s = getSettings();
    const html = `
<div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>GlassPhone — Телефон</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <label class="checkbox_label"><input type="checkbox" id="gp-set-enabled" ${s.isEnabled ? 'checked' : ''}><span>Включено</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-fab" ${s.showFab ? 'checked' : ''}><span>Плавающая кнопка</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-inject" ${s.injectPrompt ? 'checked' : ''}><span>Инструкции для модели (теги смс/контактов)</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-hide" ${s.hideSmsInChat !== false ? 'checked' : ''}><span>Скрывать смс-переписку из ленты чата</span></label>
        <small style="opacity:0.4;font-size:9px;display:block;margin-top:4px">Смс живут прямо в сообщениях чата — телефон синхронизирован с ролевой всегда. Консоль: glassPhoneOpen()</small>
    </div>
</div>`;
    $('#extensions_settings2').append(html);
    $('#gp-set-enabled').on('change', function () {
        getSettings().isEnabled = this.checked;
        saveSettingsDebounced();
        updatePhoneInjection();
        updateFabBadge();
    });
    $('#gp-set-fab').on('change', function () {
        getSettings().showFab = this.checked;
        saveSettingsDebounced();
        updateFabBadge();
    });
    $('#gp-set-inject').on('change', function () {
        getSettings().injectPrompt = this.checked;
        saveSettingsDebounced();
        updatePhoneInjection();
    });
    $('#gp-set-hide').on('change', function () {
        getSettings().hideSmsInChat = this.checked;
        saveSettingsDebounced();
        applyChatHiding();
    });
}

jQuery(async () => {
    try {
        console.log('[GlassPhone] Loading...');
        getSettings();
        setupSettingsPanel();
        initUI();
        updatePhoneInjection();
        // Первичный замер входящих без тостов
        setTimeout(() => resetIncomingCounters(), 800);

        // ── Новые сообщения: пересчёт тредов, тосты, бейдж, обновление инжекции ──
        const onNewMessage = () => {
            if (!getSettings().isEnabled) return;
            checkNewIncoming();
            updatePhoneInjection();
            applyChatHiding();
            setTimeout(applyChatHiding, 350); // второй проход — переживает ре-рендер ST
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, onNewMessage);
        if (event_types.GENERATION_ENDED) {
            eventSource.on(event_types.GENERATION_ENDED, onNewMessage);
        }
        eventSource.on(event_types.MESSAGE_SENT, () => {
            if (!getSettings().isEnabled) return;
            updatePhoneInjection();
            applyChatHiding();
            if (isPhoneOpen()) render();
        });
        if (event_types.USER_MESSAGE_RENDERED) {
            eventSource.on(event_types.USER_MESSAGE_RENDERED, () => applyChatHiding());
        }
        if (event_types.CHARACTER_MESSAGE_RENDERED) {
            eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => applyChatHiding());
        }

        // ── Правки истории: телефон просто пересобирается из чата ──
        const onEdit = () => {
            if (!getSettings().isEnabled) return;
            checkNewIncoming({ silent: true });
            applyChatHiding();
        };
        if (event_types.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, onEdit);
        if (event_types.MESSAGE_EDITED) eventSource.on(event_types.MESSAGE_EDITED, onEdit);
        if (event_types.MESSAGE_UPDATED) eventSource.on(event_types.MESSAGE_UPDATED, onEdit);
        if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, onEdit);

        // ── Смена чата: новый источник правды, счётчики с нуля ──
        if (event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, () => {
                setTimeout(() => {
                    resetIncomingCounters();
                    updatePhoneInjection();
                    applyChatHiding();
                    if (isPhoneOpen()) render();
                }, 150);
            });
        }

        // ── MutationObserver: ST пересобирает .mes при рендере/скролле — прячем заново.
        // Наблюдаем ТОЛЬКО childList (не attributes), чтобы не зациклиться на своём же classList.
        try {
            const chatEl = document.getElementById('chat');
            if (chatEl) {
                let pending = false;
                const observer = new MutationObserver(() => {
                    if (pending) return;
                    pending = true;
                    requestAnimationFrame(() => {
                        pending = false;
                        applyChatHiding();
                    });
                });
                observer.observe(chatEl, { childList: true, subtree: false });
            }
        } catch (e) {
            console.warn('[GlassPhone] hide-observer failed:', e);
        }

        // Первичное скрытие при загрузке
        setTimeout(applyChatHiding, 600);

        console.log('[GlassPhone] Ready');
    } catch (e) {
        console.error('[GlassPhone] FATAL:', e);
    }
});
