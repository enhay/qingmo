<script>
 import {getContext,onMount} from 'svelte';
 import {CONTEXT} from './context.js';
 import Button from '../components/Button.svelte';
 import Icon from '../components/Icon.svelte';
 const scopeId=$props.id();
 const {options}=getContext(CONTEXT),{repository,t}=options;
 let {initial={},count,onapply,onclose}=$props();
 let scope=$state({tag:'',start:'',end:''}),amount=$state(5),tags=$state([]),query=$state(''),matches=$state(null),failed=$state(false),saving=$state(false),serial=0,selecting=$state(false);
 let invalid=$derived(!!scope.start&&!!scope.end&&scope.start>scope.end);
 onMount(()=>{scope={tag:initial.tag||'',start:initial.start||'',end:initial.end||''};amount=count||5;let live=true;repository.stats().then(value=>{if(live)tags=value.tags||[];}).catch(()=>{if(live)failed=true;});return()=>{live=false;serial++;};});
 $effect(()=>{const value={...scope},token=++serial;matches=null;failed=false;if(!invalid)repository.rangeIds(value).then(ids=>{if(token===serial)matches=ids.length;}).catch(()=>{if(token===serial)failed=true;});});
 async function apply(){saving=true;try{await onapply({...scope},Math.max(1,Math.min(50,Math.trunc(Number(amount))||5)));}catch{failed=true;}finally{saving=false;}}
</script>
<div class="qm-settings qm-scope">
 {#if selecting}<div class="qm-scope-tag-heading"><Button label={t('back')} icon="chevron" onclick={()=>selecting=false}/><input type="search" aria-label={t('findTag')} placeholder={t('findTag')} bind:value={query}/></div><div class="qm-scope-tag-list"><Button label={t('scopeAll')} class="qm-scope-tag" aria-pressed={!scope.tag} onclick={()=>{scope.tag='';selecting=false;}}><span>{t('scopeAll')}</span>{#if !scope.tag}<Icon name="check"/>{/if}</Button>{#each tags.filter(x=>x.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) as tag}<Button label={tag.name} class="qm-scope-tag" aria-pressed={scope.tag===tag.name} onclick={()=>{scope.tag=tag.name;selecting=false;}}><span>#{tag.name} ({tag.count})</span>{#if scope.tag===tag.name}<Icon name="check"/>{/if}</Button>{/each}</div>
 {:else}<div class="qm-scope-reset"><Button label={t('resetScope')} onclick={()=>scope={tag:'',start:'',end:''}}/></div><div class="qm-scope-fields"><Button label={t('tag')} class="qm-scope-row" onclick={()=>selecting=true}><span>{t('tag')}</span><span>{scope.tag?'#'+scope.tag:t('scopeAll')}</span><Icon name="chevron"/></Button>
 {#each ['start','end'] as key}<div class="qm-scope-row"><label for={scopeId+'-'+key}>{t(key==='start'?'startDate':'endDate')}</label><input id={scopeId+'-'+key} type="date" bind:value={scope[key]} aria-invalid={invalid}/><Button label={t('clearDate')} icon="close" onclick={()=>scope[key]=''}/></div>{/each}
 {#if count!==undefined}<div class="qm-scope-row"><label for={scopeId+'-count'}>{t('reviewCount')}</label><input id={scopeId+'-count'} type="number" min="1" max="50" bind:value={amount}/></div>{/if}</div>
 {#if invalid}<p role="alert">{t('invalidDates')}</p>{:else if failed}<p role="alert">{t('scopeFailed')}</p>{:else if matches!==null}<p>{t('scopeCount',{count:matches})}</p>{/if}
 <div class="qm-scope-actions"><Button label={t('cancel')} onclick={onclose}/><Button label={t('applyScope')} class="qm-primary" disabled={invalid||matches===null||saving} onclick={apply}/></div>{/if}
</div>
<style>
 .qm-scope-reset{display:flex;justify-content:flex-end;color:var(--qm-link);margin-top:-12px}.qm-scope-fields,.qm-scope-tag-list{background:var(--qm-surface);border-radius:12px;padding:0 12px}.qm-scope :global(.qm-scope-row){display:flex;align-items:center;gap:8px;min-height:52px;width:100%;text-align:left}.qm-scope :global(.qm-scope-row+.qm-scope-row){border-top:1px solid var(--qm-border)}.qm-scope-row label{margin:0;white-space:nowrap;flex:1}.qm-scope-row input{width:auto;min-width:0;max-width:160px;margin:0;height:44px;border:0;background:transparent;color:var(--qm-text-secondary)}.qm-scope-row input[type=number]{max-width:80px}.qm-scope-row input[aria-invalid=true]{color:var(--qm-danger)}.qm-scope :global(.qm-scope-row>span:first-child){flex:1}.qm-scope :global(.qm-scope-row>span:nth-child(2)){color:var(--qm-text-secondary);max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.qm-scope>p{font-size:13px;color:var(--qm-text-secondary);padding:0 12px}.qm-scope>p[role=alert]{color:var(--qm-danger)}.qm-scope-actions{display:flex;gap:12px}.qm-scope-actions :global(button){flex:1;min-height:48px;margin:0;border-radius:12px;background:var(--qm-fill)}.qm-scope-tag-heading{display:flex;align-items:center;gap:8px;margin-bottom:12px}.qm-scope-tag-heading input{margin:0;height:36px}.qm-scope :global(.qm-scope-tag){width:100%;display:flex;justify-content:space-between;text-align:left;min-height:44px;gap:12px}.qm-scope :global(.qm-scope-tag[aria-pressed=true]){color:var(--qm-brand)}.qm-scope-tag-list{max-height:55vh;overflow:auto}
</style>
