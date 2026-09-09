<template>
  <div class="h-screen flex flex-col">
    <TopNav />
    <div class="flex-1 min-h-0 flex max-w-7xl w-full mx-auto">
      <!-- Сайдбар: разделы -->
      <aside class="hidden md:flex w-64 shrink-0 flex-col border-r border-slate-800/70 bg-slate-950/60">
        <div class="px-4 pt-4 pb-2 text-[11px] uppercase tracking-wider text-slate-500">Разделы</div>
        <nav class="flex-1 min-h-0 overflow-y-auto px-2 pb-4 space-y-1">
          <button
            v-for="s in visibleSections"
            :key="s.id"
            class="w-full text-left px-3 py-2 rounded-lg text-sm transition flex items-center gap-2"
            :class="activeId === s.id ? 'bg-slate-800 text-amber-300' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'"
            @click="scrollToSection(s.id)"
          >
            <span class="shrink-0">{{ s.icon }}</span>
            <span class="flex-1 truncate">{{ s.title }}</span>
            <span
              v-if="searching"
              class="text-[10px] leading-none px-1.5 py-1 rounded-full bg-amber-500/20 text-amber-300 shrink-0"
            >
              {{ matchCount(s.id) }}
            </span>
          </button>
        </nav>
      </aside>

      <!-- Контент -->
      <main ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto" @scroll="onScroll">
        <div class="max-w-3xl mx-auto px-6 py-8 pb-16">
          <div class="mb-8">
            <h1 class="text-2xl font-bold mb-1">Библиотека</h1>
            <p class="text-sm text-slate-400">
              Ваш помощник в обучении: правила, основы, предметы, сеты и всё, что нужно знать игроку.
            </p>
            <div class="mt-4 relative">
              <input
                v-model="query"
                class="input-dark pr-40"
                placeholder="Поиск по библиотеке (от 2 символов)…"
              />
              <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                <span v-if="searching" class="text-xs text-slate-400">
                  найдено: <b class="text-amber-300">{{ totalMatches }}</b>
                </span>
                <button
                  v-if="query"
                  class="text-slate-400 hover:text-white text-sm px-1.5 py-0.5 rounded transition"
                  title="Очистить поиск"
                  @click="query = ''"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          <div v-if="searching && totalMatches === 0" class="panel p-8 text-center">
            <div class="text-2xl mb-2">🔍</div>
            <p class="text-sm text-slate-400">
              Ничего не найдено по запросу «{{ query.trim() }}». Попробуйте изменить формулировку.
            </p>
          </div>

          <section v-for="s in visibleSections" :id="'sec-' + s.id" :key="s.id" class="mb-8">
            <h2 class="flex items-center gap-2 text-lg font-bold mb-3">
              <span>{{ s.icon }}</span>
              <span>{{ s.title }}</span>
            </h2>

            <div v-for="a in sectionArticles(s)" :key="a.id" class="panel mb-3 overflow-hidden">
              <button class="w-full flex items-center gap-3 text-left px-4 py-3" @click="toggle(a.id)">
                <span class="flex-1 font-semibold text-sm" v-html="highlightHtml(a.title, normQuery)"></span>
                <span
                  class="text-slate-500 text-xs transition-transform duration-200 shrink-0"
                  :class="{ 'rotate-180': isOpen(a.id) }"
                >
                  ▼
                </span>
              </button>

              <div v-if="isOpen(a.id)" class="px-4 pb-4 border-t border-slate-800 pt-3 space-y-3">
                <template v-for="(b, bi) in a.blocks" :key="bi">
                  <p
                    v-if="b.kind === 'p'"
                    class="text-sm text-slate-300 leading-relaxed"
                    v-html="highlightHtml(b.text, normQuery)"
                  ></p>
                  <ul v-else-if="b.kind === 'ul'" class="list-disc pl-5 space-y-1.5">
                    <li
                      v-for="(li, liIdx) in b.items"
                      :key="liIdx"
                      class="text-sm text-slate-300 leading-relaxed"
                      v-html="highlightHtml(li, normQuery)"
                    ></li>
                  </ul>
                  <table v-else class="w-full text-sm border-collapse">
                    <thead>
                      <tr>
                        <th
                          v-for="(h, hIdx) in b.head"
                          :key="hIdx"
                          class="text-left text-xs font-medium text-slate-400 border-b border-slate-700 px-2 py-1.5"
                          v-html="highlightHtml(h, normQuery)"
                        ></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, rIdx) in b.rows" :key="rIdx">
                        <td
                          v-for="(cell, cIdx) in row"
                          :key="cIdx"
                          class="border-b border-slate-800 px-2 py-1.5 text-slate-300 align-top"
                          v-html="highlightHtml(cell, normQuery)"
                        ></td>
                      </tr>
                    </tbody>
                  </table>
                </template>

                <!-- Сетка предметов редкости (генерируется из каталога) -->
                <div v-if="a.kind === 'items'" class="space-y-2 pt-1">
                  <div
                    v-for="def in articleItems(a)"
                    :key="def.id"
                    class="flex items-start gap-3 rounded-lg border p-3 transition"
                    :style="itemCardStyle(def)"
                    :class="
                      searching
                        ? itemMatches(def)
                          ? 'ring-2 ring-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.4)]'
                          : 'opacity-40 brightness-[0.55]'
                        : ''
                    "
                  >
                    <img
                      v-if="itemIconUrl(def.id)"
                      :src="itemIconUrl(def.id)"
                      alt=""
                      class="w-12 h-12 object-contain shrink-0 select-none"
                      draggable="false"
                    />
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-baseline gap-x-2">
                        <span class="font-semibold text-sm" v-html="highlightHtml(def.name, normQuery)"></span>
                        <span class="text-xs text-amber-300/90 font-mono"><CoinAmount :value="def.value" /></span>
                        <span class="text-xs text-slate-400 font-mono">{{ def.w }}×{{ def.h }}</span>
                      </div>
                      <div class="text-xs text-slate-400 leading-relaxed mt-0.5" v-html="highlightHtml(def.desc, normQuery)"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ITEM_CATALOG } from '@auctioneer/shared';
import type { ItemDef } from '@auctioneer/shared';
import { RARITY_HEX } from '../lib/rarity';
import { itemIconUrl } from '../lib/items';
import { LIBRARY_SECTIONS, articleSearchText } from '../lib/library';
import type { LibraryArticle, LibrarySection } from '../lib/library';
import TopNav from '../components/TopNav.vue';
import CoinAmount from '../components/CoinAmount.vue';

const query = ref('');
const openIds = ref<Set<string>>(new Set());
const activeId = ref<string>(LIBRARY_SECTIONS[0]?.id ?? '');
const scrollEl = ref<HTMLElement | null>(null);

const normQuery = computed(() => query.value.trim().toLowerCase());
const searching = computed(() => normQuery.value.length >= 2);

// ---------- поиск ----------

function articleMatches(a: LibraryArticle): boolean {
  if (!searching.value) return true;
  return articleSearchText(a).includes(normQuery.value);
}

function matchCount(sectionId: string): number {
  const s = LIBRARY_SECTIONS.find((x) => x.id === sectionId);
  if (!s) return 0;
  return s.articles.filter(articleMatches).length;
}

const totalMatches = computed(() => LIBRARY_SECTIONS.reduce((sum, s) => sum + matchCount(s.id), 0));

const visibleSections = computed<LibrarySection[]>(() =>
  searching.value ? LIBRARY_SECTIONS.filter((s) => matchCount(s.id) > 0) : LIBRARY_SECTIONS,
);

function sectionArticles(s: LibrarySection): LibraryArticle[] {
  return searching.value ? s.articles.filter(articleMatches) : s.articles;
}

// ---------- аккордеон и навигация ----------

function isOpen(id: string): boolean {
  if (searching.value) return true;
  return openIds.value.has(id);
}

function toggle(id: string): void {
  if (searching.value) return;
  const next = new Set(openIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openIds.value = next;
}

function scrollToSection(id: string): void {
  const el = document.getElementById('sec-' + id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onScroll(): void {
  const el = scrollEl.value;
  if (!el) return;
  const top = el.getBoundingClientRect().top + 120;
  let current = '';
  for (const s of visibleSections.value) {
    const sec = document.getElementById('sec-' + s.id);
    if (!sec) continue;
    if (sec.getBoundingClientRect().top <= top) current = s.id;
  }
  if (current) activeId.value = current;
}

// ---------- предметы из каталога ----------

function articleItems(a: LibraryArticle): ItemDef[] {
  if (a.kind !== 'items' || !a.rarity) return [];
  return ITEM_CATALOG.filter((d) => d.rarity === a.rarity);
}

function itemMatches(def: ItemDef): boolean {
  if (!searching.value) return true;
  const q = normQuery.value;
  return def.name.toLowerCase().includes(q) || def.desc.toLowerCase().includes(q);
}

function itemCardStyle(def: ItemDef): Record<string, string> {
  const c = RARITY_HEX[def.rarity];
  return {
    background: 'linear-gradient(135deg, ' + c + '2e 0%, ' + c + '14 100%)',
    borderColor: c + '55',
  };
}

// ---------- подсветка совпадений ----------

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightHtml(text: string, q: string): string {
  if (q.length < 2) return esc(text);
  const lower = text.toLowerCase();
  let out = '';
  let i = 0;
  for (;;) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) {
      out += esc(text.slice(i));
      break;
    }
    out += esc(text.slice(i, idx));
    out += '<mark>' + esc(text.slice(idx, idx + q.length)) + '</mark>';
    i = idx + q.length;
  }
  return out;
}
</script>
