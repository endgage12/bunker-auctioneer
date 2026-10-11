<template>
  <header ref="navRoot" class="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2">
      <!-- мобильное меню: Sheet от shadcn (портал в body, поверх всего, на всю высоту) -->
      <Sheet v-model:open="menuOpen">
        <SheetTrigger as-child>
          <button
            class="lg:hidden btn-ghost shrink-0 !px-2 !py-1.5"
            aria-label="Открыть меню"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </SheetTrigger>
        <SheetContent side="left" class="gap-0 p-0">
          <SheetHeader class="h-14 flex-row items-center justify-start border-b border-slate-800 px-4 shrink-0 gap-0">
            <SheetTitle>Навигация</SheetTitle>
          </SheetHeader>
          <nav class="flex flex-1 flex-col gap-1 overflow-y-auto p-2" @click="menuOpen = false">
            <router-link to="/" class="nav-link" :class="{ 'nav-link-active': $route.name === 'lobby' }">
              Лобби
            </router-link>
            <router-link
              v-if="profile"
              :to="'/profile/' + profile.id"
              class="nav-link"
              :class="{ 'nav-link-active': $route.name === 'profile' }"
            >
              Профиль
            </router-link>
            <router-link to="/market" class="nav-link" :class="{ 'nav-link-active': $route.name === 'market' }">
              Аукцион
            </router-link>
            <router-link to="/inventory" class="nav-link" :class="{ 'nav-link-active': $route.name === 'inventory' }">
              Инвентарь
            </router-link>
            <router-link to="/shop" class="nav-link" :class="{ 'nav-link-active': $route.name === 'shop' }">
              Магазин
            </router-link>
            <router-link to="/santa" class="nav-link" :class="{ 'nav-link-active': $route.name === 'santa' }">
              Тайный Санта
            </router-link>
            <router-link to="/sets" class="nav-link" :class="{ 'nav-link-active': $route.name === 'sets' }">
              Сеты
            </router-link>
            <router-link to="/library" class="nav-link" :class="{ 'nav-link-active': $route.name === 'library' }">
              Библиотека
            </router-link>
            <router-link to="/leaderboard" class="nav-link" :class="{ 'nav-link-active': $route.name === 'leaderboard' }">
              Таблица лидеров
            </router-link>
            <router-link
              v-if="profile?.isAdmin"
              to="/admin"
              class="nav-link"
              :class="{ 'nav-link-active': $route.name === 'admin' }"
            >
              Админ
            </router-link>
          </nav>
          <div v-if="profile" class="border-t border-slate-800 p-4 shrink-0">
            <div class="mb-1 truncate text-xs text-slate-400">{{ profile.name }}</div>
            <button class="btn-ghost w-full" @click="logout">Выйти</button>
          </div>
        </SheetContent>
      </Sheet>

      <!-- десктопная навигация -->
      <div class="hidden lg:flex items-center gap-2 flex-1 overflow-x-auto">
        <router-link to="/" class="nav-link" :class="{ 'nav-link-active': $route.name === 'lobby' }">
          Лобби
        </router-link>
        <router-link
          v-if="profile"
          :to="'/profile/' + profile.id"
          class="nav-link"
          :class="{ 'nav-link-active': $route.name === 'profile' }"
        >
          Профиль
        </router-link>
        <router-link to="/market" class="nav-link" :class="{ 'nav-link-active': $route.name === 'market' }">
          Аукцион
        </router-link>
        <router-link to="/inventory" class="nav-link" :class="{ 'nav-link-active': $route.name === 'inventory' }">
          Инвентарь
        </router-link>
        <router-link to="/shop" class="nav-link" :class="{ 'nav-link-active': $route.name === 'shop' }">
          Магазин
        </router-link>
        <router-link to="/santa" class="nav-link" :class="{ 'nav-link-active': $route.name === 'santa' }">
          Тайный Санта
        </router-link>
        <router-link to="/sets" class="nav-link" :class="{ 'nav-link-active': $route.name === 'sets' }">
          Сеты
        </router-link>
        <router-link to="/library" class="nav-link" :class="{ 'nav-link-active': $route.name === 'library' }">
          Библиотека
        </router-link>
        <router-link to="/leaderboard" class="nav-link" :class="{ 'nav-link-active': $route.name === 'leaderboard' }">
          Таблица лидеров
        </router-link>
        <router-link
          v-if="profile?.isAdmin"
          to="/admin"
          class="nav-link"
          :class="{ 'nav-link-active': $route.name === 'admin' }"
        >
          Админ
        </router-link>
        <button class="btn-ghost ml-2" @click="logout">Выйти</button>
      </div>

      <div class="flex-1 lg:hidden"></div>

      <!-- правая часть: никнейм и внутриигровой счёт -->
      <div v-if="profile" class="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
        <router-link
          :to="'/profile/' + profile.id"
          class="text-sm text-slate-300 hover:text-amber-300 truncate max-w-[7rem] min-[480px]:max-w-[10rem] lg:max-w-none transition"
          :title="'Открыть профиль ' + profile.name"
        >
          {{ profile.name }}
        </router-link>
        <span class="font-mono text-amber-300 text-sm whitespace-nowrap">
          <CoinAmount :value="profile.cash" />
        </span>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { gsap, motionOK } from '../lib/animations';
import { useRouter } from 'vue-router';
import CoinAmount from './CoinAmount.vue';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import Sheet from './ui/sheet/Sheet.vue';
import SheetTrigger from './ui/sheet/SheetTrigger.vue';
import SheetContent from './ui/sheet/SheetContent.vue';
import SheetHeader from './ui/sheet/SheetHeader.vue';
import SheetTitle from './ui/sheet/SheetTitle.vue';

const auth = useAuthStore();
const navRoot = ref<HTMLElement | null>(null);
const game = useGameStore();
const router = useRouter();

const profile = computed(() => auth.user);
const menuOpen = ref(false);

onMounted(async () => {
  if (!auth.user) {
    try {
      await auth.fetchMe();
    } catch {
      /* guard отправит на /login */
    }
  }
});

function logout(): void {
  menuOpen.value = false;
  game.detach();
  auth.logout();
  router.replace('/login');
}
</script>
