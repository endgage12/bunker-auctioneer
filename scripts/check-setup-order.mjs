#!/usr/bin/env node
// CLI-обёртка над scripts/lib/setup-order.mjs: проверяет все .vue в репозитории.
// Запуск: node scripts/check-setup-order.mjs   (или npm run check:setup)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkSource } from './lib/setup-order.mjs';

/** Отслеживаемые git файлы .vue (git сам уважает .gitignore) */
function vueFiles() {
  const out = execFileSync('git', ['ls-files', '*.vue'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

const files = vueFiles();
let failed = 0;

for (const file of files) {
  const problems = checkSource(readFileSync(file, 'utf8'));
  if (problems.length === 0) continue;
  failed += 1;
  console.error('\n❌ ' + file);
  for (const p of problems) {
    console.error(
      '   строка ' + p.line + ': `' + p.call + '` — геттер исполняется сразу и читает props,\n' +
        '   а props объявлен ниже (строка ' + p.propsLine + ').\n' +
        '   Перенесите объявление props выше этого вызова.',
    );
  }
}

if (failed > 0) {
  console.error('\nПроверено файлов: ' + files.length + ', проблемных: ' + failed);
  console.error('Это ошибка «Cannot access props before initialization» — она роняет компонент в браузере.');
  process.exit(1);
}

console.log('✓ порядок в <script setup> корректен: props объявлен до немедленных вызовов (' + files.length + ' файлов)');
