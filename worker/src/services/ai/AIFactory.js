import { OpenRouterProvider } from './OpenRouterProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { CloudflareAIProvider } from './CloudflareAIProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

export class AIFactory {
    static getProvider(env) {
        const model = env.OPENROUTER_MODEL || "";
        const hasGeminiKey = !!env.GEMINI_API_KEY;
        const hasOpenRouterKey = !!env.OPENROUTER_API_KEY;
        const hasOpenAIKey = !!env.OPENAI_API_KEY;

        // Check if a workspace-specific API key has been set.
        // We detect this by checking if any of the key env vars differ from env defaults.
        // The workspace sets OPENROUTER_API_KEY, GEMINI_API_KEY, and OPENAI_API_KEY
        // all to the same decrypted value. If none of them are set as a custom key
        // (i.e. no workspace-level override happened), we fallback to Cloudflare AI.
        const hasWorkspaceKey = !!(env._workspaceKeySet);

        const isDirectOpenAI = hasOpenAIKey && (
            model.toLowerCase().includes("gpt-") || 
            model.toLowerCase().startsWith("openai/")
        );

        if (isDirectOpenAI) {
            const cleanModel = model.startsWith("openai/") ? model.substring(7) : model;
            return new OpenAIProvider(env.OPENAI_API_KEY, cleanModel);
        }

        const isCloudflare = model.toLowerCase().includes("cloudflare") || 
                             model.toLowerCase().includes("llama-3-8b") ||
                             model.toLowerCase().includes("llama-3.1-8b") ||
                             model.toLowerCase().includes("llama-3.2-3b") ||
                             model.startsWith("@cf/") ||
                             (!hasGeminiKey && !hasOpenRouterKey && env.AI) ||
                             (!hasWorkspaceKey && env.AI);

        if (isCloudflare && env.AI) {
            return new CloudflareAIProvider(env.AI, model);
        }

        const isGemini = model.toLowerCase().includes("gemini") || hasGeminiKey;

        if (isGemini) {
            const apiKey = env.GEMINI_API_KEY || env.OPENROUTER_API_KEY;
            if (!apiKey) {
                if (env.AI) return new CloudflareAIProvider(env.AI);
                throw new Error("Missing GEMINI_API_KEY or OPENROUTER_API_KEY configuration in environment variables.");
            }
            const cleanModel = model.includes('/') ? 'gemini-2.0-flash' : (model || 'gemini-2.0-flash');
            return new GeminiProvider(apiKey, cleanModel);
        } else {
            const apiKey = env.OPENROUTER_API_KEY;
            if (!apiKey) {
                if (env.AI) return new CloudflareAIProvider(env.AI);
                throw new Error("Missing OPENROUTER_API_KEY configuration in environment variables.");
            }
            const cleanModel = model || "meta-llama/llama-3.2-3b-instruct:free";
            return new OpenRouterProvider(apiKey, cleanModel);
        }
    }
}

