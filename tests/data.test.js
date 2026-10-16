import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTags, parseMemoMarkdown, DraftStore, MemoRepository } from '../src/core/data.js';

function blockProvider(kramdown, dom) {
    return async path => {
        if (path === '/api/block/getBlockKramdown') return { kramdown };
        if (path === '/api/block/getBlockDOM') return { dom };
        throw new Error('Unexpected request: ' + path);
    };
}

test('速记标签转换为原生标签，同时保留 Markdown 与代码内容', () => {
    assert.equal(normalizeTags('#读书 #a/b\n正文 #已有#'), '#读书# #a/b#\n正文 #已有#');
    const markdown = '# 标题\n\nhttps://example.com/#anchor\n`#literal`\n\n```js\n#literal\n```';
    assert.equal(normalizeTags(markdown), markdown);
});

test('多段原生速记回到编辑器时保留文字、列表和代码', () => {
    const parsed = parseMemoMarkdown(
        '{{{row\n第一段 #读书#\n{: id="20261011120000-aaaaaaa"}\n\n第二段\n\n- 列表\n\n```\n{: literal="yes"}\n```\n\n![](assets/photo.png)\n}}}\n{: custom-qingmo-memo="1"}'
    );
    assert.equal(parsed.text, '第一段 #读书#\n\n第二段\n\n- 列表\n\n```\n{: literal="yes"}\n```');
    assert.deepEqual(parsed.images, ['assets/photo.png']);
});

test('手动收录块的自身属性不进入卡片正文和编辑内容', async () => {
    const id = '20261011120000-aaaaaaa';
    const repository = new MemoRepository(
        blockProvider(
            '原始段落 #阅读#\n{: id="' +
                id +
                '" updated="20261011120000" custom-qingmo-memo="1" custom-qingmo-added="1" custom-owner="保留"}',
            '<div data-type="NodeParagraph"><div contenteditable="true">原始段落 <span data-type="tag">阅读</span></div></div>'
        )
    );
    const memo = await repository.hydrate({ id, type: 'p', marker: '1', added: '1', tagsJSON: '["阅读"]' });
    assert.equal(memo.markdown, '原始段落 #阅读#');
    assert.deepEqual(parseMemoMarkdown(memo.markdown), { text: '原始段落 #阅读#', images: [] });
    assert.equal(memo.external, true);
});

test('清理当前块元数据时保留子块属性和代码中的原文', async () => {
    const id = '20261011120000-aaaaaaa';
    const literal = '{: id="' + id + '" custom-qingmo-memo="示例"}';
    const repository = new MemoRepository(
        blockProvider(
            '{{{row\n子段落\n{: id="20261011120001-bbbbbbb" custom-owner="保留"}\n\n```text\n' +
                literal +
                '\n```\n}}}\n{: id="' +
                id +
                '" custom-qingmo-memo="1" custom-qingmo-added="1"}',
            '<div data-type="NodeSuperBlock"><div data-type="NodeParagraph" custom-owner="保留"><div contenteditable="true">子段落</div></div><div data-type="NodeCodeBlock"><div contenteditable="true">{: custom-qingmo-memo="示例"}</div></div></div>'
        )
    );
    const memo = await repository.hydrate({ id, type: 's', marker: '1', added: '1', tagsJSON: '[]' });
    assert.equal(memo.markdown, '子段落\n{: custom-owner="保留"}\n\n```text\n' + literal + '\n```');
});

test('整篇笔记预览保留标题和正文，内部块属性留在原文档中', async () => {
    const id = '20261011120000-aaaaaaa';
    const repository = new MemoRepository(
        blockProvider(
            '## 小标题\n{: id="20261011120001-bbbbbbb"}\n\n正文\n{: id="20261011120002-ccccccc" custom-qingmo-memo="1"}\n\n`{: custom-owner="示例"}`\n{: id="' +
                id +
                '" tags="轻墨,阅读" type="doc"}',
            '<div data-type="NodeHeading" data-subtype="h2"><div contenteditable="true">小标题</div></div><div data-type="NodeParagraph"><div contenteditable="true">正文</div></div>'
        )
    );
    const memo = await repository.hydrate({ id, type: 'd', source: '原文档标题', tagsJSON: '["轻墨","阅读"]' });
    assert.equal(memo.markdown, '## 小标题\n\n正文\n\n`{: custom-owner="示例"}`');
    assert.equal(memo.source, '原文档标题');
    assert.equal(memo.external, true);
});

test('整篇笔记移出仅取消文档的精确轻墨标签，其余属性保留', async () => {
    const id = '20261011120000-aaaaaaa';
    const attrs = { id, tags: '轻墨,阅读,轻墨/项目,非轻墨,轻墨', title: '保留标题', 'custom-owner': '保留' };
    const repository = new MemoRepository(async (path, body) => {
        if (path === '/api/attr/getBlockAttrs') return { ...attrs };
        if (path === '/api/attr/setBlockAttrs') {
            Object.assign(attrs, body.attrs);
            return null;
        }
        throw new Error('Unexpected content write: ' + path);
    });
    repository.get = async () => ({ id, type: 'd', external: true });
    await repository.remove(id);
    assert.deepEqual(attrs, { id, tags: '阅读,轻墨/项目,非轻墨', title: '保留标题', 'custom-owner': '保留' });
});

test('新建和不同块的草稿分开存储，仅成功发送的草稿被清理', () => {
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key)
    };
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
    const throwing = new DraftStore({
        getItem() {
            throw new Error('denied');
        },
        setItem() {
            throw new Error('quota');
        },
        removeItem() {
            throw new Error('denied');
        }
    });
    assert.equal(throwing.load(), null);
    assert.equal(throwing.save('new', { text: '保留在输入框', images: [] }), false);
    assert.equal(throwing.remove(), false);
    for (const raw of ['{', '{"text":1,"images":[]}', '{"text":"x","images":["javascript:alert(1)"]}']) {
        assert.equal(new DraftStore({ getItem: () => raw }).load(), null);
    }
});

test('修改已有笔记时历史留存失败，不覆盖原内容', async () => {
    const id = '20261012135939-c5dplzm';
    const persisted = { id, content: '原内容', attrs: { id, 'custom-qingmo-memo': '1' } };
    const repository = new MemoRepository(async (path, body) => {
        if (path === '/api/attr/getBlockAttrs') return { ...persisted.attrs };
        if (path === '/api/block/updateBlock') {
            persisted.content = body.data;
            return null;
        }
        throw new Error('Unexpected request: ' + path);
    });
    repository.sql = async () => [{ id, type: 'p' }];
    repository.get = async () => ({
        id,
        type: 'p',
        markdown: persisted.content,
        dom: '<div data-type="NodeParagraph"><div contenteditable="true">原内容</div></div>'
    });
    repository.history = {
        sameContent: () => false,
        snapshot: async () => {
            throw Object.assign(new Error('未生成历史'), { code: 'HISTORY_SNAPSHOT_FAILED' });
        }
    };
    await assert.rejects(repository.save({ id, text: '修改后内容' }, {}), { code: 'HISTORY_SNAPSHOT_FAILED' });
    assert.deepEqual(persisted, { id, content: '原内容', attrs: { id, 'custom-qingmo-memo': '1' } });
});

test('不同长度代码围栏内的标签、图片源码和空行保持原样', () => {
    const body = '````md\n```\n#literal\n\n\n![source](assets/example.png)\n````';
    assert.equal(normalizeTags(body), body);
    assert.deepEqual(parseMemoMarkdown(body), { text: body, images: [] });
});

test('原生内联图片保留说明、标题、位置和重复；末尾附件保持顺序', () => {
    const body = '前文 ![说明](assets/a.png "标题") 后文\n\n![](assets/middle.png)\n\n后续段落';
    assert.deepEqual(parseMemoMarkdown(body), { text: body, images: [] });
    assert.deepEqual(parseMemoMarkdown('正文\n\n![](assets/a.png)\n\n![](assets/a.png)'), {
        text: '正文',
        images: ['assets/a.png', 'assets/a.png']
    });
});

test('统计按创建日聚合完整卡片集合，不因子块重复计算记录天数与单日最多', async () => {
    // Later changes to descendant joins must not multiply one card into several records.
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(`CREATE TABLE blocks(id TEXT,parent_id TEXT,root_id TEXT,type TEXT,created TEXT,content TEXT);
            CREATE TABLE attributes(block_id TEXT,name TEXT,value TEXT);
            CREATE TABLE spans(block_id TEXT,type TEXT,content TEXT,markdown TEXT);
            INSERT INTO blocks VALUES
            ('a','doc','doc','s','20261001080000','重复容器'),
            ('a1','a','doc','p','20261001080000','甲　乙'),
            ('a2','a','doc','p','20261001080000','😀'),
            ('b','doc','doc','p','20261001100000','丙'),
            ('c','doc','doc','p','20261003080000','丁'),
            ('d','doc','doc','p','20261101080000','戊');
            INSERT INTO attributes VALUES ('a','custom-qingmo-memo','1'),('b','custom-qingmo-memo','1'),('c','custom-qingmo-memo','1'),('d','custom-qingmo-memo','1');`);
        const repository = new MemoRepository(async (path, body) => {
            if (path === '/api/sqlite/flushTransaction') return null;
            return db.prepare(body.stmt).all();
        });
        const month = await repository.periodStats({ year: 2026, month: 10 });
        assert.deepEqual(month.buckets, [
            { date: '20261001', count: 2, words: 4 },
            { date: '20261003', count: 1, words: 1 }
        ]);
        assert.equal(month.memoCount, 3);
        assert.equal(month.wordCount, 5);
        assert.equal(month.recordDays, 2);
        assert.equal(month.maxCount, 2);
        assert.equal(month.maxWords, 4);
        const year = await repository.periodStats({ year: 2026 });
        assert.deepEqual(year.buckets, [
            { date: '202610', count: 3, words: 5 },
            { date: '202611', count: 1, words: 1 }
        ]);
        assert.equal(year.recordDays, 3);
    } finally {
        db.close();
    }
});
