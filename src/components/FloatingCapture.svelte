<script>
    let { label, onclick } = $props();
</script>

<button type="button" class="qingmo-floating" aria-label={label} {onclick}>+</button>

<style>
    .qingmo-floating {
        position: fixed;
        right: 20px;
        bottom: calc(72px + env(safe-area-inset-bottom));
        width: 52px;
        height: 52px;
        border-radius: 50%;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-primary);
        color: var(--b3-theme-on-primary);
        font-size: 30px;
        z-index: 100;
    }
</style>
