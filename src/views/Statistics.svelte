<script>
    import { getContext } from 'svelte';
    import { CONTEXT } from './context.js';
    import Button from '../components/Button.svelte';
    const { options } = getContext(CONTEXT),
        { repository, t } = options;
    let { onback, choose } = $props();
    let kind = $state('month'),
        year = $state(new Date().getFullYear()),
        month = $state(new Date().getMonth() + 1),
        result = $state(null),
        state = $state('loading');
    let bars = $derived.by(() => {
        const prefix = String(year).padStart(4, '0');
        const count = kind === 'month' ? new Date(year, month, 0).getDate() : 12;
        return Array.from({ length: count }, (_, index) => {
            const date =
                prefix + (kind === 'month' ? String(month).padStart(2, '0') : '') + String(index + 1).padStart(2, '0');
            return { date, label: index + 1, count: result?.buckets.find(item => item.date === date)?.count || 0 };
        });
    });
    let max = $derived(Math.max(1, ...bars.map(bar => bar.count)));
    let metrics = $derived(
        result
            ? [
                  ['notes', result.memoCount],
                  ['statWords', result.wordCount],
                  ...(kind === 'month'
                      ? [
                            ['statMaxCount', result.maxCount],
                            ['statMaxWords', result.maxWords]
                        ]
                      : []),
                  ['recordDays', result.recordDays]
              ]
            : []
    );
    $effect(() => {
        const currentYear = year,
            currentMonth = kind === 'month' ? month : null;
        let live = true;
        state = 'loading';
        result = null;
        repository
            .periodStats({ year: currentYear, month: currentMonth })
            .then(value => {
                if (live) {
                    result = value;
                    state = 'ready';
                }
            })
            .catch(() => {
                if (live) state = 'error';
            });
        return () => (live = false);
    });
    function shift(delta) {
        if (kind === 'year') year += delta;
        else {
            const date = new Date(year, month - 1 + delta, 1);
            year = date.getFullYear();
            month = date.getMonth() + 1;
        }
    }
    function select(bar) {
        if (!bar.count) return;
        if (kind === 'month') choose({ day: bar.date });
        else {
            month = Number(bar.date.slice(4, 6));
            kind = 'month';
        }
    }
</script>

<section class="qm-review qm-statistics" aria-label={t('statistics')} data-state={state}>
    <header class="qm-review-header">
        <Button label={t('back')} icon="close" onclick={onback} /><strong>{t('statistics')}</strong>
    </header>
    <div class="qm-stat-tabs" role="group" aria-label={t('statPeriod')}>
        {#each ['month', 'year'] as value}<Button
                label={t(value === 'month' ? 'statMonth' : 'statYear')}
                aria-pressed={kind === value}
                onclick={() => (kind = value)}
            />{/each}
    </div>
    <div class="qm-stat-period">
        <Button label={t('previous')} icon="chevron-left" onclick={() => shift(-1)} /><strong
            >{year}{kind === 'month' ? '-' + String(month).padStart(2, '0') : ''}</strong
        ><Button label={t('next')} icon="chevron-right" onclick={() => shift(1)} />
    </div>
    {#if state === 'loading'}<p role="status">{t('loading')}</p>{:else if state === 'error'}<p role="alert">
            {t('statsFailed')}
        </p>{:else}
        <div class="qm-stat-metrics">
            {#each metrics as [key, value]}<div><strong>{value}</strong><span>{t(key)}</span></div>{/each}
        </div>
        <div class="qm-stat-chart" aria-label={t('statChart')}>
            <div class="qm-stat-bars">
                {#each bars as bar}<button
                        type="button"
                        class="qm-stat-bar"
                        disabled={!bar.count}
                        aria-label={t(kind === 'month' ? 'statDayCount' : 'statMonthCount', {
                            month: kind === 'month' ? month : bar.label,
                            day: bar.label,
                            count: bar.count
                        })}
                        title={t(kind === 'month' ? 'statDayCount' : 'statMonthCount', {
                            month: kind === 'month' ? month : bar.label,
                            day: bar.label,
                            count: bar.count
                        })}
                        onclick={() => select(bar)}
                        ><i style:height={(bar.count / max) * 100 + '%'}></i><small>{bar.label}</small></button
                    >{/each}
            </div>
            <span class="qm-stat-scale">{max}</span>
        </div>
    {/if}
</section>

<style>
    .qm-statistics {
        overflow-y: auto;
    }
    .qm-stat-tabs,
    .qm-stat-period {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin: 12px 0;
    }
    .qm-stat-tabs :global(button[aria-pressed='true']) {
        background: var(--qm-fill);
        color: var(--qm-brand);
    }
    .qm-stat-period strong {
        font-size: 17px;
    }
    .qm-stat-metrics {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 24px;
        margin: 24px 0;
    }
    .qm-stat-metrics div {
        display: flex;
        flex-direction: column;
        text-align: center;
        gap: 8px;
    }
    .qm-stat-metrics strong {
        font-size: 28px;
        font-variant-numeric: tabular-nums;
    }
    .qm-stat-metrics span {
        color: var(--qm-text-secondary);
        font-size: 13px;
    }
    .qm-stat-chart {
        overflow-x: auto;
        display: flex;
        margin: 24px 8px;
        gap: 8px;
    }
    .qm-stat-bars {
        display: flex;
        flex: 1 0 max-content;
        height: 220px;
        align-items: stretch;
        gap: 3px;
        padding-bottom: 20px;
    }
    .qm-statistics button.qm-stat-bar {
        flex: 1;
        display: flex;
        align-items: flex-end;
        position: relative;
        min-width: 44px;
        padding: 0;
        background: transparent;
        border: 0;
        color: var(--qm-text-secondary);
    }
    .qm-stat-bar:focus-visible {
        outline-offset: -2px;
    }
    .qm-stat-bar i {
        display: block;
        width: 100%;
        background: var(--qm-heat-3);
    }
    .qm-stat-bar small {
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        font-size: 10px;
        line-height: 20px;
    }
    .qm-stat-scale {
        color: var(--qm-text-secondary);
        font-size: 12px;
    }
    :global(.qm-root[data-layout='mobile']) .qm-stat-metrics {
        gap: 20px 0;
    }
    :global(.qm-root[data-layout='mobile']) .qm-stat-metrics div {
        flex-basis: 33%;
    }
</style>
