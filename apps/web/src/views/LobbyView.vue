<template>
  <div class="min-h-screen">
    <TopNav />
    <div class="max-w-2xl mx-auto p-6">
      <div v-if="profile" class="text-sm text-slate-400 mb-6 text-center">
        Сыграно игр: {{ profile.gamesPlayed }} · Побед: {{ profile.gamesWon }}
        · <router-link :to="'/profile/' + profile.id" class="text-amber-300 hover:underline">профиль</router-link>
        · <router-link to="/market" class="text-amber-300 hover:underline">барахолка</router-link>
        · <router-link to="/inventory" class="text-amber-300 hover:underline">инвентарь</router-link>
      </div>

      <div class="panel p-8">
        <h1 class="text-center font-bold text-2xl mb-1">Раз, два, продано!</h1>
        <p class="text-center text-sm text-slate-400 mb-8">Аукцион со слепыми ставками</p>

        <button class="btn-primary w-full text-lg py-3" :disabled="busy" @click="play">
          {{ busy ? 'Подбор…' : 'Играть' }}
        </button>

        <p v-if="error" class="text-rose-400 text-sm mt-3 text-center">{{ error }}</p>

        <div class="flex items-center gap-3 my-6">
          <div class="h-px bg-slate-700 flex-1"></div>
          <span class="text-xs text-slate-500">или войти по коду</span>
          <div class="h-px bg-slate-700 flex-1"></div>
        </div>

        <form class="flex gap-2 justify-center" @submit.prevent="joinRoom">
          <input v-model="code" class="input-dark font-mono uppercase tracking-widest text-center w-40" maxlength="4" placeholder="КОД" />
          <button type="submit" class="btn-ghost shrink-0" :disabled="busy || code.length !== 4">Войти</button>
        </form>

        <p class="text-xs text-slate-500 text-center mt-6 leading-relaxed">
          Игра начнётся автоматически, как только наберётся 4 игрока.<br />
          Если игроков меньше, но каждый нажал «Я готов/а» — партия начнётся и без полного состава.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Profile } from '@auctioneer/shared';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopNav from '../components/TopNav.vue';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();

const profile = ref<Profile | null>(null);
const code = ref('');
const busy = ref(false);
const error = ref('');

onMounted(async () => {
  profile.value = await auth.fetchMe();
  game.attach();
});

async function play(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const resp = await game.play();
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
