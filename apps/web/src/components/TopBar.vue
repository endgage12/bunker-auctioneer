<template>
  <header class="h-12 sm:h-14 shrink-0 border-b border-slate-800 bg-slate-900/80 flex items-center px-2 sm:px-4 gap-2 sm:gap-4">
    <div class="font-bold text-amber-300 hidden sm:block">Раз, два, продано!</div>
    <div class="font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded tracking-widest text-sm">{{ game.code }}</div>
    <div class="text-xs sm:text-sm text-slate-300 truncate min-w-0">{{ phaseLabel }}</div>
    <CountdownBadge v-if="game.deadline > 0 && (game.phase === 'betting' || game.phase === 'auction')" :deadline="game.deadline" />
    <div class="flex-1"></div>
    <button class="text-sm text-slate-400 hover:text-white transition shrink-0" @click="$emit('leave')">Выйти</button>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PublicGame } from '@auctioneer/shared';
import CountdownBadge from './CountdownBadge.vue';

const props = defineProps<{ game: PublicGame }>();
defineEmits<{ (e: 'leave'): void }>();

const phaseLabel = computed(() => {
  switch (props.game.phase) {
    case 'waiting':
      return 'Ожидание игроков';
    case 'betting':
      return 'Вступительные ставки';
    case 'auction':
      return 'Торги';
    case 'finished':
      return 'Итоги';
  }
});
</script>
