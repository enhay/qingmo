<script>
    import { setContext, onMount, tick, untrack } from 'svelte';
    import { CONTEXT, displayDay } from './context.js';
    import { audioErrorCode } from '../core/transcription.js';
    import { parseMemoMarkdown, COLLECT_TAG, lastYearToday } from '../core/data.js';
    import Sidebar from './Sidebar.svelte';
    import Composer from './Composer.svelte';
    import Review from './Review.svelte';
    import Insights from './Insights.svelte';
    import Scope from './Scope.svelte';
    import Statistics from './Statistics.svelte';
    import Settings from './Settings.svelte';
    import History from './History.svelte';
    import Button from '../components/Button.svelte';
    import Icon from '../components/Icon.svelte';
    import Dialog from '../components/Dialog.svelte';
    import GalleryCard from '../components/GalleryCard.svelte';
    import { safeURL } from './context.js';
    import MemoCard from '../components/MemoCard.svelte';
    let { options: suppliedOptions } = $props();
    const options = untrack(() => suppliedOptions);
    const {
        repository,
        previewReference,
        showBacklinks,
        t,
        container,
        renderMarkdown,
        renderBlockDOM,
        openBlock,
        onClose,
        mode = 'fullscreen',
        shared
    } = options;
    setContext(CONTEXT, { options, shared });
    const doc = container.ownerDocument,
        win = doc.defaultView;
    let root = $state(),
        stream = $state(),
        sidebar = $state(),
        main = $state(),
        menuButton = $state(),
        titleButton = $state(),
        search = $state(),
        composeSlot = $state(),
        overlay = $state(),
        composer = $state(),
        review = $state();
    let layout = $state('mobile'),
        theme = $state('light'),
        sideOpen = $state(false),
        searchOpen = $state(false),
        composeOpen = $state(false),
        reviewMode = $state(''),
        modal = $state(null);
    let items = $state([]),
        stats = $state({ tags: [] }),
        filter = $state({ keyword: '', tag: '', kind: 'all', day: '', source: 'all' }),
        listOrder = $state('newest'),
        loading = $state(false),
        hasMore = $state(false),
        status = $state(''),
        notice = $state(''),
        searchValue = $state(''),
        historyState = $state('loading'),
        historySelected = $state(false),
        deleting = $state(false);
    let aiScope = $state({ tag: '', start: '', end: '' }),
        insight = $state(null),
        transcribingMemo = $state(false),
        entryHold,
        entryLong = false;
    let serial = 0,
        dead = false,
        searchTimer,
        restoreFocus,
        dialogRestoreFocus,
        pointerUsed = false,
        touchY = 0,
        touchX = 0;
    let inline = $derived(layout === 'desktop');
    let title = $derived(
        filter.tag
            ? '#' + filter.tag
            : displayDay(filter.day) || t(filter.kind === 'all' ? (inline ? 'all' : 'appName') : filter.kind)
    );
    let selectedFilters = $derived(
        [
            ['keyword', filter.keyword],
            ['tag', filter.tag ? '#' + filter.tag : ''],
            ['kind', filter.kind === 'all' ? '' : t(filter.kind)],
            ['day', displayDay(filter.day)],
            ['source', filter.source === 'all' ? '' : t(filter.source === 'native' ? 'sourceNative' : 'sourceExternal')]
        ].filter(([, label]) => label)
    );
    function notify(key) {
        status = t(key);
        notice = /Failed|Unavailable|audioError_|finishDraftFirst/.test(key) ? t(key) : '';
    }
    let referenceCounts = $state({});
    async function load(reset) {
        if (dead || (!reset && loading)) return;
        const token = reset ? ++serial : serial;
        loading = true;
        notify('loading');
        try {
            const result = await repository.list({ ...filter, order: listOrder, offset: reset ? 0 : items.length });
            if (dead || token !== serial) return;
            const counts = await repository.referenceCounts(result.items);
            if (dead || token !== serial) return;
            referenceCounts = reset ? counts : { ...referenceCounts, ...counts };
            items = reset ? result.items : items.concat(result.items);
            hasMore = result.hasMore;
            status = '';
        } catch {
            if (token === serial && !dead) notify('loadFailed');
        } finally {
            if (token === serial) loading = false;
        }
    }
    export async function refresh() {
        review?.refresh?.();
        const listPromise = load(true),
            token = serial;
        try {
            const next = await repository.stats();
            if (!dead && token === serial) stats = next;
        } catch {
            if (!dead && token === serial) notify('statsFailed');
        }
        await listPromise;
    }
    function choose(next) {
        if (reviewMode) reviewMode = '';
        clearTimeout(searchTimer);
        filter = { ...filter, ...next };
        if (typeof next.keyword === 'string') searchValue = next.keyword;
        sideOpen = false;
        if (stream) stream.scrollTop = 0;
        refresh();
    }
    async function clearFilters(next) {
        choose(next);
        await tick();
        (root.querySelector('.qm-filters button') || (inline || searchOpen ? search : menuButton))?.focus();
    }
    function queueSearch(e) {
        clearTimeout(searchTimer);
        if (e.isComposing) return;
        searchTimer = setTimeout(() => choose({ keyword: searchValue }), 200);
    }
    async function toggleSidebar(value) {
        sideOpen = value;
        if (pointerUsed) return;
        await tick();
        if (value) sidebar.querySelector('button')?.focus();
        else menuButton?.focus();
    }
    function setModal(next) {
        if (!modal) dialogRestoreFocus = next.anchor || doc.activeElement;
        modal = next;
    }
    function closeDialog() {
        const previous = dialogRestoreFocus;
        modal = null;
        dialogRestoreFocus = null;
        tick().then(() => previous?.focus());
    }
    function showSettings(first = false) {
        setModal({ type: 'settings', label: 'settings', first });
    }
    function listMenu(section = 'main') {
        setModal({ type: 'list', label: 'noteOptions', section, anchor: titleButton, actions: true });
    }
    function memoMenu(memo, anchor, event, text) {
        setModal({
            type: text ? 'selection' : 'memo',
            label: text ? 'copySelection' : 'memoActions',
            memo,
            anchor,
            text,
            actions: true,
            point: event
                ? {
                      x: event.clientX || anchor.getBoundingClientRect().left + 16,
                      y: event.clientY || anchor.getBoundingClientRect().top + 16
                  }
                : undefined
        });
    }
    async function copyText(text, key = 'copied') {
        try {
            await win.navigator.clipboard.writeText(text);
            closeDialog();
            notify(key);
        } catch {
            notify('copyFailed');
        }
    }
    function showHistory(memo) {
        historyState = 'loading';
        historySelected = false;
        setModal({ type: 'history', label: 'history', memo });
    }
    function confirmDelete(memo) {
        setModal({ type: 'delete', label: memo.external ? 'removeConfirm' : 'deleteConfirm', memo });
    }
    async function deleteMemo(memo) {
        deleting = true;
        try {
            await (memo.external ? repository.remove(memo.id) : repository.delete(memo.id));
            closeDialog();
            await refresh();
        } catch {
            notify('deleteFailed');
        } finally {
            deleting = false;
        }
    }
    function image(paths, index = 0) {
        const images = (Array.isArray(paths) ? paths : [paths]).filter(path => safeURL(path, true));
        if (images.length)
            setModal({
                type: 'image',
                label: 'viewImage',
                images,
                index: Math.max(0, Math.min(index, images.length - 1))
            });
    }
    function imageStep(direction) {
        if (modal?.type === 'image')
            modal.index = Math.max(0, Math.min(modal.index + direction, modal.images.length - 1));
    }
    function openInsight(viewId = 'default', memoId = '', initialScope = aiScope) {
        composer?.flushDraft();
        insight = { viewId, memoId, initialScope: { ...initialScope } };
        reviewMode = 'insight';
        sideOpen = false;
    }
    async function pin(memo) {
        try {
            await repository.setPinned(memo.id, !memo.pinned);
            closeDialog();
            await refresh();
            notify(memo.pinned ? 'unpinned' : 'pinned');
        } catch {
            notify('pinFailed');
        }
    }
    async function transcribeMemo(memo) {
        options.flushDrafts?.();
        if (composer?.hasDraft(memo.id)) {
            notify('finishDraftFirst');
            return;
        }
        if (!shared.settings.tencentSecretId || !shared.settings.tencentSecretKey) {
            showSettings();
            return;
        }
        if (!win.confirm(t('manualTranscriptionCost'))) return;
        transcribingMemo = true;
        try {
            await options.transcribeMemo(memo.id);
            closeDialog();
            await refresh();
        } catch (e) {
            notify(e.code === 'MEMO_CHANGED' ? 'transcriptionMemoChanged' : 'audioError_' + audioErrorCode(e));
        } finally {
            transcribingMemo = false;
        }
    }
    function openReview(next) {
        insight = null;
        composer?.flushDraft();
        reviewMode = next;
        sideOpen = false;
    }
    function closeReview() {
        insight = null;
        reviewMode = '';
        refresh();
    }
    export async function compose(memo) {
        if (reviewMode) closeReview();
        await composer?.compose(memo);
    }
    export function flushDraft() {
        composer?.flushDraft();
    }
    export function releaseComposer() {
        return composer?.releaseComposer() ?? true;
    }
    export function keyboardChanged() {
        if (dead || !root) return;
        const viewport = win.visualViewport,
            bottom = viewport ? Math.max(0, win.innerHeight - viewport.height - viewport.offsetTop) : 0;
        root.style.setProperty('--qm-keyboard', bottom + 'px');
        root.style.setProperty('--qm-composer-safe-bottom', bottom > 0 ? '0px' : 'env(safe-area-inset-bottom,0px)');
        if (composeOpen) composer?.resizeInput();
    }
    export function handleBack() {
        if (modal) {
            closeDialog();
            return true;
        }
        if (reviewMode) {
            if (reviewMode === 'insight' && review?.leave) {
                review.leave();
                return true;
            }
            if (reviewMode !== 'views') openReview('views');
            else closeReview();
            return true;
        }
        if (inline) {
            if (composer?.isEditing()) {
                composer.closeCompose();
                return true;
            }
            return false;
        }
        if (composeOpen) {
            composer.closeCompose();
            return true;
        }
        if (searchOpen) {
            searchOpen = false;
            menuButton?.focus();
            return true;
        }
        if (sideOpen) {
            toggleSidebar(false);
            return true;
        }
        return false;
    }
    export function setTheme(value) {
        theme = value === 1 || value === 'dark' ? 'dark' : 'light';
    }
    export function beforeDestroy() {
        composer?.flushDraft();
        dead = true;
        serial++;
        clearTimeout(searchTimer);
        clearTimeout(entryHold);
    }
    function keyboard(e) {
        if (e.defaultPrevented) return;
        if (!root.contains(doc.activeElement) || e.isComposing) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k' && !modal) {
            e.preventDefault();
            e.stopPropagation();
            closeReview();
            searchOpen = true;
            tick().then(() => search?.focus());
            return;
        }
        if (modal?.type === 'image' && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            imageStep(e.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (
            ['daily', 'random'].includes(reviewMode) &&
            !modal &&
            ['ArrowLeft', 'ArrowRight'].includes(e.key) &&
            !e.target.closest('input,textarea,select,[contenteditable="true"]')
        ) {
            e.preventDefault();
            e.stopPropagation();
            review?.navigate(e.key === 'ArrowLeft' ? -1 : 1);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (!handleBack()) {
                composer?.flushDraft();
                onClose?.();
            }
            return;
        }
        if (e.key === 'Tab' && (modal || (!inline && composeOpen && !reviewMode))) {
            const target = modal ? root.querySelector('.qm-dialog') : root.querySelector('.qm-sheet');
            const focusable = [
                ...target.querySelectorAll(
                    'button:not(:disabled),input:not(:disabled),[contenteditable="true"],select:not(:disabled),a[href]'
                )
            ].filter(x => !x.hidden && x.getClientRects().length);
            const first = focusable[0],
                last = focusable[focusable.length - 1];
            if (e.shiftKey && doc.activeElement === first) {
                e.preventDefault();
                last?.focus();
            } else if (!e.shiftKey && doc.activeElement === last) {
                e.preventDefault();
                first?.focus();
            }
        }
    }
    async function applyLayout() {
        const next = root.clientWidth >= 640 ? 'desktop' : 'mobile';
        if (next === layout) return;
        composer?.flushDraft();
        layout = next;
        sideOpen = false;
        composeOpen = false;
        if (next === 'mobile') searchOpen = !!searchValue;
        await tick();
        composer?.place(next === 'desktop' ? composeSlot : overlay);
        keyboardChanged();
    }
    onMount(() => {
        const pointer = () => (pointerUsed = true),
            key = e => {
                if (/^(Tab|Enter| |Escape|Arrow)/.test(e.key)) pointerUsed = false;
            };
        const foreground = () => {
            if (!doc.hidden) refresh();
        };
        doc.addEventListener('visibilitychange', foreground);
        win.addEventListener('focus', foreground);
        doc.addEventListener('pointerdown', pointer, true);
        doc.addEventListener('keydown', key, true);
        const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(applyLayout) : null;
        resize?.observe(root);
        win.visualViewport?.addEventListener('resize', keyboardChanged);
        win.visualViewport?.addEventListener('scroll', keyboardChanged);
        applyLayout();
        refresh();
        return () => {
            beforeDestroy();
            resize?.disconnect();
            doc.removeEventListener('visibilitychange', foreground);
            win.removeEventListener('focus', foreground);
            doc.removeEventListener('pointerdown', pointer, true);
            doc.removeEventListener('keydown', key, true);
            win.visualViewport?.removeEventListener('resize', keyboardChanged);
            win.visualViewport?.removeEventListener('scroll', keyboardChanged);
        };
    });
</script>

{#snippet searchBox()}
    <div class="qm-search" hidden={!inline && !searchOpen}>
        <Icon name="search" /><input
            bind:this={search}
            type="search"
            bind:value={searchValue}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            oninput={queueSearch}
            oncompositionend={queueSearch}
        />
    </div>
{/snippet}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
    bind:this={root}
    role="region"
    aria-label={t('appName')}
    onkeydown={keyboard}
    class={'qm-root qm-' + mode}
    class:qm-sidebar-open={sideOpen}
    class:qm-review-active={!!reviewMode}
    data-layout={layout}
    data-qm-theme={theme}
    ontouchstart={e => {
        touchY = e.touches[0].clientY;
        touchX = e.touches[0].clientX;
    }}
    ontouchend={e => {
        const dy = e.changedTouches[0].clientY - touchY,
            dx = e.changedTouches[0].clientX - touchX;
        if (modal?.type === 'image' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) imageStep(dx < 0 ? 1 : -1);
        else if (sideOpen && dx < -60) toggleSidebar(false);
        else if (composeOpen && dy > 80 && e.target.closest('.qm-handle')) composer.closeCompose();
        else if (!composeOpen && !reviewMode && stream.scrollTop === 0 && dy > 80) refresh();
    }}
>
    {#if reviewMode === 'statistics'}<Statistics
            onback={closeReview}
            {choose}
        />{:else if reviewMode === 'insight'}{#key insight?.viewId + ':' + insight?.memoId + ':' + insight?.history}<Insights
                bind:this={review}
                {...insight}
                {root}
                onback={() => openReview('views')}
                onsettings={showSettings}
            />{/key}{:else if reviewMode}{#key reviewMode}<Review
                {root}
                {aiScope}
                onscope={next => (aiScope = next)}
                inert={!!modal}
                bind:this={review}
                mode={reviewMode}
                desktop={layout === 'desktop'}
                onedit={memo => (memo.type === 'p' || memo.type === 's' ? compose(memo) : openBlock(memo.id))}
                onback={() => (reviewMode === 'views' ? closeReview() : openReview('views'))}
                onmode={openReview}
                oninsight={openInsight}
                onhistory={() => {
                    insight = { history: true };
                    reviewMode = 'insight';
                }}
                onsettings={() => setModal({ type: 'reviewSettings', label: 'reviewSettings' })}
                {choose}
                onmenu={memoMenu}
                onimage={image}
            />{/key}{/if}
    <aside
        bind:this={sidebar}
        class="qm-sidebar"
        aria-label={t('sidebar')}
        aria-hidden={!inline && !sideOpen}
        inert={!!modal || (reviewMode === 'insight' && shared.insight?.busy) || (!inline && (composeOpen || !sideOpen))}
    >
        <Sidebar
            onTagMenu={(tag, anchor, run) =>
                setModal({ type: 'tag', label: 'tagActions', tag, anchor, run, actions: true })}
            {stats}
            {filter}
            {choose}
            {openReview}
            {showSettings}
            onstatistics={() => openReview('statistics')}
            {layout}
            onnotify={notify}
            flushDraft={() => composer?.flushDraft()}
        />
    </aside>
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <section
        bind:this={main}
        class="qm-main"
        inert={!!modal || (!inline && composeOpen)}
        onclickcapture={e => {
            if (sideOpen) {
                e.preventDefault();
                e.stopPropagation();
                toggleSidebar(false);
            }
        }}
    >
        <header class="qm-header">
            <Button
                bind:element={menuButton}
                label={t('sidebar')}
                icon="menu"
                class="qm-round"
                aria-expanded={sideOpen}
                onclick={() => toggleSidebar(!sideOpen)}
            /><Button
                bind:element={titleButton}
                label={title}
                class="qm-title"
                aria-haspopup="dialog"
                aria-expanded={modal?.type === 'list'}
                onclick={() => listMenu()}
            /><Button
                label={t('search')}
                icon="search"
                class="qm-round"
                onclick={async () => {
                    searchOpen = !searchOpen;
                    await tick();
                    if (searchOpen) search?.focus();
                }}
            />{#if inline}{@render searchBox()}{/if}
        </header>
        {#if !inline}{@render searchBox()}{/if}
        {#if !inline}<nav class="qm-capsules" aria-label={t('views')}>
                {#each [['views', 'grid', 'views'], ['dailyReview', 'hash', 'daily'], ['randomWalk', 'more', 'random']] as [key, icon, next]}<Button
                        label={t(key)}
                        {icon}
                        class="qm-capsule"
                        onclick={() => openReview(next)}><span>{t(key)}</span></Button
                    >{/each}
            </nav>{/if}
        <div bind:this={composeSlot} class="qm-compose-slot"></div>
        <div class="qm-filters" hidden={!selectedFilters.length} role="group" aria-label={t('activeFilters')}>
            {#each selectedFilters as [key, label]}<Button
                    label={t('removeFilter', { filter: label })}
                    class="qm-filter"
                    onclick={() => clearFilters({ [key]: key === 'kind' || key === 'source' ? 'all' : '' })}
                    ><span>{label}</span><Icon name="close" /></Button
                >{/each}{#if selectedFilters.length > 1}<Button
                    label={t('clearFilters')}
                    class="qm-clear-filters"
                    onclick={() => clearFilters({ keyword: '', tag: '', kind: 'all', day: '', source: 'all' })}
                />{/if}
        </div>
        <div
            bind:this={stream}
            class="qm-stream"
            class:qm-gallery={filter.kind === 'image'}
            role="region"
            aria-label={t('memoList')}
            aria-busy={loading}
            onscroll={() => {
                if (hasMore && stream.scrollHeight - stream.scrollTop - stream.clientHeight < 160) load(false);
            }}
        >
            {#each items as memo (memo.id)}{#if filter.kind === 'image'}<GalleryCard
                        {memo}
                        {t}
                        onmenu={memoMenu}
                        onimage={image}
                    />{:else}<MemoCard
                        {memo}
                        {t}
                        {renderMarkdown}
                        {renderBlockDOM}
                        {openBlock}
                        {choose}
                        {previewReference}
                        showBacklinks={(id, event) => (options.nativeMobile ? openBlock(id) : showBacklinks(id, event))}
                        referenceCount={referenceCounts[memo.id] || 0}
                        draft={!!shared.drafts[memo.id]}
                        collapseLongMemos={shared.settings.collapseLongMemos}
                        desktop={layout === 'desktop'}
                        onedit={memo => (memo.type === 'p' || memo.type === 's' ? compose(memo) : openBlock(memo.id))}
                        oninsight={memo => openInsight('default', memo.id)}
                        onmenu={memoMenu}
                        onimage={image}
                    />{/if}{/each}{#if !items.length && !loading}<div class="qm-empty">
                    {t(selectedFilters.length ? 'noResults' : 'empty')}
                </div>{/if}
        </div>
        <div class="qm-status" role="status">
            {status}{#if status === t('savedOutsideFilter')}<Button
                    label={t('showAll')}
                    onclick={() => choose({ keyword: '', tag: '', kind: 'all', day: '', source: 'all' })}
                />{/if}
        </div>
        <div class="qm-entry-row">
            <Button
                label={t('inputBar')}
                icon="plus"
                class="qm-entry"
                onpointerdown={() => {
                    entryLong = false;
                    entryHold = setTimeout(() => {
                        entryLong = true;
                        composer?.beginRecording();
                    }, 400);
                }}
                onpointerup={() => clearTimeout(entryHold)}
                onpointercancel={() => clearTimeout(entryHold)}
                onclick={() => {
                    if (!entryLong) compose();
                    entryLong = false;
                }}><span>{t('inputBar')}</span></Button
            ><Button
                label={t('recordAudio')}
                icon="mic"
                class="qm-entry-mic"
                onclick={() => composer?.beginRecording()}
            />
        </div>
    </section>
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div
        bind:this={overlay}
        class="qm-compose-overlay"
        hidden={inline || !composeOpen}
        inert={!!modal}
        onclick={e => {
            if (e.target === overlay) composer.closeCompose();
        }}
    >
        <Composer
            bind:this={composer}
            {layout}
            {stats}
            onclose={() => {
                composeOpen = false;
                restoreFocus?.focus();
            }}
            onopen={() => {
                if (!inline) {
                    restoreFocus = doc.activeElement;
                    composeOpen = true;
                    keyboardChanged();
                }
            }}
            onnotify={notify}
            onsaved={async (id, pending) => {
                await refresh();
                try {
                    if (
                        id &&
                        !(await repository.list({ ...filter, id: typeof id === 'string' ? id : id.id })).items.length
                    ) {
                        notify('savedOutsideFilter');
                    } else notify(pending ? 'savedPending' : 'saved');
                } catch {
                    notify('savedRefreshFailed');
                }
            }}
            onsettings={showSettings}
        />
    </div>
    <div class="qm-notice" role="alert" hidden={!notice}>{notice}</div>
    {#if modal}{#key modal.type + ':' + (modal.section || '')}
            <Dialog
                heading={modal.type !== 'settings'}
                label={t(modal.label)}
                closeLabel={t('closeDialog')}
                onclose={closeDialog}
                actions={modal.actions}
                anchor={modal.anchor}
                point={modal.point}
                {root}
                class={modal.type === 'history'
                    ? 'qm-history'
                    : modal.type === 'list'
                      ? 'qm-list-menu'
                      : modal.type === 'image'
                        ? 'qm-image-viewer'
                        : modal.type === 'reviewSettings'
                          ? 'qm-scope-dialog'
                          : modal.type === 'settings'
                            ? 'qm-settings-dialog'
                            : ''}
                state={modal.type === 'history' ? historyState : undefined}
                selected={historySelected}
            >
                {#if modal.type === 'reviewSettings'}<Scope
                        initial={shared.settings.reviewScope || {}}
                        count={shared.settings.reviewCount}
                        onclose={closeDialog}
                        onapply={async (scope, count) => {
                            await shared.saveSettings({ reviewScope: scope, reviewCount: count });
                            closeDialog();
                            review?.refresh?.();
                        }}
                    />
                {:else if modal.type === 'settings'}<Settings
                        first={modal.first}
                        onclose={closeDialog}
                        onnotify={notify}
                        onsaved={first => {
                            if (first) compose();
                            review?.refresh?.();
                        }}
                    />
                {:else if modal.type === 'history'}<History
                        memo={modal.memo}
                        {composer}
                        onclose={closeDialog}
                        onnotify={notify}
                        onrefresh={refresh}
                        onsettings={showSettings}
                        onstate={state => (historyState = state)}
                        onselected={value => (historySelected = value)}
                    />
                {:else if modal.type === 'image'}<div class="qm-image-position">
                        {modal.index + 1} / {modal.images.length}
                    </div>
                    <img src={safeURL(modal.images[modal.index], true)} alt={t('attachedImage')} />
                    {#if modal.index > 0}<Button
                            label={t('previousImage')}
                            icon="chevron-left"
                            class="qm-image-previous"
                            onclick={() => imageStep(-1)}
                        />{/if}
                    {#if modal.index < modal.images.length - 1}<Button
                            label={t('nextImage')}
                            icon="chevron-right"
                            class="qm-image-next"
                            onclick={() => imageStep(1)}
                        />{/if}
                {:else if modal.type === 'selection'}<Button
                        label={t('copySelection')}
                        class="qm-dialog-action"
                        onclick={() => copyText(modal.text)}
                    />
                {:else if modal.type === 'tag'}<Button
                        label={t(
                            (shared.settings.favoriteTags || []).includes(modal.tag) ? 'unfavoriteTag' : 'favoriteTag'
                        )}
                        icon="pin"
                        class="qm-dialog-action"
                        onclick={() => {
                            const run = modal.run;
                            closeDialog();
                            run();
                        }}
                        ><span
                            >{t(
                                (shared.settings.favoriteTags || []).includes(modal.tag)
                                    ? 'unfavoriteTag'
                                    : 'favoriteTag'
                            )}</span
                        ></Button
                    >
                {:else if modal.type === 'memo'}{@const memo =
                        modal.memo}{#if memo.type === 'p' || memo.type === 's'}<Button
                            label={t('edit')}
                            icon="edit"
                            class="qm-dialog-action"
                            onclick={() => {
                                const selected = memo;
                                closeDialog();
                                compose(selected);
                            }}><span>{t('edit')}</span></Button
                        >{:else}<Button
                            label={t('nativeEdit')}
                            icon="edit"
                            class="qm-dialog-action"
                            onclick={() => {
                                const id = memo.id;
                                closeDialog();
                                openBlock(id);
                            }}><span>{t('nativeEdit')}</span></Button
                        >{/if}<Button
                        label={t('copy')}
                        icon="copy"
                        class="qm-dialog-action"
                        onclick={() => copyText(parseMemoMarkdown(memo.markdown).text)}><span>{t('copy')}</span></Button
                    ><Button
                        label={t('copyLink')}
                        icon="link"
                        class="qm-dialog-action"
                        onclick={() => copyText('siyuan://blocks/' + memo.id, 'linkCopied')}
                        ><span>{t('copyLink')}</span></Button
                    >
                    <div class="qm-action-separator"></div>
                    <Button
                        label={t(memo.pinned ? 'unpin' : 'pin')}
                        icon="pin"
                        class="qm-dialog-action"
                        onclick={() => pin(memo)}><span>{t(memo.pinned ? 'unpin' : 'pin')}</span></Button
                    ><Button
                        label={t('continueReference')}
                        icon="quote"
                        class="qm-dialog-action"
                        onclick={() => {
                            const selected = memo;
                            closeDialog();
                            closeReview();
                            composer.reference(selected);
                        }}><span>{t('continueReference')}</span></Button
                    ><Button
                        label={t('aiInsight')}
                        icon="grid"
                        class="qm-dialog-action"
                        onclick={() => {
                            const id = memo.id;
                            closeDialog();
                            openInsight('default', id);
                        }}><span>{t('aiInsight')}</span></Button
                    >{#if memo.pendingAudio || memo.audio?.some?.(segment => segment.pending)}<Button
                            label={t('transcribeRecording')}
                            icon="audio"
                            class="qm-dialog-action"
                            disabled={transcribingMemo}
                            onclick={() => transcribeMemo(memo)}><span>{t('transcribeRecording')}</span></Button
                        >{/if}
                    <div class="qm-action-separator"></div>
                    <Button
                        label={t('history')}
                        icon="history"
                        class="qm-dialog-action"
                        onclick={() => showHistory(memo)}><span>{t('history')}</span></Button
                    ><Button
                        label={t('openNative')}
                        icon="exit"
                        class="qm-dialog-action"
                        onclick={() => {
                            const id = memo.id;
                            closeDialog();
                            openBlock(id);
                        }}><span>{t('openNative')}</span></Button
                    >
                    <div class="qm-action-separator"></div>
                    <Button
                        label={t(memo.external ? 'removeMemo' : 'delete')}
                        icon="trash"
                        class="qm-dialog-action qm-danger"
                        onclick={() => confirmDelete(memo)}
                        ><span>{t(memo.external ? 'removeMemo' : 'delete')}</span></Button
                    >
                {:else if modal.type === 'delete'}{@const memo = modal.memo}
                    <p>
                        {t(
                            memo.type === 'd'
                                ? 'removeDocumentExplanation'
                                : memo.external
                                  ? memo.marker === '1' && memo.tags.includes(COLLECT_TAG)
                                      ? 'removeBothExplanation'
                                      : memo.tags.includes(COLLECT_TAG)
                                        ? 'removeTagExplanation'
                                        : 'removeAttrExplanation'
                                  : 'deleteExplanation'
                        )}
                    </p>
                    <div class="qm-confirm-actions">
                        <Button label={t('cancel')} onclick={closeDialog} /><Button
                            label={t(memo.external ? 'removeMemo' : 'delete')}
                            class="qm-primary qm-danger"
                            disabled={deleting}
                            onclick={() => deleteMemo(memo)}
                        />
                    </div>
                {:else if modal.type === 'list'}
                    {#if modal.section === 'main'}<Button
                            label={t('lastYearToday')}
                            icon="calendar"
                            class="qm-dialog-action"
                            onclick={() => {
                                closeDialog();
                                choose({ day: lastYearToday() });
                            }}><span>{t('lastYearToday')}</span></Button
                        >{#each [['sortOrder', 'sort', t(listOrder === 'newest' ? 'sortNewest' : 'sortOldest'), 'sort'], ['noteSource', 'filter', t(filter.source === 'all' ? 'sourceAll' : filter.source === 'native' ? 'sourceNative' : 'sourceExternal'), 'source']] as [key, icon, value, next]}<Button
                                label={t(key)}
                                {icon}
                                class="qm-dialog-action"
                                aria-description={value}
                                onclick={() => listMenu(next)}
                                ><span>{t(key)}<small class="qm-action-detail">{value}</small></span><Icon
                                    name="chevron"
                                /></Button
                            >{/each}
                    {:else}<Button label={t('back')} icon="chevron" class="qm-dialog-action" onclick={() => listMenu()}
                            ><span>{t('back')}</span></Button
                        >
                        <div class="qm-action-separator"></div>
                        {#each modal.section === 'sort' ? [['newest', 'sortNewest'], ['oldest', 'sortOldest']] : [['all', 'sourceAll'], ['native', 'sourceNative'], ['external', 'sourceExternal']] as [value, key]}<Button
                                label={t(key)}
                                icon="check"
                                class="qm-dialog-action"
                                aria-pressed={(modal.section === 'sort' ? listOrder : filter.source) === value}
                                onclick={() => {
                                    const sort = modal.section === 'sort';
                                    closeDialog();
                                    if (sort) {
                                        listOrder = value;
                                        choose({});
                                    } else choose({ source: value });
                                }}><span>{t(key)}</span></Button
                            >{/each}{/if}
                {/if}
            </Dialog>{/key}{/if}
</div>

<style>
    .qm-stream.qm-gallery {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        align-content: start;
    }
    :global(.qm-root[data-layout='desktop']) .qm-gallery {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
    }
    .qm-image-position {
        width: fit-content;
        margin: 0 auto 8px;
        padding: 4px 10px;
        border-radius: 12px;
        background: var(--qm-viewer-scrim);
        color: var(--qm-on-brand);
        text-align: center;
        font-size: 13px;
    }
    :global(.qm-image-previous),
    :global(.qm-image-next) {
        position: absolute;
        top: 50%;
        color: var(--qm-on-brand);
        background: var(--qm-viewer-scrim);
        border-radius: 50%;
    }
    :global(.qm-image-previous) {
        left: 12px;
    }
    :global(.qm-image-next) {
        right: 12px;
    }
    :global(.qm-root[data-layout='mobile'] .qm-image-previous),
    :global(.qm-root[data-layout='mobile'] .qm-image-next) {
        display: none;
    }
</style>
