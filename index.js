
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { getSettings, GP_VERSION } from './state.js';
import { updatePhoneInjection } from './prompts.js';
import { initUI, checkNewIncoming, resetIncomingCounters, updateFabBadge, render, isPhoneOpen, applyChatHiding, toast, notifyBankReminders, notifyAchievements } from './ui.js';
import { harvestSocialTags, setUserHandle, getUserHandle } from './social.js';
import { harvestBankTags } from './bank.js';
import { trDom } from './i18n.js';

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
<div class="inline-drawer" id="gp-settings-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>Телефон</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Язык / Language:</span>
            <select id="gp-set-lang" class="text_pole" style="flex:1">
                <option value="ru" ${s.lang !== 'en' ? 'selected' : ''}>Русский</option>
                <option value="en" ${s.lang === 'en' ? 'selected' : ''}>English</option>
            </select>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-enabled" ${s.isEnabled ? 'checked' : ''}><span>Включено</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-fab" ${s.showFab ? 'checked' : ''}><span>Плавающая кнопка</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-inject" ${s.injectPrompt ? 'checked' : ''}><span>Инструкции для модели</span></label>
        <div class="gp-inject-depth-setting" style="display:flex;gap:6px;align-items:center;margin:5px 0 7px;padding:7px 8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.04)">
            <i class="fa-solid fa-layer-group" style="opacity:.7"></i>
            <label for="gp-set-depth" style="font-size:10px;font-weight:700;white-space:nowrap">Глубина инжекта</label>
            <input type="number" id="gp-set-depth" class="text_pole" min="0" max="100" step="1" value="${Math.max(0, Number(s.injectDepth) || 0)}" style="width:62px;flex:0 0 auto">
            <span style="font-size:8px;opacity:.6;line-height:1.2">0 — перед последним ходом</span>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-hide" ${s.hideSmsInChat !== false ? 'checked' : ''}><span>Скрывать смс-переписку из ленты чата</span></label>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Профиль для соцсетей:</span>
            <select id="gp-set-profile" class="text_pole" style="flex:1"></select>
            <div class="menu_button" id="gp-profile-test" title="Проверить профиль (маленький запрос)" style="flex:0 0 auto;padding:4px 8px"><i class="fa-solid fa-plug-circle-check"></i></div>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-prefill" ${s.usePrefill ? 'checked' : ''}><span>Префилл ответа</span></label>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Контекст соцсетей:</span>
            <select id="gp-set-ctxmode" class="text_pole" style="flex:1">
                <option value="rich" ${s.socialContextMode !== 'lite' ? 'selected' : ''}>История + лорбук + карточка бота</option>
                <option value="lite" ${s.socialContextMode === 'lite' ? 'selected' : ''}>Изолированно (только срез чата)</option>
            </select>
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Макс. длина ответа:</span>
            <input type="number" id="gp-set-maxtokens" class="text_pole" min="0" max="32000" step="256" value="${s.socialMaxTokens || 0}" style="width:70px;flex:0 0 auto">
            <span style="font-size:8px;opacity:0.4">0 = авто</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Твой ник (@):</span>
            <input type="text" id="gp-set-handle" class="text_pole" maxlength="21" placeholder="авто из имени" style="flex:1">
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
            <span style="font-size:9px;opacity:0.5;white-space:nowrap">Модель картинок:</span>
            <input type="text" id="gp-set-imgmodel" class="text_pole" list="gp-imgmodels" placeholder="авто" style="flex:1">
            <datalist id="gp-imgmodels"></datalist>
            <div class="menu_button" id="gp-imgmodel-refresh" title="Загрузить список моделей" style="flex:0 0 auto;padding:4px 8px"><i class="fa-solid fa-rotate"></i></div>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-square" ${s.imageGenSquare !== false ? 'checked' : ''}><span>Картинки постов — квадрат 1:1</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-tagmode" ${s.imgTagMode ? 'checked' : ''}><span>Booru-теги (для NovelAI/аниме-моделей)</span></label>
        <div class="gp-settings-actions">
            <div class="menu_button" id="gp-imgprompt-toggle">Промпты картинок ▼</div>
            <div class="menu_button" id="gp-reset-fab">Сбросить кнопку</div>
        </div>
        <div id="gp-imgprompt-panel" style="display:none;flex-direction:column;gap:3px">
            <span style="font-size:9px;opacity:0.5">Instagram (стиль/кадр — описание поста и запрет на главперсонажей дописываются сами):</span>
            <textarea id="gp-set-imgprompt-ig" class="text_pole" rows="2" style="font-size:11px;resize:vertical"></textarea>
            <span style="font-size:9px;opacity:0.5">OnlyFans:</span>
            <textarea id="gp-set-imgprompt-of" class="text_pole" rows="2" style="font-size:11px;resize:vertical"></textarea>
            <button id="gp-imgprompt-apply" class="menu_button">Применить</button>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-sociallog" ${s.socialLogToChat !== false ? 'checked' : ''}><span>Журнал соцсетей в чат</span></label>
        <label class="checkbox_label"><input type="checkbox" id="gp-set-compact" ${s.compactRules ? 'checked' : ''}><span>Компактные правила в инжекте</span></label>
        <small style="opacity:0.4;font-size:9px;display:block;margin-top:4px">Обои и свой CSS — в приложении «Оформление» внутри телефона.</small>
        <small id="gp-version-label" style="opacity:0.55;font-size:10px;display:block;margin-top:4px;font-weight:700"></small>
    </div>
</div>`;
    $('#extensions_settings2').append(html);
    // Значения назначаются как свойства DOM, не интерполируются в HTML:
    // кавычки и </textarea> в пользовательских промптах/CSS безопасны.
    $('#gp-set-imgmodel').val(s.imageGenModel || '');
    $('#gp-set-imgprompt-ig').val(s.imgPromptIg || '');
    $('#gp-set-imgprompt-of').val(s.imgPromptOf || '');
    // Перевод панели (en) — оригиналы хранятся на нодах, переключение обратимо
    const translatePanel = () => { try { trDom(document.getElementById('gp-settings-drawer')); } catch (e) { /* ignore */ } };
    translatePanel();
    $('#gp-set-lang').on('change', function () {
        getSettings().lang = this.value === 'en' ? 'en' : 'ru';
        saveSettingsDebounced();
        translatePanel();
        if (isPhoneOpen()) render();
    });
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
    $('#gp-set-depth').on('change', function () {
        const value = Math.max(0, Math.min(100, parseInt(this.value) || 0));
        this.value = value;
        getSettings().injectDepth = value;
        saveSettingsDebounced();
        updatePhoneInjection();
    });
    $('#gp-set-hide').on('change', function () {
        getSettings().hideSmsInChat = this.checked;
        saveSettingsDebounced();
        applyChatHiding();
    });
    // Ник юзера хранится per-chat (в метаданных) — подставляем при открытии панели
    try { $('#gp-set-handle').val(getUserHandle().replace(/^@/, '')); } catch (e) { /* чат ещё не загружен */ }
    $('#gp-set-handle').on('change', function () {
        setUserHandle(this.value);
        updatePhoneInjection();
    });
    $('#gp-set-maxtokens').on('change', function () {
        getSettings().socialMaxTokens = Math.max(0, Math.min(32000, parseInt(this.value) || 0));
        saveSettingsDebounced();
    });
    $('#gp-set-imgmodel').on('change', function () {
        getSettings().imageGenModel = this.value.trim();
        saveSettingsDebounced();
    });
    // Список моделей — из автоопределённого картинко-расширения
    $('#gp-imgmodel-refresh').on('click', async function () {
        const btn = $(this);
        btn.find('i').addClass('fa-spin');
        try {
            const mod = await import('./social.js');
            const models = await mod.fetchImageModels();
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
    $('#gp-set-tagmode').on('change', function () {
        getSettings().imgTagMode = this.checked;
        saveSettingsDebounced();
    });
    $('#gp-imgprompt-toggle').on('click', function () {
        const panel = $('#gp-imgprompt-panel');
        const visible = panel.is(':visible');
        panel.css('display', visible ? 'none' : 'flex');
        $(this).text(visible ? 'Промпты картинок ▼' : 'Промпты картинок ▲');
    });
    $('#gp-imgprompt-apply').on('click', function () {
        getSettings().imgPromptIg = $('#gp-set-imgprompt-ig').val() || '';
        getSettings().imgPromptOf = $('#gp-set-imgprompt-of').val() || '';
        saveSettingsDebounced();
        toast('Промпты картинок сохранены', 'fa-check');
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
    $('#gp-reset-fab').on('click', function () {
        getSettings().fabPos = null;
        saveSettingsDebounced();
        const fab = document.getElementById('gp-fab');
        if (fab) {
            const vw = window.innerWidth, vh = window.innerHeight;
            fab.style.left = `${vw - 48 - 16}px`;
            fab.style.top = `${Math.round(vh * 0.55)}px`;
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        }
        toast('Кнопка возвращена на место', 'fa-mobile-screen-button');
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
    $('#gp-set-prefill').on('change', function () {
        getSettings().usePrefill = this.checked;
        saveSettingsDebounced();
    });
    // Проверка профиля подключения — показывает РЕАЛЬНУЮ ошибку (а не «API request failed»)
    $('#gp-profile-test').on('click', async function () {
        const btn = $(this);
        btn.find('i').removeClass('fa-plug-circle-check').addClass('fa-spinner fa-spin');
        try {
            const mod = await import('./social.js');
            const out = await mod.testSocialProfile();
            toast(`Профиль ОК: «${out}»`, 'fa-check');
        } catch (e) {
            const msg = String(e?.message || e).slice(0, 140);
            console.error('[GlassPhone] проверка профиля:', e);
            toast(`Профиль не отвечает: ${msg}`, 'fa-circle-exclamation');
        } finally {
            btn.find('i').removeClass('fa-spinner fa-spin').addClass('fa-plug-circle-check');
        }
    });

    // Обои и свой CSS переехали в приложение «Оформление» внутри телефона
    // (дублирование в панели расширения убрано по просьбе юзера)
}

jQuery(async () => {
    try {
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
            } catch (e) { /* ignore */ }
            // Транзакции из ролевой (tel:bank) → баланс + тост
            try {
                const n = harvestBankTags();
                if (n > 0) toast(`Банк: ${n} ${n === 1 ? 'операция' : 'операции'} из ролевой`, 'fa-building-columns');
            } catch (e) { /* ignore */ }
            notifyBankReminders();
            notifyAchievements();
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
                    try { harvestBankTags(); } catch (e) { /* ignore */ }
                    updateFabBadge();
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

        // Версия — в консоль и в панель настроек (сверка ПК ↔ айфон против стейл-синка)
        try { document.getElementById('gp-version-label').textContent = `Версия: ${GP_VERSION}`; } catch (e) { /* ignore */ }
    } catch (e) {
        console.error('[GlassPhone] FATAL:', e);
    }
});
