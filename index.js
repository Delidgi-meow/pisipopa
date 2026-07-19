
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { getSettings, GP_VERSION } from './state.js';
import { updatePhoneInjection } from './prompts.js';
import { initUI, checkNewIncoming, resetIncomingCounters, updateFabBadge, render, isPhoneOpen, applyChatHiding, toast, notifyBankReminders, deliverScamSms } from './ui.js';
import { harvestSocialTags, setUserHandle, getUserHandle, listIigProfiles, listIigStyles } from './social.js';
import { harvestBankTags } from './bank.js';
import { maybeScamSms } from './scam.js';
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
<div class="inline-drawer gp-settings-panel" id="gp-settings-drawer">
    <div class="inline-drawer-toggle inline-drawer-header gp-settings-header">
        <div class="gp-settings-title">
            <span class="gp-settings-status-dot" aria-hidden="true"></span>
            <span><b>Телефон</b><small id="gp-settings-status"></small></span>
        </div>
        <select id="gp-set-lang" class="text_pole gp-settings-language" aria-label="Язык / Language">
            <option value="ru" ${s.lang !== 'en' ? 'selected' : ''}>Русский</option>
            <option value="en" ${s.lang === 'en' ? 'selected' : ''}>English</option>
        </select>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content gp-settings-body">
        <div class="gp-settings-quick">
            <label><input type="checkbox" id="gp-set-enabled" ${s.isEnabled ? 'checked' : ''}><span>Включено</span></label>
            <label><input type="checkbox" id="gp-set-fab" ${s.showFab ? 'checked' : ''}><span>Плавающая кнопка</span></label>
            <label><input type="checkbox" id="gp-set-inject" ${s.injectPrompt ? 'checked' : ''}><span>Инструкции для модели</span></label>
        </div>

        <details class="gp-settings-group" open>
            <summary><i class="fa-solid fa-layer-group"></i><span><b>Модель и контекст</b><small>Профиль, история и параметры ответа</small></span><i class="fa-solid fa-chevron-down gp-settings-chevron"></i></summary>
            <div class="gp-settings-group-body gp-settings-grid">
                <label class="gp-settings-field"><span>Глубина инжекта</span><input type="number" id="gp-set-depth" class="text_pole gp-settings-number" min="0" max="100" step="1" value="${Math.max(0, Number(s.injectDepth) || 0)}"><small>0 — перед последним ходом</small></label>
                <label class="gp-settings-field"><span>Макс. длина ответа</span><input type="number" id="gp-set-maxtokens" class="text_pole gp-settings-number" min="0" max="32000" step="256" value="${s.socialMaxTokens || 0}"><small>0 = авто</small></label>
                <label class="gp-settings-field gp-settings-wide"><span>Профиль для соцсетей</span><span class="gp-settings-control-row"><select id="gp-set-profile" class="text_pole"></select><button class="menu_button gp-settings-icon-button" id="gp-profile-test" type="button" title="Проверить профиль (маленький запрос)" aria-label="Проверить профиль (маленький запрос)"><i class="fa-solid fa-plug-circle-check"></i></button></span></label>
                <label class="gp-settings-field"><span>Контекст соцсетей</span><select id="gp-set-ctxmode" class="text_pole"><option value="rich" ${s.socialContextMode !== 'lite' ? 'selected' : ''}>История + лорбук + карточка бота</option><option value="lite" ${s.socialContextMode === 'lite' ? 'selected' : ''}>Изолированно (только срез чата)</option></select></label>
                <label class="gp-settings-field"><span>Твой ник (@)</span><input type="text" id="gp-set-handle" class="text_pole" maxlength="21" placeholder="авто из имени"></label>
                <div class="gp-settings-checks gp-settings-wide">
                    <label><input type="checkbox" id="gp-set-hide" ${s.hideSmsInChat !== false ? 'checked' : ''}><span>Скрывать смс-переписку из ленты чата</span></label>
                    <label><input type="checkbox" id="gp-set-scam" ${s.scamEnabled !== false ? 'checked' : ''}><span>Спам и мошенники в смс</span></label>
                    <label><input type="checkbox" id="gp-set-prefill" ${s.usePrefill ? 'checked' : ''}><span>Префилл ответа</span></label>
                </div>
            </div>
        </details>

        <details class="gp-settings-group">
            <summary><i class="fa-solid fa-image"></i><span><b>Изображения</b><small>Модель, формат и промпты</small></span><i class="fa-solid fa-chevron-down gp-settings-chevron"></i></summary>
            <div class="gp-settings-group-body gp-settings-grid">
                <label class="gp-settings-field gp-settings-wide"><span>Модель картинок</span><span class="gp-settings-control-row"><input type="text" id="gp-set-imgmodel" class="text_pole" list="gp-imgmodels" placeholder="авто"><datalist id="gp-imgmodels"></datalist><button class="menu_button gp-settings-icon-button" id="gp-imgmodel-refresh" type="button" title="Загрузить список моделей" aria-label="Загрузить список моделей"><i class="fa-solid fa-rotate"></i></button></span></label>
                <label class="gp-settings-field"><span>Профиль картинко-расширения</span><select id="gp-set-imgprofile" class="text_pole"></select></label>
                <label class="gp-settings-field"><span>Стиль картинок телефона</span><select id="gp-set-imgstyle" class="text_pole"></select></label>
                <div class="gp-settings-checks gp-settings-wide">
                    <label><input type="checkbox" id="gp-set-square" ${s.imageGenSquare !== false ? 'checked' : ''}><span>Картинки постов — квадрат 1:1</span></label>
                    <label><input type="checkbox" id="gp-set-tagmode" ${s.imgTagMode ? 'checked' : ''}><span>Booru-теги (для NovelAI/аниме-моделей)</span></label>
                </div>
                <label class="gp-settings-field"><span>Публичные посты</span><textarea id="gp-set-imgprompt-ig" class="text_pole" rows="3"></textarea></label>
                <label class="gp-settings-field"><span>Закрытые посты</span><textarea id="gp-set-imgprompt-of" class="text_pole" rows="3"></textarea></label>
                <label class="gp-settings-field"><span>Твич: чужой эфир</span><textarea id="gp-set-imgprompt-twwatch" class="text_pole" rows="3"></textarea></label>
                <label class="gp-settings-field"><span>Твич: свой эфир</span><textarea id="gp-set-imgprompt-twmy" class="text_pole" rows="3"></textarea></label>
                <div class="gp-settings-wide gp-settings-align-end"><button id="gp-imgprompt-apply" type="button" class="menu_button">Применить</button></div>
            </div>
        </details>

        <details class="gp-settings-group">
            <summary><i class="fa-solid fa-sliders"></i><span><b>Поведение</b><small>Журнал, инжект и плавающая кнопка</small></span><i class="fa-solid fa-chevron-down gp-settings-chevron"></i></summary>
            <div class="gp-settings-group-body">
                <div class="gp-settings-checks">
                    <label><input type="checkbox" id="gp-set-sociallog" ${s.socialLogToChat !== false ? 'checked' : ''}><span>Журнал соцсетей в чат</span></label>
                    <label><input type="checkbox" id="gp-set-compact" ${s.compactRules ? 'checked' : ''}><span>Компактные правила в инжекте</span></label>
                    <label><input type="checkbox" id="gp-set-onlineava" ${s.onlineAvatars !== false ? 'checked' : ''}><span>Аватарки НПС из интернета</span></label>
                </div>
                <button class="menu_button gp-settings-reset" id="gp-reset-fab" type="button">Сбросить позицию кнопки</button>
            </div>
        </details>

        <div class="gp-settings-footer"><small>Обои и свой CSS — в приложении «Оформление» внутри телефона.</small><small id="gp-version-label"></small></div>
    </div>
</div>`;
    $('#extensions_settings2').append(html);
    // Значения назначаются как свойства DOM, не интерполируются в HTML:
    // кавычки и </textarea> в пользовательских промптах/CSS безопасны.
    $('#gp-set-imgmodel').val(s.imageGenModel || '');
    $('#gp-set-imgprompt-ig').val(s.imgPromptIg || '');
    $('#gp-set-imgprompt-of').val(s.imgPromptOf || '');
    $('#gp-set-imgprompt-twwatch').val(s.imgPromptTwWatch || '');
    $('#gp-set-imgprompt-twmy').val(s.imgPromptTwMy || '');
    // Профили подключения картинко-расширения (общее ведро novarakk и форков).
    // '' = телефон рисует через активный профиль основного чата
    {
        const sel = $('#gp-set-imgprofile');
        const profiles = listIigProfiles();
        sel.empty().append(`<option value="">Как в основном чате</option>`);
        for (const p of profiles) sel.append($('<option>').val(p.id).text(p.name));
        if (s.imageGenProfileId && !profiles.some(p => p.id === s.imageGenProfileId)) {
            s.imageGenProfileId = ''; // профиль удалили в расширении — тихий сброс
        }
        sel.val(s.imageGenProfileId || '');
        sel.off('change.gp').on('change.gp', function () {
            getSettings().imageGenProfileId = String($(this).val() || '');
            $('#gp-imgmodels').empty(); // список моделей от старого профиля устарел — ↻ перечитает
            saveSettingsDebounced();
        });
    }
    // Стиль картинок для телефона (стили расширения глобальные — не в профилях)
    {
        const sel = $('#gp-set-imgstyle');
        const styles = listIigStyles();
        sel.empty().append(`<option value="">Как в основном чате</option>`);
        for (const p of styles) sel.append($('<option>').val(p.id).text(p.name));
        if (s.imageGenStyleId && !styles.some(p => p.id === s.imageGenStyleId)) {
            s.imageGenStyleId = ''; // стиль удалили в расширении — тихий сброс
        }
        sel.val(s.imageGenStyleId || '');
        sel.off('change.gp').on('change.gp', function () {
            getSettings().imageGenStyleId = String($(this).val() || '');
            saveSettingsDebounced();
        });
    }
    // Перевод панели (en) — оригиналы хранятся на нодах, переключение обратимо
    const translatePanel = () => { try { trDom(document.getElementById('gp-settings-drawer')); } catch (e) { /* ignore */ } };
    const updatePanelStatus = () => {
        const enabled = getSettings().isEnabled;
        const status = document.getElementById('gp-settings-status');
        document.getElementById('gp-settings-drawer')?.classList.toggle('gp-settings-disabled', !enabled);
        if (status) status.textContent = getSettings().lang === 'en'
            ? (enabled ? 'Enabled' : 'Disabled')
            : (enabled ? 'Включён' : 'Выключен');
    };
    $('#gp-set-lang').on('click mousedown', event => event.stopPropagation());
    translatePanel();
    updatePanelStatus();
    $('#gp-set-lang').on('change', function () {
        getSettings().lang = this.value === 'en' ? 'en' : 'ru';
        saveSettingsDebounced();
        translatePanel();
        updatePanelStatus();
        if (isPhoneOpen()) render();
    });
    $('#gp-set-enabled').on('change', function () {
        getSettings().isEnabled = this.checked;
        saveSettingsDebounced();
        updatePhoneInjection();
        updateFabBadge();
        updatePanelStatus();
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
    $('#gp-set-scam').on('change', function () {
        getSettings().scamEnabled = this.checked;
        saveSettingsDebounced();
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
    $('#gp-imgprompt-apply').on('click', function () {
        getSettings().imgPromptIg = $('#gp-set-imgprompt-ig').val() || '';
        getSettings().imgPromptOf = $('#gp-set-imgprompt-of').val() || '';
        getSettings().imgPromptTwWatch = $('#gp-set-imgprompt-twwatch').val() || '';
        getSettings().imgPromptTwMy = $('#gp-set-imgprompt-twmy').val() || '';
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
    $('#gp-set-onlineava').on('change', function () {
        getSettings().onlineAvatars = this.checked;
        saveSettingsDebounced();
        if (isPhoneOpen()) render();
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
            // Мошенники: редкий скам-смс (сам себя гейтит кулдауном и шансом)
            maybeScamSms().then(sms => { if (sms) deliverScamSms(sms); }).catch(() => {});
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
