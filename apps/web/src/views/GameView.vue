<template>
  <div v-if="game" class="game-shell flex flex-col">
    <TopBar :game="game" @leave="leave" />

    <!-- Ожидание игроков -->
    <div v-if="game.phase === 'waiting'" class="flex-1 flex overflow-auto p-3 sm:p-6">
      <div class="m-auto bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-8 w-full max-w-lg">
        <div class="text-center mb-6">
          <p class="text-sm text-slate-400">Код комнаты</p>
          <p class="text-4xl font-mono font-bold tracking-widest text-amber-400">{{ game.code }}</p>
          <button class="text-xs text-slate-400 underline mt-1" @click="copyCode">скопировать</button>
        </div>
        <PlayersPanel :game="game" :me-id="meId" />
        <div class="mt-6">
          <button class="w-full" :class="iAmReady ? 'btn-ghost' : 'btn-primary'" @click="toggleReady">
            {{ iAmReady ? 'Я не готов/а' : 'Я готов/а' }}
          </button>
        </div>
        <p class="text-xs text-slate-500 text-center mt-3 leading-relaxed">
          Партия начнётся автоматически, когда наберётся 4 игрока.
          <template v-if="game.players.length >= 2">
            Если все нажмут «Я готов/а» — стартуем раньше.
          </template>
          <template v-else>Нужно минимум 2 игрока — отправьте код друзьям.</template>
        </p>
      </div>
    </div>

    <!-- Итоги: результаты + полностью раскрытый стол -->
    <div v-else-if="game.phase === 'finished'" class="flex-1 overflow-auto p-3 sm:p-6">
      <div class="max-w-5xl mx-auto flex flex-col gap-4 pb-6">
        <div class="flex justify-center">
          <ResultModal :game="game" :me-id="meId" @leave="leave" @again="startGame" />
        </div>
        <div class="panel p-2 sm:p-3">
          <BoardView
            :board="game.board"
            :items="game.items"
            :players="game.players"
            title="Финальный стол"
            subtitle="все предметы раскрыты"
            mode="auction"
            fit="width"
            :rarity-hints="game.private?.rarityHints"
          />
        </div>
        <p class="text-center text-xs text-slate-500">
          Полная стоимость стола:
          <b class="text-amber-300 font-mono"><CoinAmount :value="tableRevealedValue" /></b>
          · вот что скрывалось до конца игры
        </p>
      </div>
    </div>

    <!-- Игра: стол и действия -->
    <div
      v-else-if="game.phase === 'betting' || game.phase === 'auction'"
      class="flex-1 min-h-0"
    >
      <!-- Десктоп: три колонки -->
      <div class="hidden lg:flex h-full min-h-0 gap-4 p-4">
      <!-- Левая колонка: игроки -->
      <aside class="w-80 shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
        <PlayersPanel :game="game" :me-id="meId" />
        <LogPanel :log="game.log" />
      </aside>

      <!-- Центр: стол 16x16 -->
      <main class="flex-1 min-w-0 flex flex-col min-h-0">
        <div class="panel mb-3 py-2 px-4 text-sm shrink-0">
          Текущая ожидаемая стоимость предметов на столе:
          <b class="text-amber-300 font-mono"><CoinAmount :value="tableRevealedValue" /></b>
          <span v-if="game.phase === 'betting'" class="text-slate-500 text-xs">
            · стол уже сформирован — вступительная ставка открывает торги
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
            :rarity-hints="game.private?.rarityHints"
            @hidden-click="onHiddenClick"
          />
        </div>
      </main>

      <!-- Правая колонка: особые карточки -->
      <aside class="w-80 shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto">
        <CardsPanel :phase="game.phase" />
        <AntePanel v-if="game.phase === 'betting'" :game="game" :me-id="meId" @ante="onAnte" />
        <AuctionPanel v-if="game.phase === 'auction'" :game="game" :me-id="meId" @bid="onBid" />
      </aside>
    </div>

      <!-- Мобильная верстка: стол сверху, действия внизу -->
      <div class="lg:hidden h-full min-h-0 flex flex-col">
      <main class="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-2 p-2 sm:p-3">
        <!-- статусная строка -->
        <div class="panel py-1.5 px-3 text-xs shrink-0 flex items-center gap-x-3 gap-y-1 flex-wrap">
          <span class="text-slate-400">Стол:</span>
          <b class="text-amber-300 font-mono"><CoinAmount :value="tableRevealedValue" /></b>
          <span v-if="game.phase === 'betting'" class="text-slate-600 ml-auto text-[11px]">
            стол запечатан — сделайте вступительную ставку
          </span>
          <span v-else class="text-slate-600 ml-auto text-[11px] sm:hidden">
            нажмите на предмет — детали
          </span>
        </div>

        <!-- игровой стол: по ширине экрана, страница скроллится -->
        <div class="shrink-0">
          <BoardView
            :board="game.board"
            :items="game.items"
            :players="game.players"
            :title="boardTitle"
            :subtitle="boardSubtitle"
            mode="auction"
            fit="width"
            :rarity-hints="game.private?.rarityHints"
            @hidden-click="onHiddenClick"
          />
        </div>

        <!-- игроки и журнал -->
        <div class="shrink-0">
          <PlayersPanel :game="game" :me-id="meId" compact />
        </div>
        <div class="shrink-0">
          <LogPanel :log="game.log" collapsible />
        </div>
      </main>

      <!-- нижняя панель действий -->
      <footer
        class="shrink-0 z-20 border-t border-slate-800 bg-slate-950/95 backdrop-blur px-2 sm:px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
      >
        <div class="max-h-[45dvh] overflow-y-auto overscroll-contain flex flex-col gap-2">
          <CardsPanel v-if="game.phase === 'auction'" :phase="game.phase" />
          <AntePanel v-if="game.phase === 'betting'" :game="game" :me-id="meId" @ante="onAnte" />
          <AuctionPanel v-if="game.phase === 'auction'" :game="game" :me-id="meId" @bid="onBid" />
        </div>
      </footer>
      </div>
    </div>

    <!-- модалка: какие предметы может скрывать нераскрытая плитка -->
    <Dialog v-model:open="hiddenModalOpen">
      <DialogContent class="max-w-xl">
        <DialogHeader class="pr-8">
          <DialogTitle>
            Скрытый предмет {{ hiddenModal ? hiddenModal.w + '×' + hiddenModal.h : '' }}
          </DialogTitle>
        </DialogHeader>
        <p v-if="hiddenModal" class="text-xs text-slate-400 mt-1">
          Под этой плиткой лежит один из {{ hiddenCandidates.length }} предметов каталога,
          помещающихся в размер {{ hiddenModal.w }}×{{ hiddenModal.h }} (с учётом поворота):
        </p>
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3 max-h-80 overflow-y-auto pr-1">
          <div
            v-for="d in hiddenCandidates"
            :key="d.id"
            class="rounded-lg p-1.5 bg-slate-800/40 flex flex-col items-center"
            :title="d.desc"
          >
            <div class="w-full aspect-square rounded overflow-hidden">
              <ItemCard :name="d.name" :rarity="d.rarity" :def-id="d.id" :value="d.value" dense :show-value="false" />
            </div>
            <div class="text-[9px] text-slate-400 text-center mt-1 leading-tight w-full truncate">
              {{ d.w }}×{{ d.h }} · <CoinAmount :value="d.value" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
  <div v-else class="h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
    <template v-if="joinError">
      <p class="text-sm text-slate-300">{{ joinError }}</p>
      <button class="btn-primary" @click="goBack">Вернуться</button>
    </template>
    <template v-else>
      <span class="text-slate-400">Подключение…</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ITEM_CATALOG } from '@auctioneer/shared';
import type { Profile } from '@auctioneer/shared';
import CoinAmount from '../components/CoinAmount.vue';
import ItemCard from '../components/ItemCard.vue';
import Dialog from '../components/ui/dialog/Dialog.vue';
import DialogContent from '../components/ui/dialog/DialogContent.vue';
import DialogHeader from '../components/ui/dialog/DialogHeader.vue';
import DialogTitle from '../components/ui/dialog/DialogTitle.vue';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopBar from '../components/TopBar.vue';
import BoardView from '../components/BoardView.vue';
import PlayersPanel from '../components/PlayersPanel.vue';
import AntePanel from '../components/AntePanel.vue';
import AuctionPanel from '../components/AuctionPanel.vue';
import CardsPanel from '../components/CardsPanel.vue';
import LogPanel from '../components/LogPanel.vue';
import ResultModal from '../components/ResultModal.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const gameStore = useGameStore();

const profile = ref<Profile | null>(null);
const code = computed(() => String(route.params.code ?? ''));
/** Ошибка подключения к комнате по неверной ссылке (показываем кнопку «Вернуться») */
const joinError = ref('');

const game = computed(() => gameStore.game);
const meId = computed(() => auth.meId);
const iAmReady = computed(() => game.value?.players.find((p) => p.id === meId.value)?.ready ?? false);

/** Кликнутая нераскрытая плитка: модалка показывает все предметы такого же размера */
const hiddenModal = ref<{ w: number; h: number } | null>(null);
const hiddenModalOpen = computed({
  get: () => hiddenModal.value !== null,
  set: (v: boolean) => {
    if (!v) hiddenModal.value = null;
  },
});
const hiddenCandidates = computed(() => {
  const m = hiddenModal.value;
  if (!m) return [];
  // предметы ложатся на стол с возможным поворотом, поэтому учитываем оба варианта
  return ITEM_CATALOG
    .filter((d) => (d.w === m.w && d.h === m.h) || (d.w === m.h && d.h === m.w))
    .sort((a, b) => a.value - b.value);
});

function onHiddenClick(rect: { x: number; y: number; w: number; h: number }): void {
  hiddenModal.value = { w: rect.w, h: rect.h };
}

const boardTitle = computed(() =>
  game.value?.phase === 'betting' ? 'Игровой стол — ждём ставок' : 'Игровой стол',
);
const boardSubtitle = computed(() => {
  if (game.value?.phase === 'betting') return 'сделайте вступительную ставку на панели';
  return 'нажмите на предмет, чтобы увидеть цену и детали';
});

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
    // сервер отвечает ack-ом (ок/ошибка); страховка от зависшего соединения — таймаут
    const resp = await Promise.race([
      gameStore.sync(code.value),
      new Promise<{ ok: boolean; error?: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: 'Не удалось подключиться к комнате' }), 8000),
      ),
    ]);
    if (!resp.ok && !gameStore.game) {
      joinError.value = resp.error ?? 'Комната не найдена';
    }
  }
});

function goBack(): void {
  router.replace('/');
}

function onAnte(amount: number): void {
  gameStore.ante(amount);
}

function onBid(amount: number): void {
  gameStore.bid(amount);
}

function startGame(): void {
  gameStore.start();
}

function toggleReady(): void {
  gameStore.setReady(!iAmReady.value);
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
