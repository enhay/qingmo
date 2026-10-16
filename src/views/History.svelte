<script>
    import { getContext, onMount } from 'svelte';
    import { CONTEXT, safeURL } from './context.js';
    import { historyMarkdown } from '../core/history.js';
    import { COLLECT_TAG } from '../core/data.js';
    import { createEditor } from '../editor/editor.js';
    import Button from '../components/Button.svelte';
    const { options, shared } = getContext(CONTEXT),
        { repository, t, renderMarkdown, renderBlockDOM, openBlock, container } = options;
    let { memo, composer, onclose, onnotify, onrefresh, onsettings, onstate, onselected } = $props();
    let versions = $state([]),
        selected = $state(-1),
        text = $state(null),
        state = $state('loading'),
        hasMore = $state(false),
        page = 1,
        last = '',
        loading = $state(false),
        readFailed = $state(false),
        dead = false;
    const doc = container.ownerDocument,
        win = doc.defaultView;
    let preview = $derived.by(() => {
        const version = versions[selected];
        if (!version) return '';
        const template = doc.createElement('template');
        template.innerHTML = renderBlockDOM(version.dom);
        template.content
            .querySelectorAll('img')
            .forEach(img => img.setAttribute('src', safeURL(img.getAttribute('src'), true)));
        return template.innerHTML;
    });
    function setState(next) {
        state = next;
        onstate(next);
    }
    function select(index) {
        selected = index;
        const version = versions[index],
            markdown = historyMarkdown(version.dom, doc, win.Lute.New());
        text = null;
        if (version.safe && composer.canEdit(markdown, version.dom)) {
            const converter = createEditor({ element: doc.createElement('div'), renderMarkdown });
            try {
                converter.load(markdown, renderBlockDOM(version.dom));
                text = converter.value();
            } finally {
                converter.destroy();
            }
        }
        setState('selected');
        onselected(true);
    }
    async function load(nextPage = page) {
        if (loading) return;
        page = nextPage;
        loading = true;
        readFailed = false;
        try {
            const result = await repository.history.list(memo, page, last);
            if (dead) return;
            last = result.last;
            const start = versions.length;
            versions.push(...result.versions);
            hasMore = result.hasMore;
            setState(versions.length ? 'ready' : 'empty');
            if (!start && versions.length) select(0);
        } catch {
            if (!dead) {
                readFailed = true;
                setState('error');
            }
        } finally {
            loading = false;
        }
    }
    async function write(copy) {
        try {
            if (!copy) {
                if (composer.hasDraft(memo.id) && !win.confirm(t('historyReplacesDraftConfirm'))) return;
                const current = await repository.get(memo.id);
                if (dead) return;
                if (
                    !current ||
                    !['p', 's'].includes(current.type) ||
                    !composer.canEdit(current.markdown, current.dom)
                ) {
                    onnotify('nativeEditRequired');
                    openBlock(memo.id);
                    return;
                }
                if (
                    current.external &&
                    current.marker !== '1' &&
                    current.tags.includes(COLLECT_TAG) &&
                    !composer.draftHasNativeTag(text) &&
                    !win.confirm(t('editRemovesTagConfirm'))
                )
                    return;
            } else if (!shared.settings.notebook) {
                onsettings();
                return;
            }
            setState('saving');
            await repository.save({ id: copy ? undefined : memo.id, text, images: [] }, shared.settings);
            if (dead) return;
            if (!copy) {
                composer.removeDraft(memo.id);
                await composer.reloadMemo(memo.id);
            }
            onclose();
            await onrefresh();
            onnotify(copy ? 'historyCopied' : 'historyRestored');
        } catch (error) {
            if (!dead) {
                setState('error');
                onnotify(error.code === 'HISTORY_SNAPSHOT_FAILED' ? 'historySnapshotFailed' : 'historyWriteFailed');
            }
        }
    }
    onMount(() => {
        composer.flushDraft();
        load();
        return () => {
            dead = true;
        };
    });
</script>

<div class="qm-history-layout">
    <nav class="qm-history-times" aria-label={t('historyTimes')}>
        {#each versions as version, i}<Button
                label={new Date(Number(version.created) * 1000).toLocaleString()}
                class="qm-history-time"
                data-version={i}
                aria-pressed={selected === i}
                onclick={() => select(i)}
            />{/each}
        {#if state === 'empty'}<p class="qm-history-empty">{t('historyEmpty')}</p>{/if}
        <p class="qm-history-retention">{t('historyRetention')}</p>
        {#if hasMore}<Button
                label={t('loadMore')}
                class="qm-history-more"
                disabled={loading}
                onclick={() => load(page + 1)}
            />{/if}
    </nav>
    <div class="qm-history-detail">
        {#if selected >= 0}<Button label={t('historyBack')} class="qm-history-back" onclick={() => onselected(false)} />
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="qm-body qm-history-preview"
                onerrorcapture={e => {
                    if (e.target.tagName === 'IMG') {
                        e.target.alt = t('historyAssetMissing');
                        e.target.title = t('historyAssetMissing');
                    }
                }}
            >
                {@html preview}
            </div>
            <div class="qm-history-actions">
                {#if text !== null}<Button
                        label={t('historyRestore')}
                        class="qm-primary"
                        disabled={state === 'saving' ||
                            !['p', 's'].includes(memo.type) ||
                            !composer.canEdit(memo.markdown, memo.dom)}
                        onclick={() => write(false)}
                    /><Button
                        label={t('historyCopy')}
                        disabled={state === 'saving'}
                        onclick={() => write(true)}
                    />{/if}<Button
                    label={t('openNative')}
                    disabled={state === 'saving'}
                    onclick={() => {
                        const id = memo.id;
                        onclose();
                        openBlock(id);
                    }}
                />
            </div>
            {#if text === null || !['p', 's'].includes(memo.type) || !composer.canEdit(memo.markdown, memo.dom)}<p
                    class="qm-history-note"
                >
                    {t('historyNativeRequired')}
                </p>{/if}
        {:else if state === 'loading'}<p class="qm-history-empty">{t('loading')}</p>{/if}
        {#if state === 'error' && readFailed}<p class="qm-history-empty">{t('historyReadFailed')}</p>
            <Button label={t('retry')} onclick={() => load()} />{/if}
    </div>
</div>
