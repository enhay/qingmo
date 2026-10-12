'use strict';
const { Plugin, Dialog, Constants, openTab, openMobileFileById, getFrontend } = require('siyuan');

const TAB_TYPE = 'qingmo-tab';
const { MemoRepository, DEFAULT_SETTINGS } = require('./data');
const { createView } = require('./ui');

function safeHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const allowed = new Set('P BR STRONG EM DEL S UL OL LI BLOCKQUOTE PRE CODE A IMG SPAN DIV H1 H2 H3 H4 H5 H6 HR TABLE THEAD TBODY TR TH TD'.split(' '));
    for (const element of Array.from(template.content.querySelectorAll('*'))) {
        if (!allowed.has(element.tagName)) { element.remove(); continue; }
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            if (!['href', 'src', 'alt', 'title', 'class', 'data-type', 'data-content'].includes(name)) element.removeAttribute(attribute.name);
        }
        for (const name of ['href', 'src']) {
            const value = element.getAttribute(name);
            if (value == null) continue;
            const compact = value.replace(/[\u0000-\u0020\u007f]/g, '');
            const safe = name === 'src' ? /^(?:https?:\/\/|\/?assets\/)/i.test(compact) : /^(?:https?:\/\/|mailto:|siyuan:\/\/blocks\/|#|\/?assets\/)/i.test(compact);
            if (!safe) element.removeAttribute(name);
        }
        if (element.tagName === 'A') element.setAttribute('rel', 'noopener noreferrer');
    }
    return template.innerHTML;
}

module.exports = class QingMoPlugin extends Plugin {
    async onload() {
        this.views = new Set();
        this.disposed = false;
        this.settings = { ...DEFAULT_SETTINGS };
        this.t = (key, values = {}) => String(this.i18n[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] == null ? `{${name}}` : String(values[name]));
        this.repository = new MemoRepository(async (path, body = {}) => {
            const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
            const response = await fetch(path, { method: 'POST', headers: multipart ? undefined : { 'Content-Type': 'application/json' }, body: multipart ? body : JSON.stringify(body) });
            if (!response.ok) throw new Error(this.t('requestFailed', { code: response.status }));
            const envelope = await response.json();
            if (envelope.code !== 0) throw new Error(envelope.msg || this.t('requestFailed', { code: envelope.code }));
            return envelope.data;
        });
        const saved = await this.loadData('settings.json');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) Object.assign(this.settings, saved);
        if (this.disposed) return;
        this.mobile = ['mobile', 'browser-mobile'].includes(getFrontend());
        // 顶栏与侧栏图标：轻墨 logo 的单色线性简化（便签卡片、半透明墨浪、一滴墨），线宽与思源自带图标一致。
        this.addIcons('<symbol id="iconQingMo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 15c2.4 1.6 5.6 1 8.6-1.3 2.2-1.7 4.8-2.6 6.8-1.9 1.9.9 1.9 3.8-.4 4.4-1.5.4-2.5.7-3.7 2.4-1.3 1.9-3.4 2.9-6.4 2.9h-.9a4 4 0 0 1-4-4z" fill="currentColor" fill-opacity=".35" stroke="none"/><path d="M2.6 17.4V7.6a4 4 0 0 1 3.5-4l7.4-1a4 4 0 0 1 4.5 4v5.1c1.9.9 1.9 3.8-.4 4.4-1.5.4-2.5.7-3.7 2.4-1.3 1.9-3.4 2.9-6.4 2.9h-.9a4 4 0 0 1-4-4z"/><path d="M2.6 15c2.4 1.6 5.6 1 8.6-1.3 2.2-1.7 4.8-2.6 6.8-1.9M6.8 7.6l5.8-.9M6.8 10.6l2.8-.4"/><circle cx="20" cy="19.6" r="1.6" fill="currentColor" stroke="none"/></symbol>');
        this.addTopBar({ icon: 'iconQingMo', title: this.t('pluginTitle'), callback: () => this.open() });
        this.addCommand({ langKey: 'quickCapture', hotkey: '⌥⇧Q', callback: () => this.open(true) });
        const plugin = this;
        this.addDock({ type: 'qingmo', config: { position: 'RightTop', size: { width: 380, height: 0 }, icon: 'iconQingMo', title: this.t('pluginTitle') }, data: {}, init: function () { this.qingmoView = plugin.mount(this.element, 'dock'); }, destroy: function () { plugin.unmount(this.qingmoView); } });
        this.addTab({ type: TAB_TYPE, init: function () { plugin.tabView = plugin.mount(this.element, 'tab'); }, destroy: function () { if (plugin.tabView) plugin.unmount(plugin.tabView); plugin.tabView = null; } });
        this.refreshViews = () => { for (const view of this.views) Promise.resolve(view.refresh()).catch(() => {}); };
        this.keyboardHandler = () => { for (const view of this.views) view.keyboardChanged(); };
        this.foregroundHandler = () => { if (document.visibilityState === 'visible') this.refreshViews(); };
        this.blockMenuHandler = event => {
            const detail = event.detail;
            const blocks = detail?.blockElements || [];
            if (blocks.length !== 1) return;
            const block = blocks[0], id = block?.getAttribute('data-node-id');
            if (!id || block.getAttribute('data-type') === 'NodeDocument') return;
            if (String(detail.protyle.background?.ial?.tags || '').split(',').some(tag => tag.trim() === '轻墨')) return;
            const hasTag = element => Array.from(element.querySelectorAll('[data-type~="tag"]')).some(tag => {
                if (tag.textContent.replace(/^[\u2060\u200b#]+|[\u2060\u200b#]+$/g, '') !== '轻墨') return false;
                const owner = tag.closest('[data-node-id]');
                const parent = owner?.parentElement?.closest('[data-node-id]');
                const candidate = owner?.getAttribute('data-type') === 'NodeParagraph' &&
                    ['NodeListItem', 'NodeBlockquote', 'NodeSuperBlock'].includes(parent?.getAttribute('data-type')) ? parent : owner;
                return candidate === element;
            });
            const collected = element => element.getAttribute('custom-qingmo-memo') === '1' || hasTag(element);
            let ancestor = block.parentElement?.closest('[data-node-id]');
            while (ancestor) {
                if (ancestor.getAttribute('data-type') !== 'NodeHeading' && collected(ancestor)) return;
                ancestor = ancestor.parentElement?.closest('[data-node-id]');
            }
            const remove = collected(block);
            detail.menu.addItem({ icon: 'iconQingMo', label: this.t(remove ? 'removeMemo' : 'addMemo'), click: async () => {
                try {
                    const memo = await this.repository.get(id);
                    if (remove) {
                        if (!memo) return;
                        const explanation = memo.marker === '1' && memo.tags.includes('轻墨') ? 'removeBothExplanation' : memo.tags.includes('轻墨') ? 'removeTagExplanation' : 'removeAttrExplanation';
                        if (!window.confirm(this.t('removeConfirm') + '\n' + this.t(explanation))) return;
                        await this.repository.remove(id);
                    } else {
                        if (!await this.repository.canAdd(id)) return;
                        await this.repository.add(id);
                    }
                    this.refreshViews();
                } catch (error) {
                    console.error('QingMo block menu action failed', error);
                    window.alert(this.t(remove ? 'removeFailed' : 'addFailed'));
                }
            } });
        };
        this.eventBus.on('click-blockicon', this.blockMenuHandler);
        this.eventBus.on('sync-end', this.refreshViews);
        this.eventBus.on('mobile-keyboard-show', this.keyboardHandler);
        this.eventBus.on('mobile-keyboard-hide', this.keyboardHandler);
        document.addEventListener('visibilitychange', this.foregroundHandler);
        window.addEventListener('focus', this.refreshViews);
        window.visualViewport?.addEventListener('resize', this.keyboardHandler);
        window.visualViewport?.addEventListener('scroll', this.keyboardHandler);
        this.themeObserver = new MutationObserver(() => { for (const view of this.views) view.setTheme(this.theme()); });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode', 'data-light-theme', 'data-dark-theme'] });
    }
    theme() { return window.siyuan.config.appearance.mode === 1 ? 'dark' : 'light'; }
    mount(container, mode) {
        if (this.disposed) return null;
        const view = createView({ container, repository: this.repository, settings: this.settings, beforeCompose: () => { for (const other of this.views) if (other !== view && !other.releaseComposer()) return false; return true; }, saveSettings: async settings => { await this.saveData('settings.json', settings); Object.assign(this.settings, settings); this.updateFloating(); }, t: this.t, onClose: () => this.close(), mode, openBlock: id => { this.close(); const action = [Constants.CB_GET_CONTEXT, Constants.CB_GET_HL]; if (this.mobile) openMobileFileById(this.app, id, action); else openTab({ app: this.app, doc: { id, action, zoomIn: false } }); }, renderMarkdown: markdown => { const lute = window.Lute.New(); lute.SetTag(true); lute.SetSanitize(true); return safeHTML(lute.MarkdownStr('qingmo', markdown)); } });
        this.views.add(view);
        view.setTheme(this.theme());
        return view;
    }
    unmount(view) { if (view && this.views.delete(view)) view.destroy(); }
    open(compose = false) {
        if (this.disposed) return;
        // 桌面端在思源标签页里打开，宽度够时用两栏布局；手机端全屏。
        if (!this.mobile) {
            const id = this.name + TAB_TYPE;
            // 思源恢复布局时标签页是懒加载的，openTab 看不到它们，会再开一个；先激活已恢复的那个。
            const restored = this.tabView ? null : Array.from(document.querySelectorAll('.layout-tab-bar .item[data-initdata]')).find(item => { try { return JSON.parse(item.dataset.initdata).customModelType === id; } catch (_) { return false; } });
            const opened = restored ? Promise.resolve(restored.click()) : Promise.resolve(openTab({ app: this.app, custom: { icon: 'iconQingMo', title: this.t('pluginTitle'), data: {}, id } }));
            opened.then(() => { if (compose) requestAnimationFrame(() => this.tabView?.compose()); });
            return;
        }
        if (!this.dialog) {
            for (const active of this.views) if (!active.releaseComposer()) return;
            let view;
            const dialog = new Dialog({ title: this.t('pluginTitle'), content: '<div class="qingmo-host"></div>', width: '100vw', height: '100dvh', hideCloseIcon: true, destroyCallback: () => { this.unmount(view); if (this.dialog === dialog) { this.dialog = null; this.fullscreenView = null; this.destroyDialog = null; this.updateFloating(); if (!this.disposed) this.refreshViews(); } } });
            this.dialog = dialog;
            this.updateFloating();
            this.destroyDialog = dialog.destroy.bind(dialog);
            dialog.destroy = (...args) => { if (view?.handleBack?.()) return; this.destroyDialog?.(...args); };
            dialog.element.classList.add('qingmo-dialog');
            view = this.mount(dialog.element.querySelector('.qingmo-host'), 'fullscreen');
            this.fullscreenView = view;
        }
        if (compose) this.fullscreenView?.compose();
    }
    close() { this.destroyDialog?.(); }
    onLayoutReady() {
        this.updateFloating();
        if (this.settings.openOnStartup) this.open(true);
    }
    updateFloating() {
        this.floating?.remove();
        this.floating = null;
        if (!this.mobile || !this.settings.floatingButton || this.disposed || this.dialog) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qingmo-floating';
        button.setAttribute('aria-label', this.t('floatingCapture'));
        button.textContent = '+';
        button.style.cssText = 'position:fixed;right:20px;bottom:calc(72px + env(safe-area-inset-bottom));width:52px;height:52px;border-radius:50%;border:1px solid var(--b3-border-color);background:var(--b3-theme-primary);color:var(--b3-theme-on-primary);font-size:30px;z-index:100;';
        button.addEventListener('click', () => this.open(true));
        document.body.appendChild(button);
        this.floating = button;
    }
    onunload() {
        this.disposed = true;
        this.close();
        for (const view of Array.from(this.views || [])) this.unmount(view);
        this.floating?.remove();
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
};
