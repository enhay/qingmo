<script>
 import {getContext} from 'svelte';
 import {CONTEXT,displayDay} from './context.js';
 import Button from '../components/Button.svelte';
 import Icon from '../components/Icon.svelte';
 const {options}=getContext(CONTEXT),{t,mode='fullscreen',onClose}=options;
 let {stats,filter,choose,openReview,showSettings,flushDraft}=$props();
 let expanded=$state(false);
 let allSelected=$derived(filter.kind==='all'&&!filter.tag&&!filter.day&&!filter.keyword&&filter.source==='all');
 let nodes=$derived.by(()=>{const nodes=new Map();(stats.tags||[]).forEach(tag=>{tag.name.split('/').forEach((_,i,parts)=>{const name=parts.slice(0,i+1).join('/');if(!nodes.has(name))nodes.set(name,{name,count:0,depth:i});});nodes.get(tag.name).count=tag.count;});return [...nodes.values()].sort((a,b)=>a.name.localeCompare(b.name));});
 let heat=$derived.by(()=>{const today=new Date();today.setHours(0,0,0,0);const start=new Date(today);start.setDate(start.getDate()-start.getDay()-77);const map=new Map((stats.heatmap||[]).map(x=>[x.date,x.count]));let previous=-1;return Array.from({length:12},(_,week)=>{let label='';const days=Array.from({length:7},(_,day)=>{const date=new Date(start);date.setDate(start.getDate()+week*7+day);const key=`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`,count=map.get(key)||0;if(date<=today&&date.getMonth()!==previous){label=t('month',{month:date.getMonth()+1});previous=date.getMonth();}return {key,count,disabled:date>today,today:+date===+today,level:count===0?0:count<=2?1:count<=5?2:count<=9?3:4};});return {days,label};});});
 const today=new Date(),max=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
</script>
<div class="qm-side-top"><strong>{t('appName')}</strong><div class="qm-side-actions"><Button label={t('settings')} icon="settings" onclick={()=>showSettings()}/>{#if mode==='fullscreen'}<Button label={t('close')} icon="exit" onclick={()=>{flushDraft();onClose?.();}}/>{/if}</div></div>
<div class="qm-counts">{#each [['memoCount','notes'],['tagCount','tags'],['dayCount','days']] as [key,label]}<div><strong>{stats[key]||0}</strong><span>{t(label)}</span></div>{/each}</div>
<div class="qm-heatmap">{#each heat as week}<div class="qm-heat-week">{#each week.days as day}<button type="button" class="qm-heat-cell" class:qm-today={day.today} data-level={day.level} disabled={day.disabled} aria-label={t('heatDay',{date:displayDay(day.key),count:day.count})} title={t('heatDay',{date:displayDay(day.key),count:day.count})} aria-pressed={filter.day===day.key} onclick={()=>choose({day:filter.day===day.key?'':day.key})}></button>{/each}</div>{/each}</div>
<div class="qm-months">{#each heat as week}<span>{week.label}</span>{/each}<input class="qm-date-filter" type="date" {max} aria-label={t('filterDate')} title={t('filterDate')} value={displayDay(filter.day)} onchange={e=>choose({day:e.currentTarget.value.replace(/-/g,'')})}/></div>
<nav class="qm-nav"><Button label={t('review')} icon="grid" class="qm-nav-row" onclick={()=>openReview('views')}><span>{t('review')}</span></Button>
 <div class="qm-nav-row qm-nav-all" class:qm-selected={allSelected}><Button label={t('noteFilters')} class="qm-nav-disclosure" aria-expanded={expanded} onclick={()=>expanded=!expanded}><Icon name="grid"/><Icon name="triangle"/></Button><Button label={t('all')} class="qm-nav-label" aria-pressed={allSelected} onclick={()=>choose({keyword:'',tag:'',kind:'all',day:'',source:'all'})}/></div>
 <div class="qm-nav-children" hidden={!expanded}>{#each ['untagged','image','link'] as kind}<Button label={t(kind)} icon={kind==='image'?'image':kind==='link'?'link':'tag'} class={'qm-nav-row qm-nav-child'+(filter.kind===kind?' qm-selected':'')} aria-pressed={filter.kind===kind} onclick={()=>choose({kind})}><span>{t(kind)}</span></Button>{/each}</div>
</nav>
<div class="qm-tag-heading">{t('tags')}</div><div class="qm-tag-tree">{#each nodes as tag}<button type="button" class="qm-tag-row" class:qm-selected={filter.tag===tag.name} style:padding-left={30+tag.depth*16+'px'} aria-pressed={filter.tag===tag.name} aria-label={'#'+tag.name} onclick={()=>choose({tag:filter.tag===tag.name?'':tag.name})}><span>#{tag.name.split('/').pop()}</span><span class="qm-tag-count">{tag.count||''}</span></button>{/each}</div>
