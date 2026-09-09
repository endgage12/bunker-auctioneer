<template>
  <div class="min-h-screen">
    <TopNav />
    <div class="max-w-5xl mx-auto p-6">
      <div v-if="profile" class="text-sm text-slate-400 mb-6">
        Сыграно игр: {{ profile.gamesPlayed }} · Побед: {{ profile.gamesWon }}
        · <router-link to="/market" class="text-amber-300 hover:underline">барахолка</router-link>
        · <router-link to="/inventory" class="text-amber-300 hover:underline">инвентарь</router-link>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="panel p-5">
          <h2 class="font-semibold mb-4">Новая игра</h2>
          <button class="btn-primary w-full" :disabled="busy" @click="createRoom">Создать комнату</button>
          <div class="flex items-center gap-3 my-4">
            <div class="h-px bg-slate-700 flex-1"></div>
            <span class="text-xs text-slate-500">или</span>
            <div class="h-px bg-slate-700 flex-1"></div>
          </div>
          <form class="flex gap-2" @submit.prevent="joinRoom">
            <input v-model="code" class="input-dark font-mono uppercase tracking-widest" maxlength="4" placeholder="КОД" />
            <button type="submit" class="btn-ghost shrink-0" :disabled="busy || code.length !== 4">Войти</button>
          </form>
          <p v-if="error" class="text-rose-400 text-sm mt-3">{{ error }}</p>
        </div>

        <div class="panel p-5">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-semibold">Открытые комнаты</h2>
            <button class="text-xs text-slate-400 hover:text-white" @click="refreshRooms">обновить</button>
          </div>
          <div v-if="rooms.length === 0" class="text-sm text-slate-500">Сейчас нет открытых комнат</div>
          <div v-else class="flex flex-col gap-2">
            <button
              v-for="room in rooms"
              :key="room.code"
              class="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 text-left"
              @click="joinCode(room.code)"
            >
              <span class="font-mono text-amber-300 tracking-widest">{{ room.code }}</span>
              <span class="text-xs text-slate-400">{{ room.players }}/6 · хост: {{ room.hostName }}</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Profile, RoomInfo } from '@auctioneer/shared';
import { get } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopNav from '../components/TopNav.vue';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();

const profile = ref<Profile | null>(null);
const rooms = ref<RoomInfo[]>([]);
const code = ref('');
const busy = ref(false);
const error = ref('');

onMounted(async () => {
  profile.value = await auth.fetchMe();
  game.attach();
  void refreshRooms();
});

async function refreshRooms(): Promise<void> {
  try {
    rooms.value = await get<RoomInfo[]>('/api/rooms');
  } catch {
    /* ignore */
  }
}

async function createRoom(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const resp = await game.createRoom();
    if ('error' in resp) {
      error.value = resp.error;
      return;
    }
    router.push('/game/' + resp.code);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function joinCode(targetCode: string): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const resp = await game.joinRoom(targetCode);
    if ('error' in resp) {
      error.value = resp.error;
      return;
    }
    router.push('/game/' + resp.code);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function joinRoom(): Promise<void> {
  await joinCode(code.value.toUpperCase());
}
</script>
