<script>
 import {getContext,onMount} from 'svelte';
 import {CONTEXT} from './context.js';
 import {DEFAULT_SETTINGS} from '../core/data.js';
 import Button from '../components/Button.svelte';
 const {options,shared}=getContext(CONTEXT),{repository,t}=options;
 let {first=false,review=false,onclose,onnotify,onsaved}= $props();
 let books=$state([]),saving=$state(false),draft=$state({}),initial={};
 onMount(()=>{initial=review?{reviewCount:shared.settings.reviewCount||DEFAULT_SETTINGS.reviewCount}:{notebook:shared.settings.notebook||'',pathTemplate:shared.settings.pathTemplate||DEFAULT_SETTINGS.pathTemplate,openOnStartup:!!shared.settings.openOnStartup,floatingButton:!!shared.settings.floatingButton};draft={...initial};let live=true;if(!review)repository.getNotebooks().then(value=>{if(live)books=value;}).catch(()=>{if(live)onnotify('notebooksFailed');});return ()=>{live=false;};});
 async function save(e){e.preventDefault();if(review)draft.reviewCount=Math.max(1,Math.min(50,Math.trunc(Number(draft.reviewCount))||DEFAULT_SETTINGS.reviewCount));else if(!draft.notebook)return;const patch=Object.fromEntries(Object.entries(draft).filter(([key,value])=>value!==initial[key]));saving=true;try{await shared.saveSettings(patch);const wasFirst=first;onclose();onsaved?.(wasFirst);}catch{saving=false;onnotify('settingsFailed');}}
</script>
{#if first}<p>{t('chooseNotebook')}</p>{/if}
<form class="qm-settings" onsubmit={save}>
 {#if review}<label>{t('reviewCount')}<input type="number" min="1" max="50" bind:value={draft.reviewCount}/></label>
 {:else}<h3>{t('settingsRecord')}</h3><label>{t('notebook')}<select required bind:value={draft.notebook} aria-label={t('notebook')}><option value="">{t('chooseNotebook')}</option>{#each books as book}<option value={book.id}>{book.name}</option>{/each}</select></label>
 <label>{t('pathTemplate')}<input required bind:value={draft.pathTemplate}/></label><p class="qm-setting-note">{t('settingsExplanation')}</p>
 <label class="qm-checkbox"><input type="checkbox" bind:checked={draft.openOnStartup}/>{t('startup')}</label><label class="qm-checkbox"><input type="checkbox" bind:checked={draft.floatingButton}/>{t('floatingButton')}</label>
 <section aria-label={t('settingsTranscription')} data-state="reserved"></section>
 {/if}<Button label={t('saveSettings')} type="submit" class="qm-primary" disabled={saving}/>
</form>
