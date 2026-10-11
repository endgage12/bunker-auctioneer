// Метрики матчмейкинга: сколько игроки ждут лобби (медиана и p95) — контроль SLA 30 секунд.
import { LOBBY_WAIT_TARGET_SECONDS } from './options';

/** Сколько последних замеров хранить */
const MAX_SAMPLES = 500;

interface WaitSample {
  at: number;
  /** сколько ждал лобби игрок, мс */
  waitMs: number;
  /** был ли в комнате хотя бы один живой игрок (не бот) */
  hadHuman: boolean;
}

const samples: WaitSample[] = [];
/** сколько раз человек начинал подбор и ждал бота */
let humanMatchRequests = 0;
let humanMatchWaitsFilled = 0;
/** сколько живых игроков сейчас ждут дозаполнения */
let waitingHumans = 0;
let lastHumanRequestAt = 0;

export function noteHumanMatchRequest(): void {
  humanMatchRequests += 1;
  waitingHumans += 1;
  lastHumanRequestAt = Date.now();
}

export function noteHumanMatchFilled(): void {
  humanMatchWaitsFilled += 1;
  noteHumanServed();
}

/** Сколько живых игроков прямо сейчас ждут дозаполнения лобби */
export function humansWaiting(): number {
  return waitingHumans;
}

/** Человек дождался партии — снимаем его запрос из очереди ожидания */
export function noteHumanServed(): void {
  waitingHumans = Math.max(0, waitingHumans - 1);
}

/** Если человек ушёл/партия началась иначе — не держим резерв вечно */
export function clearHumanWaitIfStale(maxAgeMs = 90_000): void {
  if (waitingHumans > 0 && Date.now() - lastHumanRequestAt > maxAgeMs) {
    waitingHumans = 0;
  }
}

/** Зафиксировать ожидание игрока от нажатия «Играть» до старта партии */
export function noteLobbyWait(waitMs: number, hadHuman: boolean): void {
  samples.push({ at: Date.now(), waitMs: Math.max(0, waitMs), hadHuman });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface MatchmakingStats {
  /** число замеров ожидания */
  samples: number;
  /** медиана ожидания, мс */
  medianMs: number;
  /** 95-й процентиль ожидания, мс */
  p95Ms: number;
  /** максимум, мс */
  maxMs: number;
  /** целевой SLA, мс */
  targetMs: number;
  /** уложились ли в SLA по p95 */
  withinSla: boolean;
  /** замеры, где в комнате был живой игрок */
  humanSamples: number;
  /** медиана ожидания для комнат с живым игроком, мс */
  humanMedianMs: number;
  /** сколько раз человек начинал подбор */
  humanMatchRequests: number;
  humanMatchFilled: number;
}
export function matchmakingStats(): MatchmakingStats {
  const all = samples.map((s) => s.waitMs).sort((a, b) => a - b);
  const human = samples.filter((s) => s.hadHuman).map((s) => s.waitMs).sort((a, b) => a - b);
  const median = percentile(all, 50);
  const p95 = percentile(all, 95);
  const targetMs = LOBBY_WAIT_TARGET_SECONDS * 1000;
  return {
    samples: all.length,
    medianMs: median,
    p95Ms: p95,
    maxMs: all.length ? all[all.length - 1] : 0,
    targetMs,
    withinSla: all.length === 0 ? true : p95 <= targetMs,
    humanSamples: human.length,
    humanMedianMs: percentile(human, 50),
    humanMatchRequests,
    humanMatchFilled: humanMatchWaitsFilled,
  };
}

/** Только для тестов: очистить накопленные замеры */
export function resetMatchmakingStats(): void {
  samples.length = 0;
  humanMatchRequests = 0;
  humanMatchWaitsFilled = 0;
  waitingHumans = 0;
  lastHumanRequestAt = 0;
}

/** Человекочитаемая строка для лога сервера */
export function matchmakingSummary(): string {
  const s = matchmakingStats();
  if (s.samples === 0) return 'замеров ожидания пока нет';
  const sec = (ms: number) => (ms / 1000).toFixed(1) + 'с';
  return (
    'ожидание лобби: медиана ' + sec(s.medianMs) + ', p95 ' + sec(s.p95Ms) +
    ', максимум ' + sec(s.maxMs) + ' (цель ≤ ' + LOBBY_WAIT_TARGET_SECONDS + 'с, ' +
    (s.withinSla ? 'SLA соблюдён' : 'SLA НАРУШЕН') + ')'
  );
}
