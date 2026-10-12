'use strict';

const DEFAULT_SETTINGS = { notebook: '', pathTemplate: '/轻墨/{yyyy}/{MM}/{yyyy-MM-dd}', openOnStartup: false, floatingButton: true };
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const localDay = date => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
const validImage = value => typeof value === 'string' && /^assets\//.test(value) && !/[\r\n<>]/.test(value);
const unique = values => [...new Set(values)];

// Code fences and inline code retain literal hashes rather than becoming tags.
function transformProse(markdown, transform) {
  let fence = null;
  const output = [];
  for (const [lineIndex, line] of markdown.split('\n').entries()) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      output.push(line); continue;
    }
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = { character: marker[1][0], length: marker[1].length };
      output.push(line); continue;
    }
    const runs = [...line.matchAll(/`+/g)];
    let cursor = 0; let rendered = ''; let hasCode = false;
    for (let i = 0; i < runs.length; i++) {
      const close = runs.findIndex((run, index) => index > i && run[0].length === runs[i][0].length);
      if (close < 0) continue;
      rendered += transform(line.slice(cursor, runs[i].index), lineIndex, false) || '';
      cursor = runs[close].index + runs[close][0].length;
      rendered += line.slice(runs[i].index, cursor);
      hasCode = true; i = close;
    }
    const tail = transform(line.slice(cursor), lineIndex, !hasCode);
    if (!hasCode && tail === null) continue;
    output.push(rendered + (tail || ''));
  }
  return output.join('\n');
}
function normalizeTags(text) {
  return transformProse(String(text), part => part.replace(/(^|\s)#([^\s#]+)(#?)(?=\s|$)/g, (all, before, tag) => before + '#' + tag + '#'));
}
function extractTags(text) {
  const tags = [];
  transformProse(text, part => { for (const match of part.matchAll(/#([^\s#]+)#/g)) tags.push(match[1]); return part; });
  return unique(tags);
}
function editableMarkdown(markdown) {
  let text = String(markdown || '');
  // The superblock's own attributes are supplied separately on update.
  const wrapper = text.trim().match(/^(?:\{:[^\n]*\}\s*\n)?\{\{\{(?:row|col)\s*\n([\s\S]*)\n\}\}\}(?:\s*\n\{:[^\n]*\})?$/);
  if (wrapper) text = wrapper[1];
  // List item IALs can precede their text. Keep user attributes after removing
  // generated identity fields, and never modify literal code.
  return transformProse(text, part => {
    const cleaned = part.replace(/\{:\s*([^\n]*?)\}/g, (all, attributes) => {
      if (!/\bid="\d{14}-[a-z0-9]{7}"/.test(attributes)) return all;
      const remaining = attributes.replace(/(?:^|\s)(?:id|updated)="[^"]*"/g, '').trim();
      return remaining ? '{: ' + remaining + '}' : '';
    });
    return part.trim() && !cleaned.trim() ? null : cleaned;
  });
}
function parseMemoMarkdown(markdown) {
  const body = editableMarkdown(markdown);
  const lines = body.split('\n');
  const attachments = new Map();
  transformProse(body, (part, index, wholeLine) => {
    const match = wholeLine && part.match(/^!\[\]\(<?(assets\/[^\s)>]+)>?\)$/);
    if (match && validImage(match[1]) && (index === 0 || !lines[index - 1].trim())) attachments.set(index, match[1]);
    return part;
  });
  const images = [];
  let end = lines.length;
  let cursor = end - 1;
  while (cursor >= 0) {
    if (!lines[cursor].trim()) { cursor--; continue; }
    if (!attachments.has(cursor)) break;
    images.unshift(attachments.get(cursor)); end = cursor; cursor--;
  }
  return { text: images.length ? lines.slice(0, end).join('\n').replace(/\n+$/, '') : body, images };
}
function allImagePaths(markdown) {
  const images = [];
  transformProse(markdown, part => {
    for (const match of part.matchAll(/!\[[^\]]*\]\(<?(assets\/[^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
      if (validImage(match[1])) images.push(match[1]);
    }
    return part;
  });
  return images;
}

class DraftStore {
  constructor(storage) { this.storage = storage; }
  load(id = 'new') {
    try {
      const value = JSON.parse(this.storage.getItem('qingmo:draft:' + id));
      if (!value || typeof value.text !== 'string' || !Array.isArray(value.images) || !value.images.every(validImage)) return null;
      return { text: value.text, images: value.images.slice() };
    } catch (_) { return null; }
  }
  save(id, draft) {
    try {
      if (!draft || typeof draft.text !== 'string' || !Array.isArray(draft.images) || !draft.images.every(validImage)) return false;
      this.storage.setItem('qingmo:draft:' + id, JSON.stringify({ text: draft.text, images: draft.images.slice() }));
      return true;
    } catch (_) { return false; }
  }
  remove(id = 'new') { try { this.storage.removeItem('qingmo:draft:' + id); return true; } catch (_) { return false; } }
}

const MEMOS = `SELECT b.id,b.created FROM blocks b WHERE b.type='s' AND EXISTS (SELECT 1 FROM attributes a WHERE a.block_id=b.id AND a.name='custom-qingmo-memo' AND a.value='1')`;
const TREE = `WITH RECURSIVE memos AS (${MEMOS}), descendants(memo_id,id) AS (SELECT id,id FROM memos UNION ALL SELECT d.memo_id,b.id FROM blocks b JOIN descendants d ON b.parent_id=d.id)`;
const descendant = condition => `EXISTS (SELECT 1 FROM descendants d JOIN blocks c ON c.id=d.id WHERE d.memo_id=m.id AND (${condition}))`;

class MemoRepository {
  constructor(request) { this.request = request; }
  async sql(stmt) {
    // Native writes queue transactions and indexing separately from API success.
    await this.request('/api/sqlite/flushTransaction', {});
    return this.request('/api/query/sql', { stmt });
  }
  async getNotebooks() {
    const data = await this.request('/api/notebook/lsNotebooks', {});
    return (data.notebooks || []).filter(item => !item.closed).map(({ id, name }) => ({ id, name }));
  }
  async list({ keyword = '', tag = '', kind = 'all', day = '', offset = 0 } = {}) {
    const where = [];
    if (keyword) where.push(descendant(`instr(lower(c.content),lower(${literal(keyword)}))>0`));
    if (tag) where.push(descendant(`instr(c.tag,${literal('#' + tag + '#')})>0 OR instr(c.tag,${literal('#' + tag + '/')})>0`));
    if (kind === 'image') where.push(descendant(`EXISTS (SELECT 1 FROM spans sp WHERE sp.block_id=c.id AND sp.type='img')`));
    if (kind === 'link') where.push(descendant(`EXISTS (SELECT 1 FROM spans sp WHERE sp.block_id=c.id AND sp.type IN ('a','textmark a'))`));
    if (kind === 'untagged') where.push(`NOT ${descendant("c.tag<>''")}`);
    if (day) { if (!/^\d{8}$/.test(day)) throw Object.assign(new Error('INVALID_DAY'), { code: 'INVALID_DAY' }); where.push(`substr(m.created,1,8)=${literal(day)}`); }
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const rows = await this.sql(`${TREE} SELECT m.id,m.created FROM memos m ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.created DESC,m.id DESC LIMIT 21 OFFSET ${start}`);
    const items = await Promise.all(rows.slice(0, 20).map(async row => {
      const result = await this.request('/api/block/getBlockKramdown', { id: row.id });
      const markdown = editableMarkdown(result.kramdown);
      const parsed = parseMemoMarkdown(markdown);
      return { id: row.id, created: row.created, markdown, content: parsed.text, tags: extractTags(markdown), images: allImagePaths(markdown) };
    }));
    return { items, hasMore: rows.length > 20 };
  }
  async stats() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - start.getDay() - 77);
    const nativeTags = `${TREE}, native_tags AS (SELECT DISTINCT d.memo_id,sp.content AS name,m.created FROM descendants d JOIN memos m ON m.id=d.memo_id JOIN spans sp ON sp.block_id=d.id WHERE sp.type='textmark tag' AND sp.content<>'')`;
    const summaryRows = await this.sql(`${nativeTags} SELECT (SELECT count(*) FROM memos) AS memoCount,(SELECT min(created) FROM memos) AS firstCreated,count(DISTINCT name) AS tagCount FROM native_tags LIMIT 1`);
    const heatRows = await this.sql(`WITH memos AS (${MEMOS}) SELECT substr(created,1,8) AS date,count(*) AS count FROM memos WHERE substr(created,1,8)>=${literal(localDay(start))} AND substr(created,1,8)<=${literal(localDay(today))} GROUP BY substr(created,1,8) LIMIT 84`);
    // Expand native tags into ancestors in SQLite and deduplicate each memo
    // before counting: a/b and a/c contribute only once to their parent a.
    const tagTree = `${nativeTags}, tag_paths(memo_id,name,rest,created) AS (
      SELECT memo_id,'',name,created FROM native_tags
      UNION ALL
      SELECT memo_id,name || CASE WHEN name='' THEN '' ELSE '/' END || CASE WHEN instr(rest,'/')>0 THEN substr(rest,1,instr(rest,'/')-1) ELSE rest END,
        CASE WHEN instr(rest,'/')>0 THEN substr(rest,instr(rest,'/')+1) ELSE '' END,created
      FROM tag_paths WHERE rest<>''
    )`;
    const tags = [];
    for (let offset = 0; ; offset += 512) {
      const batch = await this.sql(`${tagTree} SELECT name,count(DISTINCT memo_id) AS count,max(created) AS lastUsed FROM tag_paths WHERE name<>'' GROUP BY name ORDER BY lastUsed DESC,name LIMIT 512 OFFSET ${offset}`);
      tags.push(...batch);
      if (batch.length < 512) break;
    }
    const summary = summaryRows[0];
    const dayMap = new Map(heatRows.map(row => [row.date, row.count]));
    const heatmap = [];
    for (let date = new Date(start); localDay(date) <= localDay(today); date.setDate(date.getDate() + 1)) heatmap.push({ date: localDay(date), count: dayMap.get(localDay(date)) || 0 });
    const first = summary.firstCreated && summary.firstCreated.slice(0, 8);
    const calendar = day => Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8));
    return { memoCount: summary.memoCount, tagCount: summary.tagCount, dayCount: first ? Math.max(1, Math.round((calendar(localDay(today)) - calendar(first)) / 86400000) + 1) : 0, heatmap, tags };
  }
  async save({ id, text, images = [] }, settings, date = new Date()) {
    if (typeof text !== 'string' || !Array.isArray(images) || !images.every(validImage)) throw Object.assign(new Error('MEMO_INVALID'), { code: 'MEMO_INVALID' });
    if (!text.trim() && !images.length) throw Object.assign(new Error('MEMO_EMPTY'), { code: 'MEMO_EMPTY' });
    let attrs = { 'custom-qingmo-memo': '1' };
    if (id) {
      const rows = await this.sql(`${MEMOS} AND b.id=${literal(id)} LIMIT 1`);
      if (!rows.length) throw Object.assign(new Error('MEMO_NOT_FOUND'), { code: 'MEMO_NOT_FOUND' });
      attrs = { ...await this.request('/api/attr/getBlockAttrs', { id }), ...attrs, id };
    }
    const parsed = parseMemoMarkdown(text);
    const body = normalizeTags(parsed.text) + [...parsed.images, ...images].map(path => '\n\n![](' + path.replace(/ /g, '%20') + ')').join('');
    const ial = Object.entries(attrs).filter(([key]) => /^[\w-]+$/.test(key)).map(([key, value]) => `${key}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;')}"`).join(' ');
    const data = `{{{row\n${body}\n}}}\n{: ${ial}}`;
    if (id) { await this.request('/api/block/updateBlock', { id, dataType: 'markdown', data }); return { id }; }
    const day = localDay(date);
    const docs = await this.sql(`SELECT b.id FROM blocks b JOIN attributes a ON a.block_id=b.id WHERE b.type='d' AND a.name='custom-qingmo-day' AND a.value=${literal(day)} ORDER BY b.created,b.id LIMIT 1`);
    let parentID = docs[0] && docs[0].id;
    if (!parentID) {
      if (!settings.notebook) throw Object.assign(new Error('NOTEBOOK_REQUIRED'), { code: 'NOTEBOOK_REQUIRED' });
      const values = { yyyy: day.slice(0, 4), MM: day.slice(4, 6), 'yyyy-MM-dd': `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` };
      const path = (settings.pathTemplate || DEFAULT_SETTINGS.pathTemplate).replace(/\{(yyyy-MM-dd|yyyy|MM)\}/g, (_, token) => values[token]);
      const ids = await this.request('/api/filetree/getIDsByHPath', { notebook: settings.notebook, path });
      parentID = ids[0] || await this.request('/api/filetree/createDocWithMd', { notebook: settings.notebook, path, markdown: '' });
      await this.request('/api/attr/setBlockAttrs', { id: parentID, attrs: { 'custom-qingmo-day': day } });
    }
    const result = await this.request('/api/block/appendBlock', { parentID, dataType: 'markdown', data });
    const operation = result && result.flatMap(transaction => transaction.doOperations || []).find(op => op.id);
    if (!operation) throw Object.assign(new Error('MEMO_SAVED_ID_MISSING'), { code: 'MEMO_SAVED_ID_MISSING' });
    return { id: operation.id };
  }
  async delete(id) {
    const rows = await this.sql(`${MEMOS} AND b.id=${literal(id)} LIMIT 1`);
    if (!rows.length) throw Object.assign(new Error('MEMO_NOT_FOUND'), { code: 'MEMO_NOT_FOUND' });
    return this.request('/api/block/deleteBlock', { id });
  }
  async upload(files) {
    const uploaded = [];
    try {
      for (const file of files) {
        const form = new FormData(); form.append('assetsDirPath', '/assets/'); form.append('file[]', file);
        const data = await this.request('/api/asset/upload', form);
        const paths = Object.values(data.succMap || {}).filter(validImage); uploaded.push(...paths);
        if ((data.errFiles || []).length || !paths.length) throw Object.assign(new Error('UPLOAD_FAILED'), { code: 'UPLOAD_FAILED' });
      }
      return unique(uploaded);
    } catch (error) { error.paths = unique(uploaded); error.uploaded = error.paths; throw error; }
  }
}
module.exports = { MemoRepository, DraftStore, parseMemoMarkdown, normalizeTags, DEFAULT_SETTINGS };
