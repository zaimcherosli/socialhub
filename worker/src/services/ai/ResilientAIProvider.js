import { AIProvider } from './AIProvider.js';

/**
 * ResilientAIProvider wraps a primary AI provider (e.g. Agent Router or OpenAI)
 * with a chain of fallback providers (e.g. Gemini, Cloudflare AI).
 * If the primary provider fails (401 invalid key, 429 rate limit, 500 error, etc.),
 * it catches the failure and immediately executes the request on the fallback provider,
 * ensuring zero 500 errors and seamless continuity for users.
 */
export class ResilientAIProvider extends AIProvider {
    constructor(primaryProvider, fallbacks = []) {
        super();
        this.primary = primaryProvider;
        this.fallbacks = (fallbacks || []).filter(Boolean);
        this.model = primaryProvider?.model || 'auto';
        this.apiKey = primaryProvider?.apiKey || '';
        this.baseUrl = primaryProvider?.baseUrl || '';
        this.ai = primaryProvider?.ai || null;
    }

    isReasoningModel() {
        return typeof this.primary?.isReasoningModel === 'function' ? this.primary.isReasoningModel() : false;
    }

    async _executeWithFallback(actionName, fn) {
        const providers = [this.primary, ...this.fallbacks];
        let lastError = null;

        for (let i = 0; i < providers.length; i++) {
            const currentProvider = providers[i];
            const pName = currentProvider.constructor?.name || 'UnknownProvider';
            const pModel = currentProvider.model || 'default';

            try {
                return await fn(currentProvider);
            } catch (err) {
                lastError = err;
                console.warn(`[ResilientAIProvider] ${actionName} failed on ${pName} (${pModel}): ${err.message}`);
                
                if (i < providers.length - 1) {
                    const nextP = providers[i + 1];
                    console.log(`[ResilientAIProvider] Engaging fallback provider: ${nextP.constructor?.name} (${nextP.model})...`);
                }
            }
        }

        throw lastError || new Error(`All AI providers failed to execute ${actionName}.`);
    }

    async generateCaption(promptOptions) {
        return this._executeWithFallback('generateCaption', (p) => p.generateCaption(promptOptions));
    }

    async generateThreadStorm(options) {
        return this._executeWithFallback('generateThreadStorm', (p) => p.generateThreadStorm(options));
    }

    async generateChatResponse(messages) {
        return this._executeWithFallback('generateChatResponse', (p) => p.generateChatResponse(messages));
    }

    async _fetchChatCompletions(payload) {
        return this._executeWithFallback('_fetchChatCompletions', async (p) => {
            if (typeof p._fetchChatCompletions === 'function') {
                return await p._fetchChatCompletions(payload);
            }

            // Fallback for providers that don't expose _fetchChatCompletions (like Gemini or Cloudflare AI)
            const msgs = payload.messages || [];
            const responseText = await p.generateChatResponse(msgs);
            return {
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: responseText
                        }
                    }
                ]
            };
        });
    }
}
