<script>
 import {onMount,tick} from 'svelte';
 import Button from './Button.svelte';
 let {label,closeLabel,onclose,children,actions=false,class:className='',anchor,point,root,state:dialogState,selected=false}=$props();
 let panel,backdrop,left=$state(8),top=$state(8);
 onMount(()=>{tick().then(()=>{
  if(actions&&root){
   const r=root.getBoundingClientRect(),a=anchor?.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight;
   const x=point?point.x-r.left:className==='qm-list-menu'?a.left-r.left:a.right-r.left-width;
   const below=a?a.bottom-r.top+6:8;
   const y=point?point.y-r.top:below+height<=r.height-8?below:a.top-r.top-height-6;
   left=Math.max(8,Math.min(x,r.width-width-8));top=Math.max(8,Math.min(y,r.height-height-8));
  }
  panel.querySelector('button,input,select')?.focus();
 });});
 function keyboard(e){if(actions&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...panel.querySelectorAll('button:not(:disabled)')];let i=buttons.indexOf(panel.ownerDocument.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[i]?.focus();}}
</script>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={backdrop} class:qm-action-backdrop={actions} class="qm-modal-backdrop" onclick={e=>{if(e.target===backdrop)onclose();}} onkeydown={keyboard}>
 <div bind:this={panel} class={'qm-dialog '+className} class:qm-action-panel={actions} class:qm-history-selected={selected} role="dialog" aria-modal="true" aria-label={label} data-state={dialogState} style:left={actions?left+'px':undefined} style:top={actions?top+'px':undefined} tabindex="-1">
 {#if !actions}<div class="qm-dialog-heading"><strong>{label}</strong><Button label={closeLabel} icon="close" onclick={onclose}/></div>{/if}
 {@render children?.()}
 </div>
</div>
