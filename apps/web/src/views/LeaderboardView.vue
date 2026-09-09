<template>
  <div class="min-h-screen">
    <TopNav />
    <div class="max-w-3xl mx-auto p-4 sm:p-6">
      <div class="panel p-5">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h2 class="font-semibold">Таблица лидеров</h2>
          <span class="text-xs text-slate-500">счёт = наличные + номинал инвентаря</span>
        </div>
        <p class="text-xs text-slate-500 mb-4">
          Топ игроков по состоянию. Место обновляется при каждом открытии страницы.
        </p>

        <div v-if="loading && entries.length === 0" class="text-sm text-slate-400 py-6 text-center">Загрузка…</div>
        <div v-else-if="error" class="text-sm text-rose-300 py-6 text-center">{{ error }}</div>
        <div v-else-if="entries.length === 0" class="text-sm text-slate-500 py-6 text-center">
          Пока в списке пусто — сыграйте первую партию!
        </div>
        <div v-else class="flex flex-col">
          <div
            v-for="e in entries"
            :key="e.id"
            class="leader-row flex items-center gap-3 px-2 py-2 rounded-lg"
            :class="e.id === me?.id ? 'leader-row-me' : ''"
          >
            <div class="w-9 shrink-0 text-center font-mono font-bold" :class="rankClass(e.rank)">
              {{ rankLabel(e.rank) }}
            </div>
            <img
              v-if="e.avatar"
              :src="e.avatar"
              alt=""
              class="w-8 h-8 rounded-full shrink-0 bg-slate-800"
            />
            <div
              v-else
              class="w-8 h-8 rounded-full shrink-0 bg-slate-700 text-slate-200 flex items-center justify-center text-sm font-semibold"
            >
              {{ e.name.slice(0, 1).toUpperCase() }}
            </div>
            <router-link
              :to="'/profile/' + e.id"
              class="min-w-0 flex-1 truncate text-sm text-slate-200 hover:text-amber-300 transition"
              :title="'Открыть профиль ' + e.name"
            >
              {{ e.name }}
            </router-link>
            <div class="shrink-0 text-right">
              <div class="font-mono text-amber-300 text-sm leading-tight">
                <CoinAmount :value="e.netWorth" />
              </div>
              <div class="text-[10px] text-slate-500 leading-tight">
                наличные <CoinAmount :value="e.cash" /> · предметы <CoinAmount :value="e.inventoryValue" /> ·
                побед {{ e.gamesWon }}
              </div>
            </div>
          </div>
        </div>

        <!-- пагинация -->
        <div
          v-if="totalPages > 1"
          class="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-800"
        >
          <button class="btn-small" :disabled="page <= 1 || loading" @click="prevPage">← Назад</button>
          <span class="text-xs text-slate-400">
            Страница {{ page }} из {{ totalPages }} · игроков {{ total }}
          </span>
          <button class="btn-small" :disabled="page >= totalPages || loading" @click="nextPage">Вперёд →</button>
        </div>

        <!-- моё место вне топа -->
        <div
          v-if="me && !shownIds.has(me.id)"
          class="leader-row leader-row-me flex items-center gap-3 px-2 py-2 rounded-lg mt-2 border-t border-slate-700/60"
        >
          <div class="w-9 shrink-0 text-center font-mono font-bold text-sky-300">{{ me.rank }}</div>
          <div class="w-8 h-8 rounded-full shrink-0 bg-sky-900/60 text-sky-200 flex items-center justify-center text-sm font-semibold">
            {{ me.name.slice(0, 1).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1 truncate text-sm text-sky-200">
            {{ me.name }} <span class="text-slate-500 text-xs">(вы)</span>
          </div>
          <div class="shrink-0 text-right">
            <div class="font-mono text-amber-300 text-sm leading-tight">
              <CoinAmount :value="me.netWorth" />
            </div>
            <div class="text-[10px] text-slate-500 leading-tight">
              наличные <CoinAmount :value="me.cash" /> · предметы <CoinAmount :value="me.inventoryValue" /> ·
              побед {{ me.gamesWon }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { LeaderboardEntry, LeaderboardResponse } from '@auctioneer/shared';
import { get } from '../lib/api';
import TopNav from '../components/TopNav.vue';
import CoinAmount from '../components/CoinAmount.vue';

const PAGE_SIZE = 30;

const entries = ref<LeaderboardEntry[]>([]);
const me = ref<LeaderboardEntry | null>(null);
const page = ref(1);
const total = ref(0);
const totalPages = ref(1);
const loading = ref(true);
const error = ref('');

const shownIds = computed(() => new Set(entries.value.map((e) => e.id)));

async function load(p: number): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const data = await get<LeaderboardResponse>(
      '/api/leaderboard?page=' + p + '&pageSize=' + PAGE_SIZE,
    );
    entries.value = data.entries;
    me.value = data.me;
    page.value = data.page;
    total.value = data.total;
    totalPages.value = data.totalPages;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Не удалось загрузить таблицу';
  } finally {
    loading.value = false;
  }
}

function prevPage(): void {
  if (page.value > 1) void load(page.value - 1);
}

function nextPage(): void {
  if (page.value < totalPages.value) void load(page.value + 1);
}

function rankLabel(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return String(rank);
}

function rankClass(rank: number): string {
  if (rank === 1) return 'text-amber-300';
  if (rank === 2) return 'text-slate-300';
  if (rank === 3) return 'text-orange-400';
  return 'text-slate-500';
}

onMounted(() => {
  void load(1);
});
</script>

<style scoped>
.leader-row {
  transition: background 0.15s ease;
}
.leader-row:hover {
  background: rgba(51, 65, 85, 0.35);
}
.leader-row-me {
  background: rgba(56, 189, 248, 0.08);
}
</style>
