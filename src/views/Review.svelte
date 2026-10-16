<script>
    import { getContext, onMount } from 'svelte';
    import { CONTEXT } from './context.js';
    import { dailyOrder, DEFAULT_SETTINGS, stableReviewIds } from '../core/data.js';
    import { INSIGHT_VIEWS } from '../core/insights.js';
    import Button from '../components/Button.svelte';
    import MemoCard from '../components/MemoCard.svelte';
    import Icon from '../components/Icon.svelte';
    import Scope from './Scope.svelte';
    import Dialog from '../components/Dialog.svelte';
    const { options, shared } = getContext(CONTEXT),
        { repository, t, container, renderMarkdown, renderBlockDOM, openBlock } = options;
    let {
        mode,
        inert = false,
        onback,
        onmode,
        onsettings,
        choose,
        onmenu,
        onimage,
        oninsight,
        onhistory,
        root,
        aiScope = {},
        onscope
    } = $props();
    let ids = $state([]),
        index = $state(0),
        memo = $state(null),
        state = $state('loading'),
        referenceCount = $state(0),
        serial = 0,
        dead = false,
        touchX = 0,
        scopeOpen = $state(false),
        scopeCount = $state(null),
        scopeFailed = $state(false);
    let storage;
    try {
        storage = container.ownerDocument.defaultView.localStorage;
    } catch {
        storage = null;
    }
    async function ensureIds(valid) {
        const scope = shared.settings.reviewScope || {};
        const all = await repository.rangeIds(scope);
        return valid() ? stableReviewIds(all, scope, storage) : null;
    }
    export async function refresh() {
        const token = ++serial,
            currentMode = mode,
            valid = () => !dead && token === serial && mode === currentMode;
        if (mode === 'views') {
            state = 'ready';
            return;
        }
        state = 'loading';
        try {
            let next;
            if (mode === 'daily') {
                next = await ensureIds(valid);
                if (!valid()) return;
                next = next.slice(
                    0,
                    Math.max(1, Math.min(50, Number(shared.settings.reviewCount) || DEFAULT_SETTINGS.reviewCount))
                );
            } else {
                const all = await repository.allIds();
                if (!valid()) return;
                next = all.filter(id => id !== memo?.id);
                next = next.length ? dailyOrder(next, String(Date.now())) : all;
            }
            if (!next.length) {
                ids = [];
                memo = null;
                state = 'empty';
                return;
            }
            let cursor = mode === 'daily' ? Math.min(index, next.length - 1) : 0;
            let result = await repository.get(next[cursor]);
            if (!valid()) return;
            if (!result) {
                next.splice(cursor, 1);
                cursor = Math.min(cursor, next.length - 1);
                result = next.length ? await repository.get(next[cursor]) : null;
                if (!valid()) return;
            }
            ids = result ? next : [];
            index = cursor;
            referenceCount = result ? (await repository.referenceCounts([result]))[result.id] || 0 : 0;
            if (!valid()) return;
            memo = result;
            state = result ? 'ready' : 'empty';
        } catch {
            if (valid()) state = 'error';
        }
    }
    $effect(() => {
        if (mode !== 'views') return;
        let live = true;
        scopeCount = null;
        scopeFailed = false;
        repository
            .rangeIds({ ...aiScope })
            .then(ids => {
                if (live) scopeCount = ids.length;
            })
            .catch(() => {
                if (live) scopeFailed = true;
            });
        return () => (live = false);
    });
    function step(delta) {
        index = Math.max(0, Math.min(ids.length - 1, index + delta));
        refresh();
    }
    onMount(() => {
        refresh();
        return () => {
            dead = true;
            serial++;
        };
    });
</script>

<section
    {inert}
    class="qm-review"
    aria-label={t('review')}
    data-state={state}
    ontouchstart={e => (touchX = e.touches[0].clientX)}
    ontouchend={e => {
        if (mode === 'daily') {
            const delta = e.changedTouches[0].clientX - touchX;
            if (Math.abs(delta) > 60) step(delta < 0 ? 1 : -1);
        }
    }}
>
    <header class="qm-review-header">
        <Button label={t('back')} icon="close" onclick={onback} /><strong
            >{t(mode === 'views' ? 'review' : mode === 'daily' ? 'dailyReview' : 'randomWalk')}</strong
        >{#if mode === 'views'}<Button
                label={t('insightHistory')}
                icon="history"
                onclick={onhistory}
            />{:else if mode === 'daily'}<Button label={t('reviewSettings')} onclick={onsettings} />{/if}
    </header>
    {#if mode === 'views'}<div class="qm-view-hero">
            <div class="qm-view-mark" aria-hidden="true"></div>
            <h2>{t('chooseView')}</h2>
            <Button label={t('adjustScope')} class="qm-ai-scope" onclick={() => (scopeOpen = true)}
                >{aiScope.tag ? '#' + aiScope.tag : t('scopeAll')}{#if aiScope.start || aiScope.end}
                    · {aiScope.start || t('unlimited')} — {aiScope.end || t('unlimited')}{/if} · {scopeFailed
                    ? t('scopeFailed')
                    : scopeCount === null
                      ? t('loading')
                      : t('notesCount', { count: scopeCount })} · {t('adjustScope')}</Button
            >
        </div>
        <div class="qm-view-list">
            {#each [['dailyReview', 'dailyDescription', 'daily'], ['randomWalk', 'randomDescription', 'random']] as [title, desc, next]}<Button
                    label={t(title)}
                    class="qm-view-row"
                    onclick={() => onmode(next)}
                    ><span class="qm-view-symbol">{next === 'daily' ? '◷' : '✦'}</span><span class="qm-view-words"
                        ><strong>{t(title)}</strong><small>{t(desc)}</small></span
                    ><span class="qm-view-arrow" aria-hidden="true">›</span></Button
                >{/each}
        </div>
        {#if shared.insight?.busy}<Button
                label={t('insightBusy')}
                onclick={() => oninsight(shared.insight.snapshot?.view.id || 'default')}
            />{/if}
        <h3 class="qm-view-group-title">{t('aiViews')}</h3>
        <div class="qm-view-list">
            {#each INSIGHT_VIEWS as view}<Button
                    label={view.title}
                    class="qm-view-row"
                    onclick={() => oninsight(view.id, '', aiScope)}
                    ><span class="qm-view-symbol"><Icon name="grid" /></span><span class="qm-view-words"
                        ><span><strong>{view.title}</strong><small class="qm-view-author">{view.author}</small></span
                        ><small>{view.description}</small></span
                    ><span class="qm-view-arrow" aria-hidden="true">›</span></Button
                >{/each}
        </div>
    {:else if state === 'error'}<p class="qm-review-empty">{t('reviewFailed')}</p>
        <Button label={t('retry')} class="qm-review-retry" onclick={refresh} />
    {:else if state === 'empty'}<div class="qm-review-empty">
            {t(mode === 'daily' ? 'scopeEmpty' : 'reviewEmpty')}{#if mode === 'daily'}<Button
                    label={t('adjustScope')}
                    onclick={onsettings}
                />{/if}
        </div>
    {:else if memo}{#if mode === 'daily'}<p class="qm-scope-description">
                {shared.settings.reviewScope?.tag ? '#' + shared.settings.reviewScope.tag : t('scopeAll')} · {shared
                    .settings.reviewScope?.start || t('unlimited')} — {shared.settings.reviewScope?.end ||
                    t('unlimited')} · {t('reviewActual', { count: ids.length })}
            </p>{/if}
        <div class="qm-review-stack">
            <MemoCard
                {memo}
                {t}
                {renderMarkdown}
                {renderBlockDOM}
                {openBlock}
                {choose}
                {onmenu}
                {onimage}
                {referenceCount}
                previewReference={options.previewReference}
                showBacklinks={(id, event) => (options.nativeMobile ? openBlock(id) : options.showBacklinks(id, event))}
                draft={!!shared.drafts[memo.id]}
                oninsight={item => oninsight('default', item.id)}
                review
            />
        </div>
        {#if mode === 'daily'}<div
                class="qm-review-dots"
                role="group"
                aria-label={t('reviewPosition', { current: index + 1, total: ids.length })}
            >
                {#each ids as _, i}<span class="qm-review-dot" aria-current={i === index}></span>{/each}
            </div>{/if}
        <div class="qm-review-controls">
            {#if mode === 'daily'}<Button label={t('previous')} disabled={index === 0} onclick={() => step(-1)} /><span
                    >{index + 1} / {ids.length}</span
                ><Button label={t('next')} disabled={index === ids.length - 1} onclick={() => step(1)} />{:else}<Button
                    label={t('nextRandom')}
                    onclick={refresh}
                />{/if}<Button label={t('openNative')} onclick={() => openBlock(memo.id)} />
        </div>
    {/if}
    {#if scopeOpen}<Dialog
            class="qm-scope-dialog"
            label={t('insightScope')}
            closeLabel={t('closeDialog')}
            {root}
            onclose={() => (scopeOpen = false)}
            ><Scope
                initial={aiScope}
                onclose={() => (scopeOpen = false)}
                onapply={next => {
                    onscope(next);
                    scopeOpen = false;
                }}
            /></Dialog
        >{/if}
</section>
