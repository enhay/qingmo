import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../src/core/settings.js';

// 后续若把保存改成直接写 patch，或在排队前合并旧值，会丢失另一视图刚保存的字段。
test('标签页与侧栏保存不同字段后，文件与共享设置保留两边改动', async () => {
    let persisted;
    const settings = createSettings({
        initial: { notebook: 'book', reviewCount: 5 },
        persist: async value => {
            persisted = structuredClone(value);
        }
    });
    await Promise.all([settings.save({ reviewCount: 3 }), settings.save({ openOnStartup: true })]);
    assert.equal(persisted.reviewCount, 3);
    assert.equal(persisted.openOnStartup, true);
    assert.deepEqual(settings.value, persisted);
    const reopened = createSettings({ initial: persisted, persist: async () => {} });
    assert.equal(reopened.value.reviewCount, 3);
    assert.equal(reopened.value.openOnStartup, true);
});
