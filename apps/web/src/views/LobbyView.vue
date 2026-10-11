<template>
  <div class="min-h-screen">
    <TopNav />
    <div class="max-w-5xl mx-auto p-4 sm:p-6">
      <div v-if="profile" ref="headEl" class="text-sm text-slate-400 mb-6 text-center">
        Сыграно игр: {{ profile.gamesPlayed }} · Побед: {{ profile.gamesWon }} ·
        <span class="text-amber-300"><CoinAmount :value="profile.cash" /></span> на руках
      </div>

      <!-- Прогресс игрока: ранг, путь до следующего, серия побед -->
      <div v-if="progress" ref="rankEl" class="panel p-4 mb-6 max-w-2xl mx-auto">
        <div class="flex items-center gap-3 mb-3">
          <span ref="rankIconEl" class="text-3xl leading-none">{{ progress.rankIcon }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <b class="text-lg" :style="{ color: progress.rankColor }">{{ progress.rankName }}</b>
              <span v-if="progress.currentStreak > 1" class="streak-chip">
                🔥 серия {{ progress.currentStreak }}
              </span>
            </div>
            <div class="text-[11px] text-slate-400">
              заработано за карьеру:
              <span class="font-mono" :class="progress.totalWinnings >= 0 ? 'text-emerald-300' : 'text-rose-300'">
                <CoinAmount :value="progress.totalWinnings" />
              </span>
              <span v-if="progress.bestStreak > 1"> · лучшая серия {{ progress.bestStreak }}</span>
            </div>
          </div>
        </div>

        <div v-if="progress.next" class="space-y-1">
          <div class="flex justify-between text-[11px] text-slate-400">
            <span>до ранга «{{ progress.next.name }}»</span>
            <span class="font-mono"><CoinAmount :value="progress.next.remaining" /></span>
          </div>
          <div class="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div ref="barEl" class="h-full rounded-full" :style="{ background: progress.rankColor }"></div>
          </div>
        </div>
        <p v-else class="text-[11px] text-amber-300">Максимальный ранг — вы легенда зала 👑</p>
      </div>

      <!-- Повышение ранга — главная награда прогрессии -->
      <div
        v-if="rankUp"
        ref="rankUpEl"
        class="rank-up mx-auto mb-5 max-w-md rounded-xl border px-5 py-4 text-center"
        :style="{ borderColor: progress?.rankColor ?? '#fbbf24' }"
      >
        <div class="text-4xl mb-1">{{ progress?.rankIcon }}</div>
        <div class="text-[11px] uppercase tracking-widest text-slate-400">новый ранг</div>
        <div class="text-xl font-bold" :style="{ color: progress?.rankColor ?? '#fbbf24' }">
          {{ progress?.rankName }}
        </div>
        <div v-if="unlockedByRankUp.length" class="text-xs text-emerald-300 mt-1">
          Открыт зал: {{ unlockedByRankUp.join(', ') }}
        </div>
      </div>

      <h1 ref="titleEl" class="text-center font-bold text-2xl sm:text-3xl mb-1">Выберите зал</h1>
      <p class="text-center text-sm text-slate-400 mb-8">
        Плата за вход фиксирована, а ценность стола разыгрывается заранее — до первой ставки
      </p>

      <!-- Три сословия: чем дороже вход, тем богаче стол -->
      <div ref="tiersEl" class="grid gap-4 sm:grid-cols-3">
        <button
          v-for="t in tiers"
          :key="t.id"
          :ref="(el) => setCardRef(t.id, el as HTMLElement | null)"
          type="button"
          class="tier-card panel relative overflow-hidden p-5 text-left transition disabled:cursor-not-allowed"
          :class="canPlay(t) ? 'hover:-translate-y-1' : 'opacity-70'"
          :disabled="busy || !canPlay(t)"
          :data-tier="t.id"
          @click="play(t)"
          @mouseenter="hoverCard(t.id, true)"
          @mouseleave="hoverCard(t.id, false)"
        >
          <span class="tier-glow" :style="{ background: t.color }" aria-hidden="true"></span>

          <div class="flex items-center justify-between gap-2 mb-3">
            <span class="text-3xl">{{ t.icon }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              :style="{ borderColor: t.color, color: t.color, borderWidth: '1px' }"
            >
              вход <CoinAmount :value="t.entry" />
            </span>
          </div>

          <h2 class="font-bold text-lg mb-1">{{ t.name }}</h2>
          <p class="text-xs text-slate-400 mb-3 leading-relaxed">{{ t.tagline }}</p>

          <div class="rounded-lg bg-slate-800/60 px-3 py-2 mb-2">
            <div class="text-[11px] text-slate-400">Ценность стола</div>
            <div class="font-mono text-sm" :style="{ color: t.color }">
              <CoinAmount :value="t.tableMin" /> — <CoinAmount :value="t.tableMax" />
            </div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-slate-500">
            <span>сейчас в зале: {{ (rooms[t.id]?.players ?? 0) }}</span>
            <span v-if="!rankAllows(t)" class="text-amber-300">🔒 нужен ранг «{{ rankNeeded(t) }}»</span>
            <span v-else-if="!canAfford(t)" class="text-rose-300">не хватает на вход</span>
            <span v-else class="text-emerald-300">доступен</span>
          </div>
        </button>
      </div>

      <p v-if="error" ref="errorEl" class="text-rose-400 text-sm mt-4 text-center">{{ error }}</p>
      <p v-if="busy" class="text-amber-300 text-sm mt-4 text-center">Подбираем стол…</p>

      <div class="flex items-center gap-3 my-8">
        <div class="h-px bg-slate-700 flex-1"></div>
        <span class="text-xs text-slate-500">или войти по коду комнаты</span>
        <div class="h-px bg-slate-700 flex-1"></div>
      </div>

      <form class="flex gap-2 justify-center" @submit.prevent="joinRoom">
        <input
          v-model="code"
          class="input-dark font-mono uppercase tracking-widest text-center w-40"
          maxlength="4"
          placeholder="КОД"
        />
        <button type="submit" class="btn-ghost shrink-0" :disabled="busy || code.length !== 4">Войти</button>
      </form>

      <p class="text-xs text-slate-500 text-center mt-6 leading-relaxed">
        Партия начнётся, как только наберётся 4 игрока. Если игроков меньше, но каждый нажал
        «Я готов/а» — игра начнётся и без полного состава.<br />
        Ценность стола определяется до начала торгов и не зависит от того, сколько внесли игроки.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { RANKS, TIERS, TIER_IDS, tierUnlockedByRank } from '@auctioneer/shared';
import type { Profile, TierDef } from '@auctioneer/shared';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import { get } from '../lib/api';
import { gsap, motionOK, popIn, shake, staggerIn } from '../lib/animations';
import TopNav from '../components/TopNav.vue';
import CoinAmount from '../components/CoinAmount.vue';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();

const profile = ref<Profile | null>(null);
const code = ref('');
const busy = ref(false);
const error = ref('');
/** сколько игроков сейчас в каждом зале */
const rooms = ref<Record<string, { waiting: number; players: number }>>({});
const progress = computed(() => profile.value?.progress ?? null);
/** показывать ли баннер «новый ранг» */
const rankUp = ref(false);
/** какие залы открылись вместе с рангом */
const unlockedByRankUp = ref<string[]>([]);
const rankUpEl = ref<HTMLElement | null>(null);
const RANK_KEY = 'auctioneer:lastRank';
/** ширина полосы прогресса до следующего ранга */
const barWidth = computed(() => Math.round((progress.value?.progress ?? 0) * 100) + '%');

const tiers: TierDef[] = TIER_IDS.map((id) => TIERS[id]);
const cardRefs = new Map<string, HTMLElement>();
const tiersEl = ref<HTMLElement | null>(null);
const rankEl = ref<HTMLElement | null>(null);
const rankIconEl = ref<HTMLElement | null>(null);
const barEl = ref<HTMLElement | null>(null);
const titleEl = ref<HTMLElement | null>(null);
const errorEl = ref<HTMLElement | null>(null);
let ticker: number | null = null;

function setCardRef(id: string, el: HTMLElement | null): void {
  if (el) cardRefs.set(id, el);
  else cardRefs.delete(id);
}

function canAfford(t: TierDef): boolean {
  return (profile.value?.cash ?? 0) >= t.entry;
}

/** Зал открыт по рангу (деньги проверяются отдельно) */
function rankAllows(t: TierDef): boolean {
  return tierUnlockedByRank(t.id, progress.value?.totalWinnings ?? 0);
}

function canPlay(t: TierDef): boolean {
  return canAfford(t) && rankAllows(t);
}

/** Название ранга, который открывает зал — для подсказки на замке */
function rankNeeded(t: TierDef): string {
  return RANKS.find((r) => r.unlocks === t.id)?.name ?? '?';
}

/** Подсветка зала под курсором: свечение в цвет сословия */
function hoverCard(id: string, on: boolean): void {
  const el = cardRefs.get(id);
  if (!el || !motionOK) return;
  const glow = el.querySelector('.tier-glow');
  gsap.to(el, { borderColor: on ? TIERS[id as 'bronze'].color : 'rgba(30,41,59,1)', duration: 0.25 });
  if (glow) gsap.to(glow, { opacity: on ? 0.22 : 0, duration: 0.3 });
}

onMounted(async () => {
  profile.value = await auth.fetchMe();
  game.attach();
  void loadRooms();
  if (motionOK) {
    // ранговый блок «проявляется», полоса прогресса наполняется
    if (rankEl.value) gsap.from(rankEl.value, { y: 14, opacity: 0, duration: 0.5, ease: 'power2.out' });
    if (barEl.value) {
      gsap.fromTo(
        barEl.value,
        { width: '0%' },
        { width: barWidth.value, duration: 1.1, delay: 0.2, ease: 'power3.out' },
      );
    }
    if (rankIconEl.value) {
      gsap.from(rankIconEl.value, { scale: 0.4, rotate: -25, duration: 0.6, delay: 0.1, ease: 'back.out(2)' });
    }
    popIn(titleEl.value, { y: -10 });
    staggerIn(tiersEl.value?.querySelectorAll('.tier-card') ?? null, { stagger: 0.09, y: 26, scale: 0.97 });
  }
  detectRankUp();
  ticker = window.setInterval(() => void loadRooms(), 5000);
});

/**
 * Повышение ранга определяем сравнением с прошлым визитом: сервер уже
 * пересчитал ранг, нам осталось показать событие один раз.
 */
function detectRankUp(): void {
  const current = progress.value;
  if (!current) return;
  let previous: string | null = null;
  try {
    previous = window.localStorage.getItem(RANK_KEY);
  } catch {
    previous = null;
  }
  try {
    window.localStorage.setItem(RANK_KEY, current.rankId);
  } catch {
    /* приватный режим — просто не запоминаем */
  }
  if (!previous || previous === current.rankId) return;
  const prevIndex = RANKS.findIndex((r) => r.id === previous);
  const nextIndex = RANKS.findIndex((r) => r.id === current.rankId);
  if (nextIndex <= prevIndex) return; // понижений не празднуем
  unlockedByRankUp.value = RANKS.slice(prevIndex + 1, nextIndex + 1)
    .map((r) => r.unlocks)
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => TIERS[t].name);
  rankUp.value = true;
  void nextTick(() => celebrateRankUp());
}

/** Салют вокруг баннера: свечение, подъём, вспышка иконки */
function celebrateRankUp(): void {
  if (!rankUpEl.value || !motionOK) return;
  const el = rankUpEl.value;
  const tl = gsap.timeline();
  tl.from(el, { y: 24, opacity: 0, scale: 0.94, duration: 0.6, ease: 'back.out(1.7)' })
    .fromTo(
      el,
      { boxShadow: '0 0 0px rgba(251,191,36,0)' },
      { boxShadow: '0 0 42px rgba(251,191,36,0.55)', duration: 0.7, yoyo: true, repeat: 3 },
      '-=0.2',
    )
    .fromTo(el.querySelector('.text-4xl'), { rotate: -18, scale: 0.5 }, { rotate: 0, scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.4)' }, 0);
}

async function loadRooms(): Promise<void> {
  try {
    rooms.value = await get<Record<string, { waiting: number; players: number }>>('/api/rooms/tiers');
  } catch {
    /* витрина залов не критична */
  }
}

async function play(t: TierDef): Promise<void> {
  if (!canAfford(t)) {
    shake(cardRefs.get(t.id) ?? null);
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const resp = await game.play(t.id);
    if ('error' in resp) {
      error.value = resp.error;
      shake(errorEl.value);
      return;
    }
    // короткая вспышка выбранного зала перед переходом
    const el = cardRefs.get(t.id);
    if (el && motionOK) {
      await new Promise<void>((resolve) => {
        gsap.to(el, { scale: 1.04, duration: 0.18, yoyo: true, repeat: 1, onComplete: () => resolve() });
      });
    }
    router.push('/game/' + resp.code);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function joinCode(targetCode: string): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const resp = await game.joinRoom(targetCode);
    if ('error' in resp) {
      error.value = resp.error;
      shake(errorEl.value);
      return;
    }
    router.push('/game/' + resp.code);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function joinRoom(): Promise<void> {
  await joinCode(code.value.toUpperCase());
}

import { onBeforeUnmount } from 'vue';
onBeforeUnmount(() => {
  if (ticker !== null) window.clearInterval(ticker);
});
</script>

<style scoped>
.rank-up {
  background: linear-gradient(160deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.7));
}
.streak-chip {
  border-radius: 9999px;
  border: 1px solid rgba(251, 146, 60, 0.5);
  background: rgba(251, 146, 60, 0.12);
  color: #fdba74;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
}
.tier-card {
  border: 1px solid rgba(30, 41, 59, 1);
}
.tier-glow {
  position: absolute;
  inset: -40% -40% auto auto;
  width: 70%;
  height: 140%;
  filter: blur(38px);
  opacity: 0;
  pointer-events: none;
}
</style>
