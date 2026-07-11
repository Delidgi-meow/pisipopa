// Изолированный рендер декоративных подарков.
// Модуль не знает о состоянии или навигации телефона и безопасно переиспользуется
// как в каталоге, так и на домашнем экране.

const escapeAttr = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export function giftVisualHtml(charmId, charm, className = '') {
    if (!charm) return '';
    const id = escapeAttr(charmId);
    const extraClass = className ? ` ${escapeAttr(className)}` : '';
    const icon = escapeAttr(charm.icon);
    return `<span class="gp-gift-visual gp-gift-${id}${extraClass}" aria-hidden="true">
        <i class="gp-gift-halo"></i><i class="gp-gift-body"><i class="fa-solid ${icon}"></i></i>
        <i class="gp-gift-spark gp-gift-spark-a">✦</i><i class="gp-gift-spark gp-gift-spark-b">✦</i>
    </span>`;
}