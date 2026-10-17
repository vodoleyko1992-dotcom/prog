'use strict';
// 20.12 (ревизия 17.10): замеры боя Warlock 52 ур. (10.10) убраны из base-profile.json — старые тесты моделей РБ/боя
// берут их из tests/fixtures/warlock52-rt-measurements.json поверх остальной памяти профиля.
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..', '..');
module.exports = () => ({ ...JSON.parse(fs.readFileSync(path.join(root, 'base-profile.json'), 'utf8')).chars.Warlock.rt,
  ...JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'warlock52-rt-measurements.json'), 'utf8')) });
