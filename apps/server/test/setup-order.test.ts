// Тесты проверки порядка объявлений в <script setup>.
//
// Проверка бесполезна, если сама не ловит баг, поэтому тестируем её на
// минимальных фикстурах: сломанный порядок обязан находиться, корректный —
// не давать ложных срабатываний.
import { describe, expect, it } from 'vitest';
import { checkScript, checkSource, readsProps, extractScript } from '../../../scripts/lib/setup-order.mjs';

/** Собирает <script setup> из строк */
function sfc(body: string): string {
  return '<template>\n  <div />\n</template>\n\n<script setup lang="ts">\n' + body + '\n</script>\n';
}

describe('чтение props', () => {
  it('находит обращение через точку и через индекс', () => {
    expect(readsProps('() => props.game.players')).toBe(true);
    expect(readsProps('const g = props["game"]')).toBe(true);
    expect(readsProps('props.value')).toBe(true);
  });

  it('не считает чтением объявление props и обращение к другому объекту', () => {
    expect(readsProps('const props = defineProps<{ a: number }>()')).toBe(false);
    expect(readsProps('myprops.value')).toBe(false);
    expect(readsProps('this.props.value')).toBe(false);
  });

  it('игнорирует упоминания в комментариях', () => {
    expect(readsProps('// props.game тут только в комментарии\nconst x = 1')).toBe(false);
    expect(readsProps('/* props.game */ const x = 1')).toBe(false);
  });
});

describe('извлечение script setup', () => {
  it('достаёт тело скрипта', () => {
    expect(extractScript(sfc('const a = 1'))).toContain('const a = 1');
  });
  it('возвращает null, если скрипта нет', () => {
    expect(extractScript('<template><div /></template>')).toBeNull();
  });
});

describe('порядок props', () => {
  it('ЛОВИТ watch с props выше объявления — именно этот баг ронял экран', () => {
    const bad = sfc(
      [
        'const rootEl = ref(null)',
        'watch(',
        '  () => props.game.players.map((p) => p.id).join("|"),',
        '  () => animate(),',
        ')',
        'const props = withDefaults(defineProps<{ game: Game }>(), {})',
      ].join('\n'),
    );
    const problems = checkSource(bad);
    expect(problems).toHaveLength(1);
    // тело <script setup> начинается с перевода строки, поэтому номера на 1 больше
    expect(problems[0].line, 'номер строки watch').toBe(3);
    expect(problems[0].propsLine, 'номер строки props').toBe(7);
  });

  it('ЛОВИТ computed и watchEffect с props выше объявления', () => {
    for (const call of ['computed', 'watchEffect']) {
      const bad = sfc(
        ['const x = ' + call + '(() => props.a + 1)', 'const props = defineProps<{ a: number }>()'].join('\n'),
      );
      expect(checkSource(bad), call).toHaveLength(1);
    }
  });

  it('не срабатывает, когда props объявлен выше', () => {
    const good = sfc(
      [
        'const props = withDefaults(defineProps<{ game: Game }>(), {})',
        'watch(',
        '  () => props.game.players.map((p) => p.id).join("|"),',
        '  () => animate(),',
        ')',
      ].join('\n'),
    );
    expect(checkSource(good)).toEqual([]);
  });

  it('не срабатывает, если немедленный вызов props не читает', () => {
    const good = sfc(
      [
        'const rootEl = ref(null)',
        'watch(rootEl, () => animate())',
        'const props = defineProps<{ a: number }>()',
      ].join('\n'),
    );
    expect(checkSource(good)).toEqual([]);
  });

  it('не срабатывает, если props в теле вызова только в комментарии', () => {
    const good = sfc(
      [
        'watch(',
        '  () => 1, // props.game здесь не читается',
        '  () => 2,',
        ')',
        'const props = defineProps<{ a: number }>()',
      ].join('\n'),
    );
    expect(checkSource(good)).toEqual([]);
  });

  it('не трогает компоненты без props', () => {
    const noProps = sfc(['const rootEl = ref(null)', 'watch(rootEl, () => animate())'].join('\n'));
    expect(checkSource(noProps)).toEqual([]);
  });

  it('находит несколько проблем сразу', () => {
    const bad = sfc(
      [
        'const a = computed(() => props.x)',
        'const b = watch(() => props.y, () => {})',
        'const props = defineProps<{ x: number; y: number }>()',
      ].join('\n'),
    );
    expect(checkSource(bad)).toHaveLength(2);
  });

  it('многострочный вызов: props читается на второй строке', () => {
    const bad = sfc(
      [
        'const rows = computed(',
        '  () => props.game.players,',
        ')',
        'const props = defineProps<{ game: Game }>()',
      ].join('\n'),
    );
    expect(checkSource(bad)).toHaveLength(1);
  });

  it('пустой скрипт не считается проблемой', () => {
    expect(checkScript('')).toEqual([]);
    expect(checkScript(null)).toEqual([]);
  });
});
