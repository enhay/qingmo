import { Chat } from '@ai-sdk/svelte';
import { InsightService } from '../core/insights.js';

export function createInsights(options) {
    return new InsightService({ ...options, createChat: init => new Chat(init) });
}
