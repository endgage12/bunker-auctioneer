<template>
  <div v-if="game" class="h-screen flex flex-col">
    <TopBar :game="game" @leave="leave" />

    <!-- Ожидание игроков -->
    <div v-if="game.phase === 'waiting'" class="flex-1 flex items-center justify-center p-6 overflow-auto">
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-8 w-full max-w-lg">
        <div class="text-center mb-6">
          <p class="text-sm text-slate-400">Код комнаты</p>
          <p class="text-4xl font-mono font-bold tracking-widest text-amber-400">{{ game.code }}</p>
          <button class="text-xs text-slate-400 underline mt-1" @click="copyCode">скопировать</button>
        </div>
        <PlayersPanel :game="game" :me-id="meId" />
        <div v-if="isHost" class="mt-6">
          <button class="btn-primary w-full" :disabled="game.players.length < 2" @click="startGame">
            Начать игру
          </button>
          <p v-if="game.players.length < 2" class="text-xs text-slate-500 text-center mt-2">
            Нужно минимум 2 игрока — отправьте код друзьям
          </p>
        </div>
        <p v-else class="text-center text-slate-400 text-sm mt-6">Ожидание хоста…</p>
      </div>
    </div>

    <!-- Игра: три колонки -->
    <div
      v-else-if="game.phase === 'betting' || game.phase === 'auction'"
      class="flex-1 flex min-h-0 gap-4 p-4"
    >
      <!-- Левая колонка: игроки -->
      <aside class="w-80 shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
        <PlayersPanel :game="game" :me-id="meId" />
        <LogPanel :log="game.log" />
      </aside>

      <!-- Центр: стол 16x16 -->
      <main class="flex-1 min-w-0 flex flex-col min-h-0">
        <div class="panel mb-3 py-2 px-4 text-sm shrink-0">
          Текущая ожидаемая стоимость предметов на столе:
          <b class="text-amber-300 font-mono">{{ fmt(tableRevealedValue) }}</b>
          <span v-if="game.phase === 'betting'" class="text-slate-500 text-xs">
            · стол заполнится призами после вступительных ставок
          </span>
        </div>
        <div class="flex-1 min-h-0 overflow-auto pb-2">
          <BoardView
            :board="game.board"
            :items="game.items"
            :players="game.players"
            :title="boardTitle"
            :subtitle="boardSubtitle"
            mode="auction"
          />
        </div>
      </main>

      <!-- Правая колонка: особые карточки -->
      <aside class="w-80 shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
        <div class="panel p-5 flex flex-col items-center justify-center gap-2 min-h-40">
          <div class="text-3xl">🃏</div>
          <h3 class="font-semibold text-sm">Особые карточки</h3>
          <p class="text-xs text-slate-500 text-center">
            Здесь появятся особые карточки, влияющие на ход игры. Раздел в разработке.
          </p>
        </div>
        <AntePanel v-if="game.phase === 'betting'" :game="game" :me-id="meId" @ante="onAnte" />
        <AuctionPanel v-if="game.phase === 'auction'" :game="game" :me-id="meId" @bid="onBid" />
      </aside>
    </div>

    <!-- Итоги -->
    <div v-else class="flex-1 flex items-center justify-center p-6 overflow-auto">
      <ResultModal :game="game" :me-id="meId" @leave="leave" @again="startGame" />
    </div>
  </div>
  <div v-else class="h-screen flex items-center justify-center text-slate-400">Подключение…</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fmt } from '@auctioneer/shared';
import type { Profile } from '@auctioneer/shared';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopBar from '../components/TopBar.vue';
import BoardView from '../components/BoardView.vue';
import PlayersPanel from '../components/PlayersPanel.vue';
import AntePanel from '../components/AntePanel.vue';
import AuctionPanel from '../components/AuctionPanel.vue';
import LogPanel from '../components/LogPanel.vue';
import ResultModal from '../components/ResultModal.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const gameStore = useGameStore();

const profile = ref<Profile | null>(null);
const code = computed(() => String(route.params.code ?? ''));

const game = computed(() => gameStore.game);
const meId = computed(() => auth.meId);
const isHost = computed(() => game.value?.players.find((p) => p.id === meId.value)?.isHost ?? false);

const boardTitle = computed(() =>
  game.value?.phase === 'betting' ? 'Игровой стол — ждём ставок' : 'Игровой стол',
);
const boardSubtitle = computed(() =>
  game.value?.phase === 'betting'
    ? 'сделайте вступительную ставку справа'
    : 'наведите курсор на раскрытый предмет для подсказки',
);

// сумма стоимости всех раскрытых предметов на столе
const tableRevealedValue = computed(() =>
  (game.value?.items ?? [])
    .filter((i) => i.revealed && i.value !== undefined)
    .reduce((s, i) => s + (i.value ?? 0), 0),
);

onMounted(async () => {
  profile.value = await auth.fetchMe();
  gameStore.attach();
  if (gameStore.game?.code !== code.value) {
    gameStore.sync(code.value);
  }
});

function onAnte(amount: number): void {
  gameStore.ante(amount);
}

function onBid(amount: number): void {
  gameStore.bid(amount);
}

function startGame(): void {
  gameStore.start();
}

function leave(): void {
  gameStore.leave();
  router.replace('/');
}

function copyCode(): void {
  void navigator.clipboard?.writeText(game.value?.code ?? '');
  gameStore.pushToast('Код скопирован');
}
</script>
