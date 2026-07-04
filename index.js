// ═══════════════════════════════════════════
// ТЕЛЕФОН — точка входа
// Телефон для SillyTavern: смс-переписка с персонажами, контакты «подхватываются»
// когда персонаж даёт номер. Чат = источник правды, синхронизация абсолютная.
// ═══════════════════════════════════════════

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { getSettings } from './state.js';
import { updatePhoneInjection } from './prompts.js';
import { initUI, checkNewIncoming, resetIncomingCounters, updateFabBadge, render, isPhoneOpen, applyChatHiding, toast, applySkin } from './ui.js';
import { harvestSocialTags, setUserHandle, getUserHandle } from './social.js';

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
        <b>Телефон</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <label class="checkbox_label"><input type="checkbox" id="gp-set-enabled" ${s.isEnabled ? 'checked' : ''}><span>Включено</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-fab" ${s.showFab ? 'checked' : ''}><span>Плавающая кнопка</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-inject" ${s.injectPrompt ? 'checked' : ''}><span>Инструкции для модели (теги смс/контактов)</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-hide" ${s.hideSmsInChat !== false ? 'checked' : ''}><span>Скрывать смс-переписку из ленты чата</span></label>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Профиль для соцсетей:</span>
            <select id="gp-set-profile" class="text_pole" style="flex:1"></select>
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Контекст соцсетей:</span>
            <select id="gp-set-ctxmode" class="text_pole" style="flex:1">
                <option value="rich" ${s.socialContextMode !== 'lite' ? 'selected' : ''}>История + лорбук + карточка бота</option>
                <option value="lite" ${s.socialContextMode === 'lite' ? 'selected' : ''}>Изолированно (только срез чата)</option>
            </select>
        </div>
        <small style="opacity:0.4;font-size:9px;display:block">Генерация лент/комментов всегда идёт БЕЗ RP-пресета. Вижн работает в обоих режимах; отдельный профиль полезен, чтобы поставить дешёвую не-reasoning модель.</small>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Глубина инжекта:</span>
            <input type="number" id="gp-set-depth" class="text_pole" min="0" max="99" step="1" value="${s.injectDepth || 0}" style="width:55px;flex:0 0 auto">
            <span style="font-size:8px;opacity:0.4">0 = последний ход</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Твой ник (@):</span>
            <input type="text" id="gp-set-handle" class="text_pole" maxlength="21" placeholder="авто из имени" style="flex:1">
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Модель картинок:</span>
            <input type="text" id="gp-set-imgmodel" class="text_pole" list="gp-imgmodels" value="${s.imageGenModel || ''}" placeholder="пусто = из novarakk" style="flex:1">
            <datalist id="gp-imgmodels"></datalist>
            <div class="menu_button" id="gp-imgmodel-refresh" title="Загрузить список моделей из novarakk" style="flex:0 0 auto;padding:4px 8px"><i class="fa-solid fa-rotate"></i></div>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-square" ${s.imageGenSquare !== false ? 'checked' : ''}><span>Картинки постов — квадрат 1:1</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-visioncomments" ${s.visionInComments ? 'checked' : ''}><span>Прикладывать фото к комментам (дороже; иначе — по описанию)</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-sociallog" ${s.socialLogToChat !== false ? 'checked' : ''}><span>Журнал соцсетей в чат (память для саммарайза)</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-compact" ${s.compactRules ? 'checked' : ''}><span>Компактные правила в инжекте (экономия токенов)</span></label>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Скин:</span>
            <select id="gp-set-skin" class="text_pole" style="flex:1">
                <option value="indigo" ${s.skin === 'indigo' || !s.skin ? 'selected' : ''}>Индиго (стандарт)</option>
                <option value="rose" ${s.skin === 'rose' ? 'selected' : ''}>Роза</option>
                <option value="emerald" ${s.skin === 'emerald' ? 'selected' : ''}>Изумруд</option>
                <option value="mono" ${s.skin === 'mono' ? 'selected' : ''}>Монохром</option>
            </select>
        </div>
        <div class="menu_button" id="gp-css-toggle" style="font-size:10px;text-align:center;margin-top:4px">CSS телефона ▼</div>
        <div id="gp-css-panel" style="display:none;flex-direction:column;gap:4px">
            <textarea id="gp-set-css" class="text_pole" rows="8" style="font-family:monospace;font-size:10px;resize:vertical" placeholder="/* Свой CSS: #gp-phone, .gp-bubble, .gp-tw-card, .gp-ig-card, ... */">${s.customCss || ''}</textarea>
            <button id="gp-css-apply" class="menu_button">Применить</button>
        </div>
        <div class="menu_button" id="gp-reset-fab" style="font-size:10px;text-align:center;margin-top:4px">Сбросить позицию кнопки</div>
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
    $('#gp-set-depth').on('change', function () {
        getSettings().injectDepth = Math.max(0, Math.min(99, parseInt(this.value) || 0));
        saveSettingsDebounced();
        updatePhoneInjection();
    });
    // Ник юзера хранится per-chat (в метаданных) — подставляем при открытии панели
    try { $('#gp-set-handle').val(getUserHandle().replace(/^@/, '')); } catch (e) { /* чат ещё не загружен */ }
    $('#gp-set-handle').on('change', function () {
        setUserHandle(this.value);
        updatePhoneInjection();
    });
    $('#gp-set-imgmodel').on('change', function () {
        getSettings().imageGenModel = this.value.trim();
        saveSettingsDebounced();
    });
    // Список доступных моделей — из активного провайдера novarakk
    $('#gp-imgmodel-refresh').on('click', async function () {
        const btn = $(this);
        btn.find('i').addClass('fa-spin');
        try {
            const provMod = await import('/scripts/extensions/third-party/novarakk/src/providers.js');
            const setMod = await import('/scripts/extensions/third-party/novarakk/src/settings.js');
            const provider = provMod.resolveActiveProvider(setMod.getSettings());
            if (!provider) throw new Error('провайдер novarakk не настроен');
            const models = await provider.fetchModels();
            if (!Array.isArray(models) || models.length === 0) throw new Error('список пуст');
            $('#gp-imgmodels').html(models.map(m => `<option value="${$('<i>').text(m).html()}">`).join(''));
            toast(`Моделей: ${models.length} — открой поле, появится список`, 'fa-check');
        } catch (e) {
            console.warn('[GlassPhone] fetch models failed:', e);
            toast(`Не удалось: ${String(e?.message || e).slice(0, 50)}`, 'fa-circle-exclamation');
        } finally {
            btn.find('i').removeClass('fa-spin');
        }
    });
    $('#gp-set-square').on('change', function () {
        getSettings().imageGenSquare = this.checked;
        saveSettingsDebounced();
    });
    $('#gp-set-visioncomments').on('change', function () {
        getSettings().visionInComments = this.checked;
        saveSettingsDebounced();
    });
    $('#gp-set-sociallog').on('change', function () {
        getSettings().socialLogToChat = this.checked;
        saveSettingsDebounced();
    });
    $('#gp-set-compact').on('change', function () {
        getSettings().compactRules = this.checked;
        saveSettingsDebounced();
        updatePhoneInjection();
    });
    $('#gp-set-skin').on('change', function () {
        getSettings().skin = this.value;
        saveSettingsDebounced();
        applySkin();
    });
    $('#gp-css-toggle').on('click', function () {
        const panel = $('#gp-css-panel');
        const visible = panel.is(':visible');
        panel.css('display', visible ? 'none' : 'flex');
        $(this).text(visible ? 'CSS телефона ▼' : 'CSS телефона ▲');
    });
    $('#gp-css-apply').on('click', function () {
        getSettings().customCss = $('#gp-set-css').val() || '';
        saveSettingsDebounced();
        applySkin();
        toast('CSS применён', 'fa-check');
    });
    $('#gp-reset-fab').on('click', function () {
        getSettings().fabPos = null;
        saveSettingsDebounced();
        const fab = document.getElementById('gp-fab');
        if (fab) { fab.style.right = ''; fab.style.bottom = ''; }
    });

    // Профиль подключения для соцсетей (из Connection Manager)
    const fillProfiles = () => {
        const sel = document.getElementById('gp-set-profile');
        if (!sel) return;
        const cur = getSettings().socialProfileId || '';
        let profiles = [];
        try {
            profiles = SillyTavern.getContext()?.extensionSettings?.connectionManager?.profiles || [];
        } catch (e) { /* ignore */ }
        sel.innerHTML = `<option value="">Текущий API (изолированно, без пресета)</option>`
            + profiles.map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${$('<i>').text(p.name || p.id).html()}</option>`).join('');
        sel.value = profiles.some(p => p.id === cur) ? cur : '';
    };
    fillProfiles();
    // Профили могли добавиться позже — обновляем список при открытии выпадашки
    $('#gp-set-profile').on('mousedown', fillProfiles);
    $('#gp-set-profile').on('change', function () {
        getSettings().socialProfileId = this.value;
        saveSettingsDebounced();
    });
    $('#gp-set-ctxmode').on('change', function () {
        getSettings().socialContextMode = this.value;
        saveSettingsDebounced();
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
            // Персонаж запостил из ролевой (теги tel:tweet / tel:insta) → в ленты + тост
            try {
                const { tweets, posts } = harvestSocialTags();
                if (tweets > 0) toast(`Новый твит в ленте`, 'fa-x-twitter');
                if (posts > 0) toast(`Новый пост в Instagram`, 'fa-instagram');
            } catch (e) { console.warn('[GlassPhone] harvest failed:', e); }
            updatePhoneInjection();
            applyChatHiding();
            setTimeout(applyChatHiding, 350); // второй проход — переживает ре-рендер ST
            if (isPhoneOpen()) render();
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
                    try { harvestSocialTags(); } catch (e) { /* ignore */ }
                    updatePhoneInjection();
                    applyChatHiding();
                    // Ник юзера per-chat — обновляем поле в настройках
                    try { $('#gp-set-handle').val(getUserHandle().replace(/^@/, '')); } catch (e) { /* ignore */ }
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
