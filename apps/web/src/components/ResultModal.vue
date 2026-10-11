<template>
  <div ref="rootEl" class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 w-full max-w-2xl shadow-2xl">
    <!-- Заголовок: главный итог ИГРОКА, а не сухое «игра окончена» -->
    <div class="text-center mb-5">
      <div class="text-xs uppercase tracking-widest text-slate-500 mb-1">
        {{ myPlace === 1 ? 'победа в партии' : 'партия окончена · ' + myPlace + '-е место' }}
      </div>
      <div
        ref="heroEl"
        class="font-mono text-3xl sm:text-4xl font-bold"
        :class="myProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'"
      >
        {{ myProfit >= 0 ? '+' : '−' }}<CoinAmount :value="Math.abs(myProfit)" animate />
      </div>
      <div class="text-xs text-slate-400 mt-1">
        {{ myProfit >= 0 ? 'заработано за партию' : 'потеряно за партию' }}
        <span v-if="myStreak > 1" class="text-orange-300"> · серия {{ myStreak }}</span>
      </div>
    </div>

    <!-- Как получился итог: понятная арифметика вместо трёх неподписанных чисел -->
    <div v-if="me" ref="calcEl" class="rounded-xl bg-slate-800/50 p-3 sm:p-4 mb-5">
      <div class="text-[11px] uppercase tracking-wider text-slate-500 mb-2">как получился итог</div>
      <div class="flex flex-col gap-1 text-xs sm:text-sm">
        <div class="flex justify-between gap-3">
          <span class="text-slate-400">Ценность стола (все предметы)</span>
          <span class="font-mono text-slate-200"><CoinAmount :value="auctionInfo.tableValue" /></span>
        </div>
        <div v-if="!auctionInfo.voided" class="flex justify-between gap-3">
          <span class="text-slate-400">
            Ваша ставка за стол
            <span v-if="isAuctionWinner" class="text-amber-300/80">(вы выиграли торги)</span>
          </span>
          <span class="font-mono text-rose-300">−<CoinAmount :value="auctionInfo.price" /></span>
        </div>
        <div v-else class="flex justify-between gap-3">
          <span class="text-slate-400">Стол сгорел из-за двойной ничьей</span>
          <span class="font-mono text-slate-500">0</span>
        </div>
        <div v-if="auctionInfo.perLoserCompensation > 0" class="flex justify-between gap-3">
          <span class="text-slate-400">Компенсация от банка (10% минуса победителя)</span>
          <span class="font-mono text-sky-300">+<CoinAmount :value="auctionInfo.perLoserCompensation" /></span>
        </div>
        <div v-else-if="isAuctionWinner" class="flex justify-between gap-3">
          <span class="text-slate-400">Куплено дешевле номинала</span>
          <span class="font-mono text-emerald-300">
            +<CoinAmount :value="Math.max(0, auctionInfo.tableValue - auctionInfo.price)" />
          </span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-slate-400">Плата за вход в зал</span>
          <span class="font-mono text-rose-300">−<CoinAmount :value="entryFee" /></span>
        </div>
        <div class="border-t border-slate-700 my-1"></div>
        <div class="flex justify-between gap-3 font-semibold">
          <span :class="myProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'">Итог</span>
          <span class="font-mono" :class="myProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'">
            {{ myProfit >= 0 ? '+' : '−' }}<CoinAmount :value="Math.abs(myProfit)" />
          </span>
        </div>
      </div>

      <!-- Состояние на финише: видно, сколько осталось деньгами и сколько пришло предметами -->
      <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-700/70 text-center">
        <div>
          <div class="text-[10px] text-slate-500">наличные</div>
          <div class="font-mono text-xs text-slate-200"><CoinAmount :value="me.cash" animate /></div>
        </div>
        <div>
          <div class="text-[10px] text-slate-500">инвентарь</div>
          <div class="font-mono text-xs text-slate-200"><CoinAmount :value="me.inventoryValue" animate /></div>
        </div>
        <div>
          <div class="text-[10px] text-slate-500">
            {{ me.inventoryGained > 0 ? 'пришло предметами' : 'было на старте' }}
          </div>
          <div class="font-mono text-xs" :class="me.inventoryGained > 0 ? 'text-emerald-300' : 'text-slate-400'">
            <CoinAmount :value="me.inventoryGained > 0 ? me.inventoryGained : me.startTotal" animate />
          </div>
        </div>
      </div>
    </div>

    <!-- Места: имя, итог партии, затем подробности мелким шрифтом -->
    <div class="text-[11px] uppercase tracking-wider text-slate-500 mb-2">места</div>
    <div class="flex flex-col gap-1.5">
      <div
        v-for="s in standings"
        :key="s.playerId"
        data-standing-row
        class="rounded-lg px-2 sm:px-3 py-2"
        :class="[
          s.playerId === meId ? 'ring-1 ring-slate-500' : '',
          s.place === 1 ? 'bg-amber-500/10 border border-amber-500/40' : 'bg-slate-800/50',
        ]"
      >
        <div class="flex items-center gap-2 sm:gap-3">
          <div class="w-6 sm:w-8 text-center font-bold shrink-0" :class="placeClass(s.place)">{{ s.place }}</div>
          <div class="flex-1 min-w-0 text-sm truncate">
            {{ nameOf(s.playerId) }}
            <span v-if="s.playerId === meId" class="text-slate-500">(вы)</span>
            <span v-if="s.playerId === auctionInfo.winnerId" class="text-[10px] text-amber-300/80 ml-1">выиграл торги</span>
          </div>
          <div
            class="font-mono text-sm sm:text-base font-bold shrink-0"
            :class="s.profit >= 0 ? 'text-emerald-300' : 'text-rose-300'"
          >
            {{ s.profit >= 0 ? '+' : '−' }}<CoinAmount :value="Math.abs(s.profit)" animate />
          </div>
        </div>
        <div class="flex items-center gap-2 sm:gap-3 mt-0.5 text-[10px] text-slate-500 font-mono">
          <span class="w-6 sm:w-8 shrink-0"></span>
          <span class="flex-1 min-w-0 truncate">
            вложено <CoinAmount :value="s.spent" />
            <template v-if="s.inventoryGained > 0"> · предметами +<CoinAmount :value="s.inventoryGained" /></template>
          </span>
          <span class="shrink-0">состояние <CoinAmount :value="s.total" /></span>
        </div>
      </div>
    </div>

    <p class="text-[10px] text-slate-500 mt-3 leading-relaxed">
      Итог каждой строки — это результат партии: вложения (вход и ставка) уже вычтены,
      а полученные предметы учтены по номиналу. «Состояние» — сколько всего на руках и в инвентаре.
    </p>

    <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-5">
      <button v-if="isHost" class="btn-primary flex-1" @click="$emit('again')">Сыграть ещё раз</button>
      <button class="btn-ghost flex-1" @click="$emit('leave')">В лобби</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CoinAmount from './CoinAmount.vue';
import { gsap, motionOK } from '../lib/animations';
import type { PublicGame } from '@auctioneer/shared';

const props = defineProps<{ game: PublicGame; meId: string }>();
defineEmits<{ (e: 'again'): void; (e: 'leave'): void }>();

const rootEl = ref<HTMLElement | null>(null);
const heroEl = ref<HTMLElement | null>(null);
const calcEl = ref<HTMLElement | null>(null);

const standings = computed(() => props.game.final?.standings ?? []);
/** своя строка: с неё и начинается разбор итогов */
const me = computed(() => standings.value.find((s) => s.playerId === props.meId) ?? null);
const myProfit = computed(() => me.value?.profit ?? 0);
const myPlace = computed(() => me.value?.place ?? 0);
const myStreak = computed(() => props.game.myStreak ?? 0);

const winner = computed(() => props.game.players.find((p) => p.id === props.game.final?.winnerId) ?? null);
const isHost = computed(() => props.game.players.find((p) => p.id === props.meId)?.isHost ?? false);

/** Итоги торгов: цена стола, компенсация и кто выиграл */
const auctionInfo = computed(() => {
  const a = props.game.final?.auction;
  return {
    winnerId: a?.winnerId ?? null,
    price: a?.price ?? 0,
    tableValue: a?.tableValue ?? props.game.tableValue ?? 0,
    perLoserCompensation: a?.perLoserCompensation ?? 0,
    voided: a?.voided ?? false,
  };
});
const isAuctionWinner = computed(() => auctionInfo.value.winnerId === props.meId);
/** Плата за вход фиксирована залом */
const entryFee = computed(() => props.game.tier?.entry ?? 0);

/**
 * Итоги партии: главная цифра «выстреливает», расчёт проявляется следом,
 * строки мест влетают каскадом. При своей победе экран коротко празднует.
 */
onMounted(() => {
  if (!motionOK || !rootEl.value) return;
  if (heroEl.value) {
    gsap.from(heroEl.value, { scale: 0.7, opacity: 0, duration: 0.55, ease: 'back.out(2)' });
  }
  if (calcEl.value) {
    gsap.from(calcEl.value, { y: 12, opacity: 0, duration: 0.4, delay: 0.2, ease: 'power2.out' });
  }
  const rows = rootEl.value.querySelectorAll('[data-standing-row]');
  if (rows.length) {
    gsap.from(rows, { y: 14, opacity: 0, duration: 0.35, delay: 0.3, stagger: 0.06, ease: 'power2.out' });
  }
  const first = rows[0] as HTMLElement | undefined;
  if (first) {
    gsap.fromTo(first, { scale: 0.97 }, { scale: 1, duration: 0.45, delay: 0.5, ease: 'back.out(2)' });
  }
  // победителю партии — золотое свечение, остальным мягкая вспышка по знаку итога
  const color = myProfit.value >= 0 ? 'rgba(52,211,153,0.5)' : 'rgba(251,113,133,0.4)';
  gsap.fromTo(
    rootEl.value,
    { boxShadow: '0 0 0 0 rgba(0,0,0,0)' },
    { boxShadow: '0 0 50px 4px ' + color, duration: 0.7, yoyo: true, repeat: 2, ease: 'sine.inOut' },
  );
});

function nameOf(id: string): string {
  return props.game.players.find((p) => p.id === id)?.name ?? '?';
}

function placeClass(place: number): string {
  if (place === 1) return 'text-amber-300';
  if (place === 2) return 'text-slate-300';
  if (place === 3) return 'text-orange-400';
  return 'text-slate-500';
}
</script>
