<template>
  <div class="h-full min-h-screen bg-slate-950 text-slate-100">
    <router-view />
    <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      <div
        v-for="t in gameStore.toasts"
        :key="t.id"
        class="toast-in px-4 py-2 rounded-lg text-sm shadow-lg pointer-events-auto"
        :class="t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-100'"
      >
        {{ t.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGameStore } from './stores/game';

const gameStore = useGameStore();
</script>
