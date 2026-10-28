<script>
    import { getContext, onMount, untrack, tick } from 'svelte';
    import { CONTEXT } from './context.js';
    import { cleanInsight, messageText } from '../core/insights.js';
    import { normalizeScope } from '../core/data.js';
    import Button from '../components/Button.svelte';
    import Scope from './Scope.svelte';
    import Dialog from '../components/Dialog.svelte';
    import Icon from '../components/Icon.svelte';

    const inputId = $props.id();
    const { options, shared } = getContext(CONTEXT),
        { insights, t, renderMarkdown, openBlock } = options;
    let { viewId = 'default', memoId = '', history = false, initialScope = {}, onback, onsettings, root } = $props();
    let scope = $state(untrack(() => ({ ...initialScope }))),
        question = $state(''),
        prepared = $state(null),
        rows = $state([]),
        preparing = $state(false),
        error = $state(''),
        scopeOpen = $state(false),
        preview = $state(false),
        scrollArea = $state(),
        followBottom = $state(true),
        serial = 0,
        dead = false;
    const snapshot = $derived(
        !history && shared.insight?.snapshot && (shared.insight.busy || matchesCurrent(shared.insight.snapshot))
            ? shared.insight.snapshot
            : prepared
    );
    const shownScope = $derived(snapshot?.scope || scope);
    const active = $derived(
        !history && snapshot?.sessionId && shared.insight?.snapshot?.sessionId === snapshot.sessionId
    );
    const messages = $derived(active ? insights.chat.messages : []);
    const conversation = $derived(messages.length > 0);
    const phase = $derived(active ? shared.insight?.phase : 'idle');
    const busy = $derived(!!shared.insight?.busy);
    const result = $derived(active ? shared.insight?.result : null);
    const state = $derived(
        history ? 'history' : preparing ? 'preparing' : conversation ? phase : snapshot ? 'ready' : 'error'
    );
    const errorKeys = {
        INSIGHT_MODEL_REQUIRED: 'aiNotConfigured',
        NOTEBOOK_REQUIRED: 'chooseNotebook',
        INSIGHT_BUSY: 'insightBusy',
        INSIGHT_UNKNOWN_SOURCE: 'insightSourcesInvalid',
        INSIGHT_EMPTY: 'insightEmpty',
        INSIGHT_TOO_LONG: 'insightTooLong',
        INSIGHT_NO_TEXT: 'insightEmpty',
        AI_AUTH_UNSUPPORTED: 'aiAuthUnsupported',
        AI_PROTOCOL_UNSUPPORTED: 'aiProtocolUnsupported',
        AI_CONFIG_INVALID: 'aiConfigInvalid',
        AI_MODEL_CHANGED: 'aiModelChanged',
        AI_CONTEXT_FULL: 'aiContextFull',
        AI_TIMEOUT: 'aiTimeout',
        AI_AUTH_FAILED: 'aiAuthFailed',
        AI_RATE_LIMITED: 'aiRateLimited',
        AI_TRUNCATED: 'aiTruncated',
        AI_INCOMPLETE: 'aiIncomplete',
        INSIGHT_SAVE_REQUIRED: 'insightSaveFailed'
    };
    const shownError = $derived(
        error || (active && shared.insight?.error ? errorKeys[shared.insight.error] || 'insightFailed' : '')
    );
    function matchesCurrent(candidate) {
        const normalized = normalizeScope(scope);
        return (
            candidate?.view.id === viewId &&
            candidate.memoId === memoId &&
            (memoId || ['tag', 'start', 'end'].every(key => candidate.scope[key] === normalized[key]))
        );
    }
    function fail(e) {
        error = errorKeys[e.code] || 'insightFailed';
    }
    async function prepare() {
        const token = ++serial;
        preparing = true;
        error = '';
        prepared = null;
        try {
            const value = await insights.prepare({
                viewId,
                scope: { ...scope },
                memoId,
                notebook: shared.settings.notebook
            });
            if (!dead && token === serial) prepared = value;
        } catch (e) {
            if (!dead && token === serial) fail(e);
        } finally {
            if (!dead && token === serial) preparing = false;
        }
    }
    async function generate() {
        if (!snapshot || busy) return;
        error = '';
        followBottom = true;
        const text = question;
        question = '';
        try {
            if (conversation) await insights.send(text);
            else {
                prepared = Object.freeze({ ...snapshot, question: text });
                await insights.generate(prepared);
            }
        } catch (e) {
            fail(e);
            question = text;
        }
    }
    async function retry() {
        error = '';
        followBottom = true;
        try {
            await insights.send('', true);
        } catch (e) {
            fail(e);
        }
    }
    async function save() {
        error = '';
        try {
            await insights.retrySave();
        } catch {
            error = 'insightSaveFailed';
        }
    }
    function newConversation() {
        if (busy || result?.saveError) return;
        insights.reset();
        question = '';
        followBottom = true;
        prepare();
    }
    export function leave() {
        if (phase === 'saving') return;
        if (busy && active) {
            if (!options.container.ownerDocument.defaultView.confirm(t('cancelInsightConfirm'))) return;
            insights.cancel();
        }
        onback();
    }
    async function copy() {
        try {
            const text = messages
                .map(
                    message => `${t(message.role === 'user' ? 'insightYou' : 'pluginTitle')}\n\n${messageText(message)}`
                )
                .join('\n\n');
            await options.container.ownerDocument.defaultView.navigator.clipboard.writeText(text);
        } catch {
            error = 'copyFailed';
        }
    }
    function body(message) {
        try {
            return renderMarkdown(
                cleanInsight(
                    messageText(message),
                    snapshot.items.map(item => item.id)
                )
            );
        } catch {
            return null;
        }
    }
    async function source(e) {
        const a = e.target.closest('a');
        if (!a) return;
        const match = a.getAttribute('href')?.match(/^siyuan:\/\/blocks\/([\w-]+)$/);
        if (!match) return;
        e.preventDefault();
        try {
            if (await options.blockExists(match[1])) openBlock(match[1]);
            else error = 'sourceMissing';
        } catch {
            error = 'sourceMissing';
        }
    }
    function trackScroll() {
        followBottom = scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight < 48;
    }
    function keydown(e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            if (!busy && snapshot && (!conversation || question.trim()) && !result?.saveError) generate();
        }
    }
    $effect(() => {
        // 仅在用户仍停留在底部时跟随 SDK 增量，保留向上阅读的位置。
        const text = messages.map(messageText).join('');
        const area = scrollArea;
        if (text && area && followBottom)
            tick().then(() => {
                if (!dead) area.scrollTop = area.scrollHeight;
            });
    });
    onMount(() => {
        if (history) {
            insights
                .history()
                .then(value => {
                    if (!dead) rows = value;
                })
                .catch(fail);
        } else if (
            insights.snapshot &&
            (insights.busy ||
                insights.result?.saveError ||
                (matchesCurrent(insights.snapshot) && insights.chat.messages.length))
        ) {
            prepared = insights.snapshot;
            scope = { ...snapshot.scope };
            viewId = snapshot.view.id;
            memoId = snapshot.memoId;
        } else prepare();
        return () => {
            dead = true;
            serial++;
        };
    });
</script>

<section class="qm-review qm-insights" data-state={state}>
    <header class="qm-review-header">
        <Button label={t('back')} icon="close" disabled={phase === 'saving'} onclick={leave} />
        <strong>{history ? t('insightHistory') : snapshot?.view.title || t('view_' + viewId)}</strong>
        {#if conversation}<Button
                label={t('newInsightConversation')}
                disabled={busy || !!result?.saveError}
                onclick={newConversation}
            />{/if}
    </header>
    <div class="qm-insight-scroll" bind:this={scrollArea} onscroll={trackScroll}>
        {#if history}
            <p class="qm-insight-meta">{t('insightHistoryCount', { count: rows.length })}</p>
            <div class="qm-insight-history-list">
                {#each rows as row}<Button
                        label={row.title}
                        class="qm-insight-history"
                        onclick={() => openBlock(row.id)}
                    >
                        <span><strong>{row.title}</strong><small>{t('view_' + row.viewId)} · {row.created}</small></span
                        ><Icon name="chevron" />
                    </Button>{/each}
            </div>
            {#if !rows.length}<p class="qm-review-empty">{t('insightHistoryEmpty')}</p>{/if}
        {:else}
            <div class="qm-insight-section qm-insight-scope">
                <p>
                    {snapshot?.memoId || memoId
                        ? t('scopeSingle')
                        : shownScope.tag
                          ? '#' + shownScope.tag
                          : t('scopeAll')} · {scope.start || t('unlimited')} — {shownScope.end || t('unlimited')}
                </p>
                {#if !memoId && !conversation}<Button
                        label={t('adjustScope')}
                        disabled={busy}
                        onclick={() => (scopeOpen = true)}
                    />{/if}
            </div>
            {#if snapshot}
                <div class="qm-insight-section">
                    <Button
                        label={t('previewMaterials')}
                        class="qm-material-toggle"
                        aria-expanded={preview}
                        onclick={() => (preview = !preview)}
                    >
                        <span
                            >{t('sentSummary', { count: snapshot.sentCount, chars: snapshot.charCount })} · {snapshot
                                .model.name}</span
                        ><Icon name="chevron" />
                    </Button>
                    {#if preview}
                        <p class="qm-insight-meta">
                            {t('materialNotes')}
                            {snapshot.matchedCount} · {snapshot.dateStart} — {snapshot.dateEnd}
                        </p>
                        {#each snapshot.items as item}<div class="qm-material">
                                <time>{item.created}</time>
                                <p>{item.text}</p>
                            </div>{/each}
                    {/if}
                    {#if snapshot.omittedCount}<p class="qm-insight-meta">
                            {t('omittedCount', { count: snapshot.omittedCount })}
                        </p>{/if}
                </div>
                {#if !conversation}<p class="qm-insight-explanation">
                        {t('aiExternal', { model: snapshot.model.name })}
                    </p>{/if}
            {/if}
            <div class="qm-insight-messages" role="log" aria-label={t('insightConversation')} aria-live="off">
                {#each messages as message (message.id)}
                    {@const html =
                        message.role === 'assistant' && message.metadata?.state === 'complete' ? body(message) : null}
                    <article
                        class="qm-insight-message"
                        class:qm-insight-user={message.role === 'user'}
                        data-state={message.metadata?.state || 'streaming'}
                    >
                        <p class="qm-insight-meta">{t(message.role === 'user' ? 'insightYou' : 'pluginTitle')}</p>
                        {#if html}
                            <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                            <div class="qm-body qm-insight-body" onclick={source}>{@html html}</div>
                        {:else}<div class="qm-insight-text">{messageText(message)}</div>{/if}
                        {#if message.metadata?.state === 'cancelled'}<p class="qm-insight-meta">
                                {t('insightStopped')}
                            </p>
                        {:else if message.metadata?.errorCode}<p class="qm-insight-error">
                                {t(errorKeys[message.metadata.errorCode] || 'insightFailed')}
                            </p>{/if}
                    </article>
                {/each}
            </div>
            {#if conversation}
                <p class="qm-insight-explanation">{t('aiDisclaimer')}</p>
                <div class="qm-insight-actions">
                    <Button label={t('openNative')} disabled={!result?.id} onclick={() => openBlock(result.id)} />
                    <Button label={t('copyResult')} onclick={copy} />
                </div>
            {/if}
        {/if}
        {#if shownError}<p class="qm-insight-error" role="alert">{t(shownError)}</p>
            {#if ['aiNotConfigured', 'aiAuthUnsupported', 'aiProtocolUnsupported', 'aiConfigInvalid'].includes(shownError)}<Button
                    label={t('goAISettings')}
                    onclick={() => options.openAISettings()}
                />
            {:else if !conversation && !history}<Button label={t('retry')} disabled={preparing} onclick={prepare} />
            {:else if conversation && !busy && !result?.saveError}<Button
                    label={t('retryInsightAnswer')}
                    onclick={retry}
                />{/if}
        {/if}
        {#if result?.saveError}<p class="qm-insight-error" role="alert">{t('insightSaveFailed')}</p>
            <Button label={t('retrySave')} disabled={busy} onclick={save} />{/if}
    </div>
    {#if !history}
        <form
            class="qm-insight-composer"
            onsubmit={e => {
                e.preventDefault();
                generate();
            }}
        >
            <label for={inputId}>{t(conversation ? 'insightFollowUp' : 'insightQuestion')}</label>
            <textarea
                id={inputId}
                rows="2"
                bind:value={question}
                placeholder={t(conversation ? 'insightFollowUpPlaceholder' : 'question_' + viewId)}
                onkeydown={keydown}
                disabled={!snapshot || !!result?.saveError}></textarea>
            <div class="qm-insight-compose-actions">
                <span role="status" aria-live="polite"
                    >{preparing
                        ? t('insightPhase_preparing')
                        : busy && active
                          ? t(
                                'insightPhase_' +
                                    (phase === 'saving'
                                        ? 'saving'
                                        : insights.chat.status === 'streaming'
                                          ? 'streaming'
                                          : 'generating')
                            )
                          : phase === 'done'
                            ? t('insightPhase_done')
                            : ''}</span
                >
                {#if busy && active && phase !== 'saving'}<Button
                        label={t('stopInsight')}
                        onclick={() => insights.cancel()}
                    />
                {:else}<Button
                        label={t(conversation ? 'send' : 'startInsight')}
                        class="qm-primary"
                        disabled={!snapshot || busy || !!result?.saveError || (conversation && !question.trim())}
                        onclick={generate}
                    />{/if}
            </div>
            {#if !shared.settings.notebook}<Button label={t('chooseNotebook')} onclick={() => onsettings(true)} />{/if}
        </form>
    {/if}
    {#if scopeOpen}<Dialog
            class="qm-scope-dialog"
            label={t('insightScope')}
            closeLabel={t('closeDialog')}
            {root}
            onclose={() => (scopeOpen = false)}
        >
            <Scope
                initial={scope}
                onclose={() => (scopeOpen = false)}
                onapply={next => {
                    scope = next;
                    scopeOpen = false;
                    prepare();
                }}
            />
        </Dialog>{/if}
</section>

<style>
    .qm-insights {
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
        overflow: hidden;
        padding-bottom: 0;
    }
    .qm-review-header {
        flex-shrink: 0;
        width: 100%;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        gap: 8px;
    }
    .qm-review-header strong {
        flex: 1;
        min-width: 0;
    }
    .qm-insight-scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
    }
    .qm-insight-section {
        background: var(--qm-surface);
        border-radius: 12px;
        padding: 12px 16px;
        margin: 12px 0;
    }
    .qm-insight-scope {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .qm-insight-scope p {
        flex: 1;
        min-width: 0;
        margin: 0;
    }
    .qm-insight-scope :global(button) {
        flex-shrink: 0;
        color: var(--qm-link);
    }
    .qm-insights :global(.qm-material-toggle) {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
        padding: 0;
    }
    :global(.qm-material-toggle > span) {
        flex: 1;
    }
    .qm-insight-meta,
    .qm-insight-explanation,
    .qm-material time,
    :global(.qm-insight-history) small {
        color: var(--qm-text-secondary);
        font-size: 13px;
        line-height: 20px;
    }
    .qm-insight-explanation {
        font-size: 12px;
        padding: 0 16px;
    }
    .qm-material {
        border-top: 1px solid var(--qm-border);
        padding: 12px 0;
    }
    .qm-material p {
        white-space: pre-wrap;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
        overflow: hidden;
        line-height: 24px;
    }
    .qm-insight-message {
        padding: 8px 16px 16px;
        margin: 12px 0;
        background: var(--qm-surface);
        border-radius: 12px;
    }
    .qm-insight-user {
        background: var(--qm-fill);
        margin-left: 24px;
    }
    .qm-insight-text {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        line-height: 27px;
    }
    .qm-insight-body {
        overflow-wrap: anywhere;
    }
    .qm-insight-body :global(a[href^='siyuan://blocks/']) {
        padding: 1px 4px;
        border-radius: 4px;
        background: var(--qm-link-tint);
        color: var(--qm-link);
        font-size: 13px;
    }
    .qm-insight-body :global(h2) {
        font-size: 17px;
        margin-top: 20px;
    }
    .qm-insight-body :global(h3) {
        font-size: 15px;
        margin-top: 20px;
    }
    .qm-insight-actions {
        display: flex;
        gap: 12px;
        padding: 0 16px 12px;
    }
    .qm-insight-error {
        color: var(--qm-danger);
        padding: 0 16px;
    }
    .qm-insight-composer {
        flex-shrink: 0;
        background: var(--qm-surface);
        border-top: 1px solid var(--qm-border);
        padding: 12px 16px calc(var(--qm-composer-safe-bottom, env(safe-area-inset-bottom, 0px)) + 12px);
    }
    .qm-insight-composer label {
        font-size: 13px;
        color: var(--qm-text-secondary);
    }
    .qm-insight-composer textarea {
        box-sizing: border-box;
        display: block;
        width: 100%;
        margin: 8px 0;
        padding: 8px;
        border: 1px solid var(--qm-border);
        border-radius: 8px;
        background: var(--qm-bg);
        color: var(--qm-text);
        font: inherit;
        line-height: 24px;
        resize: vertical;
        max-height: 160px;
    }
    .qm-insight-compose-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 44px;
    }
    .qm-insight-compose-actions > span {
        color: var(--qm-text-secondary);
        font-size: 13px;
    }
    .qm-insight-compose-actions :global(button) {
        min-width: 88px;
    }
    .qm-insight-history-list {
        background: var(--qm-surface);
        border-radius: 12px;
        overflow: hidden;
    }
    :global(.qm-insight-history) {
        display: flex;
        min-height: 64px;
        width: 100%;
        text-align: left;
        padding: 8px 16px !important;
        gap: 12px;
    }
    :global(.qm-insight-history) + :global(.qm-insight-history) {
        border-top: 1px solid var(--qm-border);
    }
    :global(.qm-insight-history > span) {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    :global(.qm-insight-history) strong {
        font-size: 15px;
        font-weight: 400;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
    }
</style>
