<script>
 import Button from './Button.svelte';
 import {safeURL} from '../views/context.js';
 let {path,t,pending=false}=$props();
 let audio,playing=$state(false),duration=$state(null),elapsed=$state(0),failed=$state(false);
 const clock=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
 async function toggle(){if(!audio)return;if(playing)audio.pause();else try{failed=false;await audio.play();}catch{failed=true;}}
</script>
<div class="qm-audio-player" data-state={failed?'error':playing?'playing':'paused'}>
 <audio bind:this={audio} src={safeURL(path,true)} preload="metadata" ondurationchange={()=>duration=Number.isFinite(audio.duration)?audio.duration:null} ontimeupdate={()=>elapsed=audio.currentTime} onplay={()=>playing=true} onpause={()=>playing=false} onended={()=>playing=false} onerror={()=>failed=true}></audio>
 <Button label={t(playing?'pauseAudio':'playAudio')} icon={playing?'pause':'play'} onclick={toggle}/><span>{playing?clock(elapsed):duration===null?'—:—':clock(duration)}</span>
 <span class="qm-audio-wave" aria-hidden="true">{#each [8,14,20,12,18,24,16,10,20,14,8,18] as height}<i style:height={height+'px'}></i>{/each}</span>
 {#if failed}<span role="status">{t('audioPlaybackFailed')}</span>{:else if pending}<span>{t('pendingTranscription')}</span>{/if}
</div>
<style>
 .qm-audio-player{display:flex;align-items:center;gap:8px;min-width:0;min-height:40px;border-radius:8px;padding:0 8px;background:var(--qm-bg);color:var(--qm-text-secondary);margin:6px 0;font-size:12px;font-variant-numeric:tabular-nums}.qm-audio-player audio{display:none}.qm-audio-player :global(button){flex-shrink:0}.qm-audio-wave{display:flex;gap:2px;align-items:center;flex:1;min-width:12px;overflow:hidden}.qm-audio-wave i{flex:0 0 2px;background:var(--qm-text-secondary);border-radius:2px}.qm-audio-player>span:last-child{overflow-wrap:anywhere}
</style>
