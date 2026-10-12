'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
const modules = ['index', 'data', 'editor', 'ui'].map(name => `${JSON.stringify('./' + name)}:function(module,exports,require){\n${fs.readFileSync(path.join(root, 'src', name + '.js'), 'utf8')}\n}`).join(',\n');
fs.writeFileSync(path.join(output, 'index.js'), `'use strict';\nconst hostRequire=require;\nconst modules={${modules}};\nconst cache={};\nfunction localRequire(id){if(id==='siyuan')return hostRequire(id);if(!modules[id])throw new Error('Unknown bundled module: '+id);if(!cache[id]){const value={exports:{}};cache[id]=value;modules[id](value,value.exports,localRequire);}return cache[id].exports;}\nmodule.exports=localRequire('./index');\n`);
for (const file of ['plugin.json', 'README.md', 'icon.png']) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.copyFileSync(path.join(root, 'src/styles.css'), path.join(output, 'index.css'));
fs.cpSync(path.join(root, 'i18n'), path.join(output, 'i18n'), { recursive: true });

// 一期英文界面沿用中文文案，避免宿主缺失英文语言文件。
fs.copyFileSync(path.join(root, 'i18n/zh_CN.json'), path.join(output, 'i18n/en_US.json'));
