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
        if (hasOpenAI && !hasGemini && !hasOpenRouter && (!model.toLowerCase().includes("gpt-") && !model.toLowerCase().startsWith("openai/") && !model.toLowerCase().includes("claude") && !model.toLowerCase().includes("deepseek") && !model.toLowerCase().includes("glm"))) {
            activeModel = "gpt-4o-mini";
        } else if (hasGemini && !hasOpenAI && !model.toLowerCase().includes("gemini")) {
            activeModel = "gemini-3.7-flash";
        }

        // 1. Agent Router & Custom Multi-Model Gateway Check (Claude Opus, DeepSeek V4, GLM, GPT-5.6)
        const isAgentRouterSpecialModel = 
            activeModel.includes('claude-opus') || 
            activeModel.includes('deepseek-v4') || 
            activeModel.includes('glm-5') || 
            activeModel.includes('gpt-5.6');

        if (isAgentRouterSpecialModel) {
            const cleanModel = activeModel.includes('/') ? activeModel.split('/').pop() : activeModel;
            const targetKey = workspaceKey || env.OPENAI_API_KEY || env.OPENROUTER_API_KEY || "";
            return new OpenAIProvider(targetKey, cleanModel, "https://agentrouter.org/v1");
        }

        // 2. Direct OpenAI Check
        const isDirectOpenAI = hasOpenAI && (
            activeModel.toLowerCase().includes("gpt-") || 
            activeModel.toLowerCase().startsWith("openai/")
        );

        if (isDirectOpenAI) {
            const cleanModel = activeModel.startsWith("openai/") ? activeModel.substring(7) : activeModel;
            return new OpenAIProvider(env.OPENAI_API_KEY || workspaceKey, cleanModel);
        }

        // 3. Gemini Check
        const isGemini = activeModel.toLowerCase().includes("gemini");

        if (isGemini) {
            const isWorkspaceOpenRouter = hasWorkspaceKey && workspaceKey.startsWith("sk-or-");

            // Use direct GeminiProvider ONLY if we have a direct Gemini API key and workspace is not using OpenRouter
            if (hasGemini && !isWorkspaceOpenRouter) {
                const apiKey = env.GEMINI_API_KEY || (workspaceKey.startsWith("AIza") ? workspaceKey : "");
                if (apiKey) {
                    let cleanModel = activeModel;
                    if (cleanModel.includes('/')) {
                        const parts = cleanModel.split('/');
                        const lastPart = parts[parts.length - 1];
                        if (lastPart.toLowerCase().includes('gemini')) {
                            cleanModel = lastPart;
                        } else {
                            cleanModel = 'gemini-3.7-flash';
                        }
                    }
                    if (!cleanModel) cleanModel = 'gemini-3.7-flash';
                    return new GeminiProvider(apiKey, cleanModel);
                }
            }
            
            // Otherwise, route to OpenRouter
            if (hasOpenRouter || isWorkspaceOpenRouter) {
                const apiKey = isWorkspaceOpenRouter ? workspaceKey : env.OPENROUTER_API_KEY;
                if (apiKey) {
                    return new OpenRouterProvider(apiKey, activeModel);
                }
            }
            
            // Fallback to Cloudflare AI
            if (env.AI) {
                return new CloudflareAIProvider(env.AI, '@cf/meta/llama-3.2-3b-instruct');
            }
            
            throw new Error("Missing GEMINI_API_KEY or OPENROUTER_API_KEY configuration for Gemini model.");
        }

        // 4. Cloudflare AI Check
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
            // If workspace has custom key (e.g. Agent Router sk- key), use OpenAIProvider targeting AgentRouter
            if (workspaceKey && workspaceKey.startsWith("sk-")) {
                const cleanModel = activeModel.includes('/') ? activeModel.split('/').pop() : activeModel;
                return new OpenAIProvider(workspaceKey, cleanModel, "https://agentrouter.org/v1");
            }
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

