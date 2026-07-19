
import { getSettings } from './state.js';

export function lang() {
    return getSettings().lang === 'en' ? 'en' : 'ru';
}

export const DAYS_I18N = {
    ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
export const MONTHS_I18N = {
    ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

// ── Точный словарь (ключ = русская строка после trim) ──
const DICT = {
    // Главный экран / приложения
    'Сообщения': 'Messages', 'Твиттер': 'Twitter', 'Банк': 'Bank', 'Магазин': 'Shop',
    'Оформление': 'Appearance', 'Телефон': 'Phone',
    // Общие кнопки/слова
    'Сохранить': 'Save', 'Применить': 'Apply', 'Добавить': 'Add', 'Удалить': 'Delete',
    'Закрыть': 'Close', 'Отклонить': 'Decline', 'Продолжить': 'Continue', 'Изменить': 'Edit',
    'Настроить': 'Customize', 'Выбрать фото': 'Choose photo', 'ВЫБРАТЬ': 'SELECT',
    'Опубликовать': 'Publish', 'Ответить': 'Reply', 'Нарисовать': 'Draw', 'Оплатить': 'Pay',
    'Оформить': 'Take out', 'Взять': 'Take', 'Внести': 'Pay', 'Вывести': 'Withdraw',
    'Разблокировать': 'Unblock', 'Заблокировать': 'Block', 'Заблокировать аккаунт': 'Block account',
    'Обновить ленту': 'Refresh feed', 'Обновить каталог': 'Refresh catalog', 'Обновить предложения': 'Refresh offers',
    'Перегенерировать': 'Regenerate', 'Другой ответ': 'Another reply', 'Не сейчас': 'Not now',
    'Сбросить кнопку': 'Reset button', 'Сбросить настройки': 'Reset settings', 'Убрать из истории': 'Remove from history',
    'Пусто': 'Empty', 'случайный': 'random', 'авто': 'auto', 'Сегодня': 'Today', 'сейчас': 'now',
    'Имя': 'Name', 'Номер': 'Number', 'Название': 'Title', 'Описание': 'Description',
    'Категория': 'Category', 'Сумма': 'Amount', 'Цена': 'Price', 'Стиль': 'Style',
    'Валюта': 'Currency', 'Баланс': 'Balance', 'Баланс:': 'Balance:', 'Баланс карты': 'Card balance',
    'Аккаунт': 'Account', 'Архив': 'Archive', 'Запись': 'Entry', 'Результат': 'Result', 'Итог': 'Outcome',
    // Сообщения / треды
    'Новый контакт': 'New contact', 'Добавить контакт': 'Add contact',
    'Как в ролевой, точно': 'Exactly as in the roleplay', 'Пусто = случайный': 'Empty = random',
    'Ник (@) для соцсетей': 'Social @handle', 'Пусто = авто из имени': 'Empty = auto from name',
    'авто из имени': 'auto from name',
    'Имя должно совпадать с именем персонажа в чате — тогда его смс попадут в этот тред. Ник и аватар подтянутся в Твиттер/Инсту.': 'The name must match the character\'s name in chat — their texts will land in this thread. The handle and avatar carry over to Twitter/Insta.',
    'Групповой чат': 'Group chat', 'групповой чат': 'group chat', 'Например: Семья': 'e.g.: Family',
    'Сначала добавь контакты — участники выбираются из них': 'Add contacts first — members are picked from them',
    'Создать чат': 'Create chat', 'Назови чат': 'Name the chat',
    'Выбери хотя бы одного участника': 'Pick at least one member',
    'Укажи имя контакта': 'Enter a contact name',
    'Пока никто не дал тебе номер': 'Nobody gave you their number yet',
    'Получи номер в ролевой — контакт появится сам': 'Get a number in the roleplay — the contact appears on its own',
    'Или добавь вручную по кнопке': 'Or add one manually with the button',
    'Начни переписку — сообщение попадёт': 'Start texting — the message goes',
    'прямо в ролевую': 'straight into the roleplay',
    'Нет сообщений — напиши первой': 'No messages — text first',
    'Сообщение...': 'Message...', 'Комментировать...': 'Comment...',
    'номер неизвестен': 'number unknown', 'Тред': 'Thread',
    'Нажми, чтобы переименовать': 'Tap to rename', 'Новое имя контакта:': 'New contact name:',
    'Ник для соцсетей': 'Social handle', 'Приложить фото': 'Attach photo', 'Фото приложено': 'Photo attached',
    'Голосовое сообщение': 'Voice message', 'Расшифровка голосового...': 'Voice transcript...',
    'Воспроизвести': 'Play', 'Сгенерировать фото': 'Generate photo', 'Перегенерировать фото': 'Regenerate photo',
    // Дискорд
    'Серверы найдены': 'Servers found', 'уже генерируется': 'already generating',
    'Серверы не сгенерировались — попробуй ещё раз': 'Servers failed to generate — try again',
    'Канал молчит — попробуй ещё раз': 'The channel is silent — try again',
    'Нажми ↻ — канал оживёт, или напиши первой': 'Tap ↻ to bring the channel alive, or post first',
    'Нажми «+» — модель придумает серверы,': 'Tap “+” — the model will invent servers',
    'где ты могла бы состоять': 'you could be a member of',
    'Текстовые каналы': 'Text channels', 'Покинуть сервер': 'Leave server',
    'Найти серверы': 'Find servers', 'Начало канала.': 'The beginning of the channel.',
    // Твич
    'Начать свой стрим': 'Start your stream', 'Ты в эфире — открыть': 'You are live — open',
    'Эфиры не сгенерировались — попробуй ещё раз': 'Streams failed to generate — try again',
    'Стрим завис — попробуй ещё раз': 'The stream froze — try again',
    'Зрители молчат — попробуй ещё раз': 'The viewers are silent — try again',
    'Нажми ↻ — модель придумает,': 'Tap ↻ — the model will invent',
    'кто сейчас в эфире': 'who is live right now',
    'Название стрима:': 'Stream title:', 'Категория (IRL / игра / музыка...):': 'Category (IRL / gaming / music...):',
    'Написать в чат стрима...': 'Write in stream chat...',
    'Что говоришь / делаешь в кадре...': 'What you say / do on camera...',
    'Что дальше?': "What's next?", 'Пауза: чат живёт сам': 'Pause: chat lives on its own',
    'Завершить стрим': 'End stream', 'Завершить стрим? Итог уйдёт в историю.': 'End the stream? The summary goes to the story.',
    'Чат подгрузится с первым событием': 'Chat loads with the first event',
    'Зрители заходят...': 'Viewers are joining...',
    'Отправить сообщение': 'Send a message', 'Донат': 'Donate',
    'Твич: чужой эфир': "Twitch: someone's stream", 'Твич: свой эфир': 'Twitch: your stream',
    'Профиль картинко-расширения': 'Image extension profile', 'Как в основном чате': 'Same as the main chat',
    'Стиль картинок телефона': 'Phone image style',
    // Сторис
    'Новая сторис': 'New story', 'Твоя сторис': 'Your story', 'Ещё': 'More',
    'Нарисовать по описанию': 'Draw from description', 'Текст на сторис': 'Story text',
    'Подпись поверх фото': 'Text over the photo', 'Для генерации и реакций в ролевой': 'For generation and roleplay reactions',
    'Сторис опубликована': 'Story published', 'Удалить сторис': 'Delete story',
    'Удалить эту сторис?': 'Delete this story?',
    'Опиши, что на фото — по этому и рисуем': 'Describe the photo — that is what gets drawn',
    'Аватарки НПС из интернета': 'NPC avatars from the internet',
    'Появились сторис знакомых': 'People you know posted stories',
    'Сумма доната должна быть больше нуля': 'The donation amount must be above zero',
    'Не хватает денег на счету': 'Not enough money in the account',
    'Сообщение к донату (можно пусто):': 'Donation message (can be empty):',
    'novarakk не установлен — генерация картинок недоступна': 'No image extension installed — image generation unavailable',
    'Удалить это сообщение?': 'Delete this message?', 'Не удалось удалить': 'Failed to delete',
    'Не удалось отправить': 'Failed to send', 'Не удалось загрузить фото': 'Failed to load the photo',
    'Нечего перегенерировать': 'Nothing to regenerate', 'Не удалось перегенерировать': 'Failed to regenerate',
    'Смотрю на фото...': 'Looking at the photo...', 'Фото готово': 'Photo ready',
    'печатает…': 'typing…', 'Кнопка возвращена на место': 'Button reset to default',
    // Твиттер / инста / OF
    'Лента пуста': 'Feed is empty', 'лента сгенерируется': 'the feed will generate',
    'по событиям твоей ролевой': 'from your roleplay events',
    'Комментариев нет — нажми': 'No comments — tap', 'пусть отреагируют': 'let them react',
    'Реакций нет — нажми': 'No reactions — tap', 'фанаты налетят': 'fans will swarm',
    'Сгенерировать реакции': 'Generate reactions', 'Сгенерировать обсуждение': 'Generate replies',
    'Новый пост': 'New post', 'Новый твит в ленте': 'New tweet in the feed',
    'Опубликовано': 'Published', 'Опубликовано для подписчиков': 'Published for subscribers',
    'Подпись к посту': 'Post caption', 'Подпись для подписчиков': 'Caption for subscribers',
    'Что на фото': 'What\'s in the photo',
    'Подпись': 'Caption', 'необязательно': 'optional',
    'Фото прикладывается к запросу — vision-модели смотрят на него сами. Описание нужно только для моделей без вижена (и для реакций в самой ролевой).': 'The photo is attached to the request — vision models see it themselves. A description is only needed for non-vision models (and for reactions inside the roleplay).',
    'Пост приватный: персонажи в ролевой узнают о нём, только если по сюжету тайно подписаны.': 'The post is private: characters learn about it only if the story has them secretly subscribed.',
    'Выбери фото или опиши, что на нём': 'Pick a photo or describe what\'s in it',
    'Твоя страничка пуста': 'Your page is empty',
    'выложить контент для подписчиков': 'post content for subscribers',
    'Фанаты отреагируют и накидают чаевых': 'Fans will react and tip',
    'выложить своё фото': 'post your own photo', 'сгенерировать ленту': 'generate the feed',
    'подписчиков': 'followers', 'на карте': 'on card', 'вывести': 'withdraw',
    'Реакции не сгенерились': 'Reactions failed to generate',
    'Не получилось — попробуй ещё раз': 'Didn\'t work — try again',
    'Не получилось': 'Failed', 'Удалить пост?': 'Delete this post?', 'Удалить твит?': 'Delete this tweet?',
    'Ответить фанатам': 'Reply to fans', 'Реакции фанатов': 'Fan reactions',
    'Он больше не появится в ленте.': 'They will no longer appear in the feed.',
    'Он больше не будет появляться в ленте.': 'They will no longer appear in the feed.',
    'Твит отправлен, но лента не обновилась': 'Tweet sent but the feed didn\'t refresh',
    'Пока нечего выводить': 'Nothing to withdraw yet',
    'Деньги станут доступны тебе в ролевой (персонажи не узнают источник)': 'The money becomes available in the roleplay (characters won\'t know the source)',
    'Вывести на карту': 'Withdraw to card', 'Выведено': 'Withdrawn',
    'Клик — изменить (траты в РП)': 'Click to edit (RP spending)',
    'Оставь пусто и нажми ОК — опишу вижном': 'Leave empty and press OK — vision will describe it',
    'Модели с виженом увидят фото сами': 'Vision models will see the photo themselves',
    'Фото ушло в чат вместе с постом. Текст-описание (для саммари) не задано — клик: вписать вручную; пустой ввод при пустом описании — описать вижном.': 'The photo went to chat with the post. No text description (for summaries) — click to type one; empty input = describe with vision.',
    // Соц-панель (аудитория/задания/ивенты/реклама)
    'Социальный профиль': 'Social profile', 'Профиль и задания': 'Profile & tasks',
    'Задания на постинг': 'Posting tasks', 'Рекламные предложения': 'Ad offers',
    'Предложений пока нет': 'No offers yet', 'Найти предложения': 'Find offers',
    'Запроси свежие интеграции — модель подберёт бренды, товары и оплату под сеттинг текущей ролевой.': 'Request fresh integrations — the model picks brands, products and pay to fit the current roleplay setting.',
    'Модель соберёт три сюжетных поворота из лорбука, карточки, истории RP, журнала телефона и всех недавних постов.': 'The model assembles three story twists from the lorebook, char card, RP history, phone log and all recent posts.',
    'Пока никто не дал тебе номер': 'Nobody gave you their number yet',
    'Получи номер в ролевой — контакт появится сам': 'Get a number in the roleplay — the contact appears on its own',
    'Или добавь вручную по кнопке': 'Or add one manually with the button',
    'Рекламное задание принято': 'Ad brief accepted',
    'Следующая публикация в этой соцсети станет рекламной': 'Your next post on this network will be the ad',
    'Ошибка генерации рекламных предложений': 'Failed to generate ad offers',
    'Модель не вернула подходящих предложений': 'The model returned no suitable offers',
    'Сюжетные ивенты': 'Story events', 'Ивенты': 'Events', 'Сюжетный поворот': 'Story twist',
    'Новая нить истории': 'A new story thread', 'Новый сюжетный поворот': 'A new story twist',
    'Активного ивента пока нет': 'No active event yet',
    'Создать три сюжетных поворота': 'Create three story twists',
    'Три возможных поворота': 'Three possible twists', 'Выбрать ивент': 'Pick an event',
    'Выбери сам ивент. Следующим экраном появятся варианты реакции на него.': 'Pick the event itself. Response options appear on the next screen.',
    'Какую нить вплести в историю?': 'Which thread to weave into the story?',
    'Что вы отвечаете или делаете?': 'What do you say or do?',
    'Написать собственное действие или реплику...': 'Write your own action or line...',
    'Свой ответ': 'Custom reply', 'Твой выбор': 'Your choice',
    'Ждём итог и последствия выбранного ответа': 'Waiting for the outcome of your choice',
    'История меняется…': 'The story is changing…', 'Ивент завершён': 'Event finished',
    'нажми, чтобы прочитать итог': 'tap to read the outcome', 'Итог ивента': 'Event outcome',
    'Выбор изменил историю': 'Your choice changed the story', 'Неудачный исход': 'Bad outcome',
    'Сдвиг аудитории': 'Audience shift', 'Модификатор подписчиков': 'Follower modifier',
    'Отношения': 'Relationships', 'Следующий крючок': 'Next hook', 'Следующая сцена': 'Next scene',
    'Последствие в РП': 'RP consequence', 'Решение принято': 'Decision made',
    'Отклонить все': 'Decline all', 'Отклонить этот сюжетный поворот?': 'Decline this story twist?',
    'Отклонить все предложенные сюжетные повороты?': 'Decline all offered story twists?',
    'Не удалось собрать ивент из контекста': 'Failed to build an event from context',
    'Не удалось продолжить событие': 'Failed to continue the event',
    'Ошибка генерации ивента': 'Event generation error', 'Ошибка генерации': 'Generation error',
    'Сюжетный ивент создан': 'Story event created',
    'Продолжение естественно появится в основном РП': 'The continuation will surface naturally in the main RP',
    'Реакции': 'Reactions', 'охват': 'reach', 'позитив': 'positive', 'негатив': 'negative',
    'Позитивные': 'Positive', 'нейтральные': 'neutral', 'негативные': 'negative', 'нейтр.': 'neut.',
    'Тёплый приём': 'Warm reception', 'Смешанная реакция': 'Mixed reaction',
    'Споры': 'Controversy', 'Негативная волна': 'Backlash',
    'любимец аудитории': 'audience darling', 'хорошая репутация': 'good reputation',
    'нейтральная репутация': 'neutral reputation', 'спорная репутация': 'contested reputation',
    'плохая репутация': 'bad reputation',
    'Журнал памяти': 'Memory log', 'Журнал пока пуст': 'The log is empty for now',
    'Новые посты, комментарии, ответы и итоги ивентов появятся здесь после записи в чат.': 'New posts, comments, replies and event outcomes appear here once written to chat.',
    'Здесь показаны скрытые записи, которые действительно добавлены в историю чата и доступны боту и саммарайзеру.': 'These are the hidden entries actually written into chat history, visible to the bot and summarizer.',
    // Задания на постинг
    'Сказать вслух': 'Say it out loud', 'Опубликовать твит': 'Post a tweet',
    'Новый кадр': 'New shot', 'Опубликовать фото в Instagram': 'Post a photo on Instagram',
    'Получить не менее 65% позитивных реакций': 'Get at least 65% positive reactions',
    'Разговор начался': 'The talk begins', 'Получить 5 реакций под одним постом': 'Get 5 reactions under one post',
    'Новые лица': 'New faces', 'Набрать суммарно 10 подписчиков': 'Gain 10 followers in total',
    'Искра спора': 'Spark of debate', 'Вызвать споры без негативной волны': 'Stir debate without a backlash',
    'На двух экранах': 'On both screens', 'Опубликоваться в обеих соцсетях': 'Post on both networks',
    'рекламная интеграция': 'sponsored integration',
    'Создать органичную рекламную публикацию.': 'Create an organic sponsored post.',
    // Банк
    'Пора платить:': 'Due now:', 'Трата': 'Expense', 'Доход': 'Income',
    'Кредиты': 'Loans', 'Платежи': 'Bills', 'Операции': 'Transactions',
    'Траты по категориям': 'Spending by category',
    'Пока нет операций. Добавь трату или доход, или пусть их создаёт ролевая.': 'No transactions yet. Add an expense or income, or let the roleplay create them.',
    'Новая трата': 'New expense', 'Новый доход': 'New income',
    'Добавить доход': 'Add income', 'Добавить трату': 'Add expense',
    'напр. зарплата': 'e.g. salary', 'напр. кофе': 'e.g. coffee',
    'Доход добавлен': 'Income added', 'Трата добавлена': 'Expense added',
    'Укажи сумму': 'Enter an amount', 'Взять кредит': 'Take a loan',
    'напр. Айфон / Ремонт': 'e.g. iPhone / Renovation', 'Срок (мес.)': 'Term (mo.)',
    'Ставка, % год.': 'Rate, %/yr', 'Число платежа': 'Payment day',
    'Мои кредиты': 'My loans', 'Кредитов нет': 'No loans', 'Погашен': 'Paid off',
    'Осталось': 'Remaining', 'Укажи сумму кредита': 'Enter the loan amount',
    'Кредит оформлен — деньги на счету': 'Loan approved — money is on your account',
    'Удалить кредит из списка? (баланс не изменится)': 'Remove the loan from the list? (balance unchanged)',
    'Обязательные платежи': 'Recurring bills', 'Добавить платёж': 'Add a bill',
    'напр. Аренда / Netflix': 'e.g. Rent / Netflix', 'Сумма/мес': 'Amount/mo',
    'Число месяца': 'Day of month', 'Мои платежи': 'My bills',
    'Обязательных платежей нет': 'No recurring bills', 'пора платить': 'due now',
    'Платёж добавлен': 'Bill added', 'Назови платёж': 'Name the bill', 'Оплачено': 'Paid',
    'Пора оплатить': 'Time to pay', 'Просрочен платёж': 'Payment overdue',
    'Досрочно': 'Pay off early', 'Сумма досрочного платежа': 'Early payment amount',
    'Кредит погашен полностью': 'Loan fully paid off', 'Досрочный платёж внесён': 'Early payment made',
    'Курс неизвестен — суммы не тронуты, сменён только символ': 'Unknown rate — amounts untouched, only the symbol changed',
    'Символ валюты (₽ $ € £ ...):': 'Currency symbol (₽ $ € £ ...):',
    'Ручная правка баланса карты (потратила в РП — спиши)': 'Manually edit the card balance (spent in RP — subtract it)',
    // Категории банка/трат
    'еда': 'food', 'транспорт': 'transport', 'жильё': 'housing', 'подписка': 'subscription',
    'одежда': 'clothes', 'развлечения': 'fun', 'красота': 'beauty', 'здоровье': 'health',
    'подарок': 'gift', 'зарплата': 'salary', 'перевод': 'transfer', 'другое': 'other',
    'кредит': 'loan', 'ролевая': 'roleplay', 'покупки': 'shopping', 'смс банка': 'bank sms',
    'реклама': 'ads',
    // Магазин
    'Доставка еды': 'Food delivery', 'Продукты': 'Groceries', 'Одежда': 'Clothes',
    'Косметика': 'Beauty', 'Детские товары': 'Kids\' goods', 'Бытовая техника': 'Appliances',
    'Ювелирка': 'Jewelry', 'Мебель': 'Furniture', 'Товары для дома': 'Home goods',
    'Секс-шоп': 'Adult store', 'Отели': 'Hotels', 'Тур-агенство': 'Travel agency',
    'Свой магазин': 'Custom shop', 'Мои заказы': 'My orders', 'Заказов пока нет': 'No orders yet',
    'Каталог пуст.': 'The catalog is empty.', 'Каталог загружен': 'Catalog loaded',
    'Загрузить каталог': 'Load catalog', 'Загружаю каталог...': 'Loading catalog...',
    'Магазины и товары подбираются под твою ролевую': 'Stores and goods are tailored to your roleplay',
    'магазины и цены сгенерируются': 'stores and prices will generate',
    'под город/страну твоей ролевой': 'for your roleplay\'s city/country',
    'Какой магазин нужен? (например: зоомагазин, оружейный, цветы, книжный...)': 'What shop do you need? (e.g.: pet store, gun shop, flowers, books...)',
    'Удалить эту категорию?': 'Delete this category?',
    // Настройки (панель расширения)
    'Включено': 'Enabled', 'Плавающая кнопка': 'Floating button',
    'Инструкции для модели (теги смс/контактов)': 'Model instructions (sms/contact tags)',
    'Скрывать смс-переписку из ленты чата': 'Hide texting from the chat feed',
    'Профиль для соцсетей:': 'Social profile:', 'Префилл ответа': 'Response prefill',
    'Контекст соцсетей:': 'Social context:', 'История + лорбук + карточка бота': 'History + lorebook + char card',
    'Изолированно (только срез чата)': 'Isolated (chat slice only)',
    'Макс. длина ответа:': 'Max response length:', '0 = авто': '0 = auto',
    'Глубина инжекта:': 'Injection depth:', '0 = последний ход': '0 = last turn',
    'Твой ник (@):': 'Your handle (@):', 'Модель картинок:': 'Image model:',
    'Картинки постов — квадрат 1:1': 'Post images — square 1:1',
    'Booru-теги (для NovelAI/аниме-моделей)': 'Booru tags (for NovelAI/anime models)',
    'Промпты картинок': 'Image prompts', 'Промпты картинок сохранены': 'Image prompts saved',
    'Instagram (стиль/кадр — описание поста и запрет на главперсонажей дописываются сами):': 'Instagram (style/framing — post description and main-character guard are appended automatically):',
    'Журнал соцсетей в чат (память для саммарайза)': 'Social log to chat (memory for summaries)',
    'Компактные правила в инжекте (экономия токенов)': 'Compact rules in the injection (saves tokens)',
    'Скин:': 'Skin:', 'Обои:': 'Wallpaper:', 'Загрузить фото': 'Upload photo', 'Сменить фото': 'Change photo',
    'Убрать обои': 'Remove wallpaper', 'Размыть обои': 'Blur wallpaper',
    'Обои установлены': 'Wallpaper set', 'Обои убраны': 'Wallpaper removed',
    'Не удалось загрузить обои': 'Failed to load the wallpaper',
    'CSS телефона ▼': 'Phone CSS ▼', 'CSS телефона ▲': 'Phone CSS ▲', 'CSS применён': 'CSS applied',
    'Сбросить позицию кнопки': 'Reset button position', 'Версия:': 'Version:',
    'Проверить профиль (маленький запрос)': 'Test the profile (tiny request)',
    'Профиль не отвечает:': 'Profile not responding:', 'Профиль ОК:': 'Profile OK:',
    'Профиль не выбран (стоит «Текущий API»)': 'No profile selected ("Current API" is set)',
    'Текущий API (изолированно, без пресета)': 'Current API (isolated, no preset)',
    'Язык / Language:': 'Language:',
    'Модель и контекст': 'Model and context', 'Профиль, история и параметры ответа': 'Profile, history and response settings',
    'Изображения': 'Images', 'Модель, формат и промпты': 'Model, format and prompts',
    'Поведение': 'Behavior', 'Журнал, инжект и плавающая кнопка': 'Log, injection and floating button',
    'Макс. длина ответа': 'Max response length', 'Профиль для соцсетей': 'Social profile',
    'Контекст соцсетей': 'Social context', 'Твой ник (@)': 'Your handle (@)', 'Модель картинок': 'Image model',
    'Публичные посты': 'Public posts', 'Закрытые посты': 'Private posts',
    // Оформление (темы)
    'Цвет фона': 'Background color', 'Цвет текста': 'Text color', 'Шрифт': 'Font', 'Цвет иконок': 'Icon color', 'Вернуть иконки темы': 'Restore theme icons',
    'Как в теме': 'Theme default', 'С засечками': 'Serif', 'Моноширинный': 'Monospace',
    'Округлый': 'Rounded', 'Узкий': 'Condensed',
    'Вернуть фон темы': 'Restore theme background', 'Вернуть цвет темы': 'Restore theme color',
    'Свой CSS': 'Custom CSS', 'Применить CSS': 'Apply CSS', 'Полный контроль': 'Full control', 'под обоями': 'under wallpaper',
    'Обои и свой CSS — в приложении «Оформление» внутри телефона.': 'Wallpaper and custom CSS live in the Appearance app inside the phone.',
    'Акцент': 'Accent', 'Скругление': 'Corner radius', 'Прозрачность': 'Transparency',
    'Размер иконок': 'Icon size', 'Мои пресеты': 'My presets', 'Мой пресет': 'My preset',
    'Название пресета': 'Preset name', 'Сохранить текущую': 'Save current',
    'Здесь появятся ваши варианты оформления': 'Your saved looks will appear here',
    'Настройки темы сброшены': 'Theme settings reset', 'Индиго': 'Indigo', 'Закат': 'Sunset',
    'Зефир': 'Zephyr', 'Неон': 'Neon', 'Нуар': 'Noir', 'Глубокий лес': 'Deep forest',
    'Пиксельное ретро': 'Pixel retro', 'Тёплое стекло': 'Warm glass', 'Чёрное золото': 'Black gold',
    'Светлый день': 'Bright day', 'Мягкий': 'Soft',
    // Добор по аудиту шаблонов
    '0 = по подписке': '0 = subscription-only', '0 — перед последним ходом': '0 — before the last turn',
    'Глубина инжекта': 'Injection depth', 'Журнал соцсетей в чат': 'Social log to chat',
    'Загрузить список моделей': 'Load model list', 'Изменить @ник': 'Edit @handle',
    'Инструкции для модели': 'Model instructions', 'Компактные правила в инжекте': 'Compact injection rules',
    'Написать собственное действие или реплику': 'Write your own action or line',
    'Последствие в RP': 'RP consequence', 'Пост': 'Post', 'Ты:': 'You:',
    'Продолжение естественно появится в основном RP': 'The continuation will surface naturally in the main RP',
    'Цена PPV, $': 'PPV price, $',
    'Фото ушло в чат вместе с постом. Текст-описание (для саммари) не задано — клик: вписать, или оставь пусто для вижна.': 'The photo went to chat with the post. No text description (for summaries) — click to type one, or leave empty for vision.',
    // Добор по инвентарю
    'Нажми': 'Tap', 'Вернуться в архив': 'Back to archive', 'АКТИВНА': 'ACTIVE',
    'Или нажми «Нарисовать» после публикации': 'Or tap "Draw" after publishing',
    'Клик — загрузить фото контакта': 'Click to upload a contact photo',
    'Клик — изменить': 'Click to edit', 'Новых постов': 'New posts', 'Новых твитов': 'New tweets',
    'Новых предложений': 'New offers', 'новых реакций': 'new reactions',
    'Отклонено': 'Declined', 'Принято': 'Accepted', 'отреагировали': 'reacted',
    'ответила под твитом': 'replied under a tweet', 'опубликовала фото в': 'posted a photo on',
    'прокомментировали': 'commented', 'Срочно': 'Urgent', 'Фото из записи': 'Photo from the entry',
    'Что происходит?': 'What\'s happening?', 'Убрать все с экрана': 'Remove all from screen',
    'Реклама': 'Ad', 'Бренд': 'Brand', 'Платёж': 'Payment', 'мес': 'mo',
    'заблокированы': 'blocked', 'разблокированы': 'unblocked',
    'Новые сообщения не будут попадать в телефон': 'New messages will no longer reach the phone',
    'Сообщения в самом чате останутся.': 'Messages remain in the chat itself.',
    'Заблокировать этот номер?': 'Block this number?',
    'Заблокирован': 'Blocked', 'Разблокирован': 'Unblocked',
    // Казино / новости / почта / заметки / галерея / скам
    'Казино': 'Casino', 'Новости': 'News', 'Заметки': 'Notes',
    'Ставка': 'Bet', 'Слоты': 'Slots', 'Крутить': 'Spin', 'Рулетка': 'Roulette',
    'Красное ×2': 'Red ×2', 'Чёрное ×2': 'Black ×2', 'Число ×36': 'Number ×36',
    'Три одинаковых — до ×200. Два — небольшой выигрыш.': 'Three of a kind — up to ×200. Two — a small win.',
    'Статистика': 'Stats', 'Спинов:': 'Spins:', 'Выиграно:': 'Won:', 'Поставлено:': 'Wagered:', 'Лучший куш:': 'Best win:',
    'Не хватает денег на счету': 'Not enough money on the account', 'Укажи число 0-36': 'Enter a number 0-36',
    'Нажми  — новости города и мира': 'Tap  — city and world news',
    'сгенерируются под твою ролевую': 'will generate to fit your roleplay',
    'Обсудить в ролевой': 'Discuss in the roleplay',
    'Ролевая узнает, что ты это прочитала': 'The roleplay learns you read this',
    'Ушло в ролевую — персонажи могут отреагировать': 'Sent to the roleplay — characters may react',
    'Новая заметка...': 'New note...', 'Отменить правку': 'Cancel editing',
    'Заметок пока нет. Секретные видишь только ты; с глазом — фоновое знание для нарратора.': 'No notes yet. Secret ones are yours alone; the eye makes one background knowledge for the narrator.',
    'видна модели': 'visible to the model', 'секретная': 'secret',
    'Сделать секретной': 'Make secret', 'Показать модели (фоново)': 'Show to the model (background)',
    'Нажми, чтобы отредактировать': 'Tap to edit', 'Удалить заметку?': 'Delete this note?',
    'Пока пусто': 'Empty for now',
    'Здесь соберутся все фото:': 'All photos will gather here:',
    'из смс, постов и чата': 'from texts, posts and chat',
    'Спам и мошенники в смс': 'Spam & scammers in SMS',
    'Новое сообщение': 'New message',
    // Прочее
    'Генерация...': 'Generating...', 'Перегенерация...': 'Regenerating...',
    'Составляю теги...': 'Composing tags...', 'Инициализация...': 'Initializing...',
    'Из ролевой': 'From the roleplay', 'из ролевой': 'from the roleplay',
    'группа': 'group', 'контакт': 'contact',
};

// ── Regex-правила для строк с числами/динамикой (порядок важен) ──
const RULES = [
    [/^(\d+)\s*м$/, '$1m'], [/^(\d+)\s*ч$/, '$1h'], [/^(\d+)\s*д$/, '$1d'],
    [/^(\d+) участ\.$/, '$1 members'], [/^(\d+) канал\.$/, '$1 channels'],
    [/^Выйти с сервера «(.+)»\?$/, 'Leave the server "$1"?'],
    [/^Участники — (\d+)$/, 'Members — $1'],
    [/^Сумма доната для (.+):$/, 'Donation amount for $1:'],
    [/^донаты (.+)$/, 'donations $1'],
    [/^Добро пожаловать в #(.+)!$/, 'Welcome to #$1!'],
    [/^Написать в #(.+)$/, 'Message #$1'],
    [/^Банк: (\d+) операц(?:ия|ии|ий) из ролевой$/, 'Bank: $1 transaction(s) from the roleplay'],
    [/^Куплено: (.+)$/, 'Bought: $1'],
    [/^«(.+)» заблокирован$/, '"$1" blocked'],
    [/^Заблокировать «(.+)»\? Он больше не (?:будет появляться|появится) в ленте\.?$/, 'Block "$1"? They will no longer appear in the feed.'],
    [/^Ник для (.+) в соцсетях \(без @\):$/, 'Social handle for $1 (without @):'],
    [/^Пора оплатить: (.+)$/, 'Time to pay: $1'],
    [/^Просрочен платёж: (.+)$/, 'Payment overdue: $1'],
    [/^Моделей: (\d+) — открой поле, появится список$/, '$1 models — open the field for the list'],
    [/^Не удалось: (.+)$/, 'Failed: $1'],
    [/^Не получилось: (.+)$/, 'Failed: $1'],
    [/^Реакции не сгенерились: (.+)$/, 'Reactions failed: $1'],
    [/^Профиль: (.+)$/, 'Profile: $1'],
    [/^Профиль ОК: (.+)$/, 'Profile OK: $1'],
    [/^Профиль не отвечает: (.+)$/, 'Profile not responding: $1'],
    [/^Реклама\s+(.+)$/, 'Ad · $1'],
    [/^Суммы конвертированы: (.+)$/, 'Amounts converted: $1'],
    [/^Выигрыш (.+)!$/, 'You won $1!'],
    [/^Новостей: \+(\d+)$/, 'News: +$1'],
    [/^Платёж по кредиту «(.+)»$/, 'Loan payment "$1"'],
    [/^Кредит «(.+)»$/, 'Loan "$1"'],
    [/(\d+)-го числа/g, 'on day $1'],
    [/^платёж\s/, 'payment '],
    [/\/мес(?![а-яё])/g, '/mo'],
    [/^(\d+)\/40 нед/, '$1/40 wk'],
    [/^Осталось\s*$/, 'Remaining '],
    [/^Пора платить:$/, 'Due now:'],
    [/^Версия: (.+)$/, 'Version: $1'],
    [/^Запись #(\d+)$/, 'Entry #$1'],
    [/^Модификатор подписчиков: ×(.+)$/, 'Follower modifier: ×$1'],
    [/^Позитивные (\d+)% · нейтральные (\d+)% · негативные (\d+)%$/, 'Positive $1% · neutral $2% · negative $3%'],
    [/^([+-]?\d+%?)\s*позитив$/, '$1 positive'],
    [/^([+-]?\d+%?)\s*нейтр\.?$/, '$1 neutral'],
    [/^([+-]?\d+%?)\s*негатив$/, '$1 negative'],
    [/^(.+?)\s*([▼▲])$/, null], // стрелка-тоггл: обрабатывается в trPiece
];

// Перевод одного фрагмента с фолбэками:
// точный словарь → regex-правила → без хвостовой пунктуации → без ведущего
// тире → по частям « · ». Возвращает null, если ничего не подошло.
function trPiece(t, depth = 0) {
    if (!t || depth > 3) return null;
    const hit = DICT[t];
    if (hit !== undefined) return hit;
    // Правила применяются КУМУЛЯТИВНО (в «1 500 ₽/мес, 10-го числа» срабатывают
    // и /мес, и -го числа); rep === null — спец-обработка ниже
    let out = t, changed = false;
    for (const [re, rep] of RULES) {
        if (rep === null) continue;
        re.lastIndex = 0;
        if (re.test(out)) {
            re.lastIndex = 0;
            out = out.replace(re, rep);
            changed = true;
        }
    }
    if (changed) return out;
    // «Строка ▼/▲» (кнопки-тогглы)
    const arrow = t.match(/^(.+?)\s*([▼▲])$/);
    if (arrow) {
        const core = trPiece(arrow[1].trim(), depth + 1);
        if (core !== null) return `${core} ${arrow[2]}`;
    }
    // «Строка.» / «Строка…» — переводим ядро, пунктуацию возвращаем
    const punct = t.match(/^(.*?)([.…!?:]+)$/);
    if (punct && punct[1].trim()) {
        const core = trPiece(punct[1].trim(), depth + 1);
        if (core !== null) return core + punct[2];
    }
    // «, строка» (текст-нода после иконки с ведущей запятой/двоеточием)
    const lead = t.match(/^([,;:]\s*)(.+)$/);
    if (lead) {
        const rest = trPiece(lead[2].trim(), depth + 1);
        if (rest !== null) return lead[1] + rest;
    }
    // «— строка» (текст-нода после иконки)
    const dash = t.match(/^([—–-]\s+)(.+)$/);
    if (dash) {
        const rest = trPiece(dash[2].trim(), depth + 1);
        if (rest !== null) return dash[1] + rest;
    }
    // «(строка)» — переводим содержимое скобок
    const paren = t.match(/^\((.+)\)$/);
    if (paren) {
        const core = trPiece(paren[1].trim(), depth + 1);
        if (core !== null) return `(${core})`;
    }
    // Составная «а · б · в» — переводим каждую часть, непереведённые оставляем
    if (t.includes(' · ')) {
        const parts = t.split(' · ');
        let any = false;
        const out = parts.map(p => {
            const r = trPiece(p.trim(), depth + 1);
            if (r !== null) { any = true; return r; }
            return p.trim();
        });
        if (any) return out.join(' · ');
    }
    return null;
}

export function tr(s) {
    if (lang() !== 'en') return s;
    const key = String(s ?? '');
    const trimmed = key.trim();
    if (!trimmed) return s;
    const res = trPiece(trimmed);
    if (res !== null) return key.replace(trimmed, res);
    return s;
}

// ── Перевод отрендеренного DOM ──
// Оригинал хранится прямо на ноде (__gpRu) → переключение языков обратимо.
const ATTRS = ['placeholder', 'title', 'aria-label'];

export function trDom(root) {
    if (!root) return;
    const en = lang() === 'en';
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'TEXTAREA') continue;
        if (node.__gpRu === undefined) {
            if (!en) continue;
            if (!/[А-ЯЁа-яё]/.test(node.nodeValue)) continue;
            node.__gpRu = node.nodeValue;
        }
        node.nodeValue = en ? tr(node.__gpRu) : node.__gpRu;
    }
    const els = [root, ...root.querySelectorAll('*')];
    for (const el of els) {
        if (!el.getAttribute) continue;
        for (const attr of ATTRS) {
            const cur = el.getAttribute(attr);
            const saved = el.dataset ? el.dataset[`gpRu${attr.replace(/[^a-z]/g, '')}`] : undefined;
            if (saved === undefined) {
                if (!en || !cur || !/[А-ЯЁа-яё]/.test(cur)) continue;
                el.dataset[`gpRu${attr.replace(/[^a-z]/g, '')}`] = cur;
                el.setAttribute(attr, tr(cur));
            } else {
                el.setAttribute(attr, en ? tr(saved) : saved);
            }
        }
    }
}
