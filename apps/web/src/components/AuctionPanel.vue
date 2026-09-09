<template>
  <div class="panel flex flex-col gap-3">
    <template v-if="auction">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold">{{ lotTitle }}</h3>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">раунд {{ auction.round }}</span>
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
            Личное раскрытие: {{ r.name }} — {{ fmt(r.value) }}
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
        <b class="text-amber-300 font-mono">{{ fmt(auction.revealedValue) }}</b>
      </div>

      <!-- Фаза ставок -->
      <template v-if="auction.phase === 'bid'">
        <div v-if="myPlayer && !myPlayer.passed" class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <input
              v-model.number="bidAmount"
              type="number"
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
        <div v-if="auction.bids" class="flex flex-col gap-1 text-sm">
          <div
            v-for="b in sortedBids"
            :key="b.playerId"
            class="flex justify-between gap-2"
            :class="b.amount === maxBid && b.amount > 0 ? 'text-amber-300' : ''"
          >
            <span class="truncate">{{ playerName(b.playerId) }}</span>
            <span class="font-mono">{{ b.amount === 0 ? 'пас' : fmt(b.amount) }}</span>
          </div>
        </div>
        <div v-if="auction.result?.winnerId" class="text-sm text-emerald-300 font-semibold">
          {{ playerName(auction.result.winnerId) }} забирает все предметы стола за {{ fmt(auction.result.price ?? 0) }}
        </div>
        <div
          v-if="auction.result?.winnerId && auction.result.compensation"
          class="text-[11px] text-sky-300"
        >
          Переплата: банк выплатил остальным компенсацию {{ fmt(auction.result.compensation) }}
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
import { computed, ref } from 'vue';
import { fmt, RARITY_LABEL } from '@auctioneer/shared';
import type { AuctionBid, PublicGame, Rarity } from '@auctioneer/shared';
import { RARITY_HEX } from '../lib/rarity';
import ItemCard from './ItemCard.vue';

const props = defineProps<{ game: PublicGame; meId: string }>();
const emit = defineEmits<{ (e: 'bid', amount: number): void }>();

const bidAmount = ref(0);

const auction = computed(() => props.game.auction);
const myPlayer = computed(() => props.game.players.find((p) => p.id === props.meId) ?? null);

const lotTitle = computed(() => 'Корабль сокровищ');

const sortedBids = computed<AuctionBid[]>(() => {
  const bids = auction.value?.bids ?? [];
  return bids.slice().sort((a, b) => b.amount - a.amount);
});

const maxBid = computed(() => (sortedBids.value.length > 0 ? sortedBids.value[0].amount : 0));

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
</script>
