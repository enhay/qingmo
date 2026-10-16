import { Plugin, Dialog, Constants, openTab, openMobileFileById, getFrontend, openSetting } from 'siyuan';
import './styles/global.css';
import { createSharedState } from './state/shared.svelte.js';
import { mount, unmount } from 'svelte';
import FloatingCapture from './components/FloatingCapture.svelte';

const TAB_TYPE = 'qingmo-tab';
import { MemoRepository, DEFAULT_SETTINGS, COLLECT_TAG } from './core/data.js';
import { InsightService } from './core/insights.js';
import { createEditor } from './editor/editor.js';
import { transcribeAudio } from './core/transcription.js';
import { MemoHistory } from './core/history.js';
import { createView } from './views/mount.js';

import { safeHTML, renderBlockDOM } from './core/render.js';

export default class QingMoPlugin extends Plugin {
    async onload() {
        this.views = new Set();
        this.disposed = false;

        this.t = (key, values = {}) =>
            String(this.i18n[key] || key).replace(/\{(\w+)\}/g, (_, name) =>
                values[name] == null ? `{${name}}` : String(values[name])
            );
        this.request = async (path, body = {}, { signal } = {}) => {
            const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
            const response = await fetch(path, {
                method: 'POST',
                headers: multipart ? undefined : { 'Content-Type': 'application/json' },
                body: multipart ? body : JSON.stringify(body),
                signal
            });
            if (!response.ok) throw new Error(this.t('requestFailed', { code: response.status }));
            const envelope = await response.json();
            if (envelope.code !== 0) throw new Error(envelope.msg || this.t('requestFailed', { code: envelope.code }));
            return envelope.data;
        };
        this.repository = new MemoRepository(this.request);
        this.repository.history = new MemoHistory(this.repository, document);
        const saved = await this.loadData('settings.json');
        this.shared = createSharedState({
            initial: saved,
            persist: async settings => {
                const response = await this.saveData('settings.json', settings);
                if (response?.code)
                    throw Object.assign(new Error('SETTINGS_SAVE_FAILED'), { code: 'SETTINGS_SAVE_FAILED' });
            },
            onSaved: () => {
                this.updateFloating();
                this.refreshViews?.();
            }
        });
        this.insights = new InsightService({
            repository: this.repository,
            request: this.request,
            document,
            getModel: async () => {
                const { conf } = await this.request('/api/system/getConf');
                const ai = conf.ai,
                    id = ai?.editing?.modelId;
                for (const provider of ai?.providers || []) {
                    if (provider.enabled === false) continue;
                    const model = provider.models?.find(item => item.id === id);
                    if (model) return model.name || model.id;
                }
                return '';
            },
            loadResource: async path => {
                const response = await fetch(`/plugins/${this.name}/skills/qingmo-insights/${path}`);
                if (!response.ok)
                    throw Object.assign(new Error('INSIGHT_METHOD_MISSING'), { code: 'INSIGHT_METHOD_MISSING' });
                return response.text();
            },
            onChange: state => this.shared.setInsight(state)
        });
        if (this.disposed) return;
        this.mobile = ['mobile', 'browser-mobile'].includes(getFrontend());
        // 顶栏与侧栏图标：轻墨 logo 的单色线性简化（便签卡片、半透明墨浪、一滴墨），线宽与思源自带图标一致。
        this.addIcons(
            '<symbol id="iconQingMo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 15c2.4 1.6 5.6 1 8.6-1.3 2.2-1.7 4.8-2.6 6.8-1.9 1.9.9 1.9 3.8-.4 4.4-1.5.4-2.5.7-3.7 2.4-1.3 1.9-3.4 2.9-6.4 2.9h-.9a4 4 0 0 1-4-4z" fill="currentColor" fill-opacity=".35" stroke="none"/><path d="M2.6 17.4V7.6a4 4 0 0 1 3.5-4l7.4-1a4 4 0 0 1 4.5 4v5.1c1.9.9 1.9 3.8-.4 4.4-1.5.4-2.5.7-3.7 2.4-1.3 1.9-3.4 2.9-6.4 2.9h-.9a4 4 0 0 1-4-4z"/><path d="M2.6 15c2.4 1.6 5.6 1 8.6-1.3 2.2-1.7 4.8-2.6 6.8-1.9M6.8 7.6l5.8-.9M6.8 10.6l2.8-.4"/><circle cx="20" cy="19.6" r="1.6" fill="currentColor" stroke="none"/></symbol>'
        );
        this.addTopBar({ icon: 'iconQingMo', title: this.t('pluginTitle'), callback: () => this.open() });
        this.addCommand({ langKey: 'quickCapture', hotkey: '⌥⇧Q', callback: () => this.open(true) });
        const plugin = this;
        this.addDock({
            type: 'qingmo',
            config: {
                position: 'RightTop',
                size: { width: 380, height: 0 },
                icon: 'iconQingMo',
                title: this.t('pluginTitle')
            },
            data: {},
            init: function () {
                this.qingmoView = plugin.mount(this.element, 'dock');
            },
            destroy: function () {
                plugin.unmount(this.qingmoView);
            }
        });
        this.addTab({
            type: TAB_TYPE,
            init: function () {
                plugin.tabView = plugin.mount(this.element, 'tab');
            },
            destroy: function () {
                if (plugin.tabView) plugin.unmount(plugin.tabView);
                plugin.tabView = null;
            }
        });
        this.refreshViews = () => {
            for (const view of this.views) Promise.resolve(view.refresh()).catch(() => {});
        };
        this.keyboardHandler = () => {
            for (const view of this.views) view.keyboardChanged();
        };
        this.foregroundHandler = () => {
            if (document.visibilityState === 'visible') this.refreshViews();
        };
        this.blockMenuHandler = event => {
            const detail = event.detail;
            const blocks = detail?.blockElements || [];
            if (blocks.length !== 1) return;
            const block = blocks[0],
                id = block?.getAttribute('data-node-id');
            if (!id || block.getAttribute('data-type') === 'NodeDocument') return;
            if (
                String(detail.protyle.background?.ial?.tags || '')
                    .split(',')
                    .some(tag => tag.trim() === COLLECT_TAG)
            )
                return;
            const hasTag = element =>
                Array.from(element.querySelectorAll('[data-type~="tag"]')).some(tag => {
                    if (tag.textContent.replace(/^[\u2060\u200b#]+|[\u2060\u200b#]+$/g, '') !== COLLECT_TAG)
                        return false;
                    const owner = tag.closest('[data-node-id]');
                    const parent = owner?.parentElement?.closest('[data-node-id]');
                    const candidate =
                        owner?.getAttribute('data-type') === 'NodeParagraph' &&
                        ['NodeListItem', 'NodeBlockquote', 'NodeSuperBlock'].includes(parent?.getAttribute('data-type'))
                            ? parent
                            : owner;
                    return candidate === element;
                });
            const collected = element => element.getAttribute('custom-qingmo-memo') === '1' || hasTag(element);
            let ancestor = block.parentElement?.closest('[data-node-id]');
            while (ancestor) {
                if (ancestor.getAttribute('data-type') !== 'NodeHeading' && collected(ancestor)) return;
                ancestor = ancestor.parentElement?.closest('[data-node-id]');
            }
            const remove = collected(block);
            detail.menu.addItem({
                icon: 'iconQingMo',
                label: this.t(remove ? 'removeMemo' : 'addMemo'),
                click: async () => {
                    try {
                        const memo = await this.repository.get(id);
                        if (remove) {
                            if (!memo) return;
                            const explanation =
                                memo.marker === '1' && memo.tags.includes(COLLECT_TAG)
                                    ? 'removeBothExplanation'
                                    : memo.tags.includes(COLLECT_TAG)
                                      ? 'removeTagExplanation'
                                      : 'removeAttrExplanation';
                            if (!window.confirm(this.t('removeConfirm') + '\n' + this.t(explanation))) return;
                            await this.repository.remove(id);
                        } else {
                            if (!(await this.repository.canAdd(id))) return;
                            await this.repository.add(id);
                        }
                        this.refreshViews();
                    } catch (error) {
                        console.error('QingMo block menu action failed', error);
                        window.alert(this.t(remove ? 'removeFailed' : 'addFailed'));
                    }
                }
            });
        };
        this.eventBus.on('click-blockicon', this.blockMenuHandler);
        this.eventBus.on('sync-end', this.refreshViews);
        this.eventBus.on('mobile-keyboard-show', this.keyboardHandler);
        this.eventBus.on('mobile-keyboard-hide', this.keyboardHandler);
        document.addEventListener('visibilitychange', this.foregroundHandler);
        window.addEventListener('focus', this.refreshViews);
        window.visualViewport?.addEventListener('resize', this.keyboardHandler);
        window.visualViewport?.addEventListener('scroll', this.keyboardHandler);
        this.themeObserver = new MutationObserver(() => {
            for (const view of this.views) view.setTheme(this.theme());
        });
        this.themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-mode', 'data-light-theme', 'data-dark-theme']
        });
    }
    get settings() {
        return this.shared?.settings || DEFAULT_SETTINGS;
    }
    theme() {
        return window.siyuan.config.appearance.mode === 1 ? 'dark' : 'light';
    }
    mount(container, mode) {
        if (this.disposed) return null;
        const view = createView({
            container,
            request: this.request,
            insights: this.insights,
            openAISettings: () => openSetting(this.app),
            blockExists: async id =>
                /^\d{14}-[a-z0-9]{7}$/.test(id) &&
                (await this.repository.sql("SELECT id FROM blocks WHERE id='" + id + "' LIMIT 1")).length > 0,
            transcribeMemo: id => this.transcribeMemo(id),
            flushDrafts: () => {
                for (const active of this.views) active.flushDraft?.();
            },
            repository: this.repository,
            shared: this.shared,
            beforeCompose: () => {
                for (const other of this.views) if (other !== view && !other.releaseComposer()) return false;
                return true;
            },
            t: this.t,
            onClose: () => this.close(),
            mode,
            openBlock: id => {
                this.close();
                const action = [Constants.CB_GET_CONTEXT, Constants.CB_GET_HL];
                if (this.mobile) openMobileFileById(this.app, id, action);
                else openTab({ app: this.app, doc: { id, action, zoomIn: false } });
            },
            renderBlockDOM,
            renderMarkdown: markdown => {
                const lute = window.Lute.New();
                lute.SetTag(true);
                lute.SetMark(true);
                lute.SetSanitize(true);
                return safeHTML(lute.MarkdownStr('qingmo', markdown));
            }
        });
        this.views.add(view);
        view.setTheme(this.theme());
        return view;
    }
    async transcribeMemo(id) {
        if (this.transcribing?.has(id))
            throw Object.assign(new Error('TRANSCRIPTION_BUSY'), { code: 'TRANSCRIPTION_BUSY' });
        this.transcribing ||= new Set();
        this.transcribing.add(id);
        this.shared.setTranscription(id, 'transcribing');
        const element = document.createElement('div');
        const editor = createEditor({
            element,
            renderMarkdown: markdown => {
                const lute = window.Lute.New();
                lute.SetTag(true);
                lute.SetMark(true);
                return safeHTML(lute.MarkdownStr('qingmo', markdown));
            }
        });
        try {
            const memo = await this.repository.get(id);
            if (!memo || !['s', 'p'].includes(memo.type) || !editor.canEdit(memo.markdown, memo.dom))
                throw Object.assign(new Error('NATIVE_EDIT_REQUIRED'), { code: 'NATIVE_EDIT_REQUIRED' });
            editor.load(memo.markdown, renderBlockDOM(memo.dom));
            let baseline = memo.markdown;
            const segments = editor.audioSegments().filter(item => item.pending);
            for (const segment of segments) {
                const response = await fetch('/' + segment.path.replace(/^\//, ''));
                if (!response.ok) throw new Error('network');
                const text = await transcribeAudio(await response.blob(), {
                    request: this.request,
                    secretId: this.settings.tencentSecretId,
                    secretKey: this.settings.tencentSecretKey
                });
                if (this.disposed) return;
                const current = await this.repository.get(id);
                if (!current || current.markdown !== baseline)
                    throw Object.assign(new Error('MEMO_CHANGED'), { code: 'MEMO_CHANGED' });
                editor.applyTranscription(segment.key, text, { atCursor: false });
                await this.repository.save({ id, text: editor.value(), images: [] }, this.settings);
                baseline = (await this.repository.get(id)).markdown;
            }
            this.refreshViews();
        } finally {
            editor.destroy();
            this.transcribing.delete(id);
            this.shared.setTranscription(id, null);
        }
    }
    unmount(view) {
        if (view && this.views.delete(view)) view.destroy();
    }
    open(compose = false) {
        if (this.disposed) return;
        // 桌面端在思源标签页里打开，宽度够时用两栏布局；手机端全屏。
        if (!this.mobile) {
            const id = this.name + TAB_TYPE;
            // 思源恢复布局时标签页是懒加载的，openTab 看不到它们，会再开一个；先激活已恢复的那个。
            const restored = this.tabView
                ? null
                : Array.from(document.querySelectorAll('.layout-tab-bar .item[data-initdata]')).find(item => {
                      try {
                          return JSON.parse(item.dataset.initdata).customModelType === id;
                      } catch (_) {
                          return false;
                      }
                  });
            const opened = restored
                ? Promise.resolve(restored.click())
                : Promise.resolve(
                      openTab({
                          app: this.app,
                          custom: { icon: 'iconQingMo', title: this.t('pluginTitle'), data: {}, id }
                      })
                  );
            opened.then(() => {
                if (compose) requestAnimationFrame(() => this.tabView?.compose());
            });
            return;
        }
        if (!this.dialog) {
            for (const active of this.views) if (!active.releaseComposer()) return;
            let view;
            const dialog = new Dialog({
                title: this.t('pluginTitle'),
                content: '<div class="qingmo-host"></div>',
                width: '100vw',
                height: '100dvh',
                hideCloseIcon: true,
                destroyCallback: () => {
                    this.unmount(view);
                    if (this.dialog === dialog) {
                        this.dialog = null;
                        this.fullscreenView = null;
                        this.destroyDialog = null;
                        this.updateFloating();
                        if (!this.disposed) this.refreshViews();
                    }
                }
            });
            this.dialog = dialog;
            this.updateFloating();
            this.destroyDialog = dialog.destroy.bind(dialog);
            dialog.destroy = (...args) => {
                if (view?.handleBack?.()) return;
                this.destroyDialog?.(...args);
            };
            dialog.element.classList.add('qingmo-dialog');
            view = this.mount(dialog.element.querySelector('.qingmo-host'), 'fullscreen');
            this.fullscreenView = view;
        }
        if (compose) this.fullscreenView?.compose();
    }
    close() {
        this.destroyDialog?.();
    }
    onLayoutReady() {
        this.updateFloating();
        if (this.settings.openOnStartup) this.open(true);
    }
    updateFloating() {
        if (this.floating) unmount(this.floating);
        this.floating = null;
        if (!this.mobile || !this.settings.floatingButton || this.disposed || this.dialog) return;
        this.floating = mount(FloatingCapture, {
            target: document.body,
            props: { label: this.t('floatingCapture'), onclick: () => this.open(true) }
        });
    }
    onunload() {
        this.disposed = true;
        this.insights?.cancel();
        this.close();
        for (const view of Array.from(this.views || [])) this.unmount(view);
        if (this.floating) unmount(this.floating);
        this.floating = null;
        this.themeObserver?.disconnect();
        if (this.refreshViews) {
            this.eventBus.off('click-blockicon', this.blockMenuHandler);
            this.eventBus.off('sync-end', this.refreshViews);
            this.eventBus.off('mobile-keyboard-show', this.keyboardHandler);
            this.eventBus.off('mobile-keyboard-hide', this.keyboardHandler);
            document.removeEventListener('visibilitychange', this.foregroundHandler);
            window.removeEventListener('focus', this.refreshViews);
            window.visualViewport?.removeEventListener('resize', this.keyboardHandler);
            window.visualViewport?.removeEventListener('scroll', this.keyboardHandler);
        }
    }
}
