import { OpenRouterProvider } from './OpenRouterProvider.js';
import { GeminiProvider } from './GeminiProvider.js';

export class AIFactory {
    static getProvider(env) {
        const model = env.OPENROUTER_MODEL || "";
        const isGemini = model.toLowerCase().includes("gemini") || !!env.GEMINI_API_KEY;

        if (isGemini) {
            const apiKey = env.GEMINI_API_KEY || env.OPENROUTER_API_KEY;
            if (!apiKey) {
                throw new Error("Missing GEMINI_API_KEY or OPENROUTER_API_KEY configuration in environment variables.");
            }
            const cleanModel = model.includes('/') ? 'gemini-1.5-flash' : (model || 'gemini-1.5-flash');
            return new GeminiProvider(apiKey, cleanModel);
        } else {
            const apiKey = env.OPENROUTER_API_KEY;
            if (!apiKey) {
                throw new Error("Missing OPENROUTER_API_KEY configuration in environment variables.");
            }
            const cleanModel = model || "meta-llama/llama-3.2-3b-instruct:free";
            return new OpenRouterProvider(apiKey, cleanModel);
        }
    }
}

