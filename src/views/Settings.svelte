<script>
 import {getContext,onMount} from 'svelte';
 import {CONTEXT} from './context.js';
 import {DEFAULT_SETTINGS} from '../core/data.js';
 import {transcribeWav,pcmToWav,audioErrorCode} from '../core/transcription.js';
 import Button from '../components/Button.svelte';
 import Icon from '../components/Icon.svelte';
 const {options,shared}=getContext(CONTEXT),{repository,t}=options;
 let {first=false,review=false,onclose,onnotify,onsaved}= $props();
 const uid=$props.id();
 let tab=$state('general');
 let editing=$state({}),testing=$state(false),testResult=$state(''),testController;
 let books=$state([]),saving=$state(false),draft=$state({}),initial=$state({});
 onMount(()=>{initial=review?{reviewCount:shared.settings.reviewCount||DEFAULT_SETTINGS.reviewCount}:{notebook:shared.settings.notebook||'',pathTemplate:shared.settings.pathTemplate||DEFAULT_SETTINGS.pathTemplate,openOnStartup:!!shared.settings.openOnStartup,floatingButton:!!shared.settings.floatingButton,tencentSecretId:shared.settings.tencentSecretId||'',tencentSecretKey:shared.settings.tencentSecretKey||''};draft={...initial};let live=true;if(!review)repository.getNotebooks().then(value=>{if(live)books=value;}).catch(()=>{if(live)onnotify('notebooksFailed');});return ()=>{live=false;testController?.abort();};});
 function switchTab(next){tab=next;}
 function tabKey(e){const keys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(e.key))return;e.preventDefault();tab=e.key==='Home'?'general':e.key==='End'?'transcription':tab==='general'?'transcription':'general';e.currentTarget.querySelector('[data-tab="'+tab+'"]')?.focus();}
 async function save(e){e.preventDefault();if(review)draft.reviewCount=Math.max(1,Math.min(50,Math.trunc(Number(draft.reviewCount))||DEFAULT_SETTINGS.reviewCount));else if(!draft.notebook||!draft.pathTemplate?.trim()){tab='general';return;}const patch=Object.fromEntries(Object.entries(draft).filter(([key,value])=>value!==initial[key]));saving=true;try{await shared.saveSettings(patch);const wasFirst=first;onclose();onsaved?.(wasFirst);}catch{saving=false;onnotify('settingsFailed');}}
async function test(){testing=true;testResult='';testController=new AbortController();try{await transcribeWav(pcmToWav(new Float32Array(16000),16000),{secretId:draft.tencentSecretId,secretKey:draft.tencentSecretKey,request:options.request,signal:testController.signal});if(!testController.signal.aborted)testResult='credentialsReady';}catch(e){if(!testController.signal.aborted)testResult='audioError_'+audioErrorCode(e);}finally{testing=false;}}
</script>
<form class="qm-settings" class:qm-settings-review={review} onsubmit={save}>
 {#if !review}<aside class="qm-settings-nav">
  <div class="qm-settings-caption">{t('settings')}</div>
  <div role="tablist" aria-orientation="vertical" tabindex="-1" aria-label={t('settings')} onkeydown={tabKey}>
   {#each [['general','settingsGeneral','settings'],['transcription','settingsTranscription','audio']] as [key,label,icon]}<button type="button" role="tab" id={uid+'-'+key} data-tab={key} aria-controls={uid+'-'+key+'-panel'} aria-selected={tab===key} tabindex={tab===key?0:-1} onclick={()=>switchTab(key)}><Icon name={icon}/><span>{t(label)}</span></button>{/each}
  </div>
 </aside>{/if}
 <div class="qm-settings-main">
  {#if !review}<header class="qm-settings-heading"><h2>{t(tab==='general'?'settingsGeneral':'settingsTranscription')}</h2><Button label={t('closeDialog')} icon="close" onclick={onclose}/></header>{/if}
  <div class="qm-settings-content">
  {#if first}<p class="qm-setting-note">{t('chooseNotebook')}</p>{/if}
  {#if review}<label>{t('reviewCount')}<input type="number" min="1" max="50" bind:value={draft.reviewCount}/></label>
  {:else}
   <div id={uid+'-general-panel'} role="tabpanel" aria-labelledby={uid+'-general'} hidden={tab!=='general'} tabindex="0">
    <h3>{t('settingsRecord')}</h3>
    <div class="qm-settings-group">
     <label class="qm-setting-row"><span>{t('notebook')}</span><select required={tab==='general'} bind:value={draft.notebook} aria-label={t('notebook')}><option value="">{t('chooseNotebook')}</option>{#each books as book}<option value={book.id}>{book.name}</option>{/each}</select></label>
     <label class="qm-setting-row"><span>{t('pathTemplate')}</span><input required={tab==='general'} bind:value={draft.pathTemplate}/></label>
    </div>
    <p class="qm-setting-note">{t('settingsExplanation')}</p>
    <h3>{t('settingsBehavior')}</h3>
    <div class="qm-settings-group">
     <label class="qm-setting-row qm-setting-switch"><span>{t('startup')}</span><input type="checkbox" role="switch" bind:checked={draft.openOnStartup}/></label>
     <label class="qm-setting-row qm-setting-switch"><span>{t('floatingButton')}</span><input type="checkbox" role="switch" bind:checked={draft.floatingButton}/></label>
    </div>
   </div>
   <div id={uid+'-transcription-panel'} role="tabpanel" aria-labelledby={uid+'-transcription'} hidden={tab!=='transcription'} tabindex="0">
    <h3>{t('settingsTencent')}</h3>
    <div class="qm-settings-group">
    {#each ['tencentSecretId','tencentSecretKey'] as key}<div class="qm-credential" role="group" aria-label={key==='tencentSecretId'?'SecretId':'SecretKey'}>
     <span class="qm-credential-label">{key==='tencentSecretId'?'SecretId':'SecretKey'}</span>
     <div class="qm-credential-value">{#if initial[key]&&!editing[key]}<span>{'••••••••'+initial[key].slice(-4)}</span><Button label={t('modifyCredential')} onclick={()=>{editing[key]=true;draft[key]='';testResult='';}}/>{:else}<input aria-label={key==='tencentSecretId'?'SecretId':'SecretKey'} type={key==='tencentSecretKey'?'password':'text'} autocomplete="off" bind:value={draft[key]}/>{/if}<Button label={t('clearCredential')} onclick={()=>{editing[key]=true;draft[key]='';testResult='';}}/></div>
    </div>{/each}
    </div>
    <div class="qm-credential-test"><Button class="qm-test-credentials" label={t('testCredentials')} disabled={testing||!draft.tencentSecretId||!draft.tencentSecretKey} onclick={test}/><p role="status" class:qm-credential-ok={testResult==='credentialsReady'}>{testResult?t(testResult):''}</p></div>
    <p class="qm-setting-note">{t('credentialTestCost')}</p><p class="qm-setting-note">{t('credentialSecurity')}</p><p class="qm-setting-note">{t('credentialBilling')}</p><p class="qm-setting-note">{t('credentialSync')}</p>
   </div>
  {/if}
  </div>
  <footer class="qm-settings-footer"><Button label={t('saveSettings')} type="submit" class="qm-primary" disabled={saving}/></footer>
 </div>
</form>

<style>
 .qm-settings{display:grid;grid-template-columns:180px minmax(0,1fr);height:100%;min-height:0}
 .qm-settings-review{display:block}
 .qm-settings-nav{padding:24px 12px;background:var(--qm-surface);border-right:1px solid var(--qm-border)}
 .qm-settings-caption{padding:0 12px 24px;color:var(--qm-text-secondary);font-size:14px}
 .qm-settings-nav [role=tablist]{display:flex;flex-direction:column;gap:8px}
 .qm-settings-nav button{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--qm-text);font:inherit;text-align:left;cursor:pointer}
 .qm-settings-nav button :global(svg){width:20px;height:20px;flex-shrink:0}
 .qm-settings-nav button[aria-selected=true]{background:var(--qm-brand);color:var(--qm-on-brand);font-weight:600}
 .qm-settings-nav button:focus-visible{outline:2px solid var(--qm-brand);outline-offset:2px}
 .qm-settings-main{min-width:0;min-height:0;display:flex;flex-direction:column}
 .qm-settings-heading{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;flex-shrink:0}
 .qm-settings-heading h2{margin:0;font-size:22px;font-weight:600}
 .qm-settings-content{padding:8px 24px 24px;overflow:auto;min-height:0;flex:1}
 .qm-settings [role=tabpanel][hidden]{display:none}
 .qm-settings h3{font-size:13px;font-weight:400;color:var(--qm-text-secondary);margin:24px 16px 10px}
 .qm-settings-group{background:var(--qm-surface);border-radius:12px;overflow:hidden}
 .qm-settings .qm-setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;min-height:64px;margin:0;padding:10px 16px}
 .qm-setting-row>span{flex-shrink:0}
 .qm-settings .qm-setting-row input:not([type=checkbox]),.qm-settings .qm-setting-row select{width:56%;min-width:0;margin:0;background:transparent;border-color:transparent;text-align:right;color:var(--qm-text-secondary)}
 .qm-settings .qm-setting-row input:focus,.qm-settings .qm-setting-row select:focus{border-color:var(--qm-brand);outline:none}
 .qm-settings .qm-setting-switch input{appearance:none;position:relative;flex:0 0 40px;width:40px;height:24px;border:0;border-radius:20px;background:var(--qm-fill);cursor:pointer;margin:10px 0}
 .qm-setting-switch input:checked{background:var(--qm-brand)}
 .qm-setting-switch input:before{content:'';position:absolute;width:20px;height:20px;top:2px;left:2px;border-radius:50%;background:var(--qm-on-brand)}
 .qm-setting-switch input:checked:before{transform:translateX(16px)}
 .qm-setting-switch input:focus-visible{outline:2px solid var(--qm-brand);outline-offset:3px}
 .qm-settings-footer{padding:16px 24px;display:flex;justify-content:flex-end;flex-shrink:0}
 .qm-settings-footer :global(button){min-height:44px;padding:0 24px}
 .qm-credential{padding:16px}
 .qm-credential-label{font-size:14px;color:var(--qm-text)}
 .qm-credential-value{display:flex;align-items:center;gap:8px;min-height:44px;margin-top:8px}
 .qm-settings .qm-credential-value input{flex:1;min-width:0;width:auto;margin:0;background:transparent}
 .qm-credential-value>span{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--qm-text-secondary)}
 .qm-credential :global(button){color:var(--qm-link);min-height:44px;padding:0 8px}
 .qm-credential-test{display:flex;align-items:center;gap:12px;margin:20px 0 8px;flex-wrap:wrap}
 .qm-credential-test :global(.qm-test-credentials){min-height:44px;border-radius:8px;background:var(--qm-brand-tint);color:var(--qm-brand);padding:0 16px;flex-shrink:0}
 .qm-credential-test p{font-size:13px;color:var(--qm-danger)}
 .qm-credential-test p.qm-credential-ok{color:var(--qm-brand)}
 .qm-setting-note{font-size:12px;line-height:20px;margin:10px 16px;color:var(--qm-text-secondary)}
 :global(.qm-root[data-layout=mobile]) .qm-settings{grid-template-columns:96px minmax(0,1fr)}
 :global(.qm-root[data-layout=mobile]) .qm-settings-nav{padding:16px 8px}
 :global(.qm-root[data-layout=mobile]) .qm-settings-caption{padding:4px 8px 20px}
 :global(.qm-root[data-layout=mobile]) .qm-settings-nav button{gap:6px;padding:0 8px;font-size:14px}
 :global(.qm-root[data-layout=mobile]) .qm-settings-nav button :global(svg){width:16px;height:16px}
 :global(.qm-root[data-layout=mobile]) .qm-settings-heading{padding:12px}
 :global(.qm-root[data-layout=mobile]) .qm-settings-heading h2{font-size:18px}
 :global(.qm-root[data-layout=mobile]) .qm-settings-content{padding:0 12px 12px}
 :global(.qm-root[data-layout=mobile]) .qm-setting-row:not(.qm-setting-switch){align-items:stretch;flex-direction:column;gap:4px}
 :global(.qm-root[data-layout=mobile]) .qm-setting-row input:not([type=checkbox]),:global(.qm-root[data-layout=mobile]) .qm-setting-row select{width:100%;text-align:left}
 :global(.qm-root[data-layout=mobile]) .qm-setting-row>span{flex-shrink:1}
 :global(.qm-root[data-layout=mobile]) .qm-setting-switch{gap:12px;font-size:14px}
 :global(.qm-root[data-layout=mobile]) .qm-credential-value{flex-wrap:wrap}
 :global(.qm-root[data-layout=mobile]) .qm-credential-value input{flex-basis:100%}
 :global(.qm-root[data-layout=mobile]) .qm-settings-footer{padding:12px}
</style>
