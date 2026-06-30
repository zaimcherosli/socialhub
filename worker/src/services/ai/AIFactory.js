import { OpenRouterProvider } from './OpenRouterProvider.js';

export class AIFactory {
    static getProvider(env) {
        const apiKey = env.OPENROUTER_API_KEY;
        if (!apiKey) {
            throw new Error("Missing OPENROUTER_API_KEY configuration in environment variables.");
        }
        const model = env.OPENROUTER_MODEL || "meta-llama/llama-3.2-3b-instruct:free";
        return new OpenRouterProvider(apiKey, model);
    }
}
