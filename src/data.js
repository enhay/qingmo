'use strict';

const DEFAULT_SETTINGS = { notebook: '', pathTemplate: '/轻墨/{yyyy}/{MM}/{yyyy-MM-dd}', openOnStartup: false, floatingButton: true, reviewCount: 5 };
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
function editableMarkdown(markdown, rootId, wholeDocument = false) {
  let text = String(markdown || '');
  // The superblock's own attributes are supplied separately on update.
  const wrapper = text.trim().match(/^(?:\{:[^\n]*\}\s*\n)?\{\{\{(?:row|col)\s*\n([\s\S]*)\n\}\}\}(?:\s*\n\{:[^\n]*\})?$/);
  if (wrapper) text = wrapper[1];
  // List item IALs can precede their text. Keep user attributes after removing
  // generated identity fields, and never modify literal code.
  return transformProse(text, part => {
    const cleaned = part.replace(/\{:\s*([^\n]*?)\}/g, (all, attributes) => {
      const identity = attributes.match(/(?:^|\s)id="(\d{14}-[a-z0-9]{7})"/);
      if (!identity) return all;
      // The selected block's attributes are read and preserved by save(), not edited as prose.
      // Whole documents are read-only previews; child attributes stay in the source document.
      if (wholeDocument || identity[1] === rootId) return '';
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

function removeNativeTagMarkdown(markdown) {
  return transformProse(markdown, part => {
    let out='';
    for(let i=0;i<part.length;){
      const start=i,linked=part[i]==='[' || (part[i]==='#'&&part[i+1]==='[');
      if(part[i]==='\\'&&part.startsWith('#轻墨#',i+1)){out+=part.slice(i,i+5);i+=5;continue;}
      if(part[i]==='<'){const end=part.indexOf('>',i+1);if(end>i){out+=part.slice(i,end+1);i=end+1;continue;}}
      if(linked){
        const bracket=i+(part[i]==='#'?1:0),end=part.indexOf(']',bracket+1);
        if(end>bracket && part[end+1]==='('){
          let depth=1,j=end+2;
          while(j<part.length&&depth){if(part[j]==='(')depth++;else if(part[j]===')')depth--;j++;}
          if(depth===0){const tagged=part[i]==='#'&&part[j]==='#'&&part.slice(bracket+1,end)==='轻墨';out+=tagged?part.slice(bracket,j):part.slice(i,j);i=j+(tagged?1:0);continue;}
        }
      }
      if(part.startsWith('**#轻墨#**',i)||part.startsWith('~~#轻墨#~~',i)||part.startsWith('__#轻墨#__',i)){i+=8;continue;}
      if(part.startsWith('*#轻墨#*',i)||part.startsWith('_#轻墨#_',i)){i+=6;continue;}
      if(part.startsWith('#轻墨#',i)){i+=4;continue;}
      if(/^(?:[a-z][a-z\d+.-]*:\/\/|mailto:)/i.test(part.slice(i,i+20))){while(i<part.length&&!/\s/.test(part[i]))i++;out+=part.slice(start,i);continue;}
      out+=part[i++];
    }
    return out;
  });
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

const MEMOS = `all_tags AS (
 SELECT block_id,content AS name FROM spans WHERE instr(' '||type||' ',' tag ')>0
), tagged_docs AS (
 SELECT DISTINCT b.id FROM blocks b JOIN all_tags t ON t.block_id=b.id WHERE b.type='d' AND t.name='轻墨'
), marked AS (
 SELECT b.id,b.created,b.type,b.root_id FROM blocks b WHERE b.type<>'d' AND EXISTS
 (SELECT 1 FROM attributes a WHERE a.block_id=b.id AND a.name='custom-qingmo-memo' AND a.value='1')
), tag_candidates AS (
 SELECT DISTINCT CASE WHEN b.type='p' AND p.type IN ('i','b','s') THEN p.id ELSE b.id END AS id
 FROM spans sp JOIN blocks b ON b.id=sp.block_id LEFT JOIN blocks p ON p.id=b.parent_id
 WHERE instr(' '||sp.type||' ',' tag ')>0 AND sp.content='轻墨' AND b.type<>'d'
), climb(candidate,id,parent_id,depth) AS (
 SELECT t.id,b.id,b.parent_id,0 FROM tag_candidates t JOIN blocks b ON b.id=t.id
 UNION ALL SELECT c.candidate,p.id,p.parent_id,c.depth+1 FROM climb c JOIN blocks p ON p.id=c.parent_id
 WHERE p.type NOT IN ('d','h')
), tagged AS (
 SELECT DISTINCT COALESCE((SELECT c.id FROM climb c JOIN marked m ON m.id=c.id WHERE c.candidate=t.id ORDER BY c.depth LIMIT 1),
   (SELECT c.id FROM climb c JOIN tag_candidates outer_tag ON outer_tag.id=c.id WHERE c.candidate=t.id ORDER BY c.depth DESC LIMIT 1)) AS id
 FROM tag_candidates t
), memos AS (
 SELECT b.id,b.created,b.type,b.root_id FROM blocks b WHERE b.id IN (SELECT id FROM marked UNION SELECT id FROM tagged UNION SELECT id FROM tagged_docs)
 AND (b.type='d' OR b.root_id NOT IN (SELECT id FROM tagged_docs))
)`;
const TREE = `WITH RECURSIVE ${MEMOS}, descendants(memo_id,id,whole_doc) AS (
 SELECT id,id,type='d' FROM memos UNION ALL SELECT d.memo_id,b.id,d.whole_doc FROM blocks b JOIN descendants d ON b.parent_id=d.id JOIN blocks current ON current.id=d.id
 WHERE d.whole_doc OR (b.type<>'h' AND current.type<>'h')
)`;
const descendant = condition => `EXISTS (SELECT 1 FROM descendants d JOIN blocks c ON c.id=d.id WHERE d.memo_id=m.id AND (${condition}))`;
function dailyOrder(ids, day) {
 let seed = 2166136261;
 for (const char of String(day)) seed = Math.imul(seed ^ char.charCodeAt(0),16777619) >>> 0;
 const result = ids.slice().sort();
 for (let i=result.length-1;i>0;i--) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; const j=(seed >>> 0)%(i+1); [result[i],result[j]]=[result[j],result[i]]; }
 return result;
}
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
  async get(id) {
    const rows = await this.sql(`${TREE} SELECT m.id,m.created,m.type,m.root_id,r.content AS source,day.value AS qingmoDay,added.value AS added,marker.value AS marker,
      (SELECT json_group_array(DISTINCT t.name) FROM descendants d JOIN all_tags t ON t.block_id=d.id WHERE d.memo_id=m.id) AS tagsJSON
      FROM memos m JOIN blocks r ON r.id=m.root_id
      LEFT JOIN attributes day ON day.block_id=r.id AND day.name='custom-qingmo-day'
      LEFT JOIN attributes added ON added.block_id=m.id AND added.name='custom-qingmo-added'
      LEFT JOIN attributes marker ON marker.block_id=m.id AND marker.name='custom-qingmo-memo'
      WHERE m.id=${literal(id)} LIMIT 1`);
    if (!rows.length) return null;
    return this.hydrate(rows[0]);
  }
  async hydrate(row) {
    const result = await this.request('/api/block/getBlockKramdown', { id: row.id });
    const markdown = editableMarkdown(result.kramdown, row.id, row.type==='d');
    const parsed = parseMemoMarkdown(markdown);
    return { ...row, markdown, content: parsed.text, tags: JSON.parse(row.tagsJSON||'[]'), images: allImagePaths(markdown), external: row.type!=='s' || row.added==='1' || row.marker!=='1' };
  }
  async list({ keyword = '', tag = '', kind = 'all', day = '', source = 'all', order = 'newest', offset = 0 } = {}) {
    const where = [];
    if (keyword) where.push(descendant(`instr(lower(c.content),lower(${literal(keyword)}))>0`));
    if (tag) where.push(descendant(`EXISTS (SELECT 1 FROM all_tags t WHERE t.block_id=c.id AND (t.name=${literal(tag)} OR instr(t.name,${literal(tag+'/')})=1))`));
    if (kind === 'image') where.push(descendant(`EXISTS (SELECT 1 FROM spans sp WHERE sp.block_id=c.id AND sp.type='img')`));
    if (kind === 'link') where.push(descendant(`EXISTS (SELECT 1 FROM spans sp WHERE sp.block_id=c.id AND (sp.type='a' OR instr(' '||sp.type||' ',' a ')>0))`));
    if (kind === 'untagged') where.push(`NOT ${descendant("EXISTS (SELECT 1 FROM all_tags t WHERE t.block_id=c.id)")}`);
    if (day) { if (!/^\d{8}$/.test(day)) throw Object.assign(new Error('INVALID_DAY'), { code: 'INVALID_DAY' }); where.push(`substr(m.created,1,8)=${literal(day)}`); }
    const external = "(m.type<>'s' OR COALESCE(added.value,'')='1' OR COALESCE(marker.value,'')<>'1')";
    if (source === 'external') where.push(external);
    if (source === 'native') where.push(`NOT ${external}`);
    const direction = order === 'oldest' ? 'ASC' : 'DESC';
    const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    const rows = await this.sql(`${TREE} SELECT m.id,m.created,m.type,m.root_id,r.content AS source,day.value AS qingmoDay,added.value AS added,marker.value AS marker,
      (SELECT json_group_array(DISTINCT t.name) FROM descendants d JOIN all_tags t ON t.block_id=d.id WHERE d.memo_id=m.id) AS tagsJSON
      FROM memos m JOIN blocks r ON r.id=m.root_id
      LEFT JOIN attributes day ON day.block_id=r.id AND day.name='custom-qingmo-day'
      LEFT JOIN attributes added ON added.block_id=m.id AND added.name='custom-qingmo-added'
      LEFT JOIN attributes marker ON marker.block_id=m.id AND marker.name='custom-qingmo-memo'
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.created ${direction},m.id ${direction} LIMIT 21 OFFSET ${start}`);
    const items = await Promise.all(rows.slice(0,20).map(row=>this.hydrate(row)));
    return { items, hasMore: rows.length > 20 };
  }
  async allIds() {
    const ids=[];
    for(let offset=0;;offset+=512){const rows=await this.sql(`WITH RECURSIVE ${MEMOS} SELECT id FROM memos ORDER BY id LIMIT 512 OFFSET ${offset}`);ids.push(...rows.map(row=>row.id));if(rows.length<512)break;}
    return ids;
  }
  async canAdd(id) {
    const rows=await this.sql(`WITH RECURSIVE ${MEMOS}, parents(id,parent_id,type) AS (
      SELECT x.id,x.parent_id,x.type FROM blocks x WHERE x.id=${literal(id)}
      UNION ALL SELECT p.id,p.parent_id,p.type FROM parents x JOIN blocks p ON p.id=x.parent_id WHERE p.type NOT IN ('d','h')
    ) SELECT 1 AS yes FROM blocks b WHERE b.id=${literal(id)} AND b.type<>'d' AND b.root_id NOT IN (SELECT id FROM tagged_docs)
      AND NOT EXISTS (SELECT 1 FROM parents x JOIN memos m ON m.id=x.id) LIMIT 1`);
    return rows.length>0;
  }
  async add(id) {
    if (!await this.canAdd(id)) throw Object.assign(new Error('MEMO_NOT_ADDABLE'),{code:'MEMO_NOT_ADDABLE'});
    await this.request('/api/attr/setBlockAttrs',{id,attrs:{'custom-qingmo-memo':'1','custom-qingmo-added':'1'}});
    return {id};
  }
  async remove(id) {
    const memo=await this.get(id);
    if (!memo) throw Object.assign(new Error('MEMO_NOT_FOUND'),{code:'MEMO_NOT_FOUND'});
    const attrs=await this.request('/api/attr/getBlockAttrs',{id});
    if (memo.type==='d') {
      const tags=String(attrs.tags||'').split(',').filter(value=>value.trim()!=='轻墨').join(',');
      await this.request('/api/attr/setBlockAttrs',{id,attrs:{tags}});
      return {id};
    }
    const leaves=await this.sql(`WITH RECURSIVE nodes(id) AS (SELECT ${literal(id)} UNION ALL SELECT b.id FROM blocks b JOIN nodes n ON b.parent_id=n.id JOIN blocks current ON current.id=n.id WHERE b.type<>'h' AND current.type<>'h') SELECT DISTINCT n.id FROM nodes n JOIN spans sp ON sp.block_id=n.id WHERE instr(' '||sp.type||' ',' tag ')>0 AND sp.content='轻墨'`);
    for (const row of leaves) {
      const result=await this.request('/api/block/getBlockKramdown',{id:row.id});
      const stripped=removeNativeTagMarkdown(result.kramdown);
      if (stripped!==result.kramdown) await this.request('/api/block/updateBlock',{id:row.id,dataType:'markdown',data:stripped});
    }
    if (attrs['custom-qingmo-memo'] || attrs['custom-qingmo-added']) await this.request('/api/attr/setBlockAttrs',{id,attrs:{'custom-qingmo-memo':'','custom-qingmo-added':''}});
    return {id};
  }
  async stats() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - start.getDay() - 77);
    const nativeTags = `${TREE}, native_tags AS (SELECT DISTINCT d.memo_id,t.name,m.created FROM descendants d JOIN memos m ON m.id=d.memo_id JOIN all_tags t ON t.block_id=d.id WHERE t.name<>'')`;
    const summaryRows = await this.sql(`${nativeTags} SELECT (SELECT count(*) FROM memos) AS memoCount,(SELECT min(created) FROM memos) AS firstCreated,count(DISTINCT name) AS tagCount FROM native_tags LIMIT 1`);
    const heatRows = await this.sql(`WITH RECURSIVE ${MEMOS} SELECT substr(created,1,8) AS date,count(*) AS count FROM memos WHERE substr(created,1,8)>=${literal(localDay(start))} AND substr(created,1,8)<=${literal(localDay(today))} GROUP BY substr(created,1,8) LIMIT 84`);
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
      const rows = await this.sql(`WITH RECURSIVE ${MEMOS} SELECT id,type FROM memos WHERE id=${literal(id)} LIMIT 1`);
      if (!rows.length) throw Object.assign(new Error('MEMO_NOT_FOUND'), { code: 'MEMO_NOT_FOUND' });
      attrs = { ...await this.request('/api/attr/getBlockAttrs', { id }), id };
      if (rows[0].type==='p') {
        if (images.length || /\n\s*\n/.test(text) || /(?:^|\n)\s*(?:[-*+] |\d+\. |>|#{1,6} |```|~~~)/.test(text)) throw Object.assign(new Error('MEMO_STRUCTURED_EDIT'),{code:'MEMO_STRUCTURED_EDIT'});
        const ial = Object.entries(attrs).filter(([key]) => /^[\w-]+$/.test(key)).map(([key,value]) => `${key}="${String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"`).join(' ');
        const body=normalizeTags(text)+images.map(path=>'\n\n![]('+path.replace(/ /g,'%20')+')').join('');
        await this.request('/api/block/updateBlock',{id,dataType:'markdown',data:body+'\n{: '+ial+'}'});
        return {id};
      }
      if (rows[0].type!=='s') throw Object.assign(new Error('MEMO_NOT_EDITABLE'),{code:'MEMO_NOT_EDITABLE'});
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
    const memo=await this.get(id);
    if (!memo || memo.external) throw Object.assign(new Error('MEMO_NOT_FOUND'), { code: 'MEMO_NOT_FOUND' });
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
module.exports = { MemoRepository, DraftStore, parseMemoMarkdown, normalizeTags, DEFAULT_SETTINGS, dailyOrder };
