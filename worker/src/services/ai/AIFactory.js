import { OpenRouterProvider } from './OpenRouterProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { CloudflareAIProvider } from './CloudflareAIProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

export class AIFactory {
    static getProvider(env) {
        const model = env.OPENROUTER_MODEL || "";
        const hasWorkspaceKey = !!(env._workspaceKeySet);
        const workspaceKey = hasWorkspaceKey ? (env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.OPENROUTER_API_KEY || "") : "";

        // Determine which providers actually have keys configured (global + workspace)
        let hasGemini = !!env.GEMINI_API_KEY;
        let hasOpenAI = !!env.OPENAI_API_KEY;
        let hasOpenRouter = !!env.OPENROUTER_API_KEY;

        if (hasWorkspaceKey) {
            if (workspaceKey.startsWith("AIza")) {
                hasGemini = true;
            } else if (workspaceKey.startsWith("sk-or-")) {
                hasOpenRouter = true;
            } else if (workspaceKey.startsWith("sk-")) {
                hasOpenAI = true;
            }
        }

        // Force model override based on key format and default model names
        let activeModel = model;
        if (hasOpenAI && !hasGemini && (!model.toLowerCase().includes("gpt-") && !model.toLowerCase().startsWith("openai/"))) {
            activeModel = "gpt-4o-mini";
        } else if (hasGemini && !hasOpenAI && !model.toLowerCase().includes("gemini")) {
            activeModel = "gemini-2.5-flash";
        }

        // 1. Direct OpenAI Check
        const isDirectOpenAI = hasOpenAI && (
            activeModel.toLowerCase().includes("gpt-") || 
            activeModel.toLowerCase().startsWith("openai/")
        );

        if (isDirectOpenAI) {
            const cleanModel = activeModel.startsWith("openai/") ? activeModel.substring(7) : activeModel;
            return new OpenAIProvider(env.OPENAI_API_KEY || workspaceKey, cleanModel);
        }

        // 2. Gemini Check
        const isGemini = hasGemini || activeModel.toLowerCase().includes("gemini");

        if (isGemini) {
            const apiKey = env.GEMINI_API_KEY || env.OPENROUTER_API_KEY || workspaceKey;
            if (!apiKey) {
                if (env.AI) return new CloudflareAIProvider(env.AI);
                throw new Error("Missing GEMINI_API_KEY configuration in environment variables.");
            }
            let cleanModel = activeModel;
            if (cleanModel.includes('/')) {
                const parts = cleanModel.split('/');
                const lastPart = parts[parts.length - 1];
                if (lastPart.toLowerCase().includes('gemini')) {
                    cleanModel = lastPart;
                } else {
                    cleanModel = 'gemini-2.5-flash';
                }
            }
            if (!cleanModel) cleanModel = 'gemini-2.5-flash';
            return new GeminiProvider(apiKey, cleanModel);
        }

        // 3. Cloudflare AI Check
        const isCloudflare = activeModel.toLowerCase().includes("cloudflare") || 
                             activeModel.toLowerCase().includes("llama-3-8b") ||
                             activeModel.toLowerCase().includes("llama-3.1-8b") ||
                             activeModel.toLowerCase().includes("llama-3.2-3b") ||
                             activeModel.startsWith("@cf/") ||
                             (!hasGemini && !hasOpenRouter && env.AI) ||
                             (!hasWorkspaceKey && env.AI);

        if (isCloudflare && env.AI) {
            const isCfModel = activeModel.startsWith("@cf/") || 
                             activeModel.toLowerCase().includes("llama") || 
                             activeModel.toLowerCase().includes("mistral") || 
                             activeModel.toLowerCase().includes("gemma") || 
                             activeModel.toLowerCase().includes("qwen");
            const cleanModel = isCfModel ? activeModel : '@cf/meta/llama-3.2-3b-instruct';
            return new CloudflareAIProvider(env.AI, cleanModel);
        } else {
            // OpenRouter fallback
            const apiKey = env.OPENROUTER_API_KEY || workspaceKey;
            if (!apiKey) {
                if (env.AI) return new CloudflareAIProvider(env.AI);
                throw new Error("Missing OPENROUTER_API_KEY configuration in environment variables.");
            }
            const cleanModel = activeModel || "meta-llama/llama-3.2-3b-instruct:free";
            return new OpenRouterProvider(apiKey, cleanModel);
        }
    }
}

