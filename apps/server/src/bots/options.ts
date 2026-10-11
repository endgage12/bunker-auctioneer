// Настройки парка ботов. Все значения можно переопределить переменными окружения.

/** Сколько всего ботов держать в парке (см. расчёт в TASKS.md, п. 12.5) */
export const BOT_COUNT = Number(process.env.BOT_COUNT ?? 44);

/** Выключить ботов целиком (BOTS_ENABLED=false) — удобно для отладки и тестов */
export const BOTS_ENABLED = (process.env.BOTS_ENABLED ?? 'true') === 'true';

/** Целевой SLA ожидания лобби, секунды (используется в логах и метриках) */
export const LOBBY_WAIT_TARGET_SECONDS = Number(process.env.BOT_LOBBY_SLA_SECONDS ?? 30);

/** Как часто парк пересматривает состав лобби, мс */
export const MATCH_INTERVAL_MS = Number(process.env.BOT_MATCH_INTERVAL_MS ?? 3000);

/** Сколько ботов максимум садится в одно лобби (партия рассчитана на 4) */
export const BOTS_PER_LOBBY = Number(process.env.BOT_PER_LOBBY ?? 3);

/** Не давать ботам играть, если у них меньше этого капитала (защита от «нулевых» ставок) */
export const BOT_MIN_CASH = Number(process.env.BOT_MIN_CASH ?? 40_000);

/**
 * Запас наличных сверх входной платы, который бот оставляет, выбирая зал.
 * Без запаса первый же проигрыш выбрасывает бота из игры.
 */
export const BOT_ENTRY_RESERVE = Number(process.env.BOT_ENTRY_RESERVE ?? 60_000);

/**
 * Доля ботов, которые «в игре» прямо сейчас. Остальные находятся на паузе
 * («ушли по делам») — это делает онлайн неровным, как у людей.
 */
export const ACTIVE_SHARE_MIN = Number(process.env.BOT_ACTIVE_SHARE_MIN ?? 0.55);
export const ACTIVE_SHARE_MAX = Number(process.env.BOT_ACTIVE_SHARE_MAX ?? 0.75);

/** Играть ли ботам мета-игру между партиями (торговец, барахолка, сеты, колесо, Санта) */
export const BOT_META_GAME = (process.env.BOT_META_GAME ?? 'true') === 'true';

/**
 * Какая доля парка должна быть «в лобби или в партии». Остальные находятся на
 * паузе («ушли по делам»), из-за чего онлайн выглядит неровным, как у людей.
 * Значение подобрано так, чтобы одновременно шло достаточно партий для SLA 30 с.
 */
export const ROOM_SHARE = Number(process.env.BOT_ROOM_SHARE ?? 0.4);

/**
 * Сколько полных составов парк держит свободными под живых игроков.
 * Это и есть механизм SLA: человек нажал «Играть» — его комнату немедленно
 * дозаполняют боты из резерва.
 */
export const RESERVE_ROOMS = Number(process.env.BOT_RESERVE_ROOMS ?? 2);

/** Болтают ли боты за столом */
export const BOT_CHAT = (process.env.BOT_CHAT ?? 'true') === 'true';

/** Проверять ли на старте, что скрытое состояние партии недоступно ботам */
export const BOT_STRICT_FAIRNESS = (process.env.BOT_STRICT_FAIRNESS ?? 'true') === 'true';
