<script>
    import { onMount } from 'svelte';
    import { createEditor } from './editor.js';
    let {
        renderMarkdown,
        label,
        placeholder,
        disabled = false,
        onchange,
        onselection,
        onkeydown,
        onkeyup,
        onfocus,
        onready,
        onfiles
    } = $props();
    let element, editor;
    onMount(() => {
        editor = createEditor({
            element,
            renderMarkdown,
            onChange: () => onchange?.(editor),
            onFiles: files => onfiles?.(files),
            onSelection: () => onselection?.(editor)
        });
        onready(editor, element);
        return () => editor.destroy();
    });
</script>

<div
    bind:this={element}
    class="qm-input"
    data-placeholder={placeholder}
    aria-label={label}
    aria-disabled={disabled}
    contenteditable={!disabled}
    role="textbox"
    tabindex="0"
    aria-multiline="true"
    {onkeydown}
    {onkeyup}
    {onfocus}
></div>
