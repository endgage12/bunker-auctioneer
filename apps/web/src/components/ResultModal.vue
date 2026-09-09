<template>
  <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-8 w-full max-w-xl shadow-2xl">
    <h2 class="text-xl font-bold text-center mb-1">Игра окончена</h2>
    <p v-if="winner" class="text-center text-amber-300 mb-6">Победитель: {{ winner.name }}</p>

    <div class="flex flex-col gap-2">
      <div
        v-for="s in standings"
        :key="s.playerId"
        class="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-lg"
        :class="s.place === 1 ? 'bg-amber-500/10 border border-amber-500/40' : 'bg-slate-800/50'"
      >
        <div class="w-6 sm:w-8 text-center font-bold shrink-0" :class="placeClass(s.place)">{{ s.place }}</div>
        <div class="flex-1 min-w-0">
          <div class="text-sm truncate">
            {{ nameOf(s.playerId) }}
            <span v-if="s.playerId === meId" class="text-slate-500">(вы)</span>
          </div>
          <div class="sm:hidden text-[10px] text-slate-500 font-mono flex items-center gap-1">
            <CoinAmount :value="s.cash" /> + <CoinAmount :value="s.inventoryValue" />
          </div>
        </div>
        <div class="hidden sm:flex items-center gap-1 text-xs text-slate-400 font-mono shrink-0">
          <CoinAmount :value="s.cash" />
        </div>
        <div class="hidden sm:block text-xs text-slate-500 font-mono shrink-0">+<CoinAmount :value="s.inventoryValue" /></div>
        <div class="text-sm sm:text-base font-bold text-amber-300 font-mono shrink-0"><CoinAmount :value="s.total" /></div>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 mt-6">
      <button v-if="isHost" class="btn-primary flex-1" @click="$emit('again')">Сыграть ещё раз</button>
      <button class="btn-ghost flex-1" @click="$emit('leave')">В лобби</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CoinAmount from './CoinAmount.vue';
import type { PublicGame } from '@auctioneer/shared';

const props = defineProps<{ game: PublicGame; meId: string }>();
defineEmits<{ (e: 'again'): void; (e: 'leave'): void }>();

const standings = computed(() => props.game.final?.standings ?? []);
const winner = computed(() => props.game.players.find((p) => p.id === props.game.final?.winnerId) ?? null);
const isHost = computed(() => props.game.players.find((p) => p.id === props.meId)?.isHost ?? false);

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
