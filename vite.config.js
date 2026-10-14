import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { copyFileSync, cpSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig({
    plugins: [svelte({ configFile: false }), {
        name: 'qingmo-resources',
        buildStart() {
            for (const name of ['plugin.json', 'README.md', 'icon.png']) this.addWatchFile(name);
            for (const directory of ['i18n', 'skills/qingmo-insights']) {
                for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
                    if (entry.isFile()) this.addWatchFile(join(entry.parentPath, entry.name));
                }
            }
        },
        closeBundle() {
            for (const name of ['plugin.json', 'README.md', 'icon.png']) copyFileSync(name, `dist/${name}`);
            cpSync('i18n', 'dist/i18n', { recursive: true });
            copyFileSync('i18n/zh_CN.json', 'dist/i18n/en_US.json');
            cpSync('skills/qingmo-insights', 'dist/skills/qingmo-insights', { recursive: true });
            writeFileSync('dist/package.json', '{"type":"commonjs"}\n');
        }
    }],
    build: {
        lib: { entry: 'src/index.js', formats: ['cjs'], fileName: () => 'index.js', cssFileName: 'index' },
        rolldownOptions: { external: ['siyuan'], output: { exports: 'default', codeSplitting: false } },
        target: 'es2022',
        minify: false
    }
});
