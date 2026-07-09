// ═══════════════════════════════════════════
// ТЕЛЕФОН — МАГАЗИН: категории, генерируемые каталоги, заказы
//
// Всё ленивое: каталог категории генерируется ТОЛЬКО когда юзер её открывает и
// жмёт «обновить». Кэш per-chat в chat_metadata.glassphone.shop. НИКАКОЙ
// постоянной инжекции — покупки уходят транзакцией в банк (та инжектится сама,
// только если банк используется) + скрытой строкой в чат (событие для ролевой).
// Каталоги генерируются с RP-контекстом → магазины/товары подходят под город/страну.
// ═══════════════════════════════════════════

import { getMeta, saveMeta } from './state.js';
import { generateShopContent, logSocialToChat, getUserName } from './social.js';
import { addTransaction, getBank, fmtMoney } from './bank.js';

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
    const order = { id: genId(), item: item.name, price: item.price, store: store.name, cat: catId, time: Date.now() };
    s.orders.unshift(order);
    if (s.orders.length > 100) s.orders = s.orders.slice(0, 100);
    saveMeta();

    // Событие для ролевой (скрытая строка в чат, уважает настройку журнала)
    try {
        const verb = catId === 'hotels' ? 'забронировала' : (catId === 'travel' ? 'оформила тур' : 'заказала');
        logSocialToChat(`${getUserName()} ${verb} «${item.name}» (${store.name}) за ${fmtMoney(item.price)}`);
    } catch (e) { /* ignore */ }
    return order;
}

export function getOrders() { return getShop().orders; }
export function deleteOrder(id) {
    const s = getShop();
    s.orders = s.orders.filter(o => o.id !== id);
    saveMeta();
}
