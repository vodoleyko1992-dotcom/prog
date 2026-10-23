'use strict';
// Тот же настоящий MV3/public DOM, отдельный обязательный сценарий неизвестного исхода.
// 20.54 (прогон смоуков 23.10): с 20.25 автозаточка снята — проверяется сверка чтением не чаще 15 с и явный archiveUnknown
// для неизвестной попытки прежней версии (подробности — в шапке v1016-enchant-core-public-browser.cjs).
process.argv.push('--unknown');
require('./v1016-enchant-core-public-browser.cjs');
