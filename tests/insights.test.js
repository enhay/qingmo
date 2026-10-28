import test from 'node:test';
import assert from 'node:assert/strict';
import { AbstractChat } from 'ai';
import { InsightService, messageText } from '../src/core/insights.js';
import { describeEditingModel } from '../src/core/ai.js';

const sourceId = '20261028090000-aaaaaaa';
const ai = {
    editing: { modelId: 'model-id', temperature: 0.5, maxCompletionTokens: 512 },
    providers: [
        {
            id: 'provider-id',
            enabled: true,
            protocol: 'openai',
            baseURL: 'https://model.example/v1',
            apiKey: 'synthetic-key',
            models: [{ id: 'model-id', name: 'test-model' }]
        }
    ]
};
const snapshot = Object.freeze({
    view: { id: 'default', title: '默认洞察' },
    scope: {},
    memoId: '',
    notebook: 'test-notebook',
    model: describeEditingModel(ai),
    base: '根据记录理解变化。',
    method: '结合反例解释取舍。',
    question: '这次变化说明了什么？',
    items: [{ id: sourceId, created: '20261028090000', text: '今天主动调整了工作安排。', tags: [] }],
    matchedCount: 1,
    sentCount: 1,
    omittedCount: 0,
    dateStart: '20261028',
    dateEnd: '20261028'
});

function createChat(init) {
    const state = {
        messages: [],
        status: 'ready',
        error: undefined,
        pushMessage(message) {
            this.messages.push(message);
        },
        popMessage() {
            this.messages.pop();
        },
        replaceMessage(index, message) {
            this.messages[index] = message;
        },
        snapshot: value => structuredClone(value)
    };
    return new (class extends AbstractChat {})({ ...init, state });
}

function streamResponse(text, { finish = 'stop', wait } = {}) {
    const encoder = new TextEncoder();
    const chunk = (content, finishReason = null) =>
        'data: ' +
        JSON.stringify({
            id: 'response-id',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, delta: { content }, finish_reason: finishReason }]
        }) +
        '\n\n';
    return new Response(
        new ReadableStream({
            async start(controller) {
                controller.enqueue(encoder.encode(chunk(text)));
                if (wait) await wait;
                controller.enqueue(encoder.encode(chunk('', finish) + 'data: [DONE]\n\n'));
                controller.close();
            }
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
    );
}

function fixture({ response, request } = {}) {
    const writes = [],
        calls = [];
    const service = new InsightService({
        createChat,
        getAI: async () => ai,
        fetch: async (url, init) => {
            calls.push({ url: String(url), body: JSON.parse(init.body) });
            return response
                ? response(init)
                : streamResponse(`可以从这次调整理解你的取舍。[今天](siyuan://blocks/${sourceId})`);
        },
        request: async (path, body) => {
            if (request) await request(path, body);
            if (path.endsWith('getIDsByHPath')) return [];
            writes.push({ path, body });
            if (path.endsWith('createDocWithMd')) return '20261028100000-bbbbbbb';
            return [];
        }
    });
    return { service, calls, writes };
}

test('追问通过 SDK 携带已完成问答与用户纠正，并追加同一篇思源文档', async () => {
    const { service, calls, writes } = fixture();
    const first = await service.generate(snapshot);
    const second = await service.send('那是读书摘录，不是我的经历。');
    assert.equal(service.phase, 'done');
    assert.equal(second.id, first.id);
    assert.deepEqual(
        calls[1].body.messages.map(message => message.role),
        ['system', 'user', 'user', 'assistant', 'user']
    );
    assert.equal(calls[1].body.messages.at(-1).content, '那是读书摘录，不是我的经历。');
    assert.equal(calls[1].body.messages[3].content, first.markdown);
    assert.equal(calls[1].body.stream, true);
    assert.equal(calls[0].body.model, 'test-model');
    assert.deepEqual(
        writes.map(write => write.path),
        [
            '/api/filetree/createDocWithMd',
            '/api/attr/setBlockAttrs',
            '/api/block/appendBlock',
            '/api/attr/setBlockAttrs'
        ]
    );
    assert.equal(writes[2].body.parentID, first.id);
    assert.deepEqual(writes[1].body.attrs, { 'custom-qingmo-conversation': 'default' });
    assert.equal(service.chat.messages.at(-1).metadata.state, 'complete');
    assert.deepEqual(Object.keys(snapshot.model).sort(), ['modelId', 'name', 'protocol', 'providerId']);
});

test('停止 SDK 请求后保留未完成文字，迟到输出不归档；下一轮仍可发送', async () => {
    let release;
    const wait = new Promise(resolve => {
        release = resolve;
    });
    const { service, writes, calls } = fixture({ response: () => streamResponse('尚未完成的理解', { wait }) });
    const pending = service.generate(snapshot);
    for (let i = 0; i < 50 && !messageText(service.chat.messages.at(-1)).includes('尚未完成'); i++)
        await new Promise(resolve => setImmediate(resolve));
    assert.equal(messageText(service.chat.messages.at(-1)), '尚未完成的理解');
    const stopping = service.cancel();
    release();
    await Promise.all([pending, stopping]);
    assert.equal(service.phase, 'cancelled');
    assert.equal(service.chat.messages.at(-1).metadata.state, 'cancelled');
    assert.equal(writes.length, 0);
    await service.send('继续');
    assert.equal(calls[1].body.messages[3].content, '（这轮回答未完成）\n尚未完成的理解');
    assert.equal(service.phase, 'done');
});

test('未知来源使回答进入错误状态，不写入文档，也不作为下一轮依据', async () => {
    const { service, writes, calls } = fixture({
        response: () => streamResponse('[来源](siyuan://blocks/20261027090000-ccccccc)')
    });
    await service.generate(snapshot);
    assert.equal(service.error.code, 'INSIGHT_UNKNOWN_SOURCE');
    assert.equal(service.chat.messages.at(-1).metadata.state, 'error');
    assert.equal(writes.length, 0);
    await service.send('请根据已选材料重新理解。');
    assert.deepEqual(
        calls[1].body.messages.map(message => message.role),
        ['system', 'user', 'user', 'user']
    );
});

test('写入后的属性保存失败仅重试属性，不再次请求模型或追加问答', async () => {
    let failAttributes = true;
    const { service, calls, writes } = fixture({
        request: async path => {
            if (path.endsWith('setBlockAttrs') && failAttributes) throw new Error('synthetic write failure');
        }
    });
    const result = await service.generate(snapshot);
    assert.equal(result.saveError, 'INSIGHT_SAVE_FAILED');
    assert.equal(result.written, true);
    assert.equal(result.id, '20261028100000-bbbbbbb');
    failAttributes = false;
    await service.retrySave();
    assert.equal(service.result.saveError, null);
    assert.equal(calls.length, 1);
    assert.deepEqual(
        writes.map(write => write.path),
        ['/api/filetree/createDocWithMd', '/api/attr/setBlockAttrs']
    );
});

test('服务商错误只暴露错误码，不输出含笔记的 SDK 默认日志或自动重试', async t => {
    const logs = t.mock.method(console, 'error', () => {});
    const { service, calls, writes } = fixture({
        response: () =>
            new Response(JSON.stringify({ error: { message: 'synthetic private response', type: 'rate_limit' } }), {
                status: 429,
                headers: { 'Content-Type': 'application/json' }
            })
    });
    await service.generate(snapshot);
    assert.equal(service.error.code, 'AI_RATE_LIMITED');
    assert.equal(service.phase, 'error');
    assert.equal(logs.mock.callCount(), 0);
    assert.equal(calls.length, 1);
    assert.equal(writes.length, 0);
});
