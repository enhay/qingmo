<script>
 import {tick} from 'svelte';
 import {parseMemoMarkdown} from '../core/data.js';
 import {safeURL} from '../views/context.js';
 import Button from './Button.svelte';
 let {memo,t,renderMarkdown,renderBlockDOM,openBlock,choose,onmenu,onimage,review=false}=$props();
 let card,body,collapsed=$state(true),clipped=$state(false);
 let parsed=$derived(parseMemoMarkdown(memo.markdown));
 let date=$derived(String(memo.created||''));
 let rendered=$derived.by(()=>{if(!renderMarkdown)return {html:'',hasTags:false};const template=document.createElement('template');template.innerHTML=renderBlockDOM?renderBlockDOM(memo.dom):renderMarkdown(parsed.text);template.content.querySelectorAll('a').forEach(a=>{const href=safeURL(a.getAttribute('href'));if(href){a.href=href;a.rel='noopener noreferrer';a.target='_blank';}else a.removeAttribute('href');});template.content.querySelectorAll('img,iframe,object,embed,script,style,form,input,button').forEach(e=>e.remove());let hasTags=false;template.content.querySelectorAll('[data-type="tag"],em').forEach(node=>{const tag=node.textContent.replace(/^#|#$/g,'');if(node.tagName==='EM'&&(!(memo.tags||[]).includes(tag)||node.textContent!=='#'+tag+'#'))return;const button=document.createElement('button');button.type='button';button.className='qm-inline-tag';button.textContent='#'+tag;button.dataset.tag=tag;node.replaceWith(button);hasTags=true;});return {html:template.innerHTML,hasTags};});
 $effect(()=>{rendered;tick().then(()=>{if(body&&collapsed)clipped=body.scrollHeight>body.clientHeight+12;});});
 function context(event){const selection=card.ownerDocument.defaultView.getSelection();const text=selection&&!selection.isCollapsed&&card.contains(selection.anchorNode)&&card.contains(selection.focusNode)?selection.toString():'';if(!text&&event.target.closest('a,.qm-image-button'))return;event.preventDefault();event.stopPropagation();onmenu(memo,card,event,text);}
</script>
<article bind:this={card} class="qm-card" class:qm-review-card={review} data-id={memo.id} tabindex="-1" oncontextmenu={context}>
 <div class="qm-card-header"><time>{date.length>=12?`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)} ${date.slice(8,10)}:${date.slice(10,12)}`:date}</time><Button label={t('memoActions')} icon="more" class="qm-card-more" onclick={e=>onmenu(memo,e.currentTarget)}/></div>
 {#if memo.type==='d'}<Button label={t('openNative')} class="qm-document-title" onclick={()=>openBlock(memo.id)}>{memo.source}</Button>{/if}
 {#if memo.external&&memo.type!=='d'&&!memo.qingmoDay}<Button label={t('source',{title:memo.source||''})} class="qm-source" onclick={()=>openBlock(memo.id)}/>{/if}
 <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
 <div bind:this={body} class="qm-body" class:qm-collapsed={collapsed&&!review} class:qm-clipped={clipped&&!review} onclick={e=>{const tag=e.target.closest('[data-tag]');if(tag)choose({tag:tag.dataset.tag});}}>{#if renderMarkdown}{@html rendered.html}{:else}{parsed.text}{/if}</div>
 {#if clipped&&!review}<Button label={t(collapsed?'expand':'collapse')} class="qm-expand" aria-expanded={!collapsed} onclick={()=>collapsed=!collapsed}/>{/if}
 {#if memo.type==='d'||!rendered.hasTags}<div class="qm-card-tags">{#each memo.tags||[] as tag}<button type="button" class="qm-inline-tag" onclick={()=>choose({tag})}>#{tag}</button>{/each}</div>{/if}
 <div class="qm-images">{#each (memo.images||parsed.images).filter(p=>safeURL(p,true)) as path}<Button label={t('viewImage')} class="qm-image-button" onclick={()=>onimage(safeURL(path,true))}><img src={safeURL(path,true)} alt={t('attachedImage')} loading="lazy"/></Button>{/each}</div>
</article>
