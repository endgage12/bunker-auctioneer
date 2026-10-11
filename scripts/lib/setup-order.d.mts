// Типы для проверки порядка объявлений в <script setup>.
// Реализация — обычный ESM (.mjs), потому что её запускает node напрямую
// (npm run check:setup), без сборки.

export interface SetupOrderProblem {
  /** номер строки немедленного вызова (watch/computed/...), с 1 */
  line: number;
  /** номер строки объявления props, с 1 */
  propsLine: number;
  /** текст вызова для сообщения */
  call: string;
}

/** Читает ли фрагмент кода `props.<...>` или `props[...]` */
export function readsProps(text: string): boolean;

/** Достаёт тело <script ...> из исходника .vue; null, если блока нет */
export function extractScript(source: string): string | null;

/** Ищет немедленные вызовы, читающие props до его объявления */
export function checkScript(script: string | null | undefined): SetupOrderProblem[];

/** Проверка одного .vue по исходнику */
export function checkSource(source: string): SetupOrderProblem[];

export const PROPS_DECL: RegExp;
export const EAGER_CALL: RegExp;
