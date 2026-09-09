<template>
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      <h1 class="text-2xl font-bold text-center mb-1">Раз, два, продано!</h1>
      <p class="text-center text-slate-400 text-sm mb-8">Аукцион + покер по мотивам события из Neverness to Everness</p>

      <div v-if="oauthError" class="mb-4 px-3 py-2 rounded bg-rose-950 text-rose-300 text-sm">
        Не удалось войти через Google
      </div>

      <button
        class="w-full flex items-center justify-center gap-3 bg-white text-slate-800 font-medium rounded-lg py-3 hover:bg-slate-200 transition mb-6"
        @click="googleLogin"
      >
        <svg width="20" height="20" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/>
        </svg>
        Войти через Google
      </button>

      <div class="flex items-center gap-3 my-4">
        <div class="h-px bg-slate-700 flex-1"></div>
        <span class="text-xs text-slate-500">или тестовый вход (dev)</span>
        <div class="h-px bg-slate-700 flex-1"></div>
      </div>

      <div v-if="devError" class="mb-3 px-3 py-2 rounded bg-rose-950 text-rose-300 text-sm">{{ devError }}</div>

      <button
        type="button"
        :disabled="busy"
        class="btn-primary w-full"
        @click="devLogin"
      >
        Войти (dev)
      </button>

      <p class="text-xs text-slate-500 mt-5 text-center">
        Новичкам выдаётся набор предметов на ~300 000 и 250 000 наличными
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { post } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import type { Profile } from '@auctioneer/shared';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const busy = ref(false);
const oauthError = ref(false);
const devError = ref('');

onMounted(async () => {
  const token = route.query.token as string | undefined;
  if (route.query.error) {
    oauthError.value = true;
    return;
  }
  if (token) {
    auth.setToken(token);
    try {
      await auth.fetchMe();
    } catch {
      auth.logout();
      oauthError.value = true;
      return;
    }
    router.replace('/');
  }
});

function googleLogin(): void {
  window.location.href = '/api/auth/google';
}

function randomId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function devLogin(): Promise<void> {
  busy.value = true;
  devError.value = '';
  try {
    const id = randomId();
    const email = 'dev-' + id + '@example.com';
    const name = 'Dev ' + id;
    const resp = await post<{ token: string; profile: Profile }>('/api/auth/dev-login', {
      email,
      name,
    });
    auth.setToken(resp.token);
    auth.user = resp.profile;
    router.replace('/');
  } catch (e) {
    devError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
