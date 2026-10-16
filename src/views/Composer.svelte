<script>
    import { getContext, onMount, tick } from 'svelte';
    import { CONTEXT, safeURL } from './context.js';
    import { parseMemoMarkdown, normalizeTags, DraftStore, COLLECT_TAG } from '../core/data.js';
    import { startRecording, transcribeAudio, audioErrorCode } from '../core/transcription.js';
    import RichEditor from '../editor/RichEditor.svelte';
    import Button from '../components/Button.svelte';
    import AudioPlayer from '../components/AudioPlayer.svelte';
    const { options, shared } = getContext(CONTEXT),
        { repository, t, renderMarkdown, renderBlockDOM, openBlock, beforeCompose } = options;
    let { layout, stats, onclose, onopen, onnotify, onsaved, onsettings } = $props();
    let sheet,
        file,
        editor,
        element,
        candidates,
        images = $state([]),
        busy = $state(false),
        uploading = $state(false),
        draftId = $state('new'),
        editingMemo = null,
        stale = true,
        opened = false,
        dead = false;
    let value = $state(''),
        active = $state({}),
        tagOptions = $state([]),
        candidate = $state(-1),
        candidateLeft = $state(8),
        candidateTop = $state(8),
        tagName = '',
        dismissedTag = null,
        timer;
    let references = $state([]),
        referenceIndex = $state(-1),
        referenceTimer,
        referenceRequest = 0,
        dismissedReference = null;
    let storage;
    try {
        storage = options.container.ownerDocument.defaultView.localStorage;
    } catch {
        storage = null;
    }
    const drafts = new DraftStore(storage),
        doc = options.container.ownerDocument,
        win = doc.defaultView;
    let levels = $state([]),
        recordCaret;
    const formatId = $props.id();
    let formatOpen = $state(false),
        formatControl = $state(),
        formatPanel = $state(),
        formatCaret;
    async function toggleFormat(event) {
        formatOpen = !formatOpen;
        if (!formatOpen) {
            editor.restoreCaret(formatCaret);
            return;
        }
        formatCaret = editor.captureCaret();
        await tick();
        if (event.detail === 0) formatPanel.querySelector('button')?.focus();
    }
    function applyFormat(key) {
        editor.restoreCaret(formatCaret);
        editor.command(key);
        formatCaret = editor.captureCaret();
    }
    function formatKeys(event) {
        if (!formatOpen || !sheet?.contains(event.target)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            formatOpen = false;
            editor.restoreCaret(formatCaret);
            return;
        }
        if (formatPanel?.contains(event.target) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const buttons = [...formatPanel.querySelectorAll('button')],
                index = buttons.indexOf(doc.activeElement);
            buttons[
                event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
            ]?.focus();
        }
    }
    function dismissFormat(event) {
        if (formatOpen && !formatControl?.contains(event.target)) formatOpen = false;
    }
    let pendingUpload = $state(null),
        recordStarting = $state(false);
    let recording = $state(false),
        seconds = $state(0),
        audioRows = $state([]),
        transcribing = $state({}),
        audioErrors = $state({}),
        recorder,
        recordSerial = 0;
    const requests = new Map();
    let inline = $derived(layout === 'desktop');
    export function flushDraft() {
        clearTimeout(timer);
        if (editor && (inline ? !stale : opened) && !busy) {
            try {
                if (!drafts.save(draftId, { text: editor.value(), images: images.slice() }))
                    onnotify('draftUnavailable');
                else shared.setDraft(draftId, Boolean(editor.value().trim() || images.length));
            } catch {
                onnotify('draftUnavailable');
            }
        }
    }
    function syncAudio() {
        audioRows = editor?.audioSegments() || [];
    }
    function stopRequests() {
        recordSerial++;
        recorder?.cancel();
        recorder = null;
        recording = false;
        for (const [key, controller] of requests) {
            controller.abort();
            shared.setTranscription?.(draftId + ':' + key, null);
        }
        requests.clear();
        transcribing = {};
    }
    function queueDraft() {
        syncAudio();
        clearTimeout(timer);
        timer = setTimeout(flushDraft, 300);
    }
    export function place(target) {
        if (!sheet || !target) return;
        const focused = sheet.contains(doc.activeElement);
        flushDraft();
        target.append(sheet);
        if (inline && !busy && !uploading) loadDraft(editingMemo);
        else stale = true;
        if (focused) {
            if (inline) element.focus();
            else compose(editingMemo);
        }
        resizeInput();
    }
    export function resizeInput() {
        if (!element) return;
        const min = inline ? 48 : 116,
            max = inline ? 360 : Math.max(116, (win.visualViewport?.height || win.innerHeight) - 200);
        element.style.height = 'auto';
        element.style.height = Math.max(min, Math.min(element.scrollHeight, max)) + 'px';
    }
    function editorHTML(memo, attachments) {
        const template = doc.createElement('template');
        template.innerHTML = renderBlockDOM(memo.dom);
        for (const path of attachments.slice().reverse()) {
            const imgs = [...template.content.querySelectorAll('img')].filter(
                img => (img.getAttribute('src') || '').replace(/^\//, '') === path
            );
            const img = imgs.pop();
            if (img) {
                const parent = img.parentElement;
                img.remove();
                if (parent && !parent.textContent.trim() && !parent.querySelector('img')) parent.remove();
            }
        }
        return template.innerHTML;
    }
    export function loadDraft(memo) {
        if (!editor) return;
        formatOpen = false;
        stopRequests();
        editingMemo = memo || null;
        draftId = memo?.id || 'new';
        let saved;
        try {
            saved = drafts.load(draftId);
        } catch {
            onnotify('draftUnavailable');
        }
        shared.setDraft(draftId, Boolean(saved && (saved.text.trim() || saved.images.length)));
        const original = memo ? parseMemoMarkdown(memo.markdown) : { text: '', images: [] };
        editor.load(
            saved?.text ?? original.text,
            saved ? undefined : memo && renderBlockDOM ? editorHTML(memo, original.images) : undefined
        );
        value = editor.value();
        images = (saved?.images || original.images || []).filter(p => safeURL(p, true));
        stale = false;
        tagOptions = [];
        syncAudio();
        tick().then(resizeInput);
    }
    export async function compose(memo) {
        if (!editor) {
            await tick();
            if (!editor) return;
        }
        if (pendingUpload) {
            onnotify('audioUploadFailed');
            return;
        }
        if (busy || uploading || (beforeCompose && !beforeCompose())) return;
        if (memo && shared.transcription?.[memo.id]) {
            onnotify('transcribing');
            return;
        }
        if (memo && !editor.canEdit(parseMemoMarkdown(memo.markdown).text, memo.dom)) {
            onnotify('nativeEditRequired');
            openBlock(memo.id);
            return;
        }
        flushDraft();
        loadDraft(memo);
        opened = true;
        onopen();
        await tick();
        element.focus();
        resizeInput();
        if (!memo && !shared.settings.notebook) {
            closeCompose();
            onsettings(true);
        }
    }
    export function closeCompose() {
        formatOpen = false;
        if (pendingUpload) {
            onnotify('audioUploadFailed');
            return;
        }
        if (busy || uploading) return;
        stopRequests();
        if (inline) {
            if (draftId !== 'new') compose();
            else element?.blur();
            return;
        }
        flushDraft();
        opened = false;
        onclose();
    }
    export function releaseComposer() {
        if (busy || uploading || recording || pendingUpload) return false;
        stopRequests();
        if (inline) {
            flushDraft();
            stale = true;
        } else if (opened) closeCompose();
        return true;
    }
    export function isEditing() {
        return draftId !== 'new';
    }
    export async function reference(memo) {
        flushDraft();
        const saved = drafts.load('new');
        if (saved && (saved.text?.trim() || saved.images?.length) && !win.confirm(t('replaceDraftReference'))) return;
        await compose();
        if (draftId !== 'new' || (!inline && !opened)) return;
        editor.load('');
        images = [];
        editor.insertReference(memo.id, parseMemoMarkdown(memo.markdown).text.slice(0, 60));
        value = editor.value();
        syncAudio();
        flushDraft();
    }
    export async function beginRecording() {
        if (recording || recordStarting || busy || uploading) return;
        if (inline) {
            if (beforeCompose && !beforeCompose()) return;
            if (stale) loadDraft(editingMemo);
        }
        if (!inline && !opened) await compose();
        if (!inline && !opened) return;
        const token = ++recordSerial;
        recordStarting = true;
        try {
            const next = await startRecording({
                onLevel: values => {
                    if (token === recordSerial) levels = values;
                },
                onTick: elapsed => {
                    if (token === recordSerial) seconds = Math.floor(elapsed);
                },
                onLimit: () => {
                    if (token === recordSerial) {
                        onnotify('recordingLimit');
                        finishRecording();
                    }
                }
            });
            if (dead || token !== recordSerial) {
                next.cancel();
                return;
            }
            recorder = next;
            seconds = 0;
            recording = true;
        } catch (e) {
            if (token === recordSerial) onnotify('audioError_' + audioErrorCode(e));
        } finally {
            recordStarting = false;
        }
    }
    async function uploadRecording(blob) {
        const token = recordSerial;
        uploading = true;
        try {
            const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
            const paths = await repository.upload([
                new File([blob], 'qingmo-' + Date.now() + '.' + extension, { type: blob.type })
            ]);
            if (dead || token !== recordSerial) return;
            pendingUpload = null;
            const currentCaret = editor.captureCaret();
            editor.restoreCaret(recordCaret);
            const segment = editor.insertAudio(paths[0], { pending: true });
            if (currentCaret) editor.restoreCaret(currentCaret);
            syncAudio();
            value = editor.value();
            flushDraft();
            if (segment && shared.settings.tencentSecretId && shared.settings.tencentSecretKey)
                transcribe(segment, blob);
        } catch {
            if (!dead && token === recordSerial) {
                pendingUpload = blob;
                onnotify('audioUploadFailed');
            }
        } finally {
            if (!dead) uploading = false;
        }
    }
    async function finishRecording() {
        const current = recorder,
            token = recordSerial;
        if (!current) return;
        recorder = null;
        recording = false;
        recordCaret = editor.captureCaret();
        try {
            const blob = await current.stop();
            if (blob && !dead && token === recordSerial) await uploadRecording(blob);
        } catch (e) {
            if (!dead) onnotify('audioError_' + audioErrorCode(e));
        }
    }
    async function transcribe(segment, blob) {
        if (requests.has(segment.key)) return;
        const controller = new AbortController(),
            id = draftId;
        requests.set(segment.key, controller);
        shared.setTranscription?.(draftId + ':' + segment.key, { draftId, path: segment.path, phase: 'transcribing' });
        transcribing = { ...transcribing, [segment.key]: true };
        audioErrors = { ...audioErrors, [segment.key]: '' };
        try {
            if (!blob) {
                const response = await win.fetch(safeURL(segment.path, true), { signal: controller.signal });
                if (!response.ok) throw new Error('audio fetch');
                blob = await response.blob();
            }
            const text = await transcribeAudio(blob, {
                secretId: shared.settings.tencentSecretId,
                secretKey: shared.settings.tencentSecretKey,
                request: options.request,
                signal: controller.signal
            });
            if (!dead && !controller.signal.aborted && id === draftId) {
                editor.applyTranscription(segment.key, text, { atCursor: true });
                value = editor.value();
                syncAudio();
                flushDraft();
            }
        } catch (e) {
            if (!dead && !controller.signal.aborted)
                audioErrors = { ...audioErrors, [segment.key]: 'audioError_' + audioErrorCode(e) };
        } finally {
            if (requests.get(segment.key) === controller) {
                requests.delete(segment.key);
                shared.setTranscription?.(id + ':' + segment.key, null);
                transcribing = { ...transcribing, [segment.key]: false };
            }
        }
    }
    export function canEdit(markdown, dom) {
        return editor?.canEdit(markdown, dom) || false;
    }
    export function hasDraft(id) {
        flushDraft();
        const saved = drafts.load(id);
        return saved && (saved.text?.trim() || saved.images?.length) ? saved : null;
    }
    export function removeDraft(id) {
        drafts.remove(id);
        shared.setDraft(id, false);
    }
    export async function reloadMemo(id) {
        if (draftId === id) loadDraft(await repository.get(id));
    }
    export function draftHasNativeTag(text) {
        if (!renderMarkdown) return false;
        const template = doc.createElement('template');
        template.innerHTML = renderMarkdown(normalizeTags(text));
        return [...template.content.querySelectorAll('[data-type~="tag"],em')].some(node => {
            if (node.closest('code,pre')) return false;
            const value = node.textContent.replace(/[\u200b\u2060]/g, '').trim();
            return node.getAttribute('data-type')?.split(' ').includes('tag')
                ? value.replace(/^#|#$/g, '') === COLLECT_TAG
                : value === '#' + COLLECT_TAG + '#';
        });
    }
    async function submit() {
        if (busy || uploading || recording || pendingUpload || (!value.trim() && !images.length)) return;
        if (draftId === 'new' && !shared.settings.notebook) {
            onsettings(true);
            return;
        }
        if (
            editingMemo?.external &&
            editingMemo.marker !== '1' &&
            editingMemo.tags.includes(COLLECT_TAG) &&
            !draftHasNativeTag(editor.value()) &&
            !win.confirm(t('editRemovesTagConfirm'))
        )
            return;
        const hasPending = audioRows.some(x => x.pending);
        flushDraft();
        stopRequests();
        formatOpen = false;
        busy = true;
        let savedId;
        try {
            savedId = await repository.save(
                { id: draftId === 'new' ? undefined : draftId, text: editor.value(), images: images.slice() },
                shared.settings
            );
        } catch (error) {
            if (dead) return;
            busy = false;
            onnotify(
                error.code === 'HISTORY_SNAPSHOT_FAILED'
                    ? 'historySnapshotFailed'
                    : error.code === 'MEMO_STRUCTURED_EDIT'
                      ? 'structuredEditFailed'
                      : 'saveFailed'
            );
            element.focus();
            return;
        }
        if (dead) return;
        try {
            drafts.remove(draftId);
            shared.setDraft(draftId, false);
        } catch {
            onnotify('draftUnavailable');
        }
        busy = false;
        editor.load('');
        value = '';
        images = [];
        draftId = 'new';
        editingMemo = null;
        tagOptions = [];
        if (!inline) {
            opened = false;
            onclose();
        }
        syncAudio();
        await onsaved(savedId, hasPending);
        resizeInput();
        if (inline) element.focus();
    }
    async function upload(e) {
        const files = [...e.currentTarget.files];
        e.currentTarget.value = '';
        await uploadFiles(files);
    }
    async function uploadFiles(input) {
        if (busy || uploading) return;
        const files = input.filter(file => file.type.startsWith('image/'));
        if (files.length !== input.length) onnotify('imagesOnly');
        if (!files.length) return;
        uploading = true;
        onnotify('uploading');
        try {
            const paths = await repository.upload(files);
            if (!dead) {
                images.push(...paths);
                onnotify('uploaded');
            }
        } catch (error) {
            if (!dead) {
                images.push(...(error.paths || []));
                onnotify('uploadFailed');
            }
        } finally {
            if (!dead) {
                uploading = false;
                images = images.filter(p => safeURL(p, true));
                flushDraft();
            }
        }
    }
    async function tagCandidates() {
        clearTimeout(referenceTimer);
        const request = ++referenceRequest;
        const ref = editor.token('@');
        if (ref && !editor.composing) {
            tagOptions = [];
            if (dismissedReference === ref.name) return;
            dismissedReference = null;
            references = [];
            referenceIndex = -1;
            referenceTimer = setTimeout(async () => {
                try {
                    const items = await repository.referenceCandidates(ref.name, draftId === 'new' ? '' : draftId);
                    if (dead || request !== referenceRequest || editor.token('@')?.name !== ref.name) return;
                    references = items;
                    await positionCandidates(ref);
                } catch {
                    if (!dead && request === referenceRequest) onnotify('referenceSearchFailed');
                }
            }, 180);
            return;
        }
        references = [];
        dismissedReference = null;
        editor.highlightToken();
        const token = editor.token();
        if (!token) {
            tagOptions = [];
            tagName = '';
            candidate = -1;
            dismissedTag = null;
            return;
        }
        if (token.name !== tagName) {
            candidate = -1;
            dismissedTag = null;
        }
        tagName = token.name;
        if (dismissedTag === tagName) return;
        tagOptions = (stats.tags || [])
            .filter(x => x.name.toLocaleLowerCase().includes(token.name.toLocaleLowerCase()))
            .sort((a, b) => String(b.lastUsed).localeCompare(String(a.lastUsed)))
            .slice(0, 6);
        if (token.name && !(stats.tags || []).some(x => x.name.toLocaleLowerCase() === token.name.toLocaleLowerCase()))
            tagOptions.push({ name: token.name, create: true });
        await positionCandidates(token);
    }
    async function positionCandidates(token) {
        await tick();
        if (!candidates || (!tagOptions.length && !references.length)) return;
        const caret = token.range.getBoundingClientRect(),
            box = sheet.getBoundingClientRect();
        candidateLeft = Math.max(8, Math.min(caret.left - box.left, box.width - candidates.offsetWidth - 8));
        const below = caret.bottom - box.top + sheet.scrollTop + 4;
        candidateTop =
            below + candidates.offsetHeight > sheet.scrollTop + box.height
                ? Math.max(sheet.scrollTop + 8, caret.top - box.top + sheet.scrollTop - candidates.offsetHeight - 4)
                : below;
    }
    function complete(name) {
        editor.completeTag(name);
        candidate = -1;
        dismissedTag = null;
        tagOptions = [];
    }
    function keydown(e) {
        if (e.isComposing || editor.composing || e.keyCode === 229) return;
        const format =
            (e.ctrlKey || e.metaKey) &&
            !e.altKey &&
            { b: !e.shiftKey && 'bold', u: !e.shiftKey && 'underline', h: e.shiftKey && 'highlight' }[
                e.key.toLowerCase()
            ];
        if (format) {
            e.preventDefault();
            e.stopPropagation();
            editor.command(format);
            return;
        }
        if (editor.token('@')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                dismissedReference = editor.token('@').name;
                references = [];
                ++referenceRequest;
                return;
            }
            if (references.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Enter') completeReference(references[Math.max(0, referenceIndex)]);
                else
                    referenceIndex =
                        (referenceIndex + (e.key === 'ArrowDown' ? 1 : -1) + references.length) % references.length;
                return;
            }
        }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
            return;
        }
        const token = editor.token();
        if (!token) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            dismissedTag = token.name;
            tagOptions = [];
            return;
        }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && tagOptions.length) {
            e.preventDefault();
            candidate =
                candidate < 0
                    ? e.key === 'ArrowDown'
                        ? 0
                        : tagOptions.length - 1
                    : (candidate + (e.key === 'ArrowDown' ? 1 : -1) + tagOptions.length) % tagOptions.length;
            return;
        }
        if (e.key === 'Enter' && token.name) {
            e.preventDefault();
            e.stopPropagation();
            complete(
                candidate >= 0
                    ? tagOptions[candidate].name
                    : (stats.tags || []).find(x => x.name.toLocaleLowerCase() === token.name.toLocaleLowerCase())
                          ?.name || token.name
            );
        }
    }
    function completeReference(item) {
        editor.completeReference(item.id, item.label);
        references = [];
        ++referenceRequest;
    }
    function ready(api, node) {
        editor = api;
        element = node;
        if (inline) loadDraft();
    }
    function selection(api) {
        if (formatOpen) formatCaret = api.captureCaret();
        active = Object.fromEntries(
            ['bold', 'underline', 'highlight', 'unordered', 'ordered', 'quote'].map(key => [key, api.active(key)])
        );
    }
    onMount(() => {
        if (storage)
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (key?.startsWith('qingmo:draft:')) {
                    const id = key.slice('qingmo:draft:'.length),
                        saved = drafts.load(id);
                    shared.setDraft(id, Boolean(saved && (saved.text.trim() || saved.images.length)));
                }
            }
        doc.addEventListener('pointerdown', dismissFormat, true);
        doc.addEventListener('keydown', formatKeys, true);
        const visibility = () => {
            if (doc.hidden) flushDraft();
        };
        doc.addEventListener('visibilitychange', visibility);
        win.addEventListener('pagehide', flushDraft);
        return () => {
            flushDraft();
            stopRequests();
            dead = true;
            clearTimeout(timer);
            clearTimeout(referenceTimer);
            ++referenceRequest;
            doc.removeEventListener('pointerdown', dismissFormat, true);
            doc.removeEventListener('keydown', formatKeys, true);
            doc.removeEventListener('visibilitychange', visibility);
            win.removeEventListener('pagehide', flushDraft);
        };
    });
</script>

<section
    bind:this={sheet}
    class="qm-sheet"
    role={inline ? 'region' : 'dialog'}
    aria-modal={inline ? undefined : true}
    aria-label={t(draftId === 'new' ? 'compose' : 'edit')}
>
    <Button label={t('closeInput')} class="qm-handle" onclick={closeCompose}><span></span></Button>
    <RichEditor
        {renderMarkdown}
        label={t(draftId === 'new' ? 'compose' : 'edit')}
        placeholder={t('inputPlaceholder')}
        disabled={busy}
        onready={ready}
        onfiles={uploadFiles}
        onchange={api => {
            value = api.value();
            queueDraft();
            resizeInput();
            tagCandidates();
        }}
        onselection={selection}
        onkeydown={keydown}
        onkeyup={e => {
            if (!e.isComposing && !editor.composing && !['Enter', 'Escape', 'ArrowDown', 'ArrowUp'].includes(e.key))
                tagCandidates();
        }}
        onfocus={() => {
            if (inline && stale && !busy && !uploading && (!beforeCompose || beforeCompose())) loadDraft(editingMemo);
        }}
    />
    {#if pendingUpload}<div role="alert">
            {t('audioUploadFailed')}<Button
                label={t('retryUpload')}
                disabled={uploading}
                onclick={() => uploadRecording(pendingUpload)}
            /><Button label={t('discardRecording')} onclick={() => (pendingUpload = null)} />
        </div>{/if}
    <div class="qm-audio-drafts">
        {#each audioRows as segment (segment.key)}<div class="qm-audio-draft">
                <AudioPlayer path={segment.path} {t} />{#if transcribing[segment.key]}<span role="status"
                        >{t('transcribing')}</span
                    >{:else if segment.pending}{#if !shared.settings.tencentSecretId || !shared.settings.tencentSecretKey}<Button
                            label={t('configureTranscription')}
                            onclick={() => onsettings()}
                        />{:else}<span>{t(audioErrors[segment.key] || 'pendingTranscription')}</span><Button
                            label={t('retryTranscription')}
                            onclick={() => transcribe(segment)}
                        />{/if}{/if}<Button
                    label={t('removeAudio')}
                    icon="close"
                    disabled={busy}
                    onclick={() => {
                        requests.get(segment.key)?.abort();
                        requests.delete(segment.key);
                        shared.setTranscription?.(draftId + ':' + segment.key, null);
                        editor.removeAudio(segment.key);
                        value = editor.value();
                        syncAudio();
                        queueDraft();
                    }}
                />
            </div>{/each}
    </div>
    <div class="qm-previews">
        {#each images as path, i}<div class="qm-preview">
                <img src={safeURL(path, true)} alt={t('attachedImage')} /><Button
                    label={t('removeImage')}
                    icon="close"
                    disabled={busy || uploading}
                    onclick={() => {
                        images.splice(i, 1);
                        queueDraft();
                    }}
                />
            </div>{/each}
    </div>
    <div
        bind:this={candidates}
        class="qm-candidates"
        role="listbox"
        aria-label={t('tags')}
        style:left={candidateLeft + 'px'}
        style:top={candidateTop + 'px'}
    >
        {#each references as item, i}<button
                type="button"
                class="qm-reference-option"
                role="option"
                aria-selected={referenceIndex === i}
                onmousedown={e => e.preventDefault()}
                onclick={() => completeReference(item)}
                ><span>{item.label}</span><small>{item.local ? item.created?.slice(0, 8) : item.path}</small></button
            >{/each}
        {#each tagOptions as tag, i}<button
                type="button"
                class="qm-tag-option"
                role="option"
                aria-selected={candidate === i}
                onmousedown={e => e.preventDefault()}
                onclick={() => complete(tag.name)}
                >#{tag.name}{#if tag.create}<small class="qm-tag-create">{t('createTag')}</small>{/if}</button
            >{/each}
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="qm-tools"
        onmousedown={e => {
            if (e.target.closest('button')) e.preventDefault();
        }}
    >
        {#if recording}<div
                class="qm-recording"
                role="status"
                aria-label={t('recordingTime', { seconds })}
                data-state={seconds >= 50 ? 'ending' : 'recording'}
            >
                <i class="qm-record-dot" aria-hidden="true"></i><span class="qm-record-time"
                    >{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span
                ><small>/ 1:00</small><span class="qm-meter" aria-hidden="true"
                    >{#each levels as level}<i style:height={4 + level * 20 + 'px'}></i>{/each}</span
                ><Button
                    label={t('cancelRecording')}
                    icon="close"
                    onclick={() => {
                        recorder?.cancel();
                        recorder = null;
                        recording = false;
                        recordSerial++;
                    }}
                /><Button label={t('finishRecording')} icon="stop" class="qm-send" onclick={finishRecording} />
            </div>{:else}
            <Button
                label={t('tag')}
                icon="hash"
                disabled={busy || uploading}
                onclick={() => editor.insert('#')}
            /><Button label={t('addImage')} icon="image" disabled={busy || uploading} onclick={() => file.click()} /><i
                class="qm-divider"
            ></i>
            <div bind:this={formatControl} class="qm-format-control">
                <Button
                    label={t('formatMore')}
                    class="qm-format-toggle"
                    aria-expanded={formatOpen}
                    aria-controls={formatId}
                    disabled={busy || uploading}
                    onclick={toggleFormat}><span aria-hidden="true">Aa</span></Button
                >
                {#if formatOpen}<div
                        bind:this={formatPanel}
                        id={formatId}
                        class="qm-format-popover"
                        role="toolbar"
                        aria-label={t('formatMore')}
                    >
                        {#each ['bold', 'underline', 'highlight'] as key}<Button
                                label={t(key)}
                                icon={key}
                                aria-pressed={!!active[key]}
                                onclick={() => applyFormat(key)}
                            />{/each}
                    </div>{/if}
            </div>
            {#each [['unordered', 'list'], ['ordered', 'ordered'], ['quote', 'quote']] as [key, icon]}<Button
                    label={t(key)}
                    {icon}
                    disabled={busy || uploading}
                    aria-pressed={!!active[key]}
                    onclick={() => editor.command(key)}
                />{/each}
            <Button
                label={t('recordAudio')}
                icon="mic"
                class="qm-record-button"
                disabled={busy || uploading || recordStarting}
                onclick={beginRecording}
            /><Button
                label={t('cancel')}
                class="qm-cancel-edit"
                hidden={!(inline && draftId !== 'new')}
                disabled={busy || uploading}
                onclick={closeCompose}
            /><Button
                label={t(draftId === 'new' ? 'send' : 'saveEdit')}
                icon="send"
                class="qm-send"
                aria-busy={busy}
                disabled={busy || uploading || recording || pendingUpload || (!value.trim() && !images.length)}
                onclick={submit}
            />{/if}
    </div>
    <input
        bind:this={file}
        type="file"
        accept="image/*"
        multiple
        hidden
        disabled={busy || uploading}
        onchange={upload}
    />
</section>

<style>
    .qm-reference-option {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 8px 12px;
        text-align: left;
        border: 0;
        background: var(--qm-surface);
        color: var(--qm-text);
    }
    .qm-reference-option[aria-selected='true'] {
        background: var(--qm-fill);
    }
    .qm-reference-option span {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-size: 14px;
    }
    .qm-reference-option small {
        color: var(--qm-text-secondary);
        font-size: 12px;
    }

    .qm-format-control {
        position: relative;
        flex-shrink: 0;
    }
    .qm-format-control :global(.qm-format-toggle) {
        font-size: 20px;
        letter-spacing: -1px;
        border-radius: 8px;
    }
    .qm-format-control :global(.qm-format-toggle[aria-expanded='true']) {
        background: var(--qm-fill);
        color: var(--qm-text);
    }
    .qm-format-popover {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 0;
        z-index: 5;
        display: flex;
        padding: 6px;
        gap: 2px;
        border: 1px solid var(--qm-border-strong);
        border-radius: 12px;
        background: var(--qm-surface);
        box-shadow: 0 4px 16px var(--qm-fill);
    }
    .qm-format-popover :global(button) {
        border-radius: 8px;
    }
    .qm-audio-draft {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        background: var(--qm-bg);
        border-radius: 8px;
        margin: 6px 0;
        padding: 8px;
    }
    .qm-audio-draft :global(.qm-audio-player) {
        flex: 1;
        min-width: 100px;
        margin: 0;
        padding: 0;
    }
    .qm-audio-draft span {
        font-size: 12px;
        color: var(--qm-text-secondary);
    }
    .qm-meter {
        display: flex;
        align-items: center;
        gap: 2px;
        height: 24px;
    }
    .qm-meter i {
        width: 2px;
        background: var(--qm-brand-bright);
    }
    @media (prefers-reduced-motion: reduce) {
        .qm-meter {
            width: 60px;
            height: 2px;
            background: var(--qm-brand-bright);
        }
        .qm-meter i {
            display: none;
        }
    }
    .qm-recording {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-width: 0;
        height: 44px;
    }
    .qm-record-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--qm-danger);
        animation: qm-record-pulse 1s infinite;
    }
    .qm-record-time {
        font-size: 15px;
        font-variant-numeric: tabular-nums;
        color: var(--qm-text);
    }
    .qm-recording[data-state='ending'] .qm-record-time {
        color: var(--qm-danger);
    }
    .qm-recording small {
        font-size: 13px;
        color: var(--qm-text-secondary);
        white-space: nowrap;
    }
    .qm-meter {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        justify-content: center;
    }
    .qm-recording :global(button) {
        flex-shrink: 0;
    }
    @keyframes qm-record-pulse {
        50% {
            opacity: 0.35;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .qm-record-dot {
            animation: none;
        }
    }
</style>
