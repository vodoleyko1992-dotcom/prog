'use strict';
// 20.13 (ревизия 17.10, шаг 7, quality/M4): охрана главного цикла теперь одна — const mainParked внутри main().
// Тесты, которые исполняют вырезанный кусок main() в песочнице, берут это объявление из настоящего content.js,
// чтобы проверялось то же условие, что работает у игрока.
module.exports = function mainParkedDecl(src) {
  const m = String(src).match(/const mainParked = [^\n]+/);
  if (!m) throw new Error('content.js: const mainParked не найден');
  return m[0] + '\n';
};
