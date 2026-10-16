export function countText(text) {
    return Array.from(String(text || '').replace(/\s/gu, '')).length;
}
export function historyPlainText(dom, doc) {
    const template = doc.createElement('template');
    template.innerHTML = dom;
    template.content
        .querySelectorAll('[data-type="img"],img,audio,video,.protyle-attr,.protyle-action,script,style')
        .forEach(node => node.remove());
    return [...template.content.querySelectorAll('[data-node-id]')]
        .filter(node => !node.querySelector('[data-node-id]'))
        .map(node => node.textContent.replace(/[\u200b\u2060]/g, ''))
        .join('');
}
export function historyTime(created, now = new Date()) {
    const date = new Date(Number(created) * 1000),
        day = value => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
    const elapsed = Math.round((day(now) - day(date)) / 86400000);
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    if (elapsed === 0) return { key: 'historyToday', time };
    if (elapsed === 1) return { key: 'historyYesterday', time };
    if (elapsed >= 2 && elapsed <= 6) return { key: 'historyDaysAgo', days: elapsed };
    return {
        key: 'historyDate',
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        time
    };
}
const failure = code => Object.assign(new Error(code), { code });
function extractHistory(content, memo, doc) {
    if (content.rootID !== memo.root_id || content.isLargeDoc || typeof content.content !== 'string')
        throw failure('HISTORY_INVALID');
    const template = doc.createElement('template');
    template.innerHTML = content.content;
    const matches = Array.from(template.content.querySelectorAll('[data-node-id]')).filter(
        node => node.dataset.nodeId === memo.id
    );
    if (memo.type === 'd') return { dom: content.content, safe: false };
    if (matches.length > 1) throw failure('HISTORY_INVALID');
    if (!matches.length) return null;
    const node = matches[0],
        expected = memo.type === 'p' ? 'NodeParagraph' : memo.type === 's' ? 'NodeSuperBlock' : '';
    const structuralAttrs = new Set([
        'data-node-id',
        'data-node-index',
        'data-type',
        'data-subtype',
        'class',
        'updated',
        'data-sb-layout',
        'data-marker'
    ]);
    const children = Array.from(node.querySelectorAll('[data-type^="Node"]'));
    const safe =
        children.every(child =>
            Array.from(child.attributes).every(
                attr =>
                    structuralAttrs.has(attr.name) ||
                    (child.dataset.type === 'NodeAudio' && attr.name.startsWith('custom-'))
            )
        ) &&
        Boolean(expected) &&
        node.dataset.type === expected &&
        Array.from(node.querySelectorAll('[data-type^="Node"]')).every(child =>
            ['NodeParagraph', 'NodeList', 'NodeListItem', 'NodeBlockquote', 'NodeCodeBlock', 'NodeAudio'].includes(
                child.dataset.type
            )
        );
    return { dom: node.outerHTML, safe };
}
function contentKey(dom, doc) {
    const template = doc.createElement('template');
    template.innerHTML = dom;
    template.content.querySelectorAll('.protyle-attr,.protyle-icons').forEach(node => node.remove());
    for (const node of template.content.querySelectorAll('*'))
        for (const attribute of Array.from(node.attributes))
            if (
                [
                    'data-node-id',
                    'data-node-index',
                    'updated',
                    'contenteditable',
                    'spellcheck',
                    'draggable',
                    'id'
                ].includes(attribute.name) ||
                (attribute.name.startsWith('custom-') && node.dataset.type !== 'NodeAudio')
            )
                node.removeAttribute(attribute.name);
    for (const node of template.content.querySelectorAll('[data-type]'))
        if (!node.dataset.type.startsWith('Node')) node.dataset.type = node.dataset.type.split(' ').sort().join(' ');
    const walker = doc.createTreeWalker(template.content, 4);
    while (walker.nextNode())
        walker.currentNode.nodeValue = walker.currentNode.nodeValue.replace(/[\u200b\u2060]/g, '');
    return template.innerHTML;
}
function historyMarkdown(dom, doc, lute) {
    const template = doc.createElement('template');
    template.innerHTML = dom;
    template.content.querySelectorAll('.protyle-attr,.protyle-icons').forEach(node => node.remove());
    // Lute's standard Markdown export omits audio IALs. Carry their identity and
    // custom attributes separately so restoring history keeps pending recordings.
    const audio = [];
    for (const node of template.content.querySelectorAll('[data-type="NodeAudio"]')) {
        const media = node.querySelector('audio'),
            src = media?.getAttribute('src');
        if (!src || !/^\/?assets\/[^\s<>"']+$/.test(src)) continue;
        const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        const attrs = [];
        const id = node.getAttribute('data-node-id');
        if (/^\d{14}-[a-z0-9]{7}$/.test(id || '')) attrs.push('id="' + id + '"');
        for (const attr of Array.from(node.attributes))
            if (/^custom-[\w-]+$/.test(attr.name)) attrs.push(attr.name + '="' + escape(attr.value) + '"');
        const marker = 'QINGMOAUDIO' + crypto.randomUUID().replace(/-/g, '') + 'END';
        audio.push([
            marker,
            '<audio controls="controls" src="' +
                escape(src) +
                '"></audio>' +
                (attrs.length ? '\n{: ' + attrs.join(' ') + '}' : '')
        ]);
        const replacement = doc.createElement('div');
        replacement.dataset.type = 'NodeParagraph';
        const body = doc.createElement('div');
        body.contentEditable = 'true';
        body.setAttribute('contenteditable', 'true');
        body.textContent = marker;
        replacement.append(body);
        node.replaceWith(replacement);
    }
    for (const node of template.content.querySelectorAll('*'))
        for (const attr of Array.from(node.attributes))
            if (
                ![
                    'data-type',
                    'data-subtype',
                    'data-id',
                    'data-sb-layout',
                    'data-marker',
                    'data-content',
                    'href',
                    'src',
                    'alt',
                    'title',
                    'class',
                    'contenteditable',
                    'spellcheck'
                ].includes(attr.name)
            )
                node.removeAttribute(attr.name);
    const wrapper = template.content.querySelector('[data-type="NodeSuperBlock"]');
    if (wrapper) wrapper.replaceWith(...wrapper.childNodes);
    for (const editable of template.content.querySelectorAll('[contenteditable]'))
        editable.setAttribute('contenteditable', 'true');
    lute.SetBlockRef(true);
    lute.SetTag(true);
    lute.SetMark(true);
    lute.SetTextMark(true);
    let markdown = lute.BlockDOM2StdMd(template.innerHTML).trim();
    for (const [marker, value] of audio) markdown = markdown.replace(marker, value);
    return markdown;
}
class MemoHistory {
    constructor(repository, doc) {
        this.repository = repository;
        this.doc = doc;
    }
    filters(memo) {
        return { type: 3, query: memo.root_id, notebook: '', op: '' };
    }
    async list(memo, page = 1, previous = '') {
        const r = this.repository,
            filters = this.filters(memo),
            data = await r.request('/api/history/searchHistory', { ...filters, page }),
            versions = [];
        let last = previous;
        if (!Array.isArray(data.histories)) throw failure('HISTORY_INVALID');
        for (const created of data.histories) {
            const result = await r.request('/api/history/getHistoryItems', { ...filters, created });
            if (!Array.isArray(result.items)) throw failure('HISTORY_INVALID');
            for (const item of result.items.filter(item => item.id === memo.root_id)) {
                const content = await r.request('/api/history/getDocHistoryContent', {
                    historyPath: item.path,
                    k: '',
                    highlight: false
                });
                const extracted = extractHistory(content, memo, this.doc);
                if (!extracted) continue;
                const key = contentKey(extracted.dom, this.doc);
                if (key !== last) versions.push({ ...extracted, created, path: item.path, key });
                last = key;
            }
        }
        versions.sort((a, b) => Number(b.created) - Number(a.created));
        return { versions, hasMore: page < Number(data.pageCount), last };
    }
    sameContent(memo, markdown) {
        const lute = this.doc.defaultView.Lute.New();
        lute.SetTag(true);
        lute.SetMark(true);
        lute.SetSuperBlock(true);
        lute.SetKramdownIAL(true);
        lute.SetTextMark(true);
        lute.SetProtyleWYSIWYG(true);
        return contentKey(memo.dom, this.doc) === contentKey(lute.Md2BlockDOM(markdown), this.doc);
    }
    async snapshot(memo) {
        try {
            await this.repository.request('/api/sqlite/flushTransaction', {});
            await this.repository.request('/api/history/createDocHistory', { id: memo.root_id });
            // SiYuan queues history indexing separately from createDocHistory's response.
            const key = contentKey(memo.dom, this.doc),
                deadline = Date.now() + 5000;
            do {
                const result = await this.list(memo, 1);
                if (result.versions.some(version => version.key === key)) return;
                if (Date.now() >= deadline) break;
                await new Promise(resolve => setTimeout(resolve, 250));
            } while (Date.now() <= deadline);
            throw failure('HISTORY_SNAPSHOT_FAILED');
        } catch (error) {
            throw failure('HISTORY_SNAPSHOT_FAILED');
        }
    }
}
export { MemoHistory, extractHistory, contentKey, historyMarkdown };
