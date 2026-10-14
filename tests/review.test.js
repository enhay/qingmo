
import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyOrder } from '../src/core/data.js';

test('同日回顾顺序不受查询返回顺序影响，每条速记只出现一次', () => {
  const ids = ['20261011090000-aaaaaaa', '20261010080000-bbbbbbb', '20261009120000-ccccccc', '20261008110000-ddddddd'];
  const original = ids.slice();
  const order = dailyOrder(ids, '20261012');
  assert.deepEqual(order, dailyOrder(ids.slice().reverse(), '20261012'));
  assert.deepEqual(order.slice().sort(), ids.slice().sort());
  assert.deepEqual(ids, original);
});

test('没有历史速记或只有一条时，回顾返回实际可读集合', () => {
  assert.deepEqual(dailyOrder([], '20261012'), []);
  const id = '20261011090000-aaaaaaa';
  assert.deepEqual(dailyOrder([id], '20261012'), [id]);
});
