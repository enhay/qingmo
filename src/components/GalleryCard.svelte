<script>
    import { safeURL } from '../views/context.js';
    import { historyPlainText } from '../core/history.js';
    import Button from './Button.svelte';
    let { memo, t, onmenu, onimage } = $props();
    let images = $derived(memo.images.filter(path => safeURL(path, true)));
    let excerpt = $derived(historyPlainText(memo.dom, document));
    let date = $derived(String(memo.created || ''));
</script>

<article class="qm-gallery-card" data-id={memo.id}>
    <button type="button" class="qm-gallery-image" aria-label={t('viewImage')} onclick={() => onimage(images, 0)}>
        <img src={safeURL(images[0], true)} alt={t('attachedImage')} loading="lazy" />
        {#if images.length > 1}<span>{images.length}</span>{/if}
    </button>
    <div class="qm-gallery-detail">
        <p>{excerpt}</p>
        <div>
            <time
                >{#if memo.pinned}{t('pinnedLabel')} ·
                {/if}{date.slice(0, 4)}-{date.slice(4, 6)}-{date.slice(6, 8)}
                {date.slice(8, 10)}:{date.slice(10, 12)}</time
            ><Button label={t('memoActions')} icon="more" onclick={event => onmenu(memo, event.currentTarget)} />
        </div>
    </div>
</article>

<style>
    .qm-gallery-card {
        overflow: hidden;
        border-radius: 14px;
        background: var(--qm-surface);
    }
    .qm-gallery-image {
        display: block;
        position: relative;
        width: 100%;
        aspect-ratio: 4 / 5;
        padding: 0;
        border: 0;
        cursor: zoom-in;
        background: var(--qm-fill);
    }
    .qm-gallery-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: left top;
    }
    .qm-gallery-image span {
        position: absolute;
        bottom: 6px;
        right: 6px;
        padding: 3px 6px;
        border-radius: 4px;
        background: var(--qm-overlay);
        color: var(--qm-on-brand);
        font-size: 11px;
    }
    .qm-gallery-detail {
        padding: 8px 10px 10px;
    }
    .qm-gallery-detail p {
        margin: 0;
        font-size: 14px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .qm-gallery-detail div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 4px;
    }
    time {
        color: var(--qm-text-secondary);
        font-size: 12px;
    }
    @media (hover: hover) {
        .qm-gallery-card:hover {
            box-shadow: 0 2px 10px color-mix(in srgb, var(--qm-text) 8%, transparent);
        }
    }
</style>
