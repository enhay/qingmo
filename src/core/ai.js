import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

const fail = code => Object.assign(new Error(code), { code });

const protocols = {
    openai: (options, name) => createOpenAI(options).chat(name),
    'openai-responses': (options, name) => createOpenAI(options).responses(name),
    anthropic: (options, name) =>
        createAnthropic({
            ...options,
            headers: { 'anthropic-dangerous-direct-browser-access': 'true', ...options.headers }
        })(name)
};

function editingModel(ai) {
    const provider = ai?.providers?.find(
        item => item.enabled !== false && item.models?.some(model => model.id === ai.editing?.modelId)
    );
    const model = provider?.models.find(item => item.id === ai.editing?.modelId && item.enabled !== false);
    if (!model?.name) throw fail('INSIGHT_MODEL_REQUIRED');
    if (provider.authType && provider.authType !== 'apiKey') throw fail('AI_AUTH_UNSUPPORTED');
    if (!Object.hasOwn(protocols, provider.protocol)) throw fail('AI_PROTOCOL_UNSUPPORTED');
    let url;
    try {
        url = new URL(provider.baseURL);
    } catch {
        throw fail('AI_CONFIG_INVALID');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('AI_CONFIG_INVALID');
    return { provider, model };
}

// 只允许公开的模型身份进入材料快照；凭证仅在发起 SDK 请求时使用。
export function describeEditingModel(ai) {
    const { provider, model } = editingModel(ai);
    return Object.freeze({ providerId: provider.id, modelId: model.id, name: model.name, protocol: provider.protocol });
}

export function createEditingConnection(ai, fetch = globalThis.fetch) {
    const { provider, model } = editingModel(ai);
    const options = { baseURL: provider.baseURL, apiKey: provider.apiKey || '', headers: provider.headers, fetch };
    return {
        model: protocols[provider.protocol](options, model.name),
        temperature: ai.editing.temperature,
        maxOutputTokens: ai.editing.maxCompletionTokens || undefined,
        timeout: provider.requestTimeout > 0 ? provider.requestTimeout * 1000 : undefined
    };
}
