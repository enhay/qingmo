// 把 dist/ 软链接到思源工作空间的插件目录，构建后重载思源即可预览。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const workspace = process.argv[2];
if (!workspace) {
  console.error('用法：npm run link -- <思源工作空间目录>');
  process.exit(1);
}
const plugins = path.join(path.resolve(workspace), 'data/plugins');
if (!fs.existsSync(plugins)) {
  console.error(`不是思源工作空间：${plugins} 不存在`);
  process.exit(1);
}
const target = fileURLToPath(new URL('../dist', import.meta.url));
const link = path.join(plugins, 'siyuan-qingmo');
const stat = fs.lstatSync(link, { throwIfNoEntry: false });
if (stat && !stat.isSymbolicLink()) {
  console.error(`${link} 已是实际目录，请先手动移走后再链接`);
  process.exit(1);
}
if (stat) fs.unlinkSync(link);
fs.symlinkSync(target, link, 'junction');
console.log(`${link} -> ${target}`);
