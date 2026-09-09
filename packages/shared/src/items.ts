// Каталог предметов и генераторы
import type { ItemDef, ItemInstance, Rarity } from './types';
import { STARTER_PACK_MAX, STARTER_PACK_MIN } from './constants';

export const RARITY_VALUE_RANGE: Record<Rarity, [number, number]> = {
  white: [2_000, 8_000],
  green: [8_000, 20_000],
  blue: [20_000, 45_000],
  purple: [45_000, 90_000],
  gold: [90_000, 160_000],
  red: [160_000, 300_000],
};

interface CatalogEntry {
  name: string;
  desc: string;
}

const NAMES: Record<Rarity, CatalogEntry[]> = {
  white: [
    { name: 'Пыльная ваза', desc: 'Старая ваза с трещиной на донышке. Внутри — только пыль и пара засохших цветов.' },
    { name: 'Гипсовая статуэтка', desc: 'Дешёвая копия античной статуи. Краска облупилась, но сходство с оригиналом угадывается.' },
    { name: 'Жестяная кружка', desc: 'Помятая походная кружка. На боку выцарапаны чьи-то инициалы.' },
    { name: 'Деревянный гребешок', desc: 'Резной гребешок без двух зубьев. До сих пор пахнет сандалом.' },
    { name: 'Стеклянный шар', desc: 'Мутный шар с пузырьками воздуха внутри. Предсказаний, увы, не даёт.' },
    { name: 'Бумажный веер', desc: 'Расписной веер из тонкой бумаги. Один резкий взмах — и он рассыплется.' },
    { name: 'Латунная пуговица', desc: 'Большая пуговица с мундира неизвестного полка. Натёрта до блеска.' },
    { name: 'Керамический горшок', desc: 'Горшок с отбитым краем. Идеален для рассады и наваристых супов.' },
    { name: 'Потёртая колода карт', desc: 'Колода без двух карт. Говорят, умелому шулеру она приносит удачу.' },
  ],
  green: [
    { name: 'Резная шкатулка', desc: 'Шкатулка с замысловатой резьбой. Ключ давно утерян, но замок легко поддаётся.' },
    { name: 'Бронзовое зеркальце', desc: 'Зеркальце в бронзовой оправе. Отражает на полтона теплее, чем есть на самом деле.' },
    { name: 'Шёлковый платок', desc: 'Платок из шёлка с вышитыми пионами. Не выцветает даже на солнце.' },
    { name: 'Нефритовый браслет', desc: 'Холодный браслет из нефрита. По поверью, отводит дурные сны.' },
    { name: 'Фарфоровая чашка', desc: 'Тонкостенная чашка с кобальтовой росписью. Звенит, как колокольчик.' },
    { name: 'Медный чайник', desc: 'Чайник, видавший не одну сотню чаепитий. Свистит на высоких нотах.' },
    { name: 'Янтарная бусина', desc: 'Бусина с застывшим внутри древним насекомым. Кто-то называет её «каплей солнца».' },
    { name: 'Свиток с пейзажем', desc: 'Картина на шёлковом свитке: горы, туман и одинокая лодка.' },
    { name: 'Набор резцов мастера', desc: 'Девять резцов разной формы в кожаном чехле. Дерево слушается их, как живое.' },
  ],
  blue: [
    { name: 'Серебряная брошь', desc: 'Брошь в виде листа папоротника. Застёжка работает безупречно.' },
    { name: 'Лаковый ларец', desc: 'Ларец, покрытый чёрным лаком с золотыми прожилками. Внутри пахнет смолой.' },
    { name: 'Изумрудная подвеска', desc: 'Огранённый изумруд на тонкой цепочке. В глубине камня мерцает зелёное пламя.' },
    { name: 'Старинный компас', desc: 'Латунный компас, стрелка которого показывает не на север, а на сокровища.' },
    { name: 'Шпалера с грифоном', desc: 'Гобелен ручной работы. Грифон на нём будто следит за зрителем.' },
    { name: 'Сапфировое кольцо', desc: 'Кольцо с сапфиром в серебре. Камень меняет оттенок в зависимости от освещения.' },
    { name: 'Кинжал с гравировкой', desc: 'Клинок с гравировкой «Возвращайся с победой». Ножны из тёмной кожи.' },
    { name: 'Позолоченный канделябр', desc: 'Канделябр на пять свечей. Свечи в комплект не входят.' },
    { name: 'Карта неведомых земель', desc: 'Карта земель, которых нет ни на одном атласе. Края обгорели, маршрут обрывается на полпути.' },
  ],
  purple: [
    { name: 'Амулет лунного света', desc: 'Амулет, светящийся в темноте мягким серебристым светом.' },
    { name: 'Меч из звёздной стали', desc: 'Клинок, выкованный из металла упавшей звезды. Никогда не тупится.' },
    { name: 'Корона горного хрусталя', desc: 'Корона, выточенная из цельного кристалла. Носить тяжело, выглядеть — царственно.' },
    { name: 'Свиток древних заклинаний', desc: 'Свиток на незнакомом языке. При чтении вслух гаснут свечи.' },
    { name: 'Часы с духом-кукушкой', desc: 'Настольные часы, в которых живёт дружелюбный дух. Опаздывают ровно на минуту.' },
    { name: 'Жезл иллюзий', desc: 'Жезл, создающий миражи. Отличить фокус от реальности почти невозможно.' },
    { name: 'Доспех рыцаря тумана', desc: 'Доспех, будто выкованный из тумана: невесомый и невероятно прочный.' },
    { name: 'Шкатулка Пандоры', desc: 'Говорят, внутри осталась одна надежда. Открывать не рекомендуется.' },
    { name: 'Хрустальный шар предсказателя', desc: 'Шар, в котором можно увидеть будущее. Чаще всего — чужое.' },
  ],
  gold: [
    { name: 'Кубок вечного пира', desc: 'Кубок, который никогда не пустеет. К сожалению, только для воды.' },
    { name: 'Тиара заката', desc: 'Тиара с камнями цвета заходящего солнца.' },
    { name: 'Реликвия морского бога', desc: 'Обломок трезубца. Пахнет солью и штормом.' },
    { name: 'Скипетр громовержца', desc: 'Скипетр, накапливающий статическое электричество. В грозу гудит.' },
    { name: 'Зеркало истины', desc: 'Зеркало, показывающее вещи такими, какие они есть. Выдерживает не каждый.' },
    { name: 'Ключ от врат бездны', desc: 'Ключ из чёрного металла. Замочная скважина, к которой он подходит, никому не известна.' },
    { name: 'Диадема полярной звезды', desc: 'Диадема, холодная как лёд. Камень внутри — осколок северного сияния.' },
    { name: 'Грифон из чистого золота', desc: 'Статуэтка грифона. Если присмотреться — он слегка дышит.' },
    { name: 'Якорь «Надежда»', desc: 'Корабельный якорь, не раз спасший судно в шторм. Приносит удачу в плавании.' },
  ],
  red: [
    { name: 'Сердце дракона', desc: 'Пульсирующий кристалл. Тёплый на ощупь, как живой.' },
    { name: 'Корона падшего короля', desc: 'Корона короля, потерявшего всё. Говорят, она помнит каждую его битву.' },
    { name: 'Око всевидящего', desc: 'Артефакт, который видит больше, чем следует. Моргает редко.' },
    { name: 'Печать первостихий', desc: 'Печать с символами огня, воды, земли и воздуха.' },
    { name: 'Клинок судьбы', desc: 'Клинок, который, по легенде, сам выбирает победителя.' },
    { name: 'Грааль рассвета', desc: 'Чаша, из которой пили первые герои. Светится на восходе.' },
    { name: 'Плащ невидимого императора', desc: 'Плащ, скрывающий владельца от чужих глаз. Самого императора так никто и не увидел.' },
    { name: 'Ядро вечности', desc: 'Сфера с медленно вращающейся галактикой внутри.' },
  ],
};

export const ITEM_CATALOG: ItemDef[] = Object.entries(NAMES).flatMap(([rarity, entries]) =>
  entries.map((entry, i) => {
    const [minValue, maxValue] = RARITY_VALUE_RANGE[rarity as Rarity];
    return {
      id: rarity + '-' + i,
      name: entry.name,
      desc: entry.desc,
      rarity: rarity as Rarity,
      minValue,
      maxValue,
    };
  }),
);

/** Детерминированный ГПСЧ (mulberry32) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const DIM_WEIGHTS: [number, number][] = [[1, 30], [2, 26], [3, 20], [4, 14], [5, 10]];

/** Случайный размер стороны предмета (1..5), мелкие предметы чаще */
export function randomDim(rng: () => number): number {
  let r = rng() * 100;
  for (const [d, w] of DIM_WEIGHTS) {
    r -= w;
    if (r < 0) return d;
  }
  return 1;
}

export const UNIFORM_RARITY: Record<Rarity, number> = {
  white: 1, green: 1, blue: 1, purple: 1, gold: 1, red: 1,
};

export const PRIZE_RARITY: Record<Rarity, number> = {
  white: 26, green: 24, blue: 20, purple: 15, gold: 10, red: 5,
};

function pickRarity(rng: () => number, weights: Record<Rarity, number>): Rarity {
  const entries = Object.entries(weights) as [Rarity, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [rarity, w] of entries) {
    r -= w;
    if (r < 0) return rarity;
  }
  return entries[entries.length - 1][0];
}

export function generateItem(
  rng: () => number,
  opts: { rarityWeights?: Record<Rarity, number> } = {},
): ItemInstance {
  const rarity = pickRarity(rng, opts.rarityWeights ?? UNIFORM_RARITY);
  const pool = ITEM_CATALOG.filter((d) => d.rarity === rarity);
  const def = pick(rng, pool);
  const [min, max] = RARITY_VALUE_RANGE[rarity];
  const value = Math.round(randomInt(rng, min, max) / 100) * 100;
  return {
    id: crypto.randomUUID(),
    defId: def.id,
    name: def.name,
    rarity,
    value,
    w: randomDim(rng),
    h: randomDim(rng),
  };
}

/**
 * Стартовый набор нового игрока: случайные предметы суммарной
 * стоимостью примерно в STARTER_PACK_MIN..STARTER_PACK_MAX (~300 000).
 */
export function generateStarterPack(rng: () => number): ItemInstance[] {
  for (let attempt = 0; attempt < 80; attempt++) {
    const pack: ItemInstance[] = [];
    let total = 0;
    while (total < STARTER_PACK_MIN && pack.length < 12) {
      const item = generateItem(rng);
      pack.push(item);
      total += item.value;
    }
    if (total >= STARTER_PACK_MIN && total <= STARTER_PACK_MAX) return pack;
  }
  // фолбэк (крайне маловероятно): отдаём то, что накопилось
  const pack: ItemInstance[] = [];
  let total = 0;
  while (total < STARTER_PACK_MIN && pack.length < 12) {
    const item = generateItem(rng);
    pack.push(item);
    total += item.value;
  }
  return pack;
}

export function itemsTotal(items: readonly { value: number }[]): number {
  return items.reduce((s, i) => s + i.value, 0);
}

/** Отформатировать число как игровую валюту (без неразрывных пробелов) */
export function fmt(n: number): string {
  return n.toLocaleString('ru-RU').replace(new RegExp(String.fromCharCode(160) + '|' + String.fromCharCode(8239), 'g'), ' ');
}
