<template>
  <div class="min-h-screen">
    <TopNav />
    <div v-if="bank" class="max-w-5xl mx-auto p-6">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <!-- Банк -->
        <div class="panel p-5">
          <h2 class="font-semibold mb-1">Банк дома</h2>
          <div class="text-3xl font-mono text-amber-300">{{ fmt(bank.balance) }}</div>
          <p class="text-xs text-slate-500 mt-2 mb-5">
            Сюда поступают доходы партий, комиссии барахолки и самовыкупы.
            Отсюда платятся торговец, стартовые капиталы и выплаты игрокам.
          </p>

          <h3 class="text-sm font-semibold mb-2">Пополнить банк</h3>
          <div class="flex gap-2">
            <input v-model.number="depositAmount" type="number" min="1" class="input-price" placeholder="Сумма" />
            <button class="btn-primary" :disabled="!depositAmount || depositAmount < 1" @click="doDeposit">
              Пополнить
            </button>
          </div>

          <h3 class="text-sm font-semibold mt-5 mb-2">Выплата игроку</h3>
          <div class="flex flex-col gap-2">
            <input v-model="transferEmail" type="email" class="input-dark" placeholder="Email игрока" />
            <div class="flex gap-2">
              <input v-model.number="transferAmount" type="number" min="1" class="input-price" placeholder="Сумма" />
              <button
                class="btn-ghost"
                :disabled="!transferEmail || !transferAmount || transferAmount < 1"
                @click="doTransfer"
              >
                Выплатить
              </button>
            </div>
          </div>
        </div>

        <!-- Собственность дома -->
        <div class="panel p-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-semibold">Собственность дома ({{ bank.inventory.length }})</h2>
            <span class="text-xs text-slate-400">
              сумма <span class="text-amber-300 font-mono">{{ fmt(bank.inventoryValue) }}</span>
            </span>
          </div>
          <p class="text-xs text-slate-500 mb-3">
            Предметы, выкупленные торговцем у игроков. Можно выставить на барахолку от имени дома.
          </p>
          <div v-if="bank.inventory.length === 0" class="text-sm text-slate-500">У дома пока нет предметов</div>
          <div class="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
            <div v-for="it in bank.inventory" :key="it.id" class="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-slate-800/40">
              <div class="w-12 h-12 rounded overflow-hidden shrink-0">
                <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm truncate">{{ it.name }}</div>
                <div class="text-xs text-slate-400">номинал {{ fmt(it.value) }} · {{ it.w }}×{{ it.h }}</div>
              </div>
              <input v-model.number="housePrices[it.id]" type="number" min="1" class="input-price" placeholder="Цена" />
              <button class="btn-small" :disabled="!housePrices[it.id]" @click="listHouseItem(it.id)">
                Выставить
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- История операций -->
      <div class="panel p-5 mt-6">
        <h2 class="font-semibold mb-3">История операций банка</h2>
        <div v-if="bank.transactions.length === 0" class="text-sm text-slate-500">Операций пока нет</div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs text-slate-500">
                <th class="py-2 pr-4">Время</th>
                <th class="py-2 pr-4">Операция</th>
                <th class="py-2 pr-4">Сторона</th>
                <th class="py-2 pr-4 text-right">Сумма</th>
                <th class="py-2 text-right">Баланс после</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in bank.transactions" :key="t.id" class="border-t border-slate-800">
                <td class="py-1.5 pr-4 text-xs text-slate-400">{{ timeOf(t.at) }}</td>
                <td class="py-1.5 pr-4">{{ txLabel(t.type) }}</td>
                <td class="py-1.5 pr-4 text-slate-400">{{ t.partyName ?? '—' }}</td>
                <td class="py-1.5 pr-4 text-right font-mono" :class="t.amount >= 0 ? 'text-emerald-300' : 'text-rose-300'">
                  {{ t.amount >= 0 ? '+' : '' }}{{ fmt(t.amount) }}
                </td>
                <td class="py-1.5 text-right font-mono text-slate-300">{{ fmt(t.balanceAfter) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div v-else class="p-12 text-center text-slate-400">Загрузка…</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { BANK_TX_LABELS, fmt } from '@auctioneer/shared';
import type { AdminBank } from '@auctioneer/shared';
import { get, post } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopNav from '../components/TopNav.vue';
import ItemCard from '../components/ItemCard.vue';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();

const bank = ref<AdminBank | null>(null);
const depositAmount = ref(0);
const transferEmail = ref('');
const transferAmount = ref(0);
const housePrices = reactive<Record<string, number>>({});

onMounted(async () => {
  try {
    const profile = await auth.fetchMe();
    if (!profile.isAdmin) {
      game.pushToast('Нужны права администратора', 'error');
      router.replace('/');
      return;
    }
    bank.value = await get<AdminBank>('/api/admin/bank');
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
    router.replace('/');
  }
});

async function refresh(): Promise<void> {
  bank.value = await get<AdminBank>('/api/admin/bank');
}

async function doDeposit(): Promise<void> {
  try {
    await post('/api/admin/bank/deposit', { amount: depositAmount.value });
    game.pushToast('Банк пополнен');
    depositAmount.value = 0;
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

async function doTransfer(): Promise<void> {
  try {
    await post('/api/admin/bank/transfer', { email: transferEmail.value, amount: transferAmount.value });
    game.pushToast('Выплата выполнена');
    transferAmount.value = 0;
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

async function listHouseItem(itemId: string): Promise<void> {
  try {
    await post('/api/admin/market/list', { itemId, price: housePrices[itemId] });
    game.pushToast('Предмет дома выставлен на барахолку');
    delete housePrices[itemId];
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

function txLabel(type: string): string {
  return BANK_TX_LABELS[type] ?? type;
}

function timeOf(at: number): string {
  return new Date(at).toLocaleString('ru-RU');
}
</script>
