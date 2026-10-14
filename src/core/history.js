
const failure = code => Object.assign(new Error(code), {code});
function extractHistory(content, memo, doc) {
  if (content.rootID !== memo.root_id || content.isLargeDoc || typeof content.content !== 'string') throw failure('HISTORY_INVALID');
  const template=doc.createElement('template');template.innerHTML=content.content;
  const matches=Array.from(template.content.querySelectorAll('[data-node-id]')).filter(node=>node.dataset.nodeId===memo.id);
  if(memo.type==='d')return {dom:content.content,safe:false};
  if(matches.length>1)throw failure('HISTORY_INVALID');
  if(!matches.length)return null;
  const node=matches[0],expected=memo.type==='p'?'NodeParagraph':memo.type==='s'?'NodeSuperBlock':'';
  const structuralAttrs=new Set(['data-node-id','data-node-index','data-type','data-subtype','class','updated','data-sb-layout','data-marker']);
  const children=Array.from(node.querySelectorAll('[data-type^="Node"]'));
  const safe=children.every(child=>Array.from(child.attributes).every(attr=>structuralAttrs.has(attr.name)))&&Boolean(expected)&&node.dataset.type===expected&&Array.from(node.querySelectorAll('[data-type^="Node"]')).every(child=>['NodeParagraph','NodeList','NodeListItem','NodeBlockquote','NodeCodeBlock'].includes(child.dataset.type));
  return {dom:node.outerHTML,safe};
}
function contentKey(dom,doc){const template=doc.createElement('template');template.innerHTML=dom;template.content.querySelectorAll('.protyle-attr,.protyle-icons').forEach(node=>node.remove());for(const node of template.content.querySelectorAll('*'))for(const attribute of Array.from(node.attributes))if(['data-node-id','data-node-index','updated','contenteditable','spellcheck','draggable','id'].includes(attribute.name)||attribute.name.startsWith('custom-'))node.removeAttribute(attribute.name);for(const node of template.content.querySelectorAll('[data-type]'))if(!node.dataset.type.startsWith('Node'))node.dataset.type=node.dataset.type.split(' ').sort().join(' ');const walker=doc.createTreeWalker(template.content,4);while(walker.nextNode())walker.currentNode.nodeValue=walker.currentNode.nodeValue.replace(/[\u200b\u2060]/g,'');return template.innerHTML;}
function historyMarkdown(dom,doc,lute){const template=doc.createElement('template');template.innerHTML=dom;template.content.querySelectorAll('.protyle-attr,.protyle-icons').forEach(node=>node.remove());for(const node of template.content.querySelectorAll('*'))for(const attr of Array.from(node.attributes))if(!['data-type','data-subtype','data-sb-layout','data-marker','data-content','href','src','alt','title','class','contenteditable','spellcheck'].includes(attr.name))node.removeAttribute(attr.name);const wrapper=template.content.querySelector('[data-type="NodeSuperBlock"]');if(wrapper)wrapper.replaceWith(...wrapper.childNodes);return lute.BlockDOM2StdMd(template.innerHTML).trim();}
class MemoHistory {
 constructor(repository,doc){this.repository=repository;this.doc=doc;}
 filters(memo){return {type:3,query:memo.root_id,notebook:'',op:''};}
 async list(memo,page=1,previous=''){
  const r=this.repository,filters=this.filters(memo),data=await r.request('/api/history/searchHistory',{...filters,page}),versions=[];let last=previous;
  if(!Array.isArray(data.histories))throw failure('HISTORY_INVALID');
  for(const created of data.histories){
   const result=await r.request('/api/history/getHistoryItems',{...filters,created});
   if(!Array.isArray(result.items))throw failure('HISTORY_INVALID');
   for(const item of result.items.filter(item=>item.id===memo.root_id)){
    const content=await r.request('/api/history/getDocHistoryContent',{historyPath:item.path,k:'',highlight:false});
    const extracted=extractHistory(content,memo,this.doc);if(!extracted)continue;
    const key=contentKey(extracted.dom,this.doc);if(key!==last)versions.push({...extracted,created,path:item.path,key});last=key;
   }
  }
  versions.sort((a,b)=>Number(b.created)-Number(a.created));
  return {versions,hasMore:page<Number(data.pageCount),last};
 }
 sameContent(memo,markdown){const lute=this.doc.defaultView.Lute.New();lute.SetTag(true);lute.SetMark(true);lute.SetSuperBlock(true);lute.SetKramdownIAL(true);lute.SetTextMark(true);lute.SetProtyleWYSIWYG(true);return contentKey(memo.dom,this.doc)===contentKey(lute.Md2BlockDOM(markdown),this.doc);}
 async snapshot(memo){
  try{
   await this.repository.request('/api/sqlite/flushTransaction',{});
   await this.repository.request('/api/history/createDocHistory',{id:memo.root_id});
   // SiYuan queues history indexing separately from createDocHistory's response.
   const key=contentKey(memo.dom,this.doc),deadline=Date.now()+5000;
   do{
    const result=await this.list(memo,1);
    if(result.versions.some(version=>version.key===key))return;
    if(Date.now()>=deadline)break;
    await new Promise(resolve=>setTimeout(resolve,250));
   }while(Date.now()<=deadline);
   throw failure('HISTORY_SNAPSHOT_FAILED');
  }catch(error){throw failure('HISTORY_SNAPSHOT_FAILED');}
 }
}
export {MemoHistory,extractHistory,contentKey,historyMarkdown};
