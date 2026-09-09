<template>
  <!-- Компактный вид для мобильной игры: горизонтальная лента игроков -->
  <div v-if="compact" class="flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5">
    <a
      v-for="p in game.players"
      :key="p.id"
      :href="'#/profile/' + p.id"
      target="_blank"
      rel="noopener"
      class="shrink-0 flex items-center gap-1.5 rounded-lg px-1.5 py-1 bg-slate-800/50"
      :class="p.id === meId ? 'ring-1 ring-slate-500' : ''"
      :title="'Открыть профиль ' + p.name"
    >
      <div
        class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 text-slate-950"
        :style="{ background: playerColor(p.id) }"
      >
        {{ p.name.charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0">
        <div class="text-[11px] leading-tight truncate max-w-24">
          {{ p.name }}
          <span v-if="p.isHost" class="text-amber-300">★</span>
        </div>
        <div class="text-[10px] font-mono text-slate-400 leading-tight">
          {{ fmt(p.cash) }}
          <template v-if="p.ante > 0 && (game.phase === 'betting' || game.phase === 'auction')">
            <span class="text-amber-200/80">· {{ fmt(p.ante) }}</span>
          </template>
        </div>
      </div>
      <span
        v-if="statusOf(p).text"
        class="text-[9px] px-1 py-0.5 rounded shrink-0"
        :class="statusOf(p).cls"
      >
        {{ statusOf(p).text }}
      </span>
    </a>
  </div>

  <!-- Полный список -->
  <div v-else class="panel">
    <h3 class="text-sm font-semibold mb-2">Игроки</h3>
    <div class="flex flex-col gap-1.5">
      <div
        v-for="p in game.players"
        :key="p.id"
        class="flex items-center gap-2 px-2 py-1.5 rounded-lg"
        :class="p.id === meId ? 'bg-slate-800/80' : 'bg-slate-800/40'"
      >
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 text-slate-950"
          :style="{ background: playerColor(p.id) }"
        >
          {{ p.name.charAt(0).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <a
              :href="'#/profile/' + p.id"
              target="_blank"
              rel="noopener"
              class="text-sm truncate hover:text-amber-300 hover:underline"
              :title="'Открыть профиль ' + p.name"
              @click.stop
            >{{ p.name }}</a>
            <span v-if="p.isHost" class="text-[9px] px-1 rounded bg-amber-500/20 text-amber-300">ХОСТ</span>
            <span v-if="!p.online" class="text-[9px] px-1 rounded bg-rose-500/20 text-rose-300">офлайн</span>
          </div>
          <div class="text-[11px] text-slate-400 font-mono">
            {{ fmt(p.cash) }}
            <span class="text-slate-600">· инв: {{ fmt(p.inventoryValue) }}</span>
          </div>
          <div v-if="game.phase === 'betting' || game.phase === 'auction'" class="text-[10px] text-slate-500">
            ставка: <span class="text-amber-200/80">{{ fmt(p.ante) }}</span>
          </div>
        </div>
        <span
          v-if="statusOf(p).text"
          class="text-[10px] px-1.5 py-0.5 rounded shrink-0"
          :class="statusOf(p).cls"
        >
          {{ statusOf(p).text }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmt } from '@auctioneer/shared';
import type { PublicGame, PublicPlayer } from '@auctioneer/shared';

const props = withDefaults(defineProps<{ game: PublicGame; meId: string; compact?: boolean }>(), {
  compact: false,
});

const AVATAR_COLORS = ['#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#f87171', '#38bdf8', '#fb923c'];

function playerColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function statusOf(p: PublicPlayer): { text: string; cls: string } {
  const g = props.game;
  if (g.phase === 'waiting') {
    return p.ready
      ? { text: 'готов', cls: 'bg-emerald-500/20 text-emerald-300' }
      : { text: '', cls: '' };
  }
  if (g.phase === 'betting') {
    return p.ante > 0
      ? { text: 'поставил', cls: 'bg-emerald-500/20 text-emerald-300' }
      : { text: 'думает', cls: 'bg-slate-700/40 text-slate-300' };
  }
  if (g.phase === 'auction' && g.auction) {
    const a = g.auction;
    if (a.phase === 'bid') {
      return p.passed
        ? { text: 'пас', cls: 'bg-rose-500/20 text-rose-300' }
        : { text: 'ставит…', cls: 'bg-sky-500/20 text-sky-300' };
    }
    if (a.phase === 'resolve' && a.result?.winnerId) {
      return a.result.winnerId === p.id
        ? { text: 'выиграл лот', cls: 'bg-amber-500/20 text-amber-300' }
        : { text: '', cls: '' };
    }
    return { text: '', cls: '' };
  }
  if (g.phase === 'finished' && g.final) {
    const st = g.final.standings.find((s) => s.playerId === p.id);
    return { text: st ? st.place + '-е место' : '', cls: 'bg-slate-700/40 text-slate-300' };
  }
  return { text: '', cls: '' };
}
</script>
