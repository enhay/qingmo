<script>
 import {getContext,onMount} from 'svelte';
 import {CONTEXT} from './context.js';
 import Button from '../components/Button.svelte';
 const {options}=getContext(CONTEXT),{repository,t}=options;
 let {initial={},count,onapply,onclose}=$props();
 let scope=$state({tag:'',start:'',end:''}),amount=$state(5),tags=$state([]),query=$state(''),matches=$state(null),failed=$state(false),saving=$state(false),serial=0;
 let invalid=$derived(!!scope.start&&!!scope.end&&scope.start>scope.end);
 onMount(()=>{scope={tag:initial.tag||'',start:initial.start||'',end:initial.end||''};amount=count||5;let live=true;repository.stats().then(value=>{if(live)tags=value.tags||[];}).catch(()=>{if(live)failed=true;});return()=>{live=false;serial++;};});
 $effect(()=>{const value={...scope},token=++serial;matches=null;failed=false;if(!invalid)repository.rangeIds(value).then(ids=>{if(token===serial)matches=ids.length;}).catch(()=>{if(token===serial)failed=true;});});
 async function apply(){saving=true;try{await onapply({...scope},Math.max(1,Math.min(50,Math.trunc(Number(amount))||5)));}catch{failed=true;}finally{saving=false;}}
</script>
<div class="qm-settings qm-scope"><Button label={t('resetScope')} onclick={()=>scope={tag:'',start:'',end:''}}/><label>{t('findTag')}<input type="search" bind:value={query}/></label><label>{t('tag')}<select bind:value={scope.tag}><option value="">{t('scopeAll')}</option>{#if scope.tag&&!tags.some(x=>x.name===scope.tag)}<option value={scope.tag}>{scope.tag}</option>{/if}{#each tags.filter(x=>x.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())||x.name===scope.tag) as tag}<option value={tag.name}>{tag.name} ({tag.count})</option>{/each}</select></label>
 {#each ['start','end'] as key}<label>{t(key==='start'?'startDate':'endDate')}<input type="date" bind:value={scope[key]} aria-invalid={invalid}/><Button label={t('clearDate')} onclick={()=>scope[key]=''}/></label>{/each}
 {#if count!==undefined}<label>{t('reviewCount')}<input type="number" min="1" max="50" bind:value={amount}/></label>{/if}
 {#if invalid}<p role="alert">{t('invalidDates')}</p>{:else if failed}<p role="alert">{t('scopeFailed')}</p>{:else if matches!==null}<p>{t('scopeCount',{count:matches})}</p>{/if}
 <div class="qm-scope-actions"><Button label={t('cancel')} onclick={onclose}/><Button label={t('applyScope')} class="qm-primary" disabled={invalid||matches===null||saving} onclick={apply}/></div>
</div>
<style>.qm-scope-actions{display:flex;gap:12px}.qm-scope-actions :global(button){flex:1;min-height:44px}</style>
