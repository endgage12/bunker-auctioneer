<template>
  <header class="sticky top-0 z-40 bg-slate-950/90 backdrop-blur border-b border-slate-800">
    <div class="max-w-6xl mx-auto px-6 h-14 flex items-center gap-2">
      <router-link to="/" class="font-bold text-amber-300 mr-4">Раз, два, продано!</router-link>
      <router-link to="/" class="nav-link" :class="{ 'nav-link-active': $route.name === 'lobby' }">
        Лобби
      </router-link>
      <router-link to="/market" class="nav-link" :class="{ 'nav-link-active': $route.name === 'market' }">
        Аукцион (барахолка)
      </router-link>
      <router-link to="/inventory" class="nav-link" :class="{ 'nav-link-active': $route.name === 'inventory' }">
        Инвентарь
      </router-link>
      <router-link to="/hideout" class="nav-link" :class="{ 'nav-link-active': $route.name === 'hideout' }">
        Убежище
      </router-link>
      <router-link
        v-if="profile?.isAdmin"
        to="/admin"
        class="nav-link"
        :class="{ 'nav-link-active': $route.name === 'admin' }"
      >
        Админ
      </router-link>
      <div class="flex-1"></div>
      <div v-if="profile" class="flex items-center gap-3">
        <span class="text-sm text-slate-300">{{ profile.name }}</span>
        <span class="font-mono text-amber-300 text-sm">{{ fmt(profile.cash) }}</span>
        <button class="btn-ghost" @click="logout">Выйти</button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fmt } from '@auctioneer/shared';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();

const profile = computed(() => auth.user);

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
  game.detach();
  auth.logout();
  router.replace('/login');
}
</script>
