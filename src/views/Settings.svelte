<script>
 import {getContext,onMount} from 'svelte';
 import {CONTEXT} from './context.js';
 import {DEFAULT_SETTINGS} from '../core/data.js';
 import {transcribeWav,pcmToWav,audioErrorCode} from '../core/transcription.js';
 import Button from '../components/Button.svelte';
 const {options,shared}=getContext(CONTEXT),{repository,t}=options;
 let {first=false,review=false,onclose,onnotify,onsaved}= $props();
 let editing=$state({}),testing=$state(false),testResult=$state(''),testController;
 let books=$state([]),saving=$state(false),draft=$state({}),initial=$state({});
 onMount(()=>{initial=review?{reviewCount:shared.settings.reviewCount||DEFAULT_SETTINGS.reviewCount}:{notebook:shared.settings.notebook||'',pathTemplate:shared.settings.pathTemplate||DEFAULT_SETTINGS.pathTemplate,openOnStartup:!!shared.settings.openOnStartup,floatingButton:!!shared.settings.floatingButton,tencentSecretId:shared.settings.tencentSecretId||'',tencentSecretKey:shared.settings.tencentSecretKey||''};draft={...initial};let live=true;if(!review)repository.getNotebooks().then(value=>{if(live)books=value;}).catch(()=>{if(live)onnotify('notebooksFailed');});return ()=>{live=false;testController?.abort();};});
 async function save(e){e.preventDefault();if(review)draft.reviewCount=Math.max(1,Math.min(50,Math.trunc(Number(draft.reviewCount))||DEFAULT_SETTINGS.reviewCount));else if(!draft.notebook)return;const patch=Object.fromEntries(Object.entries(draft).filter(([key,value])=>value!==initial[key]));saving=true;try{await shared.saveSettings(patch);const wasFirst=first;onclose();onsaved?.(wasFirst);}catch{saving=false;onnotify('settingsFailed');}}
async function test(){testing=true;testResult='';testController=new AbortController();try{await transcribeWav(pcmToWav(new Float32Array(16000),16000),{secretId:draft.tencentSecretId,secretKey:draft.tencentSecretKey,request:options.request,signal:testController.signal});if(!testController.signal.aborted)testResult='credentialsReady';}catch(e){if(!testController.signal.aborted)testResult='audioError_'+audioErrorCode(e);}finally{testing=false;}}
</script>
{#if first}<p>{t('chooseNotebook')}</p>{/if}
<form class="qm-settings" onsubmit={save}>
 {#if review}<label>{t('reviewCount')}<input type="number" min="1" max="50" bind:value={draft.reviewCount}/></label>
 {:else}<h3>{t('settingsRecord')}</h3><label>{t('notebook')}<select required bind:value={draft.notebook} aria-label={t('notebook')}><option value="">{t('chooseNotebook')}</option>{#each books as book}<option value={book.id}>{book.name}</option>{/each}</select></label>
 <label>{t('pathTemplate')}<input required bind:value={draft.pathTemplate}/></label><p class="qm-setting-note">{t('settingsExplanation')}</p>
 <label class="qm-checkbox"><input type="checkbox" bind:checked={draft.openOnStartup}/>{t('startup')}</label><label class="qm-checkbox"><input type="checkbox" bind:checked={draft.floatingButton}/>{t('floatingButton')}</label>
 <section aria-label={t('settingsTranscription')}><h3>{t('settingsTranscription')}</h3>{#each ['tencentSecretId','tencentSecretKey'] as key}<label>{key==='tencentSecretId'?'SecretId':'SecretKey'}{#if initial[key]&&!editing[key]}<span>{'••••••••'+initial[key].slice(-4)}</span><Button label={t('modifyCredential')} onclick={()=>{editing[key]=true;draft[key]='';testResult='';}}/>{:else}<input type={key==='tencentSecretKey'?'password':'text'} autocomplete="off" bind:value={draft[key]}/>{/if}<Button label={t('clearCredential')} onclick={()=>{editing[key]=true;draft[key]='';testResult='';}}/></label>{/each}<Button label={t('testCredentials')} disabled={testing||!draft.tencentSecretId||!draft.tencentSecretKey} onclick={test}/><p role="status">{testResult?t(testResult):''}</p><p class="qm-setting-note">{t('credentialTestCost')}</p><p class="qm-setting-note">{t('credentialSecurity')}</p><p class="qm-setting-note">{t('credentialBilling')}</p><p class="qm-setting-note">{t('credentialSync')}</p></section>
 {/if}<Button label={t('saveSettings')} type="submit" class="qm-primary" disabled={saving}/>
</form>
