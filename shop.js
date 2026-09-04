
import { getMeta, saveMeta, getRpDateTime } from './state.js';
import { generateShopContent, generateShopSearch, logSocialToChat, getUserName, generateCourier, generateCourierReply } from './social.js';
import { addTransaction, getBank, fmtMoney } from './bank.js';
import { lang } from './i18n.js';

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Категории (иконки FontAwesome). hint — подсказка модели про ассортимент.
export const SHOP_CATS = [
    { id: 'food', name: 'Доставка еды', icon: 'fa-burger', hint: 'Restaurants / food delivery: dishes, cuisines, combos, desserts.' },
    { id: 'grocery', name: 'Продукты', icon: 'fa-basket-shopping', hint: 'Grocery / supermarket goods and everyday products.' },
    { id: 'clothes', name: 'Одежда', icon: 'fa-shirt', hint: 'Clothing stores: dresses, outerwear, shoes, accessories — fitting local fashion.' },
    { id: 'beauty', name: 'Косметика', icon: 'fa-spray-can-sparkles', hint: 'Cosmetics / beauty: makeup, skincare, perfume, haircare.' },
    { id: 'kids', name: 'Детские товары', icon: 'fa-baby-carriage', hint: 'Baby & kids goods: clothes, toys, strollers, care products, nursery.' },
    { id: 'tech', name: 'Бытовая техника', icon: 'fa-blender', hint: 'Home appliances and electronics (fridges, phones, gadgets).' },
    { id: 'jewelry', name: 'Ювелирка', icon: 'fa-gem', hint: 'Jewelry: rings, necklaces, earrings, luxury watches.' },
    { id: 'furniture', name: 'Мебель', icon: 'fa-couch', hint: 'Furniture: sofas, beds, tables, storage.' },
    { id: 'home', name: 'Товары для дома', icon: 'fa-house-chimney', hint: 'Home goods, decor, kitchenware, textiles.' },
    { id: 'adult', name: 'Секс-шоп', icon: 'fa-fire', hint: 'Adult store — toys, lingerie, NSFW items. Be explicit and tasteful, do not sanitize.' },
    { id: 'hotels', name: 'Отели', icon: 'fa-hotel', hint: 'Hotels — each "store" is a hotel, items are room types per night with prices.' },
    { id: 'travel', name: 'Тур-агенство', icon: 'fa-plane', hint: 'Travel agency — each "store" is an operator, items are tour packages/trips with prices.' },
];

// Кастомные категории юзера (per-chat): «пропиши какой магазин нужен»
export function getCustomCats() {
    const s = getShop();
    if (!Array.isArray(s.customCats)) s.customCats = [];
    return s.customCats;
}
export function addCustomCat(name) {
    const n = String(name || '').trim().slice(0, 40);
    if (!n) return null;
    const cat = { id: 'custom_' + genId(), name: n, icon: 'fa-store', hint: `Custom shop category requested by the user: "${n}". Generate stores and items matching this request.`, custom: true };
    getCustomCats().push(cat);
    saveMeta();
    return cat;
}
export function delCustomCat(id) {
    const s = getShop();
    s.customCats = getCustomCats().filter(c => c.id !== id);
    delete s.cats[id]; // каталог тоже удаляем
    saveMeta();
}

export function catById(id) {
    return SHOP_CATS.find(c => c.id === id) || getCustomCats().find(c => c.id === id) || null;
}

export function getShop() {
    const m = getMeta();
    if (!m.shop || typeof m.shop !== 'object') m.shop = {};
    const s = m.shop;
    if (!s.cats || typeof s.cats !== 'object') s.cats = {};
    if (!Array.isArray(s.orders)) s.orders = [];
    return s;
}

export function getCategory(catId) {
    return getShop().cats[catId] || null;
}

// Категория «активна» (что-то сгенерировано/куплено) — на будущее/бейджи
export function shopActive() {
    const s = getShop();
    return Object.keys(s.cats).length > 0 || s.orders.length > 0;
}

// Последовательная очередь генераций
let _genChain = Promise.resolve();
export function generateCategory(catId, onStatus) {
    const run = () => _generateCategory(catId, onStatus);
    const p = _genChain.then(run, run);
    _genChain = p.then(() => {}, () => {});
    return p;
}

async function _generateCategory(catId, onStatus) {
    const cat = catById(catId);
    if (!cat) throw new Error('Неизвестная категория');
    onStatus?.('Загружаю каталог...');
    const currency = getBank().currency;
    const arr = await generateShopContent(cat.name, cat.hint, currency);
    if (!Array.isArray(arr) || arr.length === 0) throw new Error('Каталог не сгенерировался — попробуй ещё раз');
    const stores = arr.map(st => ({
        id: genId(),
        name: String(st.store || 'Магазин').slice(0, 50),
        items: (Array.isArray(st.items) ? st.items : []).filter(it => it && it.name).slice(0, 10).map(it => ({
            id: genId(),
            name: String(it.name).slice(0, 70),
            price: Math.max(0, Math.round(Number(it.price) || 0)),
            desc: String(it.desc || '').slice(0, 160),
        })),
    })).filter(st => st.items.length > 0);
    if (stores.length === 0) throw new Error('Пустой каталог');
    getShop().cats[catId] = { stores, at: Date.now() };
    saveMeta();
    return stores;
}

// ── Поиск: ИИ подбирает товары под запрос и докидывает их в существующие магазины ──
let _searchChain = Promise.resolve();
export function searchShopItems(catId, query) {
    const run = () => _searchShopItems(catId, query);
    const p = _searchChain.then(run, run);
    _searchChain = p.then(() => {}, () => {});
    return p;
}

async function _searchShopItems(catId, query) {
    const cat = catById(catId);
    if (!cat) throw new Error('Неизвестная категория');
    const data = getCategory(catId);
    if (!data?.stores?.length) throw new Error('Каталог пуст — сначала загрузи его');
    const q = String(query || '').trim();
    if (!q) return [];
    const arr = await generateShopSearch(cat.name, data.stores.map(s => s.name), q, getBank().currency);
    if (!Array.isArray(arr) || !arr.length) throw new Error('Ничего не нашлось — попробуй переформулировать');
    const added = [];
    for (const st of arr) {
        const target = data.stores.find(x => x.name.toLowerCase() === String(st.store || '').toLowerCase()) || data.stores[0];
        for (const it of (Array.isArray(st.items) ? st.items : [])) {
            const name = String(it?.name || '').trim().slice(0, 70);
            if (!name) continue;
            if (target.items.some(x => x.name.toLowerCase() === name.toLowerCase())) continue;
            if (target.items.length >= 40) break;   // магазин не бездонный
            const item = { id: genId(), name, price: Math.max(1, Math.round(Number(it.price) || 0)), desc: String(it.desc || '').slice(0, 160) };
            target.items.push(item);
            added.push({ storeId: target.id, item });
        }
    }
    if (added.length) saveMeta();
    return added;
}

// Купить товар: списываем с банка, пишем заказ, событие в чат (ролевая узнаёт)
export function buyItem(catId, storeId, itemId) {
    const s = getShop();
    const cat = s.cats[catId];
    if (!cat) return null;
    const store = cat.stores.find(x => x.id === storeId);
    if (!store) return null;
    const item = store.items.find(x => x.id === itemId);
    if (!item) return null;

    addTransaction({ amount: -item.price, label: item.name, category: 'покупки' });

    // Корзина: пока курьер не выехал, добор из того же магазина идёт в тот же
    // заказ. Иначе два круассана из одной «Азбуки» ехали бы по отдельности,
    // каждый со своим сроком.
    const open = s.orders.find(o => o.stage === 'placed' && o.cat === catId && o.store === store.name
        && (o.placedTurn === chatLen() || Date.now() - (o.time || 0) < 15 * 60 * 1000));
    if (open) {
        if (!Array.isArray(open.items)) open.items = [{ name: open.item, price: open.price }];
        open.items.push({ name: item.name, price: item.price });
        open.price += item.price;
        saveMeta();
        try {
            logSocialToChat(`${getUserName()} добавляет «${item.name}» (${store.name}) к заказу за ${fmtMoney(item.price)}`);
        } catch (e) { /* ignore */ }
        return { ...open, merged: true };
    }

    const order = { id: genId(), item: item.name, price: item.price, store: store.name, cat: catId, time: Date.now(), items: [{ name: item.name, price: item.price }] };
    if (BOOKING_CATS.has(catId)) {
        order.stage = 'booked';
    } else {
        const [lo, hi] = DELIVERY_ETA[catId] || DEFAULT_ETA;
        order.eta = Math.round(lo + Math.random() * (hi - lo));
        order.stage = 'placed';
        order.placedRp = rpMinutes();       // null, если в ролевой нет дат
        order.placedTurn = chatLen();
    }
    s.orders.unshift(order);
    if (s.orders.length > 100) s.orders = s.orders.slice(0, 100);
    saveMeta();

    // Событие для ролевой (скрытая строка в чат, уважает настройку журнала)
    try {
        const verb = catId === 'hotels' ? 'бронирует' : (catId === 'travel' ? 'оформляет тур' : 'заказывает');
        logSocialToChat(`${getUserName()} ${verb} «${item.name}» (${store.name}) за ${fmtMoney(item.price)}`);
    } catch (e) { /* ignore */ }
    return order;
}

// ═══ ДОСТАВКА ═══
// Заказ едет по RP-времени, а если в ролевой дат нет — по ходам чата,
// чтобы посылка не висела «в пути» вечно.

// Минуты RP-времени: [минимум, максимум] — конкретный срок разыгрывается при заказе
const DELIVERY_ETA = {
    food: [30, 75],
    grocery: [60, 150],
    clothes: [1440, 4320],
    beauty: [1440, 2880],
    kids: [1440, 4320],
    tech: [2880, 7200],
    jewelry: [1440, 4320],
    furniture: [4320, 10080],
    home: [1440, 4320],
    adult: [1440, 4320],
};
const DEFAULT_ETA = [1440, 4320];
const MIN_PER_TURN = 12;        // один ход ролевой ≈ столько минут
// Бронь, а не посылка: везти нечего
const BOOKING_CATS = new Set(['hotels', 'travel']);

function rpMinutes() {
    const d = getRpDateTime();
    if (!d || !Number.isFinite(d.year)) return null;
    return Math.floor(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1, d.hours || 0, d.minutes || 0) / 60000);
}
// Ходы ролевой, а не длина массива: телефон сам дописывает в чат строки
// журнала («Событие мира…»), и без фильтра собственная публикация поста
// подгоняла курьера.
function chatLen() {
    try {
        const chat = SillyTavern.getContext()?.chat || [];
        let n = 0;
        for (const m of chat) {
            if (!m || m.is_system) continue;
            if (/<!--\s*tel:log/i.test(String(m.mes || ''))) continue;
            n++;
        }
        return n;
    } catch (e) { return 0; }
}

// Человеческий срок: «~35 мин», «~2 часа», «~3 дня».
// Язык выбираем здесь, а не правилом перевода: срок попадает внутрь других
// строк, и подстрочное правило ловило бы похожие куски реплик из ролевой.
export function fmtEta(min) {
    min = Math.max(0, Math.round(min));
    const en = lang() === 'en';
    if (min < 60) {
        const m = Math.max(5, Math.round(min / 5) * 5);
        return en ? `~${m} min` : `~${m} мин`;
    }
    if (min < 1440) {
        const h = Math.round(min / 60);
        return en ? `~${h} h` : `~${h} ${h === 1 ? 'час' : h < 5 ? 'часа' : 'часов'}`;
    }
    const d = Math.round(min / 1440);
    return en ? `~${d} d` : `~${d} ${d === 1 ? 'день' : d < 5 ? 'дня' : 'дней'}`;
}

// Доля пройденного пути 0..1. RP-время (если в ролевой есть даты) МОЖЕТ
// только ускорить курьера, но не остановить: ходовой счётчик — постоянный
// пол. Строгий режим «только по часам сюжета» отменён: модель внутри сцены
// держит одну метку времени десятки реплик, часы стоят — и заказ висел
// сутками, пока пользователь не шевелил сцену письмом курьеру.
function orderProgress(o) {
    if (!o.eta) return 1;
    let byRp = 0;
    const now = rpMinutes();
    const haveRp = now !== null && Number.isFinite(o.placedRp);
    if (haveRp) {
        const d = now - o.placedRp;
        // Отрицательное — флешбэк/скачок назад; огромное — смена ролевой
        if (d >= 0 && d < 60 * 1440 * 60) byRp = d / o.eta;
    }
    // Не меньше трёх ходов даже у самой быстрой доставки: за один ответ
    // ролевой курьер приехать не может
    const turnsNeeded = Math.min(20, Math.max(3, Math.round(o.eta / MIN_PER_TURN)));
    const byTurns = Math.max(0, chatLen() - (o.placedTurn || 0)) / turnsNeeded;
    return Math.max(byRp, byTurns);
}

// Осталось ждать (минуты RP) — для карточки заказа
export function orderLeft(o) {
    if (!o.eta) return 0;
    return Math.max(0, Math.round(o.eta * (1 - Math.min(1, orderProgress(o)))));
}

function stageFor(o) {
    const p = orderProgress(o);
    if (p >= 1) return 'done';
    if (p >= 0.5) return 'way';
    return 'placed';
}

// Двигаем заказы и отдаём только НОВЫЕ переходы — по ним UI бросает уведомления.
// Вызывается на каждое сообщение ролевой.
export function advanceOrders() {
    const events = [];
    let dirty = false;
    for (const o of getShop().orders) {
        // Заказы до появления доставки и брони отелей/туров не едут
        if (!o.stage || o.stage === 'done' || o.stage === 'booked') continue;
        let next = stageFor(o);
        // Не больше одной ступени за раз. Часы сюжета умеют прыгать (модель
        // отсчитала полдня одной репликой, метка съехала после свайпа) — без
        // этого свежий заказ приезжал бы мгновенно, не побывав в пути и даже
        // не получив курьера.
        if (o.stage === 'placed' && next === 'done') next = 'way';
        if (next === o.stage) continue;
        o.stage = next;
        dirty = true;
        events.push({ order: o, stage: next });
        if (next === 'done') {
            try {
                const who = o.courier?.name ? `Курьер ${o.courier.name}` : 'Курьер';
                logSocialToChat(`${who} доставил ${getUserName()} заказ «${o.item}» (${o.store})`);
            } catch (e) { /* ignore */ }
        }
    }
    if (dirty) saveMeta();
    return events;
}

// ═══ КУРЬЕР ═══
// Назначается лениво — в момент, когда заказ выехал, и одним запросом:
// пока посылка собирается, курьера ещё нет, придумывать некого.

export function findOrder(id) { return getShop().orders.find(o => o.id === id) || null; }

let _courierBusy = new Set();

// Назначить курьера и получить от него первое сообщение. Идемпотентна.
export async function ensureCourier(orderId) {
    const o = findOrder(orderId);
    if (!o || o.courier) return o?.courier || null;
    if (_courierBusy.has(orderId)) return null;
    _courierBusy.add(orderId);
    try {
        // Курьера могут назначить ещё на сборке — тогда и пишет он про сборку
        const c = await generateCourier(o, fmtEta(orderLeft(o)), o.stage === 'placed');
        // За время запроса заказ мог быть удалён
        const cur = findOrder(orderId);
        if (!cur) return null;
        cur.courier = { name: c.name };
        cur.chat = Array.isArray(cur.chat) ? cur.chat : [];
        if (c.text) cur.chat.push({ text: c.text, ts: Date.now() });
        saveMeta();
        return cur.courier;
    } finally {
        _courierBusy.delete(orderId);
    }
}

export function orderChat(o) { return Array.isArray(o?.chat) ? o.chat : []; }

// Непрочитанное от курьера — бейдж на заказе
export function courierUnread(o) {
    const seen = o?.chatRead || 0;
    return orderChat(o).filter(m => !m.user && m.ts > seen).length;
}
export function markCourierRead(orderId) {
    const o = findOrder(orderId);
    if (!o) return;
    o.chatRead = Date.now();
    saveMeta();
}

// Её сообщение курьеру + его ответ
export async function writeToCourier(orderId, text) {
    const o = findOrder(orderId);
    text = String(text || '').trim();
    if (!o || !o.courier || !text) return null;
    o.chat = orderChat(o);
    o.chat.push({ text: text.slice(0, 500), ts: Date.now(), user: true });
    saveMeta();
    try {
        logSocialToChat(`${getUserName()} пишет курьеру ${o.courier.name}: «${text}»`);
    } catch (e) { /* ignore */ }
    const reply = await generateCourierReply(o, o.courier, o.chat, text);
    const cur = findOrder(orderId);
    if (!cur) return null;
    cur.chat = orderChat(cur);
    cur.chat.push({ text: reply, ts: Date.now() });
    saveMeta();
    return reply;
}

// Курьер у двери — сообщение при доставке
export async function courierArrived(orderId) {
    const o = findOrder(orderId);
    if (!o || !o.courier) return null;
    const reply = await generateCourierReply(o, o.courier, orderChat(o), '', true);
    const cur = findOrder(orderId);
    if (!cur) return null;
    cur.chat = orderChat(cur);
    cur.chat.push({ text: reply, ts: Date.now() });
    saveMeta();
    return reply;
}

export function getOrders() { return getShop().orders; }
export function deleteOrder(id) {
    const s = getShop();
    s.orders = s.orders.filter(o => o.id !== id);
    saveMeta();
}
