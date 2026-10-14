<script>
 import Icon from './Icon.svelte';
 let { label, icon, children, class: className='', element=$bindable(), ...rest }=$props();
</script>
<button bind:this={element} type="button" class={'qm-button '+className} aria-label={label} title={label} {...rest}>{#if icon}<Icon name={icon}/>{:else if !children}{label}{/if}{@render children?.()}</button>
