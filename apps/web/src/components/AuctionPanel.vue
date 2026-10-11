<template>
  <div ref="panelEl" class="panel flex flex-col gap-3">
    <template v-if="auction">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ lotTitle }}</h3>
        <div class="flex items-center gap-1.5">
          <span
            v-if="myStreak > 1"
            class="streak-chip"
            :title="'Серия побед: зал добавит ' + Math.round(myStreakBonus * 100) + '% к призовым'"
          >
            🔥 серия {{ myStreak }} · +{{ Math.round(myStreakBonus * 100) }}%
          </span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">раунд {{ auction.round }}</span>
        </div>
      </div>

      <div
        v-if="game.private && (game.private.reveals.length || game.private.hints.length)"
        class="rounded-lg bg-slate-800/60 p-2 flex flex-col gap-1.5"
      >
        <div v-for="r in game.private.reveals" :key="r.itemId" class="flex items-center gap-2">
          <div class="w-10 h-10 rounded overflow-hidden shrink-0">
            <ItemCard :name="r.name" :rarity="r.rarity" :value="r.value" dense />
          </div>
          <div class="text-[11px] text-slate-300">
            Личное раскрытие: {{ r.name }} — <CoinAmount :value="r.value" />
          </div>
        </div>
        <div v-for="(h, i) in game.private.hints" :key="'h' + i" class="text-[11px] text-violet-300">
          {{ h }}
        </div>
      </div>

      <div class="text-xs text-slate-400">
        <template v-if="auction.round < 5">
          Победа в раунде: ставка ≥ <b class="text-slate-200">×{{ auction.multiplier }}</b> от второй
        </template>
        <template v-else-if="auction.round === 5">
          <span class="text-emerald-300">Финальный раунд: побеждает высшая ставка</span>
        </template>
        <template v-else>
          <span class="text-rose-300">Дополнительный раунд: участвуют только лидеры; при ничьей стол сгорает</span>
        </template>
      </div>

      <div class="flex flex-wrap gap-1">
        <span
          v-for="(count, r) in auction.rarityCounts"
          :key="r"
          class="text-[10px] px-1.5 py-0.5 rounded-full border"
          :style="rarityChipStyle(r as Rarity)"
        >
          {{ RARITY_LABEL[r as Rarity] }} ×{{ count }}
        </span>
      </div>

      <div class="text-sm">
        Открыто {{ auction.revealedCount }}/{{ auction.totalItems }} — сумма
        <b class="text-amber-300 font-mono"><CoinAmount :value="auction.revealedValue" /></b>
      </div>

      <!-- Фаза ставок -->
      <template v-if="auction.phase === 'bid'">
        <div v-if="myPlayer && !myPlayer.passed" class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <input
              v-model.number="bidAmount"
              type="number"
              inputmode="decimal"
              enterkeyhint="done"
              :min="0"
              :max="myPlayer.cash"
              class="input-dark font-mono"
              placeholder="Сумма ставки"
            />
            <button class="btn-small shrink-0" @click="bidAmount = myPlayer.cash">MAX</button>
          </div>
          <div class="grid grid-cols-5 gap-1">
            <button v-for="pct in [10, 25, 50, 75, 100]" :key="pct" class="btn-small" @click="setPct(pct)">
              {{ pct }}%
            </button>
          </div>
          <div class="flex gap-2">
            <button class="btn-primary flex-1" :disabled="bidAmount <= 0" @click="submit">Ставка</button>
            <button class="btn-danger" @click="$emit('bid', 0)">Пас</button>
          </div>
          <p v-if="myPlayer.bidPlaced" class="text-[11px] text-emerald-300">
            Ставка отправлена — можно изменить до конца таймера
          </p>
        </div>
        <div v-else class="text-sm text-slate-400">
          {{ auction.round === 6 ? 'Вы не участвуете в дополнительном раунде' : 'Вы пасанули' }}
        </div>
      </template>

      <!-- Раскрытие -->
      <div v-else-if="auction.phase === 'reveal'" class="text-sm text-slate-400">
        Раскрытие стола…
      </div>

      <!-- Итог раунда -->
      <div v-else class="flex flex-col gap-1.5">
        <div v-if="auction.bids" ref="bidsListEl" class="flex flex-col gap-1 text-sm">
          <div
            v-for="b in sortedBids"
            :key="b.playerId"
            class="flex justify-between gap-2"
            :class="b.amount === maxBid && b.amount > 0 ? 'text-amber-300' : ''"
          >
            <span class="truncate">{{ playerName(b.playerId) }}</span>
            <span class="font-mono">
              <template v-if="b.amount === 0">пас</template>
              <CoinAmount v-else :value="b.amount" />
            </span>
          </div>
        </div>
        <div v-if="auction.result?.winnerId" ref="resultEl" class="text-sm text-emerald-300 font-semibold">
          {{ playerName(auction.result.winnerId) }} забирает все предметы стола за <CoinAmount :value="auction.result.price ?? 0" />
        </div>
        <div
          v-if="auction.result?.winnerId && auction.result.compensation"
          class="text-[11px] text-sky-300"
        >
          Переплата: каждый проигравший получает по <CoinAmount :value="perLoserCompensation" />
          от банка (10% от минуса победителя)
        </div>
        <div
          v-else-if="auction.result?.winnerId && winnerProfit > 0"
          class="text-[11px] text-slate-400"
        >
          Победитель в плюсе на <CoinAmount :value="winnerProfit" /> — проигравшие ничего не получают и не теряют
        </div>
        <div v-else-if="auction.result?.voided" class="text-sm text-rose-300 font-semibold">
          Ставки совпали дважды — стол не достался никому
        </div>
        <div v-else class="text-sm text-slate-400">Условие раунда не выполнено — следующий раунд</div>
      </div>
    </template>
    <div v-else class="text-sm text-slate-400">Ожидание стола…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RARITY_LABEL, streakBonus } from '@auctioneer/shared';
import { gsap, motionOK } from '../lib/animations';
import type { AuctionBid, PublicGame, Rarity } from '@auctioneer/shared';
import { RARITY_HEX } from '../lib/rarity';
import ItemCard from './ItemCard.vue';
import CoinAmount from './CoinAmount.vue';

const props = defineProps<{ game: PublicGame; meId: string }>();
const emit = defineEmits<{ (e: 'bid', amount: number): void }>();

const bidAmount = ref(0);
const panelEl = ref<HTMLElement | null>(null);
const bidsListEl = ref<HTMLElement | null>(null);
const resultEl = ref<HTMLElement | null>(null);
/** последняя отыгранная фаза — чтобы не перезапускать анимацию на каждый push */
let lastPhaseKey = '';

const auction = computed(() => props.game.auction);
const myPlayer = computed(() => props.game.players.find((p) => p.id === props.meId) ?? null);

const lotTitle = computed(() => 'Корабль сокровищ');

const sortedBids = computed<AuctionBid[]>(() => {
  const bids = auction.value?.bids ?? [];
  return bids.slice().sort((a, b) => b.amount - a.amount);
});

const maxBid = computed(() => (sortedBids.value.length > 0 ? sortedBids.value[0].amount : 0));

/** Серия побед игрока: за неё зал добавляет процент к призовым */
const myStreak = computed(() => props.game.myStreak ?? 0);
const myStreakBonus = computed(() => streakBonus(myStreak.value));

/** Сколько получает каждый проигравший: компенсация делится поровну */
const perLoserCompensation = computed(() => {
  const total = auction.value?.result?.compensation ?? 0;
  const losers = Math.max(1, props.game.players.length - 1);
  return Math.floor(total / losers);
});

/** Насколько победитель в плюсе: стоимость стола минус его ставка */
const winnerProfit = computed(() => {
  const r = auction.value?.result;
  if (!r?.winnerId) return 0;
  const tableValue = props.game.items.reduce((sum, i) => sum + (i.value ?? 0), 0);
  return Math.max(0, tableValue - (r.price ?? 0));
});

function playerName(id: string): string {
  return props.game.players.find((p) => p.id === id)?.name ?? '?';
}

function rarityChipStyle(r: Rarity): Record<string, string> {
  const c = RARITY_HEX[r];
  return { borderColor: c, color: c, background: c + '18' };
}

function setPct(pct: number): void {
  const cash = myPlayer.value?.cash ?? 0;
  bidAmount.value = Math.floor((cash * pct) / 100);
}

function submit(): void {
  const cash = myPlayer.value?.cash ?? 0;
  const amount = Math.max(0, Math.min(cash, Math.floor(bidAmount.value || 0)));
  emit('bid', amount);
}

/**
 * Анимации торгов. Сервер присылает полный снимок на каждое действие,
 * поэтому реагируем на смену фазы/раунда, а не на каждый объект состояния.
 */
watch(
  () => {
    const a = auction.value;
    return a ? a.round + ':' + a.phase : '';
  },
  () => {
    const a = auction.value;
    if (!a || !motionOK) return;
    const key = a.round + ':' + a.phase;
    if (key === lastPhaseKey) return;
    lastPhaseKey = key;

    if (a.phase === 'reveal') {
      // новый раунд: лёгкий «толчок» панели и подсветка бейджа раунда
      if (panelEl.value) {
        gsap.fromTo(panelEl.value, { x: -8, opacity: 0.6 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power2.out' });
      }
    }

    if (a.phase === 'resolve') {
      // вскрытие: строки ставок влетают каскадом, победитель вспыхивает
      void nextTick().then(() => {
        if (bidsListEl.value) {
          const rows = bidsListEl.value.querySelectorAll(':scope > div');
          gsap.from(rows, { y: 10, opacity: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out' });
        }
        if (resultEl.value) {
          gsap.fromTo(
            resultEl.value,
            { scale: 0.9, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.8)' },
          );
          // вспышка: победитель есть — золотая, ничья/сгорел — красная
          const color = auction.value?.result?.winnerId ? 'rgba(251,191,36,0.8)' : 'rgba(251,113,133,0.8)';
          gsap.fromTo(
            resultEl.value,
            { filter: `drop-shadow(0 0 0 ${color})` },
            { filter: `drop-shadow(0 0 18px ${color})`, duration: 0.35, yoyo: true, repeat: 1 },
          );
        }
      });
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (panelEl.value) gsap.killTweensOf(panelEl.value);
});
</script>
