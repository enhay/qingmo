'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTags, parseMemoMarkdown, DraftStore } = require('../src/data');

test('速记标签转换为原生标签，同时保留 Markdown 与代码内容', () => {
  assert.equal(normalizeTags('#读书 #a/b\n正文 #已有#'), '#读书# #a/b#\n正文 #已有#');
  const markdown = '# 标题\n\nhttps://example.com/#anchor\n`#literal`\n\n```js\n#literal\n```';
  assert.equal(normalizeTags(markdown), markdown);
});

test('多段原生速记回到编辑器时保留文字、列表和代码', () => {
  const parsed = parseMemoMarkdown('{{{row\n第一段 #读书#\n{: id="20261011120000-aaaaaaa"}\n\n第二段\n\n- 列表\n\n```\n{: literal="yes"}\n```\n\n![](assets/photo.png)\n}}}\n{: custom-qingmo-memo="1"}');
  assert.equal(parsed.text, '第一段 #读书#\n\n第二段\n\n- 列表\n\n```\n{: literal="yes"}\n```');
  assert.deepEqual(parsed.images, ['assets/photo.png']);
});

test('新建和不同块的草稿分开存储，仅成功发送的草稿被清理', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const drafts = new DraftStore(storage);
  drafts.save('new', { text: '新想法', images: [] });
  drafts.save('memo-a', { text: '编辑甲', images: ['assets/photo.png'] });
  drafts.save('memo-b', { text: '编辑乙', images: [] });
  drafts.remove('memo-a');
  assert.deepEqual(drafts.load(), { text: '新想法', images: [] });
  assert.equal(drafts.load('memo-a'), null);
  assert.deepEqual(drafts.load('memo-b'), { text: '编辑乙', images: [] });
});

test('存储不可用或内容损坏时草稿操作返回失败，不中断记笔记', () => {
  const throwing = new DraftStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } });
  assert.equal(throwing.load(), null);
  assert.equal(throwing.save('new', { text: '保留在输入框', images: [] }), false);
  assert.equal(throwing.remove(), false);
  for (const raw of ['{', '{"text":1,"images":[]}', '{"text":"x","images":["javascript:alert(1)"]}']) {
    assert.equal(new DraftStore({ getItem: () => raw }).load(), null);
  }
});

test('不同长度代码围栏内的标签、图片源码和空行保持原样', () => {
  const body = '````md\n```\n#literal\n\n\n![source](assets/example.png)\n````';
  assert.equal(normalizeTags(body), body);
  assert.deepEqual(parseMemoMarkdown(body), { text: body, images: [] });
});

test('原生内联图片保留说明、标题、位置和重复；末尾附件保持顺序', () => {
  const body = '前文 ![说明](assets/a.png "标题") 后文\n\n![](assets/middle.png)\n\n后续段落';
  assert.deepEqual(parseMemoMarkdown(body), { text: body, images: [] });
  assert.deepEqual(parseMemoMarkdown('正文\n\n![](assets/a.png)\n\n![](assets/a.png)'), { text: '正文', images: ['assets/a.png', 'assets/a.png'] });
});
