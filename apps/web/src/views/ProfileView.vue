<template>
  <div class="min-h-screen">
    <TopNav />
    <div class="max-w-3xl mx-auto p-6">
      <div v-if="loading" class="panel p-8 text-center text-slate-400">Загрузка профиля…</div>

      <div v-else-if="notFound" class="panel p-8 text-center">
        <div class="text-2xl mb-2">🔍</div>
        <p class="text-sm text-slate-400 mb-4">Игрок не найден.</p>
        <router-link to="/" class="btn-ghost">В лобби</router-link>
      </div>

      <div v-else-if="profile" class="space-y-4">
        <!-- шапка профиля -->
        <div class="panel p-6 flex items-center gap-4">
          <div
            class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold shrink-0 text-slate-950"
            :style="{ background: playerColor(profile.id) }"
          >
            {{ profile.name.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-bold truncate">{{ profile.name }}</h1>
              <span v-if="profile.id === meId" class="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300">
                это вы
              </span>
              <span v-if="profile.isAdmin" class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                АДМИН
              </span>
            </div>
            <p class="text-xs text-slate-500 mt-1">
              В игре с {{ memberSince }}
            </p>
          </div>
          <router-link to="/" class="btn-ghost shrink-0">В лобби</router-link>
        </div>

        <!-- статистика -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="panel p-4 text-center">
            <div class="text-2xl font-bold text-amber-300 font-mono">{{ profile.gamesPlayed }}</div>
            <div class="text-xs text-slate-500 mt-1">игр сыграно</div>
          </div>
          <div class="panel p-4 text-center">
            <div class="text-2xl font-bold text-amber-300 font-mono">{{ profile.gamesWon }}</div>
            <div class="text-xs text-slate-500 mt-1">побед</div>
          </div>
          <div class="panel p-4 text-center">
            <div class="text-2xl font-bold text-amber-300 font-mono">{{ winRate }}%</div>
            <div class="text-xs text-slate-500 mt-1">винрейт</div>
          </div>
          <div class="panel p-4 text-center">
            <div class="text-2xl font-bold text-amber-300 font-mono"><CoinAmount :value="profile.netWorth" /></div>
            <div class="text-xs text-slate-500 mt-1">состояние (наличные + инвентарь)</div>
          </div>
          <div class="panel p-4 text-center">
            <div class="text-2xl font-bold text-amber-300 font-mono">{{ profile.itemsCount }}</div>
            <div class="text-xs text-slate-500 mt-1">предметов</div>
          </div>
          <div class="panel p-4 text-center">
            <div class="text-2xl font-bold text-amber-300 font-mono"><CoinAmount :value="profile.inventoryValue" /></div>
            <div class="text-xs text-slate-500 mt-1">номинал инвентаря</div>
          </div>
          <div class="panel p-4 text-center">
            <div class="text-2xl font-bold text-amber-300 font-mono">{{ profile.completedSets }} / {{ profile.totalSets }}</div>
            <div class="text-xs text-slate-500 mt-1">сетов собрано</div>
          </div>
        </div>

        <!-- история матчей -->
        <div class="panel p-6">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">История матчей</h2>
              <button class="btn-small" title="Обновить историю" @click="load()">Обновить</button>
            </div>
            <div v-if="history.length" class="text-xs text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                всего вложено
                <span class="font-mono text-amber-300"><CoinAmount :value="totalInvested" /></span>
              </span>
              <span>
                суммарная разница
                <span class="font-mono font-semibold" :class="totalProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'">
                  <CoinAmount :value="totalProfit" signed />
                </span>
              </span>
            </div>
          </div>
          <div v-if="history.length === 0" class="text-sm text-slate-500">Пока нет сыгранных матчей</div>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="h in history"
              :key="h.gameId"
              class="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-800/40 cursor-pointer transition hover:bg-slate-800/80"
              :title="'Открыть предметы матча ' + h.code"
              @click="openMatch(h)"
            >
              <div class="w-8 text-center font-bold shrink-0" :class="placeClass(h.place)">{{ h.place }}</div>
              <div class="min-w-0 flex-1">
                <div class="text-sm flex flex-wrap items-center gap-x-2">
                  <span>{{ dateText(h.finishedAt) }}</span>
                  <span class="text-slate-500 text-xs">· {{ h.players }} игроков · комната {{ h.code }}</span>
                  <span
                    v-if="h.winnerId === profile.id"
                    class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300"
                  >
                    победа
                  </span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">
                  вложено <span class="font-mono"><CoinAmount :value="h.invested" /></span>
                  <span class="text-sky-400/80"> · предметы</span>
                </div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-sm font-mono font-bold" :class="h.profit >= 0 ? 'text-emerald-300' : 'text-rose-300'">
                  <CoinAmount :value="h.profit" signed />
                </div>
                <div class="text-[10px]" :class="h.profit >= 0 ? 'text-emerald-400/70' : 'text-rose-400/70'">
                  {{ h.profit >= 0 ? 'ушёл в плюс' : 'ушёл в минус' }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- модалка: предметы матча -->
    <Dialog v-model:open="matchDialogOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader class="pr-8">
          <DialogTitle>Матч {{ matchDetail ? matchDetail.code : '…' }}</DialogTitle>
        </DialogHeader>
        <div v-if="matchLoading" class="text-sm text-slate-400 mt-4">Загрузка предметов…</div>
        <template v-else-if="matchDetail">
          <p class="text-xs text-slate-500 mt-1">
            {{ dateText(matchDetail.finishedAt) }} · {{ matchDetail.players.length }} игроков · победитель:
            <span class="text-amber-300">{{ winnerName }}</span>
          </p>
          <div v-if="matchDetail.items.length === 0" class="text-sm text-slate-500 mt-4">
            Данных о предметах этой партии нет — она сыграна до появления истории предметов.
          </div>
          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2 mt-4 mb-2">
              <div class="text-xs text-slate-400">Предметы призового стола ({{ matchDetail.items.length }})</div>
              <div class="text-xs text-slate-400">
                ценность: <span class="font-mono text-amber-300"><CoinAmount :value="itemsTotalValue" /></span>
              </div>
            </div>
            <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-80 overflow-y-auto pr-1">
              <div
                v-for="it in matchDetail.items"
                :key="it.itemId"
                class="rounded-lg p-1.5 bg-slate-800/40 flex flex-col items-center"
                :title="it.name + ' — ' + fmt(it.value) + ' · ' + it.w + '×' + it.h + ' · ' + ownerName(it.ownerId)"
              >
                <div class="w-full aspect-square rounded overflow-hidden">
                  <ItemCard :name="it.name" :rarity="it.rarity" :def-id="it.defId" dense :show-value="false" />
                </div>
                <div class="text-[9px] text-slate-400 text-center mt-1 leading-tight w-full truncate">
                  {{ it.w }}×{{ it.h }} · <CoinAmount :value="it.value" />
                </div>
                <div
                  class="text-[9px] text-center leading-tight w-full truncate"
                  :class="it.ownerId ? 'text-emerald-300' : 'text-rose-300'"
                >
                  {{ it.ownerId ? '→ ' + ownerName(it.ownerId) : 'сгорел' }}
                </div>
              </div>
            </div>
          </template>
        </template>
        <div v-else class="text-sm text-rose-300 mt-4">Не удалось загрузить предметы матча.</div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { fmt } from '@auctioneer/shared';
import type { GameDetail, MatchHistoryEntry, PublicProfile } from '@auctioneer/shared';
import { get } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import TopNav from '../components/TopNav.vue';
import ItemCard from '../components/ItemCard.vue';
import CoinAmount from '../components/CoinAmount.vue';
import Dialog from '../components/ui/dialog/Dialog.vue';
import DialogContent from '../components/ui/dialog/DialogContent.vue';
import DialogHeader from '../components/ui/dialog/DialogHeader.vue';
import DialogTitle from '../components/ui/dialog/DialogTitle.vue';

const route = useRoute();
const auth = useAuthStore();

const profile = ref<PublicProfile | null>(null);
const history = ref<MatchHistoryEntry[]>([]);
const loading = ref(true);
const notFound = ref(false);

const matchDialogOpen = ref(false);
const matchDetail = ref<GameDetail | null>(null);
const matchLoading = ref(false);

/** Открыть модалку с предметами матча (видна для любой партии, независимо от победителя) */
async function openMatch(h: MatchHistoryEntry): Promise<void> {
  matchDialogOpen.value = true;
  matchLoading.value = true;
  matchDetail.value = null;
  try {
    matchDetail.value = await get<GameDetail>('/api/game/' + h.gameId);
  } catch {
    /* ошибка показывается в модалке */
  } finally {
    matchLoading.value = false;
  }
}

const winnerName = computed(() => {
  const d = matchDetail.value;
  if (!d) return '—';
  return d.players.find((p) => p.id === d.winnerId)?.name ?? '—';
});

const itemsTotalValue = computed(() => (matchDetail.value?.items ?? []).reduce((s, i) => s + i.value, 0));

function ownerName(ownerId?: string): string {
  const d = matchDetail.value;
  if (!ownerId || !d) return '—';
  return d.players.find((p) => p.id === ownerId)?.name ?? '—';
}

const profileId = computed(() => String(route.params.id ?? ''));
const meId = computed(() => auth.meId);

const memberSince = computed(() => {
  const d = profile.value?.createdAt;
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
});

const winRate = computed(() => {
  const p = profile.value;
  if (!p || p.gamesPlayed === 0) return 0;
  return Math.round((p.gamesWon / p.gamesPlayed) * 100);
});

const totalInvested = computed(() => history.value.reduce((s, h) => s + h.invested, 0));
const totalProfit = computed(() => history.value.reduce((s, h) => s + h.profit, 0));

function placeClass(place: number): string {
  if (place === 1) return 'text-amber-300';
  if (place === 2) return 'text-slate-300';
  if (place === 3) return 'text-orange-400';
  return 'text-slate-500';
}

function dateText(at: number): string {
  return new Date(at).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const AVATAR_COLORS = ['#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#f87171', '#38bdf8', '#fb923c'];

function playerColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

async function load(): Promise<void> {
  loading.value = true;
  notFound.value = false;
  profile.value = null;
  history.value = [];
  try {
    const [p, h] = await Promise.all([
      get<PublicProfile>('/api/profile/' + profileId.value),
      get<MatchHistoryEntry[]>('/api/profile/' + profileId.value + '/history'),
    ]);
    profile.value = p;
    history.value = h;
  } catch {
    notFound.value = true;
  } finally {
    loading.value = false;
  }
}

void load();
watch(profileId, () => void load());

// Страница может подолгу висеть открытой во вкладке: при возврате на неё
// перезапрашиваем профиль и историю (сыгранные матчи сразу появятся).
function onVisible(): void {
  if (document.visibilityState === 'visible') void load();
}

onMounted(() => document.addEventListener('visibilitychange', onVisible));
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible));
</script>
