import { DEFAULT_SETTINGS } from './data.js';

export function createSettings({ initial, persist, onChange = () => {} }) {
    let current = { ...DEFAULT_SETTINGS, ...(initial && typeof initial === 'object' && !Array.isArray(initial) ? initial : {}) };
    let pending = Promise.resolve();
    return {
        get value() { return current; },
        save(patch) {
            const changes = { ...patch };
            // 标签页与侧栏共享同一文件；下一次保存须合并上一次已写入的值。
            const saving = pending.then(async () => {
                const next = { ...current, ...changes };
                await persist(next);
                current = next;
                onChange(current);
                return current;
            });
            pending = saving.catch(() => {});
            return saving;
        }
    };
}
