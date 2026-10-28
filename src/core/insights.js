import { streamText, convertToModelMessages, toUIMessageStream } from 'ai';
import { describeEditingModel, createEditingConnection } from './ai.js';
import { normalizeScope } from './data.js';

const fail = code => Object.assign(new Error(code), { code });
const aiErrorCode = error => {
    if (error.statusCode === 401 || error.statusCode === 403) return 'AI_AUTH_FAILED';
    if (error.statusCode === 429) return 'AI_RATE_LIMITED';
    return error.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_REQUEST_FAILED';
};
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const titles = {
    default: '默认洞察',
    values: '价值澄清',
    inversion: '逆向思考',
    'second-order': '二阶思考',
    cbt: 'CBT',
    mbti: 'MBTI'
};
const descriptions = {
    default: '理解近期主题与变化',
    values: '理解看重的事情与取舍',
    inversion: '从失败条件重新看目标',
    'second-order': '看看眼前选择的后续影响',
    cbt: '梳理事件、想法、感受与行为',
    mbti: '非正式地观察自己的偏好'
};
export const INSIGHT_VIEWS = Object.entries(titles).map(([id, title]) => ({
    id,
    title,
    author: '轻墨',
    description: descriptions[id],
    kind: 'ai',
    reference: `references/${id}.md`,
    needsScope: true
}));

export function memoText(memo, doc = globalThis.document) {
    const fragment = doc.createElement('template');
    fragment.innerHTML = memo.dom;
    fragment.content
        .querySelectorAll(
            'script,style,img,audio,video,.protyle-attr,.protyle-icons,[data-type="NodeAudio"],[data-type="NodeVideo"],[data-type="NodeBlockQueryEmbed"]'
        )
        .forEach(node => node.remove());
    for (const node of fragment.content.querySelectorAll('br,[data-type="NodeParagraph"],p,li'))
        node.append(doc.createTextNode('\n'));
    return fragment.content.textContent.replace(/[\u200b\u2060]/g, '').trim();
}

export function cleanInsight(markdown, ids) {
    const allowed = new Set(ids);
    for (const match of markdown.matchAll(/siyuan:\/\/blocks\/([^\s)<>"']+)/gi)) {
        if (!allowed.has(match[1])) throw fail('INSIGHT_UNKNOWN_SOURCE');
    }
    // 模型输出只能产生文字和已核对来源；不让附件、HTML、IAL 或原生查询进入结果文档。
    return markdown
        .replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*$/gm, '')
        .replace(/!\[([^\]]*)\]\([^\n]*?\)/g, '$1')
        .replace(/\[([^\]]*)\]\(([^\n]*?)\)/g, (_, label, url) =>
            /^siyuan:\/\/blocks\/\d{14}-[a-z0-9]{7}$/.test(url) && allowed.has(url.slice(16))
                ? `[${label}](${url})`
                : label
        )
        .replace(/\{:[^\n]*\}/g, '')
        .replace(/\{\{/g, '\\{\\{')
        .replace(/\(\(/g, '\\(\\(')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/(^|\s)#([^\s#]+)#/g, '$1\\#$2\\#')
        .trim();
}

export class InsightService {
    constructor({
        repository,
        request,
        loadResource,
        getAI,
        createChat,
        fetch,
        onChange = () => {},
        document = globalThis.document
    }) {
        Object.assign(this, { repository, request, loadResource, getAI, fetch, onChange, document });
        this.busy = false;
        this.phase = 'idle';
        this.result = null;
        this.snapshot = null;
        this.error = null;
        this.documentId = null;
        this.completion = null;
        this.stopped = false;
        this.chat = createChat({
            transport: {
                sendMessages: options => this.stream(options),
                reconnectToStream: async () => null
            },
            onFinish: event => {
                this.completion = event;
            },
            onError: error => {
                this.error = fail(
                    error.code || (error.message.startsWith('AI_') ? error.message : 'AI_REQUEST_FAILED')
                );
            }
        });
    }
    change(phase) {
        this.phase = phase;
        this.onChange(this);
    }
    async prepare({ viewId = 'default', scope = {}, memoId, question = '', notebook } = {}) {
        const view = INSIGHT_VIEWS.find(item => item.id === viewId);
        if (!view) throw fail('INSIGHT_INVALID_VIEW');
        if (!notebook || (await this.repository.getNotebooks()).every(item => item.id !== notebook))
            throw fail('NOTEBOOK_REQUIRED');
        const model = describeEditingModel(await this.getAI());
        const normalized = normalizeScope(scope),
            ids = memoId ? [memoId] : await this.repository.rangeIds(normalized);
        if (!ids.length) throw fail('INSIGHT_EMPTY');
        const items = [];
        let charCount = 0;
        for (const id of ids) {
            const memo = await this.repository.get(id);
            if (!memo) throw fail('INSIGHT_READ_FAILED');
            const text = memoText(memo, this.document);
            if (!text) continue;
            if (charCount + text.length > 30000) {
                if (!items.length) throw fail('INSIGHT_TOO_LONG');
                break;
            }
            items.push({ id: memo.id, created: memo.created, tags: memo.tags.slice(), text });
            charCount += text.length;
        }
        if (!items.length) throw fail('INSIGHT_NO_TEXT');
        const [base, method] = await Promise.all([this.loadResource('SKILL.md'), this.loadResource(view.reference)]);
        if (typeof base !== 'string' || !base.trim() || typeof method !== 'string' || !method.trim())
            throw fail('INSIGHT_METHOD_MISSING');
        const dates = items.map(item => item.created.slice(0, 8)).sort();
        for (const item of items) {
            Object.freeze(item.tags);
            Object.freeze(item);
        }
        Object.freeze(items);
        Object.freeze(normalized);
        return Object.freeze({
            view: Object.freeze({ ...view }),
            scope: normalized,
            memoId: memoId || '',
            question: String(question),
            notebook,
            model,
            matchedCount: ids.length,
            items,
            sentCount: items.length,
            omittedCount: ids.length - items.length,
            dateStart: dates[0],
            dateEnd: dates.at(-1),
            charCount,
            base,
            method
        });
    }
    async stream({ messages, abortSignal }) {
        const ai = await this.getAI({ signal: abortSignal });
        if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const model = describeEditingModel(ai);
        if (
            model.modelId !== this.snapshot.model.modelId ||
            model.providerId !== this.snapshot.model.providerId ||
            model.name !== this.snapshot.model.name ||
            model.protocol !== this.snapshot.model.protocol
        )
            throw fail('AI_MODEL_CHANGED');
        const { base, method, scope, items, matchedCount, sentCount, omittedCount, dateStart, dateEnd } = this.snapshot;
        const system = [base, method].join('\n\n');
        const material = JSON.stringify({ scope, matchedCount, sentCount, omittedCount, dateStart, dateEnd, items });
        // 预算覆盖方法、材料和全部问答。超过预算时明确停止，不丢掉用户早期的纠正。
        if (
            system.length + material.length + messages.reduce((sum, message) => sum + messageText(message).length, 0) >
            60000
        )
            throw fail('AI_CONTEXT_FULL');
        const result = streamText({
            ...createEditingConnection(ai, this.fetch),
            system,
            messages: [
                { role: 'user', content: '本次选定的笔记：\n' + material },
                ...(await convertToModelMessages(
                    messages
                        .filter(
                            message =>
                                message.role !== 'assistant' ||
                                ['complete', 'cancelled', 'truncated'].includes(message.metadata?.state)
                        )
                        .map(message =>
                            message.role === 'assistant' && message.metadata?.state !== 'complete'
                                ? {
                                      ...message,
                                      parts: [{ type: 'text', text: '（这轮回答未完成）\n' + messageText(message) }]
                                  }
                                : message
                        )
                ))
            ],
            abortSignal,
            maxRetries: 0,
            // SDK 默认错误日志含请求正文；只保留可供界面处理的错误码。
            onError: ({ error }) => {
                this.error = fail(aiErrorCode(error));
            }
        });
        return toUIMessageStream({
            stream: result.stream,
            originalMessages: messages,
            sendReasoning: false,
            sendSources: false,
            onError: aiErrorCode
        });
    }
    reset() {
        if (this.busy) throw fail('INSIGHT_BUSY');
        if (this.result?.saveError) throw fail('INSIGHT_SAVE_REQUIRED');
        this.snapshot = null;
        this.result = null;
        this.error = null;
        this.documentId = null;
        this.chat.messages = [];
        this.change('idle');
    }
    async generate(snapshot) {
        if (this.busy) throw fail('INSIGHT_BUSY');
        if (this.result?.saveError) throw fail('INSIGHT_SAVE_REQUIRED');
        this.snapshot = Object.freeze({ ...snapshot, sessionId: this.chat.generateId() });
        this.documentId = null;
        this.result = null;
        this.chat.messages = [];
        return this.send(snapshot.question || '请用当前视角回应这些笔记中最值得讨论的发现。');
    }
    async send(question, retry = false) {
        if (this.busy) throw fail('INSIGHT_BUSY');
        if (!this.snapshot) throw fail('INSIGHT_EMPTY');
        if (this.result?.saveError) throw fail('INSIGHT_SAVE_REQUIRED');
        if (!retry && !question.trim()) return;
        this.busy = true;
        this.error = null;
        this.completion = null;
        this.stopped = false;
        this.change('generating');
        try {
            if (retry) await this.chat.regenerate();
            else await this.chat.sendMessage({ text: question.trim() });
            const event = this.completion;
            if (this.stopped || event?.isAbort) {
                this.change('cancelled');
                return;
            }
            if (this.error || event?.isError || event?.isDisconnect) throw this.error || fail('AI_REQUEST_FAILED');
            if (event?.finishReason === 'length') throw fail('AI_TRUNCATED');
            if (event?.finishReason !== 'stop') throw fail('AI_INCOMPLETE');
            const markdown = cleanInsight(
                messageText(event.message),
                this.snapshot.items.map(item => item.id)
            );
            if (!markdown) throw fail('INSIGHT_EMPTY_OUTPUT');
            const questionMessage = [...event.messages].reverse().find(item => item.role === 'user');
            const result = {
                snapshot: this.snapshot,
                markdown,
                question: messageText(questionMessage),
                created: new Date().toISOString(),
                id: this.documentId,
                written: false,
                saveError: null
            };
            this.result = result;
            this.change('saving');
            try {
                await this.save(result);
            } catch {
                result.saveError = 'INSIGHT_SAVE_FAILED';
            }
            this.change(result.saveError ? 'save-error' : 'done');
            return result;
        } catch (error) {
            this.error = fail(error.code || 'AI_REQUEST_FAILED');
            this.change('error');
        } finally {
            if (this.completion?.message) {
                const id = this.completion.message.id;
                const state = this.stopped
                    ? 'cancelled'
                    : this.error?.code === 'AI_TRUNCATED'
                      ? 'truncated'
                      : this.error
                        ? 'error'
                        : 'complete';
                this.chat.messages = this.chat.messages.map(message =>
                    message.id === id ? { ...message, metadata: { state, errorCode: this.error?.code } } : message
                );
            }
            this.busy = false;
            this.onChange(this);
        }
    }
    async cancel() {
        if (!this.busy || this.phase === 'saving') return;
        this.stopped = true;
        await this.chat.stop();
    }
    async retrySave() {
        if (this.busy || !this.result?.saveError) return;
        this.busy = true;
        this.change('saving');
        try {
            await this.save();
        } catch {
            this.result.saveError = 'INSIGHT_SAVE_FAILED';
        } finally {
            this.busy = false;
            this.change(this.result.saveError ? 'save-error' : 'done');
        }
    }
    async save(result = this.result) {
        if (!result) return;
        const { snapshot } = result;
        const ids = snapshot.items.map(item => item.id);
        // 用户补充以纯文字保留；不能让补充内容在文档中执行 HTML、IAL、查询或原生引用。
        const question = result.question.replace(/[\\`*_{}\[\]()#+.!<>|~-]/g, '\\$&');
        const turn = `## 你\n\n${question}\n\n## 轻墨\n\n${result.markdown}`;
        if (!result.written) {
            if (!result.id) {
                const date = new Date(result.created);
                const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const base = `/轻墨/洞察/${day}-${snapshot.view.title}`;
                let path = base,
                    index = 1;
                while (
                    (await this.request('/api/filetree/getIDsByHPath', { notebook: snapshot.notebook, path })).length
                )
                    path = base + '-' + ++index;
                const range = `范围：${snapshot.scope.tag ? '标签 ' + snapshot.scope.tag : '全部标签'}；${snapshot.dateStart} 至 ${snapshot.dateEnd}；实际使用 ${snapshot.sentCount} 条，未发送 ${snapshot.omittedCount} 条。`;
                result.id = await this.request('/api/filetree/createDocWithMd', {
                    notebook: snapshot.notebook,
                    path,
                    markdown: `# ${snapshot.view.title}\n\n${cleanInsight(range, ids)}\n\n开始时间：${result.created}\n\n${turn}`
                });
                this.documentId = result.id;
            } else {
                await this.request('/api/block/appendBlock', {
                    parentID: result.id,
                    dataType: 'markdown',
                    data: '\n\n' + turn
                });
            }
            result.written = true;
        }
        // 文档或问答已经写入后，属性失败只重试属性，避免重复创建或追加。
        await this.request('/api/attr/setBlockAttrs', {
            id: result.id,
            attrs: { 'custom-qingmo-conversation': snapshot.view.id }
        });
        result.saveError = null;
        this.onChange(this);
        return result.id;
    }
    async history() {
        const rows = [];
        for (let offset = 0; ; offset += 512) {
            const batch = await this.repository.sql(
                `SELECT b.id,b.content AS title,b.created,a.value AS viewId FROM blocks b JOIN attributes a ON a.block_id=b.id WHERE b.type='d' AND a.name='custom-qingmo-conversation' AND a.value IN (${INSIGHT_VIEWS.map(v => literal(v.id)).join(',')}) ORDER BY b.created DESC,b.id DESC LIMIT 512 OFFSET ${offset}`
            );
            rows.push(...batch);
            if (batch.length < 512) return rows;
        }
    }
}

export function messageText(message) {
    return (message?.parts || [])
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('');
}
