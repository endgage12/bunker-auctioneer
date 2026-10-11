// Проверка порядка объявлений в <script setup> компонентов Vue.
//
// Зачем: код в <script setup> исполняется сверху вниз, а `watch(getter)`,
// `computed(getter)` и `watchEffect` вызывают переданную функцию немедленно.
// Если такой вызов стоит выше объявления `props` и читает его, компонент падает
// при монтировании с «Cannot access 'props' before initialization» — и роняет
// весь экран. Ни TypeScript, ни сборка Vite этого не видят: ошибка только в
// рантайме, поэтому нужна отдельная проверка.
//
// Логика вынесена в чистые функции, чтобы её можно было покрыть тестами.

/** Объявление props: `const props = defineProps...` или `const props = withDefaults(...)` */
export const PROPS_DECL = /^(?:const|let|var)\s+props\b/;

/** Вызовы, исполняющие переданный геттер немедленно */
export const EAGER_CALL = /^(?:const\s+[\w$]+\s*=\s*)?(watch|computed|watchEffect|watchPostEffect)\s*\(/;

/** Читает ли фрагмент кода `props.<...>` или `props[...]` */
export function readsProps(text) {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return /(^|[^.\w$])props\s*[.[]/.test(withoutComments);
}

/**
 * Достаёт блок <script setup> из исходника .vue.
 * Возвращает null, если блока нет.
 */
export function extractScript(source) {
  const m = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/);
  return m ? m[1] : null;
}

/** Собирает текст вызова целиком, считая скобки, начиная со строки start */
function captureCall(lines, start) {
  let depth = 0;
  let body = '';
  for (let j = start; j < lines.length; j += 1) {
    const line = lines[j];
    body += line + '\n';
    for (const ch of line) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
    }
    if (depth <= 0) break;
  }
  return body;
}

/**
 * Ищет в скрипте немедленные вызовы, читающие props до его объявления.
 * Возвращает массив проблем: { line, propsLine, call } (номера строк с 1).
 */
export function checkScript(script) {
  if (!script) return [];
  const lines = script.split('\n');

  let propsLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (PROPS_DECL.test(lines[i].trim())) {
      propsLine = i;
      break;
    }
  }
  if (propsLine === -1) return [];

  const problems = [];
  for (let i = 0; i < propsLine; i += 1) {
    if (!EAGER_CALL.test(lines[i].trim())) continue;
    const body = captureCall(lines, i);
    if (!readsProps(body)) continue;
    problems.push({ line: i + 1, propsLine: propsLine + 1, call: lines[i].trim().slice(0, 80) });
  }
  return problems;
}

/** Проверка одного .vue-файла по исходнику */
export function checkSource(source) {
  return checkScript(extractScript(source));
}
