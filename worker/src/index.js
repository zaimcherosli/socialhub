/**
 * SocialHub Cloudflare Worker Backend Pipeline
 * Handles secure user authentication, PBKDF2 password hashing, HS256 JWT sessions,
 * OAuth platforms registry connection, RESTful post drafts composer, media asset galleries,
 * and the Core Scheduling & Queue Engine.
 */

import { PublishingEngine } from './publishers/PublishingEngine.js';
import { PublisherFactory } from './publishers/PublisherFactory.js';
import { AIFactory } from './services/ai/AIFactory.js';
import { AutopilotService } from './services/ai/AutopilotService.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Helper: base64url encoding for JWT
function base64urlEncode(bytes) {
    const binString = String.fromCharCode(...bytes);
    return btoa(binString)
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

// Helper: base64url decoding for JWT
function base64urlDecode(str) {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) {
        base64 += "=";
    }
    const binString = atob(base64);
    return Uint8Array.from(binString, (c) => c.charCodeAt(0));
}

// Helper: JSON parts encoders for JWT
function encodeJson(obj) {
    const bytes = encoder.encode(JSON.stringify(obj));
    return base64urlEncode(bytes);
}

function decodeJson(str) {
    const bytes = base64urlDecode(str);
    return JSON.parse(decoder.decode(bytes));
}

// Helper: Native Crypto PBKDF2 Password Hashing
async function hashPassword(password, salt = null) {
    if (!salt) {
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    const iterations = 100000;
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const derivedBytes = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: encoder.encode(salt),
            iterations,
            hash: 'SHA-256'
        },
        passwordKey,
        256
    );
    const hash = Array.from(new Uint8Array(derivedBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `pbkdf2$${iterations}$${salt}$${hash}`;
}

async function verifyPassword(password, storedHash) {
    try {
        const parts = storedHash.split('$');
        if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
        const [, , salt] = parts;
        const newHash = await hashPassword(password, salt);
        return newHash === storedHash;
    } catch (e) {
        return false;
    }
}

// Helper: HMAC-SHA256 JWT Generation
async function signJWT(payload, secret) {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = encodeJson(header);
    const encodedPayload = encodeJson(payload);
    const tokenData = `${encodedHeader}.${encodedPayload}`;
    
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(tokenData)
    );
    
    const encodedSignature = base64urlEncode(new Uint8Array(signature));
    return `${tokenData}.${encodedSignature}`;
}

async function getPerformanceFeedback(db, workspaceId) {
    try {
        const topPosts = await db.prepare(
            `SELECT content, views_count, likes_count, replies_count FROM scheduled_posts 
             WHERE workspace_id = ? AND status = 'published' AND views_count > 0
             ORDER BY (views_count + likes_count * 5 + replies_count * 10) DESC 
             LIMIT 3`
        ).bind(workspaceId).all();

        const bottomPosts = await db.prepare(
            `SELECT content, views_count, likes_count, replies_count FROM scheduled_posts 
             WHERE workspace_id = ? AND status = 'published' AND views_count > 0
             ORDER BY (views_count + likes_count * 5 + replies_count * 10) ASC 
             LIMIT 3`
        ).bind(workspaceId).all();

        let performanceFeedback = "";
        if (topPosts.results && topPosts.results.length > 0) {
            performanceFeedback += "\nHere are your top-performing past posts. Analyze their hook, style, and angle to write similar high-performing content:\n";
            topPosts.results.forEach((p, i) => {
                performanceFeedback += `Top Post ${i+1}: "${p.content.replace(/\n/g, ' ')}" (Views: ${p.views_count}, Likes: ${p.likes_count})\n`;
            });
        }
        if (bottomPosts.results && bottomPosts.results.length > 0) {
            performanceFeedback += "\nHere are your lowest-performing past posts. Avoid these hooks, structures, or angles, and write different/better angles:\n";
            bottomPosts.results.forEach((p, i) => {
                performanceFeedback += `Low Post ${i+1}: "${p.content.replace(/\n/g, ' ')}" (Views: ${p.views_count}, Likes: ${p.likes_count})\n`;
            });
        }
        return performanceFeedback;
    } catch (e) {
        console.error("[getPerformanceFeedback] Failed to query performance:", e.message);
        return "";
    }
}

async function verifyJWT(token, secret) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        
        const [encodedHeader, encodedPayload, encodedSignature] = parts;
        const tokenData = `${encodedHeader}.${encodedPayload}`;
        
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify"]
        );
        
        const signatureBytes = base64urlDecode(encodedSignature);
        const dataBytes = encoder.encode(tokenData);
        
        const isValid = await crypto.subtle.verify(
            "HMAC",
            key,
            signatureBytes,
            dataBytes
        );
        
        if (!isValid) return null;
        
        const payload = decodeJson(encodedPayload);
        if (payload.exp && Date.now() / 1000 > payload.exp) {
            return null;
        }
        return payload;
    } catch (e) {
        return null;
    }
}

// Helper: AES-GCM Encryption for stored tokens
async function getEncryptionKey(secret) {
    const secretBytes = encoder.encode(secret);
    const hash = await crypto.subtle.digest("SHA-256", secretBytes);
    return await crypto.subtle.importKey(
        "raw",
        hash,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptToken(text, secret) {
    if (!text) return null;
    const key = await getEncryptionKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(text)
    );
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${cipherHex}`;
}

async function decryptToken(encryptedStr, secret) {
    if (!encryptedStr) return null;
    try {
        const parts = encryptedStr.split(':');
        if (parts.length !== 2) return null;
        const [ivHex, cipherHex] = parts;
        
        const key = await getEncryptionKey(secret);
        const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const ciphertext = new Uint8Array(cipherHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            ciphertext
        );
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        return null;
    }
}

async function runFallbackAI(systemPrompt, env) {
    // 1. Try Cloudflare Workers AI (since it requires no keys and is fast/internal)
    if (env.AI) {
        try {
            console.log("[FallbackAI] Attempting Cloudflare Workers AI fallback...");
            const res = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
                messages: [
                    { role: "system", content: "You must output strictly a JSON object." },
                    { role: "user", content: systemPrompt }
                ]
            });
            const text = typeof res === 'string' ? res : (res.choices?.[0]?.message?.content || res.response || JSON.stringify(res));
            if (text) {
                console.log("[FallbackAI] Cloudflare Workers AI fallback successful.");
                return { text, model: "@cf/meta/llama-3.2-3b-instruct (fallback)" };
            }
        } catch (e) {
            console.error("[FallbackAI] Cloudflare Workers AI fallback failed:", e);
        }
    }

    // 2. Try OpenRouter Free Llama if key is present
    if (env.OPENROUTER_API_KEY) {
        try {
            console.log("[FallbackAI] Attempting OpenRouter free Llama fallback...");
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://socialhub.zaimrosli.my",
                    "X-Title": "SocialHub Autoposter Fallback"
                },
                body: JSON.stringify({
                    model: "meta-llama/llama-3.2-3b-instruct:free",
                    messages: [{ role: "user", content: systemPrompt }],
                    temperature: 0.7
                })
            });
            if (res.ok) {
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content || "";
                if (text) {
                    console.log("[FallbackAI] OpenRouter free Llama fallback successful.");
                    return { text, model: "meta-llama/llama-3.2-3b-instruct:free (fallback)" };
                }
            }
        } catch (e) {
            console.error("[FallbackAI] OpenRouter free Llama fallback failed:", e);
        }
    }

    return null;
}

async function getAIEnvironment(db, workspaceId, env, encryptionSecret, subscriptionPlan) {
    const aiEnv = { ...env };
    
    // Smart plan-based model defaults
    const PLAN_DEFAULT_MODELS = {
        free:       'nousresearch/hermes-3-llama-3.1-405b:free',
        starter:    'nousresearch/hermes-3-llama-3.1-405b:free',
        pro:        'google/gemini-3.5-flash',
        agency:     'openai/gpt-4o-mini',
        enterprise: 'openai/gpt-5.5',
    };

    // 1. Check global settings if database exists (stored under user_id = 1 / admin)
    if (db) {
        try {
            const toggles = await db.prepare(
                "SELECT setting_key, setting_value FROM settings WHERE user_id = 1 AND setting_key IN ('sys_gemini_disabled', 'sys_openai_disabled')"
            ).all();
            if (toggles && toggles.results) {
                const isGeminiDisabled = toggles.results.some(s => s.setting_key === 'sys_gemini_disabled' && s.setting_value === 'true');
                const isOpenAIDisabled = toggles.results.some(s => s.setting_key === 'sys_openai_disabled' && s.setting_value === 'true');
                
                if (isGeminiDisabled) aiEnv.GEMINI_API_KEY = "";
                if (isOpenAIDisabled) aiEnv.OPENAI_API_KEY = "";
            }
        } catch (_) {}
    }

    // 2. Load workspace specific configurations (BYOK)
    if (db && workspaceId) {
        try {
            const wsAI = await db.prepare(
                "SELECT ai_model, ai_api_key_enc, custom_ai_instructions, copywriting_persona FROM workspaces WHERE id = ?"
            ).bind(workspaceId).first();
            
            if (wsAI) {
                // Check if user has their own API key
                let hasByokKey = false;
                if (wsAI.ai_api_key_enc) {
                    const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                    const resolvedKey = decrypted || wsAI.ai_api_key_enc;
                    const isValidKey = resolvedKey && (resolvedKey.startsWith('sk-') || resolvedKey.startsWith('AIza') || resolvedKey.length > 40);
                    if (isValidKey) {
                        // Only assign the workspace key to its matching provider slot
                        // Do NOT overwrite other providers' global keys with a foreign key type
                        if (resolvedKey.startsWith('AIza')) {
                            // Gemini key — only override Gemini slot
                            aiEnv.GEMINI_API_KEY = resolvedKey;
                        } else if (resolvedKey.startsWith('sk-or-')) {
                            // OpenRouter key — only override OpenRouter slot
                            aiEnv.OPENROUTER_API_KEY = resolvedKey;
                        } else if (resolvedKey.startsWith('sk-')) {
                            // OpenAI key — only override OpenAI slot
                            aiEnv.OPENAI_API_KEY = resolvedKey;
                        } else {
                            // Unknown key type — treat as OpenRouter fallback
                            aiEnv.OPENROUTER_API_KEY = resolvedKey;
                        }
                        aiEnv._workspaceKeySet = true;
                        hasByokKey = true;
                    }
                }

                // Model selection: manual > smart plan default
                if (wsAI.ai_model && wsAI.ai_model !== 'auto') {
                    // Manual selection by user (advanced mode)
                    aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                } else if (!hasByokKey) {
                    // Smart auto-select: pick best model for this plan
                    const plan = subscriptionPlan || wsAI.subscription_plan || 'free';
                    aiEnv.OPENROUTER_MODEL = PLAN_DEFAULT_MODELS[plan] || PLAN_DEFAULT_MODELS['free'];
                }

                // Append copywriting persona context if set
                let personaInstructions = "";
                if (wsAI.copywriting_persona === 'male_husband') {
                    personaInstructions = `\n\nCRITICAL PERSONA RULES:
- Write strictly from the Perspective/POV of a married Malaysian man/husband/father (Suami/Lelaki/Papa).
- Use natural conversational terms like "aku", "bini aku", "wife aku", "anak-anak".
- DIVERSIFY STORYTELLING ANGLES (JANGAN asyik cerita/relate pasal bini/wife sahaja):
  1. Self/Personal: Frame as a man's own daily experience, hobbies, work-from-home, or personal preference (e.g. "aku sendiri yang leceh...", "aku setup meja kerja...", "aku beli ni sebab...").
  2. Dad life: Frame around managing kids, family activities, safety, or parenting (e.g. "anak-anak aku...", "sebagai bapa...").
  3. Husband Initiative: Frame around you doing housework or DIY repairs yourself (e.g. "aku tolong basuh...", "aku pasang sendiri...", "aku tukar kipas ni...").
  4. Wife Easing (Limit to max 25% of posts): Frame as helping/easing your wife's workload, but only when highly relevant. Do NOT make it the hook or narrative of every post.`;
                } else if (wsAI.copywriting_persona === 'female_wife') {
                    personaInstructions = `\n\nCRITICAL PERSONA RULES:
- Write strictly from the Perspective/POV of a married Malaysian woman/wife/mother (Isteri/Ibu).
- Use natural conversational terms like "husband aku", "laki aku", "anak-anak".
- Frame the hooks or narrative naturally around family life, managing the kitchen/household, or making life easier for your husband and children.`;
                } else if (wsAI.copywriting_persona === 'young_single') {
                    personaInstructions = `\n\nCRITICAL PERSONA RULES:
- Write strictly from the Perspective/POV of a young single adult living alone in Malaysia (bujang/student/worker).
- Frame the content around convenience, budget-friendly choices, quick meals/solutions, renting rooms/apartments, and making solo life simpler.`;
                }
                
                aiEnv.custom_ai_instructions = (wsAI.custom_ai_instructions || "") + personaInstructions;
            }
        } catch (_) {}
    }
    
    return aiEnv;
}

async function createNotification(db, workspaceId, userId, title, message, type = 'info', link = null) {
    if (!db) return;
    try {
        await db.prepare(
            `INSERT INTO notifications (workspace_id, user_id, title, message, type, link, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(workspaceId, userId || null, title, message, type, link).run();
    } catch (e) {
        console.error("[createNotification] Failed:", e);
    }
}

async function syncHistoricalThreadsPosts(env, userId, workspaceId, socialAccountId, accessToken, threadsUserId) {
    console.log(`[HistoricalSync] Initiated for workspace ${workspaceId}, account ${socialAccountId}`);
    try {
        const url = `https://graph.threads.net/v1.0/${threadsUserId}/threads?fields=id,media_product_type,media_type,permalink,text,timestamp,username&access_token=${accessToken}&limit=50`;
        const res = await fetch(url);
        if (!res.ok) {
            const errText = await res.text();
            console.error(`[HistoricalSync] Threads API error: ${errText}`);
            return;
        }
        const data = await res.json();
        if (!data || !Array.isArray(data.data)) {
            console.warn(`[HistoricalSync] No posts returned from Threads API.`);
            return;
        }

        console.log(`[HistoricalSync] Found ${data.data.length} posts on Threads. Syncing...`);
        for (const thread of data.data) {
            // Check if post already exists in scheduled_posts
            const existing = await env.DB.prepare(
                "SELECT id FROM scheduled_posts WHERE workspace_id = ? AND external_post_id = ?"
            ).bind(workspaceId, thread.id).first().catch(() => null);

            if (!existing) {
                const pubDate = thread.timestamp ? new Date(thread.timestamp).toISOString() : new Date().toISOString();
                
                await env.DB.prepare(
                    `INSERT INTO scheduled_posts (
                        user_id, workspace_id, account_id, platform, content,
                        status, publish_at, published_at, external_post_id, timezone, created_at, updated_at
                    ) VALUES (?, ?, ?, 'threads', ?, 'published', ?, ?, ?, 'UTC', ?, ?)`
                ).bind(
                    userId,
                    workspaceId,
                    socialAccountId,
                    thread.text || '',
                    pubDate,
                    pubDate,
                    thread.id,
                    pubDate,
                    pubDate
                ).run().catch(err => {
                    console.error(`[HistoricalSync] Error inserting post ${thread.id}: ${err.message}`);
                });
            } else {
                // If it exists but account_id is null (due to previous disconnect), relink it!
                await env.DB.prepare(
                    "UPDATE scheduled_posts SET account_id = ? WHERE id = ? AND account_id IS NULL"
                ).bind(socialAccountId, existing.id).run().catch(() => {});
            }
        }
        console.log(`[HistoricalSync] Sync completed for workspace ${workspaceId}`);
    } catch (e) {
        console.error(`[HistoricalSync] Unhandled error: ${e.message}`);
    }
}

// Filename sanitizer
function sanitizeFilename(name) {
    if (!name) return 'unnamed_file';
    return name.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\.\.+/g, '.');
}

// Modular OAuth Platforms Registry
const OAuthProviders = {
    threads: {
        getAuthUrl(state, redirectUri, clientId) {
            const url = new URL("https://threads.net/oauth/authorize");
            url.searchParams.set("client_id", clientId);
            url.searchParams.set("redirect_uri", redirectUri);
            url.searchParams.set("scope", "threads_basic,threads_content_publish,threads_manage_replies,threads_manage_insights");
            url.searchParams.set("response_type", "code");
            url.searchParams.set("state", state);
            return url.toString() + '#weblink';
        },
        async exchangeCode(code, redirectUri, clientId, clientSecret) {
            if ((clientId && clientId.includes("mock")) || (code && code.includes("mock")) || (redirectUri && (redirectUri.includes("localhost") || redirectUri.includes("127.0.0.1")))) {
                return {
                    access_token: `mock-threads-token-${Date.now()}`,
                    refresh_token: "threads-mock-refresh-token",
                    expires_in: 86400 * 60,
                    account_name: "@threads_tester",
                    account_id: `mock_threads_id_${Date.now()}`
                };
            }

            const response = await fetch("https://graph.threads.net/oauth/access_token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: "authorization_code",
                    redirect_uri: redirectUri,
                    code: code
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                const errMsg = err.error?.message || err.error_message || (err.error ? JSON.stringify(err.error) : JSON.stringify(err));
                throw new Error(errMsg || "Meta Threads access token exchange failed");
            }

            const data = await response.json();
            const shortLivedToken = data.access_token;
            const accountId = data.user_id;

            // Exchange short-lived token (1 hour) for long-lived token (60 days)
            const exchangeResponse = await fetch(
                `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${clientSecret}&access_token=${shortLivedToken}`
            );
            
            let finalToken = shortLivedToken;
            let expiresIn = data.expires_in || 3600;
            
            if (exchangeResponse.ok) {
                const exchangeData = await exchangeResponse.json();
                finalToken = exchangeData.access_token;
                expiresIn = exchangeData.expires_in || (86400 * 60);
            } else {
                console.error("[Threads] Failed to exchange for long-lived token:", await exchangeResponse.text());
            }

            const profileResponse = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${finalToken}`);
            let accountName = `@threads_user_${accountId}`;
            let correctAccountId = accountId.toString();
            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                accountName = `@${profile.username}`;
                if (profile.id) {
                    correctAccountId = profile.id.toString();
                }
            }

            return {
                access_token: finalToken,
                refresh_token: data.refresh_token || "threads-no-refresh-token",
                expires_in: expiresIn,
                account_name: accountName,
                account_id: correctAccountId
            };
        }
    },
    facebook: {
        getAuthUrl(state, redirectUri, clientId) {
            const url = new URL("https://www.facebook.com/v18.0/dialog/oauth");
            url.searchParams.set("client_id", clientId);
            url.searchParams.set("redirect_uri", redirectUri);
            url.searchParams.set("scope", "email,public_profile,pages_show_list,pages_read_engagement,pages_manage_posts");
            url.searchParams.set("response_type", "code");
            url.searchParams.set("state", state);
            url.searchParams.set("auth_type", "rerequest");
            return url.toString();
        },
        async exchangeCode(code, redirectUri, clientId, clientSecret) {
            if (clientId.includes("mock") || code.includes("mock") || redirectUri.includes("localhost") || redirectUri.includes("127.0.0.1")) {
                return {
                    access_token: `mock-facebook-token-${Date.now()}`,
                    refresh_token: "facebook-mock-refresh-token",
                    expires_in: 86400 * 60,
                    account_name: "Facebook Page Tester",
                    account_id: `mock_facebook_id_${Date.now()}`
                };
            }

            // 1. Get short-lived User token
            const response = await fetch("https://graph.facebook.com/v18.0/oauth/access_token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    code: code
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || "Facebook access token exchange failed");
            }

            const data = await response.json();
            const shortLivedUserToken = data.access_token;

            // 2. Exchange short-lived User token for long-lived User token (60 days)
            const fbExchangeResponse = await fetch(
                `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${shortLivedUserToken}`
            );

            let longLivedUserToken = shortLivedUserToken;
            if (fbExchangeResponse.ok) {
                const exchangeData = await fbExchangeResponse.json();
                longLivedUserToken = exchangeData.access_token;
            } else {
                console.error("[Facebook] Failed to exchange for long-lived token:", await fbExchangeResponse.text());
            }

            // 3. Get user's own profile (ID + name) as fallback
            const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${longLivedUserToken}`);
            let fbUserId = 'fb_user';
            let fbUserName = 'Facebook User';
            if (meRes.ok) {
                const meData = await meRes.json();
                fbUserId = meData.id || 'fb_user';
                fbUserName = meData.name || 'Facebook User';
            }

            // 4. Try to fetch managed Pages — if none found, store user token for manual page selection
            const pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${longLivedUserToken}&fields=id,name,access_token`);

            if (pagesResponse.ok) {
                const pagesData = await pagesResponse.json();
                const pages = pagesData.data || [];
                if (pages.length > 0) {
                    // Best case: got page access token directly (permanent, never expires)
                    return {
                        access_token: pages[0].access_token,
                        refresh_token: "facebook-no-refresh-token",
                        expires_in: 5184000,
                        account_name: `${pages[0].name} (FB Page)`,
                        account_id: pages[0].id.toString(),
                        allPages: pages // pass all pages for multi-page selection later
                    };
                }
            }

            // Fallback: no pages found — store user token and let user pick from UI
            console.warn(`[Facebook] No pages returned for user ${fbUserId} — storing user token for page selection UI`);
            return {
                access_token: longLivedUserToken,
                refresh_token: "facebook-user-token",
                expires_in: 5184000,
                account_name: `${fbUserName} (Select Page)`,
                account_id: fbUserId.toString(),
                needsPageSelection: true
            };
        }
    },
    instagram: {
        getAuthUrl(state, redirectUri, clientId) {
            const url = new URL("https://api.instagram.com/oauth/authorize");
            url.searchParams.set("client_id", clientId);
            url.searchParams.set("redirect_uri", redirectUri);
            url.searchParams.set("scope", "user_profile,user_media");
            url.searchParams.set("response_type", "code");
            url.searchParams.set("state", state);
            return url.toString() + '#weblink';
        },
        async exchangeCode(code, redirectUri, clientId, clientSecret) {
            if (clientId.includes("mock") || code.includes("mock") || redirectUri.includes("localhost") || redirectUri.includes("127.0.0.1")) {
                return {
                    access_token: `mock-instagram-token-${Date.now()}`,
                    refresh_token: "instagram-mock-refresh-token",
                    expires_in: 86400 * 60,
                    account_name: "@instagram_tester",
                    account_id: `mock_instagram_id_${Date.now()}`
                };
            }

            const response = await fetch("https://api.instagram.com/oauth/access_token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: "authorization_code",
                    redirect_uri: redirectUri,
                    code: code
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                const errMsg = err.error?.message || err.error_message || (err.error ? JSON.stringify(err.error) : JSON.stringify(err));
                throw new Error(errMsg || "Instagram access token exchange failed");
            }

            const data = await response.json();
            const accessToken = data.access_token;
            const accountId = data.user_id;

            const profileResponse = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${accessToken}`);
            let accountName = `instagram_user_${accountId}`;
            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                accountName = profile.username;
            }

            return {
                access_token: accessToken,
                refresh_token: "instagram-no-refresh-token",
                expires_in: 86400 * 60,
                account_name: accountName,
                account_id: accountId.toString()
            };
        }
    }
};

// Helper: Clean up scraped title tags to remove branding suffixes and agent credentials
const cleanScrapedTitle = (title) => {
    if (!title) return "";
    let clean = title.trim();

    // 1. Remove agent credentials like PEA 1234, REN 12345, REA 1234, E(3)1234, etc.
    clean = clean.replace(/\b(PEA|REN|REA|E|REN|PEA)\s?\d{3,6}\b/gi, '').trim();
    clean = clean.replace(/\b[EPR]\(\d\)\s?\d{3,6}\b/gi, '').trim();

    // 2. Remove common portals and branding suffixes
    const portalsRegex = /\|\s*(Salah\s*Property|SalahProperty|PropMall|Mudah|PropertyGuru|iProperty|Telegram|Facebook|Instagram|TikTok)[^|]*$/i;
    clean = clean.replace(portalsRegex, '').trim();

    const portalsRegexDash = /-\s*(Salah\s*Property|SalahProperty|PropMall|Mudah|PropertyGuru|iProperty|Telegram|Facebook|Instagram|TikTok)[^-]*$/i;
    clean = clean.replace(portalsRegexDash, '').trim();

    // 3. Remove general trailing separator characters
    clean = clean.replace(/[\s|—•-]$/, '').trim();
    
    // Clean double spaces
    clean = clean.replace(/\s+/g, ' ').trim();

    return clean;
};

// Helper: Extract price in RM format (e.g. RM1.63mil, RM1.5m, RM150k) from text
const extractPrice = (text) => {
    if (!text) return "";
    const regex = /RM\s?(\d+[\d,.]*\s?(?:mil|million|m|k|b|juta)?)\b/i;
    const match = text.match(regex);
    if (match) {
        let price = match[0].trim();
        if (price.endsWith('.')) {
            price = price.slice(0, -1);
        }
        return price;
    }
    return "";
};

// Helper: Check if a URL points to a specific Telegram channel post
const isTelegramPostUrl = (urlStr) => {
    try {
        const u = new URL(urlStr);
        return (u.hostname === 't.me' || u.hostname === 'telegram.me') && /^\/[^\/]+\/\d+$/.test(u.pathname);
    } catch (_) { return false; }
};

// Helper: Extract real listing title from Telegram post description fallback
const extractTelegramTitle = (scrapedTitle, scrapedDescription) => {
    if (!scrapedDescription) return scrapedTitle || "";
    
    // Clean emojis and bullet markers from each line
    const rawLines = scrapedDescription.split('\n');
    const cleanLines = rawLines.map(l => {
        let val = l.replace(/[✅✨🏠📌🔥*‼️•⁠🏡❗️❗\-–\s]/g, ' ').replace(/\s+/g, ' ').trim();
        // Strip out contact links/handles (wasap.my, wa.me, wa.link, t.me, bit.ly, etc.)
        val = val.replace(/(?:https?:\/\/)?(?:www\.)?(?:wasap\.my|wa\.me|wa\.link|t\.me|bit\.ly)\/[a-zA-Z0-9_/.-]+/gi, '');
        // Clean leading transition prepositions left after link strip
        val = val.replace(/^(?:di|pada|hubungi|contact|ren|pea|wasap|wasap\.my|wa\.me)\s+/i, '');
        return val.trim();
    }).filter(Boolean);

    const buildingTypeRegex = /\b(Storey|Tingkat|Sty|Terrace|Teres|Semi.?D|Bungalow|Banglo|Condo|Condominium|Kondominium|Apartment|Pangsapuri|Flat|Townhouse|House|Rumah|Suite|Office|Shoplot|Cluster)\b/i;
    const locationKeyword = /\b(Bandar|Taman|Pandan|Subang|Shah|Alam|Petaling|Ampang|Rawang|Semenyih|Dengkil|Klang|Cheras|Setapak|Puchong|Serdang|Cyberjaya|Putrajaya|Kajang|Sepang|Sri|Damansara|Kepong|Selayang|Batu|Seremban|Nilai|Alam|Perdana|Indah|Permai|Damai|Maju|Jaya|Murni|Harmoni|Saujana|Putra|Prima|Utama|Raya|Seksyen|BSP|SP\s*\d+|Bangi|Gombak|Setiawangsa|Wangsa|Maju|Bukit|Jalil|Banting|Jenjarom|Salak|Tinggi|Semenyih|Kajang|Klang|Kuala|Lumpur|KL|Sentul)\b/i;

    // Search for a line with building type and check neighboring lines for location context
    for (let i = 0; i < cleanLines.length; i++) {
        const line = cleanLines[i];
        if (buildingTypeRegex.test(line)) {
            // Exclude long description sentences that start with common descriptions
            if (line.length > 80 && (line.toLowerCase().startsWith("the ") || line.toLowerCase().startsWith("this ") || line.toLowerCase().startsWith("is "))) {
                continue;
            }
            // If the line has building type, check if it also has location
            if (locationKeyword.test(line)) {
                return line.substring(0, 100).trim();
            }
            // Otherwise check if the next line has location
            if (i + 1 < cleanLines.length && locationKeyword.test(cleanLines[i+1])) {
                const combined = `${line} - ${cleanLines[i+1]}`;
                return combined.substring(0, 100).trim();
            }
            // If next line is not location, check if previous line was a short header
            if (i - 1 >= 0 && cleanLines[i-1].length < 30 && locationKeyword.test(cleanLines[i-1])) {
                const combined = `${line} - ${cleanLines[i-1]}`;
                return combined.substring(0, 100).trim();
            }
            // Return building type line alone
            return line.substring(0, 100).trim();
        }
    }

    // Fallback: search for location keyword alone
    const locLine = cleanLines.find(l => l.length > 3 && locationKeyword.test(l));
    if (locLine) return locLine.substring(0, 100).trim();

    return scrapedTitle || "";
};

// Helper: Auto-shorten any ecommerce links found inside post content
const autoShortenTextLinks = async (db, content, userId, workspaceId) => {
    if (!content) return content;

    const ecommerceRegex = /(https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:shopee\.com\.my|shopee\.sg|shopee\.co\.id|shopee\.com|tiktok\.com|lazada\.com\.my|lazada\.com)[\w\-._~:/?#[\]@!$&'()*+,;=]*)/gi;
    
    let updatedContent = content;
    const matches = [...content.matchAll(ecommerceRegex)].map(m => m[1]);
    const uniqueUrls = Array.from(new Set(matches));

    for (const rawUrl of uniqueUrls) {
        const code = Math.random().toString(36).substring(2, 8);
        try {
            await db.prepare(
                `INSERT INTO short_links (code, target_url, title, description, workspace_id)
                 VALUES (?, ?, 'Auto-Shortened Link', 'Automatically shortened during post scheduling', ?)`
            ).bind(code, rawUrl, workspaceId).run();

            updatedContent = updatedContent.split(rawUrl).join(`https://nakcuba.my/l/${code}`);
        } catch (e) {
            console.error("Auto-shortening failed for URL:", rawUrl, e);
        }
    }
    
    return updatedContent;
};

// Helper: Append Fact Preservation rule to workspace instructions
const getFactPreservingInstructions = (rawInstructions) => {
    if (!rawInstructions || rawInstructions.trim() === '') return "";
    return `${rawInstructions}\n\nFACT PRESERVATION RULE:\nYou must strictly preserve the real facts from the input/source text (such as the actual location, price, room count, and property specs). Under no circumstances should you invent, guess, or hallucinate a fake price (like RM800,000) or a fake location (like Shah Alam) if it is not in the source text. If your guidelines ask you to avoid or hide the actual price or project name, simply do not mention them at all (omit them) or use general phrases like 'harga berpatutan' or 'lokasi strategik' — but DO NOT fabricate or invent fake details.`;
};
// Helper: Get niche classification & guidelines instructions prompt
const getNicheInstructionsPrompt = async (db, productContext) => {
    if (!db) return "";
    const textToAnalyze = (productContext || "").toLowerCase();
    
    let matchedNiche = null;
    let matchedRules = [];
    
    try {
        const niches = await db.prepare("SELECT * FROM system_niche_rules ORDER BY id ASC").all();
        if (niches && niches.results) {
            for (const niche of niches.results) {
                // detection_keywords is a comma-separated list
                const keywords = (niche.detection_keywords || "").split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
                if (keywords.some(k => textToAnalyze.includes(k))) {
                    matchedNiche = niche.name;
                    // rules is stored as a JSON array string
                    try {
                        matchedRules = JSON.parse(niche.rules || "[]");
                    } catch (_) {
                        matchedRules = [];
                    }
                    break;
                }
            }
        }
    } catch (_) {
        // Fallback to empty if D1 query fails
    }
    
    let promptBlock = "";
    if (matchedNiche) {
        promptBlock = `\nSYSTEM AUTO-CLASSIFIED NICHE: ${matchedNiche}\nCRITICAL NICHE RULES (You MUST follow these rules closely):\n${matchedRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
    } else {
        promptBlock = `\nSYSTEM AUTO-CLASSIFIED NICHE: General / Dynamic Fallback\nCRITICAL DYNAMIC RULES (Analyze the input product/service and dynamically decide the best copywriting style, hooks, and guidelines that fit it. DO NOT fabricate or invent fake facts, prices, or locations).`;
    }
    return promptBlock;
};

// Helper: Get raw niche classification data
const getNicheInstructions = async (db, productContext) => {
    if (!db) return null;
    const textToAnalyze = (productContext || "").toLowerCase();
    
    try {
        const niches = await db.prepare("SELECT * FROM system_niche_rules ORDER BY id ASC").all();
        if (niches && niches.results) {
            for (const niche of niches.results) {
                const keywords = (niche.detection_keywords || "").split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
                if (keywords.some(k => textToAnalyze.includes(k))) {
                    let rules = [];
                    try {
                        rules = JSON.parse(niche.rules || "[]");
                    } catch (_) {}
                    return {
                        niche_key: niche.niche_key || null,
                        name: niche.name,
                        rules: rules,
                        example_output: niche.example_output || null
                    };
                }
            }
        }
    } catch (_) {}
    return null;
};

// ── Shared Helper: Execute immediate publish logic (used by Web REST API and Telegram Webhook) ──
async function executeImmediatePublish(db, spId, userId, encryptionSecret) {
    const scheduledPost = await db.prepare(
        "SELECT * FROM scheduled_posts WHERE id = ? AND user_id = ?"
    ).bind(spId, userId).first();

    if (!scheduledPost) {
        throw new Error('Scheduled post not found');
    }

    await db.prepare("UPDATE scheduled_posts SET status = 'publishing' WHERE id = ?").bind(spId).run();

    const socialAccount = await db.prepare(
        "SELECT * FROM social_accounts WHERE id = ? AND user_id = ?"
    ).bind(scheduledPost.account_id, userId).first();

    if (!socialAccount) {
        throw new Error('Connected social account not found.');
    }

    const decryptedAccessToken = await decryptToken(socialAccount.access_token, encryptionSecret);
    const credentials = { access_token: decryptedAccessToken, account_id: socialAccount.account_id };

    const publisher = PublisherFactory.getPublisher(scheduledPost.platform);
    
    const postObj = {
        title: '',
        caption: scheduledPost.content,
        media: []
    };

    const result = await publisher.publish(postObj, credentials);

    if (result.success) {
        const nowStr = new Date().toISOString();
        await db.prepare(
            `UPDATE scheduled_posts 
              SET status = 'published', published_at = ?, external_post_id = ?, error_message = NULL, updated_at = (datetime('now'))
              WHERE id = ?`
         ).bind(nowStr, result.provider_post_id, spId).run();

         await db.prepare(
             `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
              VALUES (NULL, ?, 'success', NULL, ?, ?, ?)`
         ).bind(socialAccount.id, result.provider_post_id, JSON.stringify(result), nowStr).run();

         await createNotification(
             db, 
             scheduledPost.workspace_id, 
             userId, 
             "Post Berjaya Diterbitkan 🚀", 
             `Post dijadualkan anda berjaya diterbitkan di platform ${scheduledPost.platform.toUpperCase()} (${socialAccount.account_name})`, 
             "success", 
             "/schedule.html"
         );

         return { success: true, result };
    } else {
        await db.prepare(
            `UPDATE scheduled_posts 
              SET status = 'failed', error_message = ?, updated_at = (datetime('now'))
              WHERE id = ?`
         ).bind(result.error_message, spId).run();

         await db.prepare(
             `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, response_payload, published_at) 
              VALUES (NULL, ?, 'failed', ?, ?, (datetime('now')))`
         ).bind(socialAccount.id, result.error_message, JSON.stringify(result)).run();

         await createNotification(
             db, 
             scheduledPost.workspace_id, 
             userId, 
             "Gagal Menerbitkan Post ❌", 
             `Sistem gagal menerbitkan post anda di ${scheduledPost.platform.toUpperCase()} (${socialAccount.account_name}). Ralat: ${result.error_message}`, 
             "error", 
             "/schedule.html"
         );

         throw new Error(result.error_message);
    }
}

// ── Telegram Bot API HTTP Helpers ──
async function sendTelegramMessage(token, chatId, text, replyMarkup = null) {
    let cleanToken = (token || '').trim();
    if (cleanToken.toLowerCase().startsWith('bot')) {
        cleanToken = cleanToken.substring(3);
    }
    console.log(`[Telegram Debug] sending using token: ${cleanToken.substring(0, 10)}...${cleanToken.substring(cleanToken.length - 10)} (length: ${cleanToken.length})`);
    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    const body = {
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
    };
    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[Telegram sendTelegramMessage Error] status: ${response.status}, body: ${errBody}`);
    }
    return response.ok;
}

async function editTelegramMessage(token, chatId, messageId, text, replyMarkup = null) {
    let cleanToken = (token || '').trim();
    if (cleanToken.toLowerCase().startsWith('bot')) {
        cleanToken = cleanToken.substring(3);
    }
    const url = `https://api.telegram.org/bot${cleanToken}/editMessageText`;
    const body = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: 'HTML'
    };
    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[Telegram editTelegramMessage Error] status: ${response.status}, body: ${errBody}`);
    }
    return response.ok;
}

async function answerCallbackQuery(token, callbackQueryId, text = null) {
    let cleanToken = (token || '').trim();
    if (cleanToken.toLowerCase().startsWith('bot')) {
        cleanToken = cleanToken.substring(3);
    }
    const url = `https://api.telegram.org/bot${cleanToken}/answerCallbackQuery`;
    const body = { callback_query_id: callbackQueryId };
    if (text) {
        body.text = text;
    }
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        console.error(`[Telegram answerCallbackQuery Error] status: ${response.status}, body: ${errBody}`);
    }
    return response.ok;
}

// Helper: extract page metadata for Telegram URL scraping
async function scrapeTelegramUrl(urlStr) {
    try {
        const response = await fetch(urlStr, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'ms-MY,ms;q=0.9,en-MY;q=0.8,en;q=0.7',
                'Referer': new URL(urlStr).origin + '/'
            }
        });
        if (!response.ok) return { title: '', description: '' };
        const html = await response.text();

        // Extract title
        let title = '';
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) title = titleMatch[1].trim();

        // Extract meta description
        let description = '';
        const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i) ||
                            html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i);
        if (descMatch) description = descMatch[1].trim();

        // Decode HTML entities
        const decode = (s) => s.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec)).replace(/&quot;/g, '"').replace(/&amp;/g, '&');

        return {
            title: decode(cleanScrapedTitle(title)),
            description: decode(description)
        };
    } catch (_) {
        return { title: '', description: '' };
    }
}

// ── Telegram Webhook Core Handler (Runs asynchronously in ctx.waitUntil) ──
async function handleTelegramUpdate(update, env, encryptionSecret, jwtSecret) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error("TELEGRAM_BOT_TOKEN binding missing");
        return;
    }

    try {
        // ── 1. Handle Inline Button Clicks (Callback Query) ──
        if (update.callback_query) {
            const cq = update.callback_query;
            const chatId = cq.message.chat.id;
            const messageId = cq.message.message_id;
            const queryData = cq.data;
            const callbackQueryId = cq.id;

            // Lookup connected user
            const connection = await env.DB.prepare(
                `SELECT user_id FROM user_telegram_connections WHERE telegram_chat_id = ?`
            ).bind(cq.from.id).first();

            if (!connection) {
                await answerCallbackQuery(token, callbackQueryId, "Akaun anda belum disambungkan. Sila sambung di Dashboard.");
                return;
            }

            const userId = connection.user_id;

            if (queryData.startsWith("publish_draft:")) {
                const draftId = parseInt(queryData.split(":")[1], 10);
                await answerCallbackQuery(token, callbackQueryId, "Sedang menerbitkan...");
                await editTelegramMessage(token, chatId, messageId, "⏳ Sedang menerbitkan post anda ke Threads...");
                
                try {
                    await executeImmediatePublish(env.DB, draftId, userId, encryptionSecret);
                    await editTelegramMessage(token, chatId, messageId, "🎉 <b>Berjaya diterbitkan!</b>\nPost anda telah dipos secara langsung ke Threads.");
                } catch (publishErr) {
                    await editTelegramMessage(token, chatId, messageId, `❌ <b>Gagal menerbitkan:</b>\n${publishErr.message}`);
                }
            }
            
            else if (queryData.startsWith("schedule_draft:")) {
                const draftId = parseInt(queryData.split(":")[1], 10);
                await answerCallbackQuery(token, callbackQueryId, "Sedang menjadualkan...");

                try {
                    // Set default schedule time: Tomorrow 9:00 PM Malaysia time (13:00 UTC)
                    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
                    tomorrow.setUTCHours(13, 0, 0, 0);
                    const publishTimeStr = tomorrow.toISOString();

                    await env.DB.prepare(
                        `UPDATE scheduled_posts 
                         SET status = 'scheduled', publish_at = ?, timezone = 'Asia/Kuala_Lumpur', updated_at = (datetime('now')) 
                         WHERE id = ? AND user_id = ?`
                    ).bind(publishTimeStr, draftId, userId).run();

                    const readableTime = tomorrow.toLocaleString('ms-MY', { timeZone: 'Asia/Kuala_Lumpur' });
                    await editTelegramMessage(token, chatId, messageId, `📅 <b>Berjaya dijadualkan!</b>\nPost akan diterbitkan pada <b>${readableTime} (MYT)</b>.`);
                } catch (schedErr) {
                    await editTelegramMessage(token, chatId, messageId, `❌ <b>Gagal menjadualkan:</b>\n${schedErr.message}`);
                }
            }
            
            else if (queryData.startsWith("cancel_draft:")) {
                const draftId = parseInt(queryData.split(":")[1], 10);
                await answerCallbackQuery(token, callbackQueryId, "Aksi dibatalkan.");
                
                try {
                    await env.DB.prepare(
                        `UPDATE scheduled_posts SET status = 'cancelled', updated_at = (datetime('now')) WHERE id = ? AND user_id = ?`
                    ).bind(draftId, userId).run();
                    await editTelegramMessage(token, chatId, messageId, "❌ <b>Aksi dibatalkan.</b>\nDraf post ini telah dibatalkan.");
                } catch (_) {
                    await editTelegramMessage(token, chatId, messageId, "❌ Aksi dibatalkan.");
                }
            }
            return;
        }

        // ── 2. Handle Normal Messages ──
        if (update.message && update.message.text) {
            const msg = update.message;
            const chatId = msg.chat.id;
            const text = msg.text.trim();

            // Command: /start <link_code>
            if (text.startsWith("/start ") || text.startsWith("/connect ")) {
                const code = text.split(" ")[1];
                if (!code) {
                    await sendTelegramMessage(token, chatId, "Sila berikan kod penyambungan. Contoh: <code>/start 123456</code>");
                    return;
                }

                const linkReq = await env.DB.prepare(
                    `SELECT user_id FROM telegram_link_codes WHERE code = ? AND expires_at > datetime('now')`
                ).bind(code).first();

                if (!linkReq) {
                    await sendTelegramMessage(token, chatId, "❌ <b>Kod tidak sah atau tamat tempoh.</b>\nSila dapatkan kod baru di Settings -> Telegram di SocialHub.");
                    return;
                }

                const userId = linkReq.user_id;

                // Create connection
                await env.DB.prepare(
                    `INSERT OR REPLACE INTO user_telegram_connections (user_id, telegram_chat_id) VALUES (?, ?)`
                ).bind(userId, chatId).run();

                // Delete code
                await env.DB.prepare(`DELETE FROM telegram_link_codes WHERE code = ?`).bind(code).run();

                // Get user email
                const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first();

                await sendTelegramMessage(token, chatId, `🎉 <b>Sambungan Berjaya!</b>\nAkaun SocialHub anda (<b>${user?.email}</b>) telah berjaya dihubungkan ke bot ini.\n\nKini anda boleh terus hantar pautan listing (mudah.my, propertyguru, dll) atau taip draf prompt terus di sini! 🚀`);
                return;
            }

            // Command: /disconnect
            if (text === "/disconnect") {
                await env.DB.prepare(`DELETE FROM user_telegram_connections WHERE telegram_chat_id = ?`).bind(chatId).run();
                await sendTelegramMessage(token, chatId, "🔌 <b>Akaun diputuskan.</b>\nSambungan anda dengan SocialHub bot telah dibuang.");
                return;
            }

            // Check if user is linked
            const connection = await env.DB.prepare(
                `SELECT user_id FROM user_telegram_connections WHERE telegram_chat_id = ?`
            ).bind(chatId).first();

            if (!connection) {
                await sendTelegramMessage(token, chatId, "👋 <b>Helo! Akaun anda belum disambungkan.</b>\nSila pergi ke web Dashboard SocialHub -> <b>Settings</b>, dapatkan kod penyambungan Telegram, dan hantarkan ia ke bot ini.\n\nContoh: <code>/start 123456</code>");
                return;
            }

            const userId = connection.user_id;

            // Retrieve active workspace for this user
            const workspaceMember = await env.DB.prepare(
                `SELECT workspace_id, role FROM workspace_members WHERE user_id = ? LIMIT 1`
            ).bind(userId).first();

            if (!workspaceMember) {
                await sendTelegramMessage(token, chatId, "❌ Ralat: Tiada workspace aktif dijumpai untuk akaun anda.");
                return;
            }

            const workspace = await env.DB.prepare(
                `SELECT id, name, subscription_plan, subscription_status FROM workspaces WHERE id = ?`
            ).bind(workspaceMember.workspace_id).first();

            const activeWorkspace = {
                workspace_id: workspace.id,
                name: workspace.name,
                subscription_plan: workspace.subscription_plan,
                subscription_status: workspace.subscription_status,
                role: workspaceMember.role
            };

            // Detect URL (Web Scraper workflow)
            const urlRegex = /(https?:\/\/[^\s]+)/gi;
            const urlMatch = text.match(urlRegex);

            if (urlMatch) {
                const targetUrl = urlMatch[0];
                const userInstructions = text.replace(targetUrl, '').trim();
                await sendTelegramMessage(token, chatId, "🔍 <b>Meneliti listing hartanah anda...</b>\nSedang mengikis data dan menjana copywriting Threads...");

                try {
                    // Scrape listing content
                    const scraped = await scrapeTelegramUrl(targetUrl);
                    
                    // Fetch social accounts connected to workspace
                    const accounts = await env.DB.prepare(
                        `SELECT id, platform FROM social_accounts WHERE workspace_id = ? AND platform = 'threads' LIMIT 1`
                    ).bind(activeWorkspace.workspace_id).first();

                    if (!accounts) {
                        await sendTelegramMessage(token, chatId, "❌ Ralat: Tiada akaun Threads yang dihubungkan ke workspace ini. Sila sambung di Dashboard terlebih dahulu.");
                        return;
                    }

                    // Retrieve workspace preferences
                    const wsAI = await env.DB.prepare(
                        "SELECT ai_model, ai_api_key_enc, custom_ai_instructions FROM workspaces WHERE id = ?"
                    ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                    const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                    // Compile prompts
                    const provider = AIFactory.getProvider(aiEnv);
                    const isProperty = scraped.title.toLowerCase().includes("property") || scraped.description.toLowerCase().includes("apartment") || scraped.description.toLowerCase().includes("semi d") || scraped.description.toLowerCase().includes("teres") || scraped.description.toLowerCase().includes("house") || scraped.description.toLowerCase().includes("hartanah");

                    const nicheInstructions = isProperty 
                        ? '["You MUST include the property price (e.g. RM 325,000 or RM 325k) in the copywriting.","NEVER include any phone numbers, agent names, or agency names."]'
                        : '[]';

                    const promptOptions = {
                        businessType: isProperty ? 'Ejen Hartanah & Properti' : 'Pemasaran Kandungan',
                        product: `Title: ${scraped.title}\nDescription: ${scraped.description}\nUrl: ${targetUrl}`,
                        targetAudience: 'Malaysian Threads users',
                        goal: 'Engagement & Lead generation',
                        tone: 'Casual Malaysian Malay (Bahasa Rojak)',
                        language: 'Malay',
                        customInstructions: [
                            getFactPreservingInstructions(aiEnv.custom_ai_instructions),
                            `CRITICAL NICHE RULES:\n${JSON.parse(nicheInstructions).map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
                            userInstructions ? `USER SPECIFIC GUIDELINES:\n${userInstructions}` : ''
                        ].filter(Boolean).join('\n\n')
                    };

                    const aiRes = await provider.generateCaption(promptOptions);
                    const fullCaption = `${aiRes.caption}\n\nHubungi untuk info lanjut! ➡️ ${targetUrl}\n\n${(aiRes.hashtags || []).join(' ')}`.trim();

                    // Insert as DRAFT into scheduled_posts
                    const result = await env.DB.prepare(
                        `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, media_urls, status, publish_at, timezone) 
                         VALUES (?, ?, ?, 'threads', ?, '[]', 'draft', (datetime('now')), 'UTC')`
                    ).bind(userId, activeWorkspace.workspace_id, accounts.id, fullCaption).run();

                    const draftId = result.meta.last_row_id;

                    // Send Telegram preview with actions
                    const messageText = `📝 <b>Draft Cadangan Penerbitan:</b>\n\n${fullCaption}`;
                    const replyMarkup = {
                        inline_keyboard: [
                            [
                                { text: "📅 Jadual Besok 9 malam", callback_data: `schedule_draft:${draftId}` },
                                { text: "⚡ Terbit Sekarang", callback_data: `publish_draft:${draftId}` }
                            ],
                            [
                                { text: "❌ Batalkan", callback_data: `cancel_draft:${draftId}` }
                            ]
                        ]
                    };

                    await sendTelegramMessage(token, chatId, messageText, replyMarkup);
                } catch (scrapeErr) {
                    await sendTelegramMessage(token, chatId, `❌ Gagal memproses listing: ${scrapeErr.message}`);
                }
                return;
            }

            // Normal text (Chat Assistant workflow)
            await sendTelegramMessage(token, chatId, "🤖 <i>Sedang berfikir...</i>");

            try {
                // Save user message to database
                await env.DB.prepare(
                    `INSERT INTO agent_chat_history (workspace_id, user_id, sender, message) VALUES (?, ?, 'user', ?)`
                ).bind(activeWorkspace.workspace_id, userId, text).run();

                // Retrieve history
                const dbHistory = await env.DB.prepare(
                    `SELECT sender, message FROM agent_chat_history WHERE workspace_id = ? ORDER BY id DESC LIMIT 10`
                ).bind(activeWorkspace.workspace_id).all();
                const conversationHistory = (dbHistory.results || []).reverse();

                // Retrieve workspace AI model & key
                const wsAI = await env.DB.prepare("SELECT ai_model, ai_api_key_enc FROM workspaces WHERE id = ?").bind(activeWorkspace.workspace_id).first().catch(() => null);

                const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                // AI instructions
                const systemInstructions = `You are 'SocialHub AI Agent', a helpful, professional, and friendly social media marketing assistant for this workspace. 
You are responding via Telegram. Keep your answers clear, conversational, and concise (under 2 paragraphs if possible). 

CRITICAL LANGUAGE / SPEECH RULES:
1. When communicating in Malay, write in a very natural, friendly Malaysian conversational style (Bahasa Rojak / colloquial speech). E.g. use "je", "lah", "tau", "ni", "nak", "korang", "weyy". 
2. Do NOT use formal, Google-translate-style Malay. Do NOT sound robotic.`;

                const messages = [{ role: 'system', content: systemInstructions }];
                
                // Append context
                const histToAppend = conversationHistory.slice(0, -1);
                histToAppend.forEach(h => {
                    messages.push({
                        role: h.sender === 'user' ? 'user' : 'assistant',
                        content: h.message
                    });
                });

                messages.push({ role: 'user', content: text });

                const provider = AIFactory.getProvider(aiEnv);
                const responseText = await provider.generateChatResponse(messages);

                // Save agent message to database
                await env.DB.prepare(
                    `INSERT INTO agent_chat_history (workspace_id, user_id, sender, message) VALUES (?, ?, 'agent', ?)`
                ).bind(activeWorkspace.workspace_id, userId, responseText.trim()).run();

                // Reply to user on Telegram
                await sendTelegramMessage(token, chatId, responseText.trim());
            } catch (chatErr) {
                await sendTelegramMessage(token, chatId, `❌ Gagal memproses maklum balas AI: ${chatErr.message}`);
            }
        }
    } catch (telegramErr) {
        console.error("Telegram Webhook Processor failed:", telegramErr);
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const jwtSecret = env.JWT_SECRET || "socialhub-dev-super-secret-key-12345!@#";
        const encryptionSecret = env.ENCRYPTION_KEY || jwtSecret;

        // CORS configs
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Type': 'application/json'
        };

        const getBillingCycleStart = (createdAtString) => {
            if (!createdAtString) {
                const d = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                const pad = (num) => String(num).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;
            }
            
            const cleanedString = createdAtString.includes('T') ? createdAtString : createdAtString.replace(' ', 'T');
            const createdDate = new Date(cleanedString);
            const anniversaryDay = createdDate.getDate();
            
            const now = new Date();
            const getMaxDays = (year, month) => new Date(year, month + 1, 0).getDate();
            
            let targetYear = now.getFullYear();
            let targetMonth = now.getMonth();
            
            let day = Math.min(anniversaryDay, getMaxDays(targetYear, targetMonth));
            let cycleStart = new Date(targetYear, targetMonth, day);
            
            if (cycleStart > now) {
                targetMonth -= 1;
                if (targetMonth < 0) {
                    targetMonth = 11;
                    targetYear -= 1;
                }
                day = Math.min(anniversaryDay, getMaxDays(targetYear, targetMonth));
                cycleStart = new Date(targetYear, targetMonth, day);
            }
            
            const pad = (num) => String(num).padStart(2, '0');
            return `${cycleStart.getFullYear()}-${pad(cycleStart.getMonth() + 1)}-${pad(cycleStart.getDate())} 00:00:00`;
        };

        // Ensure active_workspace_id column exists in users table (idempotent entrypoint auto-migration)
        if (env.DB) {
            try {
                await env.DB.prepare("ALTER TABLE users ADD COLUMN active_workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL").run();
            } catch (_) { /* column already exists */ }
            // Ensure new insights columns exist in scheduled_posts
            try { await env.DB.prepare("ALTER TABLE scheduled_posts ADD COLUMN quotes_count INTEGER DEFAULT 0").run(); } catch (_) {}
            try { await env.DB.prepare("ALTER TABLE scheduled_posts ADD COLUMN reach_count INTEGER DEFAULT 0").run(); } catch (_) {}
            try { await env.DB.prepare("ALTER TABLE scheduled_posts ADD COLUMN shares_count INTEGER DEFAULT 0").run(); } catch (_) {}
            // Ensure workspace_analytics table exists for follower growth tracking
            try {
                await env.DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_analytics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id INTEGER NOT NULL,
                    account_id INTEGER,
                    platform TEXT DEFAULT 'threads',
                    followers_count INTEGER DEFAULT 0,
                    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`).run();
            } catch (_) {}

            // Ensure system_niche_rules table exists and seed initial default values
            try {
                await env.DB.prepare(`CREATE TABLE IF NOT EXISTS system_niche_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    niche_key TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    detection_keywords TEXT NOT NULL,
                    rules TEXT NOT NULL,
                    example_output TEXT DEFAULT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                )`).run();

                const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM system_niche_rules").first();
                if (countRes && countRes.count === 0) {
                    await env.DB.prepare(`
                        INSERT INTO system_niche_rules (niche_key, name, detection_keywords, rules) VALUES
                        ('hartanah', 'Ejen Hartanah & Properti', 'rumah,apartment,condo,tanah,teres,semi-d,saujana,hartanah,listing,sale,rent,kondo,bilik,sewa,jual,flat,bungalow,banglo,saujana putra,wangsa melawati,wangsa ceria,dengkil', '["You MUST include the property price (e.g. RM 325,000 or RM 325k) in the copywriting to attract buyers.","Focus on the actual property details (type, location, size/sqft, features, facilities) from the product info.","NEVER include any phone numbers (e.g. 017-xxx xxxx), agent names, PEA/REN numbers, or agency names (e.g. IQI Realty) in the caption or CTA. The only contact method is via the link provided separately.","For real estate/properties, include specific hashtags based on transaction type (e.g. #jualbelirumah #jualrumah #rumahsewa #rumahuntukdijual)."]'),
                        ('affiliate', 'Affiliate Shopee/TikTok/Lazada', 'shopee,lazada,tiktok shop,beli di,beg kuning,racun shopee,racun tiktok,murah gila,diskaun,voucher,promo,gadget,barang dapur', '["DO NOT include the price (e.g. RMxx) in the copywriting. Keep the price secret to make the audience curious so they click the link.","Write in a highly engaging, casual, and conversational style (Manglish / Bahasa Rojak) to recommend the product naturally.","Use conversational hooks that capture attention instantly (e.g. ''Korang yang selalu workout tu wajib tengok ni...'', ''Giler ah, tak sangka ada item ni...'').","Focus on benefits and pain points solved by the product."]'),
                        ('automotif', 'Ejen Jual Kereta / Motor', 'kereta,car,perodua,proton,honda,toyota,bulanan,loan,trade-in,deposit,full loan,myvi,bezza,saga,alza,x50', '["Focus on low monthly installments (bayaran bulanan), rebates, or free gifts.","Highlight easy loan approvals, full loan availability, or fast trade-in deals.","Use a professional yet friendly and accessible tone.","Encourage users to check their loan eligibility as the main hook/CTA."]')
                    `).run();
                }
            } catch (_) {}

            // Ensure workspace_api_keys table exists for Hermes/agent integration
            try {
                await env.DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_api_keys (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    key_hash TEXT NOT NULL UNIQUE,
                    key_prefix TEXT NOT NULL,
                    name TEXT DEFAULT 'Default Key',
                    created_at TEXT DEFAULT (datetime('now')),
                    last_used_at TEXT
                )`).run();
            } catch (_) {}

            // Ensure agent_chat_history table exists for in-app chat agent
            try {
                await env.DB.prepare(`CREATE TABLE IF NOT EXISTS agent_chat_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    sender TEXT CHECK(sender IN ('user', 'agent')) NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`).run();
            } catch (_) {}

            // Ensure user_telegram_connections table exists for linking Telegram bot
            try {
                await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_telegram_connections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    telegram_chat_id INTEGER NOT NULL UNIQUE,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`).run();
            } catch (_) {}

            // Ensure telegram_link_codes table exists for temporary OTP codes
            try {
                await env.DB.prepare(`CREATE TABLE IF NOT EXISTS telegram_link_codes (
                    code TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL
                )`).run();
            } catch (_) {}

            // Ensure short_links table exists for link shortener & cloaking
            try {
                await env.DB.prepare(`CREATE TABLE IF NOT EXISTS short_links (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    code TEXT NOT NULL UNIQUE,
                    target_url TEXT NOT NULL,
                    title TEXT,
                    description TEXT,
                    clicks_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )`).run();
            } catch (_) {}
        if (url.pathname.startsWith('/l/')) {
            const code = url.pathname.substring(3).trim();
            if (!code) {
                return new Response("Not Found", { status: 404 });
            }

            if (!env.DB) {
                return new Response("DB Binding Missing", { status: 500 });
            }

            const link = await env.DB.prepare("SELECT * FROM short_links WHERE code = ?").bind(code).first().catch(() => null);
            if (!link) {
                return new Response("Link Not Found", { status: 404 });
            }

            const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
            const isBot = [
                'facebookexternalhit',
                'threadsbot',
                'facebookplatform',
                'facebot',
                'twitterbot',
                'slackbot',
                'telegrambot',
                'linkedinbot',
                'discordbot',
                'googlebot',
                'bingbot',
                'bot',
                'crawler',
                'spider'
            ].some(crawler => userAgent.includes(crawler));

            if (isBot) {
                const title = link.title || "Lihat produk viral terkini";
                const desc = link.description || "Klik pautan untuk maklumat lanjut dan ulasan produk menarik.";
                const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${title}</title>
    <meta name="description" content="${desc}">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${desc}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${request.url}">
</head>
<body>
    <p>Redirecting to target...</p>
</body>
</html>`;
                return new Response(html, {
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            } else {
                ctx.waitUntil(
                    env.DB.prepare("UPDATE short_links SET clicks_count = clicks_count + 1 WHERE id = ?").bind(link.id).run().catch(() => null)
                );
                return Response.redirect(link.target_url, 302);
            }
        }
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Shared Auth helper — supports both JWT session tokens AND workspace API keys
        const getAuthUser = async () => {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

            const token = authHeader.split(' ')[1];

            // --- API Key path: prefix starts with 'sk-sh-' ---
            if (token.startsWith('sk-sh-') && env.DB) {
                const keyHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
                const keyHash = Array.from(new Uint8Array(keyHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

                const apiKey = await env.DB.prepare(
                    `SELECT k.id as key_id, k.workspace_id, k.user_id, k.name as key_name,
                            u.id, u.uuid, u.name, u.email, u.role, u.status, u.active_workspace_id
                     FROM workspace_api_keys k
                     JOIN users u ON k.user_id = u.id
                     WHERE k.key_hash = ?`
                ).bind(keyHash).first();

                if (!apiKey) return null;

                // Update last_used_at timestamp
                await env.DB.prepare("UPDATE workspace_api_keys SET last_used_at = (datetime('now')) WHERE id = ?")
                    .bind(apiKey.key_id).run();

                // Inject active_workspace_id from API key's workspace so downstream routes resolve correctly
                return { ...apiKey, active_workspace_id: apiKey.workspace_id };
            }

            // --- JWT path: existing browser session token ---
            const payload = await verifyJWT(token, jwtSecret);
            if (!payload || !payload.sub) return null;
            if (!env.DB) return { uuid: payload.sub, email: payload.email, name: payload.name, role: payload.role };

            return await env.DB.prepare("SELECT id, uuid, name, email, role, status, active_workspace_id FROM users WHERE uuid = ?")
                .bind(payload.sub)
                .first();
        };

        const extractMetaTags = (html) => {
            let title = "";
            let description = "";
            let image = "";

            try {
                // Extract <head> section to avoid parsing the massive <body>
                const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
                const headHtml = headMatch ? headMatch[1] : html.substring(0, 100000);

                // Extract meta tags from <head> using simple non-backtracking regex
                const metaTags = headHtml.match(/<meta\s+[^>]+>/gi) || [];
                
                for (const tag of metaTags) {
                    const property = (tag.match(/property=["']([^"']+)["']/i) || tag.match(/name=["']([^"']+)["']/i))?.[1];
                    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
                    
                    if (property && content) {
                        const propLower = property.toLowerCase();
                        if (propLower === 'og:title') {
                            title = content.trim();
                        } else if (propLower === 'og:description') {
                            description = content.trim().substring(0, 1500);
                        } else if (propLower === 'description' && !description) {
                            description = content.trim().substring(0, 1500);
                        } else if (propLower === 'og:image') {
                            image = content.trim();
                        }
                    }
                }
            } catch (_) {}

            return { title, description, image };
        };

        const PLANS = {
            free: { accounts: 1, posts: 10, ai_credits: 20, storage: 50 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant'] },
            starter: { accounts: 1, posts: 10, ai_credits: 20, storage: 50 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant'] }, // unused legacy
            pro: { accounts: 3, posts: 50, ai_credits: 250, storage: 500 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant'] }, // Starter (Pro) - RM29
            agency: { accounts: 10, posts: 500, ai_credits: 800, storage: 5 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics'] }, // Growth (Gold) - RM59
            enterprise: { accounts: 99999, posts: 5000, ai_credits: 2500, storage: 50 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics', 'clients'] } // Agency (Premium) - RM149
        };

        const getActiveWorkspace = async (user) => {
            if (!user) return null;

            // Ensure active_workspace_id column exists (idempotent auto-migration)
            try {
                await env.DB.prepare("ALTER TABLE users ADD COLUMN active_workspace_id INTEGER REFERENCES workspaces(id) ON DELETE SET NULL").run();
            } catch (_) { /* column already exists */ }
            try {
                await env.DB.prepare("ALTER TABLE workspaces ADD COLUMN whatsapp_number TEXT DEFAULT NULL").run();
            } catch (_) { /* column already exists */ }

            // If user has active workspace selected, verify and return it
            if (user.active_workspace_id) {
                const ws = await env.DB.prepare(
                    `SELECT m.role, w.id as workspace_id, w.uuid, w.name, w.slug, w.subscription_plan, w.subscription_status, w.whatsapp_number, w.created_at as created_at
                     FROM workspace_members m
                     JOIN workspaces w ON m.workspace_id = w.id
                     WHERE m.user_id = ? AND w.id = ?`
                ).bind(user.id, user.active_workspace_id).first();
                if (ws) return ws;
            }

            // Fallback to first available workspace
            const fallbackWs = await env.DB.prepare(
                `SELECT m.role, w.id as workspace_id, w.uuid, w.name, w.slug, w.subscription_plan, w.subscription_status, w.whatsapp_number, w.created_at as created_at
                 FROM workspace_members m
                 JOIN workspaces w ON m.workspace_id = w.id
                 WHERE m.user_id = ?
                 ORDER BY w.id ASC`
            ).bind(user.id).first();

            if (fallbackWs) {
                try {
                    await env.DB.prepare("UPDATE users SET active_workspace_id = ? WHERE id = ?")
                        .bind(fallbackWs.workspace_id, user.id)
                        .run();
                    user.active_workspace_id = fallbackWs.workspace_id;
                } catch (_) {}
            }

            return fallbackWs;
        };

        const logActivity = async (workspaceId, userId, action, details) => {
            await env.DB.prepare(
                `INSERT INTO audit_logs (workspace_id, user_id, action, details)
                 VALUES (?, ?, ?, ?)`
            ).bind(workspaceId || null, userId || null, action, details || null).run();
        };

        try {
            switch (url.pathname) {
                // ==================== SAAS MULTI-TENANT REST API ====================



                // ── AI Settings: GET/POST model preference & API key per workspace ──
                case '/api/ai/settings': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    // Ensure ai_model column exists (idempotent migration)
                    try {
                        await env.DB.prepare("ALTER TABLE workspaces ADD COLUMN ai_model TEXT DEFAULT 'meta-llama/llama-3.2-3b-instruct:free'").run();
                    } catch (_) { /* column already exists */ }
                    try {
                        await env.DB.prepare("ALTER TABLE workspaces ADD COLUMN ai_api_key_enc TEXT").run();
                    } catch (_) { /* column already exists */ }
                    try {
                        await env.DB.prepare("ALTER TABLE workspaces ADD COLUMN custom_ai_instructions TEXT").run();
                    } catch (_) { /* column already exists */ }

                    // GET: return current settings + usage
                    if (request.method === 'GET') {
                        const ws = await env.DB.prepare(
                            "SELECT ai_model, ai_api_key_enc, custom_ai_instructions, copywriting_persona FROM workspaces WHERE id = ?"
                        ).bind(activeWorkspace.workspace_id).first();

                        const plan = activeWorkspace.subscription_plan;
                        const maxCredits = PLANS[plan]?.ai_credits ?? 0;
                        const startOfMonth = getBillingCycleStart(activeWorkspace.created_at);
                        const creditsRes = await env.DB.prepare(
                            "SELECT COUNT(*) as count FROM audit_logs WHERE workspace_id = ? AND action = 'ai_generate' AND created_at >= ?"
                        ).bind(activeWorkspace.workspace_id, startOfMonth).first();

                        return new Response(JSON.stringify({
                            success: true,
                            model: ws?.ai_model || env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-3b-instruct:free',
                            has_api_key: !!(ws?.ai_api_key_enc),
                            custom_ai_instructions: ws?.custom_ai_instructions || '',
                            copywriting_persona: ws?.copywriting_persona || 'general',
                            credits_used: creditsRes?.count || 0,
                            credits_max: maxCredits,
                            subscription_plan: activeWorkspace?.subscription_plan || 'free'
                        }), { status: 200, headers: corsHeaders });
                    }

                    // POST: save model and/or API key
                    if (request.method === 'POST') {
                        if (activeWorkspace.role === 'viewer') {
                            return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot change settings.' }), { status: 403, headers: corsHeaders });
                        }
                        const { model, api_key, custom_ai_instructions, copywriting_persona } = await request.json();
                        if (!model) return new Response(JSON.stringify({ message: 'Model is required.' }), { status: 400, headers: corsHeaders });

                        let encKey = null;
                        if (api_key && api_key.trim() !== '') {
                            // Encrypt using built-in encrypt function
                            try {
                                encKey = await encryptToken(api_key.trim(), encryptionSecret);
                            } catch (e) {
                                encKey = api_key.trim(); // fallback plain if no encrypt func
                            }
                        }

                        if (encKey) {
                            await env.DB.prepare(
                                "UPDATE workspaces SET ai_model = ?, ai_api_key_enc = ?, custom_ai_instructions = ?, copywriting_persona = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(model, encKey, custom_ai_instructions || null, copywriting_persona || 'general', activeWorkspace.workspace_id).run();
                        } else {
                            await env.DB.prepare(
                                "UPDATE workspaces SET ai_model = ?, custom_ai_instructions = ?, copywriting_persona = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(model, custom_ai_instructions || null, copywriting_persona || 'general', activeWorkspace.workspace_id).run();
                        }

                        await logActivity(activeWorkspace.workspace_id, user.id, 'update_ai_settings', `AI model changed to: ${model}`);

                        return new Response(JSON.stringify({ success: true, message: 'AI settings saved.' }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/ai/image': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });
                    if (!env.AI) return new Response(JSON.stringify({ message: 'AI service missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                    if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot generate media.' }), { status: 403, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    try {
                        const { prompt } = await request.json();
                        if (!prompt) return new Response(JSON.stringify({ message: 'Prompt is required.' }), { status: 400, headers: corsHeaders });

                        const imageResponse = await env.AI.run('@cf/lykon/dreamshaper-8-lcm', {
                            prompt: prompt,
                            num_steps: 20
                        });

                        const arrayBuffer = await new Response(imageResponse).arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        for (let i = 0; i < bytes.length; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        const base64Str = btoa(binary);
                        const dataUrl = `data:image/jpeg;base64,${base64Str}`;
                        const fileSize = arrayBuffer.byteLength;

                        const plan = activeWorkspace.subscription_plan;
                        const limits = PLANS[plan];
                        const sizeRes = await env.DB.prepare("SELECT SUM(file_size) as total FROM media WHERE workspace_id = ?").bind(activeWorkspace.workspace_id).first();
                        const currentTotal = sizeRes ? (sizeRes.total || 0) : 0;
                        if ((currentTotal + fileSize) > limits.storage) {
                            return new Response(JSON.stringify({ message: "Subscription limit reached: Storage capacity exceeded." }), { status: 403, headers: corsHeaders });
                        }

                        const filename = `ai_generated_${Date.now()}.jpg`;

                        const result = await env.DB.prepare(
                            `INSERT INTO media (user_id, workspace_id, filename, original_name, mime_type, file_size, width, height, storage_provider, storage_key, thumbnail) 
                             VALUES (?, ?, ?, ?, 'image/jpeg', ?, 1024, 1024, 'local', ?, ?)`
                        ).bind(user.id, activeWorkspace.workspace_id, filename, filename, fileSize, dataUrl, dataUrl).run();

                        const newMediaId = result.meta.last_row_id;
                        const mediaRecord = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(newMediaId).first();

                        await logActivity(activeWorkspace.workspace_id, user.id, 'ai_image_generate', `Generated AI image: ${prompt.substring(0, 30)}...`);

                        return new Response(JSON.stringify({ success: true, media: mediaRecord }), { status: 201, headers: corsHeaders });
                    } catch (e) {
                        return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                    }
                }

                case '/api/ai/generate': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot generate content.' }), { status: 403, headers: corsHeaders });

                    // Read workspace AI preferences from DB (model & optional custom API key)
                    const wsAI = await env.DB.prepare(
                        "SELECT ai_model, ai_api_key_enc FROM workspaces WHERE id = ?"
                    ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                    const plan = activeWorkspace.subscription_plan;
                    const maxCredits = PLANS[plan].ai_credits;

                    // Bypass monthly limits check if a workspace-specific API key is set, or if we are in local development
                    const hasCustomKey = !!(wsAI?.ai_api_key_enc);
                    const isDev = env.ENVIRONMENT === 'development';
                    let currentCreditsUsed = 0;

                    if (!hasCustomKey && !isDev) {
                        const startOfMonth = getBillingCycleStart(activeWorkspace.created_at);
                        const creditsRes = await env.DB.prepare(
                            "SELECT COUNT(*) as count FROM audit_logs WHERE workspace_id = ? AND action = 'ai_generate' AND created_at >= ?"
                        ).bind(activeWorkspace.workspace_id, startOfMonth).first();

                        currentCreditsUsed = creditsRes ? (creditsRes.count || 0) : 0;
                        if (currentCreditsUsed >= maxCredits) {
                            return new Response(JSON.stringify({ message: `AI credit limit reached: Your ${plan} plan allows up to ${maxCredits} AI generations per month. Please add your own API key in Settings to bypass this limit or upgrade your subscription.` }), { status: 403, headers: corsHeaders });
                        }
                    }

                    try {
                        let { businessType, product, targetAudience, goal, tone, language, presetType, customNote, localTimeContext, postFormat, funnelStage } = await request.json();

                        let timeGuide = "";
                        if (localTimeContext) {
                            timeGuide = `\n[CRITICAL TIME-AWARENESS CONTEXT: The user's current local day and time is: ${localTimeContext}. Use this to make the post highly context-aware. If it is Friday (Jumaat), greet with "Salam Jumaat" or talk about Jumaat blessings/reminders. If it is evening or night (e.g. 7:00 PM - 11:00 PM), greet with Salam Maghrib/Isyak or Salam Malam, or mention evening zikir/reflections. If it is late night or early morning (e.g. 2:00 AM - 5:00 AM), talk about Tahajjud, Qiyamullail, or early morning zikir. If it is morning (e.g. 6:00 AM - 11:00 AM), say good morning or greet with morning energy. Do NOT state the time explicitly (e.g. do NOT say "pada jam 7.30 malam..."), but write content relevant to that time naturally.]\n`;
                        }

                        if (presetType && presetType !== 'default') {
                            language = 'Malay';
                            tone = 'Ultra-Realistic Malay';
                            targetAudience = 'Malaysian Threads users';
                            goal = 'Engagement / Conversation';

                            if (presetType === 'morning_greeting') {
                                businessType = 'Casual Greeting';
                                product = `Generate a very casual and short Malaysian morning greeting (e.g. "Assalamualaikum, selamat pagi. Dah bangun ke tu? Dah bersedia untuk Subuh/Tahajud?"). Keep it under 150 characters, mix English/Malay naturally (Bahasa Rojak). Do NOT use AI-like generic greetings. No emojis in the first line. ${customNote ? 'Additional topic/note: ' + customNote : ''}` + timeGuide;
                            } else if (presetType === 'selawat') {
                                businessType = 'Religious Remembrance';
                                product = `Write a short, heart-touching Islamic reminder, selawat, or zikir for Malaysian Muslims on Threads. E.g. "Salam Jumaat korang. Banyakkan selawat hari ni...". Keep it gentle, simple, and under 200 characters. ${customNote ? 'Additional topic/note: ' + customNote : ''}` + timeGuide;
                            } else if (presetType === 'islamic_quote') {
                                businessType = 'Islamic Quote';
                                product = `Write an inspiring, gentle, and peaceful Islamic quote or motivational reminder for Malaysian Muslims. Keep it authentic, simple, and under 200 characters. ${customNote ? 'Additional topic/note: ' + customNote : ''}` + timeGuide;
                            } else if (presetType === 'engagement') {
                                businessType = 'Conversation Starter';
                                product = `Write a casual, funny, or thought-provoking random check-in question to spark replies and conversations on Threads. E.g. "Pagi-pagi ni korang sarapan apa?", "Korang team mandi pagi ke mandi sebelum tidur?". Keep it short and under 150 characters. ${customNote ? 'Additional topic/note: ' + customNote : ''}` + timeGuide;
                            } else if (presetType === 'motivasi') {
                                businessType = 'Inspirational Quote';
                                product = `Write a short, powerful morning motivational quote or positive energy statement in Malaysian Malay. Keep it under 150 characters. ${customNote ? 'Additional topic/note: ' + customNote : ''}` + timeGuide;
                            }
                        } else {
                            if (!businessType || !product) {
                                return new Response(JSON.stringify({ message: 'Business type and product/service are required.' }), { status: 400, headers: corsHeaders });
                            }
                            if (timeGuide) {
                                product += timeGuide;
                            }
                        }

                        // Build env-like object overriding with workspace preferences
                        const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                        const provider = AIFactory.getProvider(aiEnv);
                        const performanceFeedback = await getPerformanceFeedback(env.DB, activeWorkspace.workspace_id);
                        const nicheData = await getNicheInstructions(env.DB, product);
                        
                        let result;
                        let modelUsed = aiEnv.OPENROUTER_MODEL || "unknown";
                        try {
                            result = await provider.generateCaption({
                                businessType,
                                product: product + performanceFeedback,
                                targetAudience: targetAudience || 'General public',
                                goal: goal || 'Brand awareness',
                                tone: tone || 'Professional',
                                language: language || 'Bahasa Melayu',
                                postFormat: postFormat || 'single',
                                funnelStage: funnelStage || 'none',
                                customInstructions: getFactPreservingInstructions(aiEnv.custom_ai_instructions),
                                nicheRules: nicheData ? nicheData.rules : null,
                                nicheExampleOutput: nicheData ? nicheData.example_output : null
                            });
                        } catch (e) {
                            console.error("AI Generation failed, falling back to robust system models:", e);
                            const systemPrompt = provider.assembleCaptionPrompt({
                                businessType,
                                product: product + performanceFeedback,
                                targetAudience: targetAudience || 'General public',
                                goal: goal || 'Brand awareness',
                                tone: tone || 'Professional',
                                language: language || 'Bahasa Melayu',
                                postFormat: postFormat || 'single',
                                funnelStage: funnelStage || 'none',
                                customInstructions: getFactPreservingInstructions(aiEnv.custom_ai_instructions),
                                nicheRules: nicheData ? nicheData.rules : null,
                                nicheExampleOutput: nicheData ? nicheData.example_output : null
                            });

                            const fallback = await runFallbackAI(systemPrompt, env);
                            if (fallback) {
                                let jsonStr = fallback.text;
                                if (jsonStr.startsWith("```json")) {
                                    jsonStr = jsonStr.substring(7);
                                } else if (jsonStr.startsWith("```")) {
                                    jsonStr = jsonStr.substring(3);
                                }
                                if (jsonStr.endsWith("```")) {
                                    jsonStr = jsonStr.substring(0, jsonStr.length - 3);
                                }
                                try {
                                    result = JSON.parse(jsonStr.trim());
                                    if (result && Array.isArray(result.caption)) {
                                        result.caption = result.caption.join('---thread-separator---');
                                    }
                                } catch (err) {
                                    result = {
                                        caption: fallback.text,
                                        cta: "",
                                        hashtags: []
                                    };
                                }
                                modelUsed = `${aiEnv.OPENROUTER_MODEL} (failed, fell back to ${fallback.model})`;
                            } else {
                                throw e;
                            }
                        }

                        await logActivity(activeWorkspace.workspace_id, user.id, 'ai_generate', `Generated caption for business "${businessType}": ${(product || '').substring(0, 30)}... model: ${modelUsed}`);

                        return new Response(JSON.stringify({
                            success: true,
                            result,
                            model_used: modelUsed,
                            credits_remaining: maxCredits - currentCreditsUsed - 1
                        }), { status: 200, headers: corsHeaders });
                    } catch (e) {
                        return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                    }
                }

                case '/api/ai/scrape-url': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    try {
                        const { url } = await request.json();
                        if (!url) {
                            return new Response(JSON.stringify({ message: 'URL is required.' }), { status: 400, headers: corsHeaders });
                        }

                        console.log(`[Scraper] Scraping URL: ${url}`);

                        // Helper: extract keywords from URL slug as fallback
                        const extractSlugKeywords = (rawUrl) => {
                            try {
                                const u = new URL(rawUrl);
                                // Combine pathname + search for richer context
                                const slug = (u.pathname + ' ' + u.search)
                                    .replace(/[-_/]/g, ' ')
                                    .replace(/\.htm.*$/i, '')
                                    .replace(/\d{5,}/g, '') // remove long IDs
                                    .replace(/[^a-zA-Z ]/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                                // Clean up common noise words and capitalise
                                const words = slug.split(' ').filter(w => w.length > 2 && !['www','com','my','html','for','sale','buy','the','and','with'].includes(w.toLowerCase()));
                                return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            } catch (_) { return ''; }
                        };

                        // Helper: decode HTML entities
                        const decodeHtmlEntities = (str) => {
                            if (!str) return "";
                            return str.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
                                      .replace(/&quot;/g, '"')
                                      .replace(/&amp;/g, '&')
                                      .replace(/&lt;/g, '<')
                                      .replace(/&gt;/g, '>')
                                      .replace(/&nbsp;/g, ' ');
                        };

                        let finalUrl = url;
                        let pageText = "";
                        let title = "";
                        let description = "";
                        let image = "";

                        try {
                            const response = await fetch(url, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                    'Accept-Language': 'ms-MY,ms;q=0.9,en-MY;q=0.8,en;q=0.7',
                                    'Accept-Encoding': 'gzip, deflate, br',
                                    'Cache-Control': 'no-cache',
                                    'Referer': new URL(url).origin + '/',
                                    'Sec-Fetch-Mode': 'navigate',
                                    'Sec-Fetch-Site': 'none',
                                    'Sec-Fetch-Dest': 'document',
                                    'Upgrade-Insecure-Requests': '1'
                                },
                                redirect: 'follow'
                            });

                            finalUrl = response.url || url;

                            if (response.ok) {
                                const html = await response.text();

                                 // Extract <title>
                                 const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                                 if (titleMatch) title = titleMatch[1].trim();

                                 const metas = extractMetaTags(html);
                                 if (metas.title) title = metas.title;
                                 if (metas.description) description = metas.description;
                                 if (metas.image) image = metas.image;

                                // JSON-LD extraction for richer structured data (Product / ItemPage / RealEstateListing)
                                if (!description || description.length < 50) {
                                    const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
                                    for (const match of jsonLdMatches) {
                                        try {
                                            const ld = JSON.parse(match[1]);
                                            const objs = Array.isArray(ld) ? ld : [ld];
                                            for (const obj of objs) {
                                                if (!title && obj.name) title = obj.name;
                                                if (!description && obj.description) description = obj.description.substring(0, 500);
                                                // Also pull address, offers info for property/real-estate
                                                if (obj.address) {
                                                    const addr = typeof obj.address === 'string' ? obj.address : [obj.address.streetAddress, obj.address.addressLocality, obj.address.addressRegion].filter(Boolean).join(', ');
                                                    if (addr) description = (description || '') + ' Location: ' + addr;
                                                }
                                                if (description) break;
                                            }
                                        } catch (_) {}
                                        if (description) break;
                                    }
                                }

                                // Body text fallback
                                if (!description || !title) {
                                    let bodyText = html
                                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                        .replace(/<[^>]+>/g, ' ')
                                        .replace(/\s+/g, ' ')
                                        .trim();
                                    pageText = bodyText.substring(0, 3000);
                                }
                            }
                        } catch (_) {
                            // Network/fetch error - will fall through to URL slug fallback
                        }

                        let decodedTitle = cleanScrapedTitle(decodeHtmlEntities(title));
                        let decodedDesc = decodeHtmlEntities(description || pageText.substring(0, 500));

                        // URL slug fallback: if scrape returned nothing useful, parse keywords from the URL itself
                        if (!decodedTitle || decodedTitle.length < 5) {
                            decodedTitle = extractSlugKeywords(url);
                        }

                        if (isTelegramPostUrl(url) || /Telegram|View\s*@|Listing\s*|Hartanah/i.test(decodedTitle)) {
                            decodedTitle = extractTelegramTitle(decodedTitle, decodedDesc);
                        }

                        const lowerText = (decodedTitle + ' ' + decodedDesc).toLowerCase();
                        const isBlocked = lowerText.includes('enable javascript') ||
                                          lowerText.includes('javascript is disabled') ||
                                          lowerText.includes('cloudflare') ||
                                          lowerText.includes('captcha') ||
                                          lowerText.includes('security check') ||
                                          lowerText.includes('access denied') ||
                                          lowerText.includes('robot') ||
                                          lowerText.includes('unsupported browser') ||
                                          (decodedTitle.includes('Shopee') && decodedDesc.includes('JavaScript'));

                        // Only report blocked if we truly have nothing from URL slug either
                        if (isBlocked && !decodedTitle) {
                            return new Response(JSON.stringify({
                                success: false,
                                is_blocked: true,
                                message: 'Situs web menyekat bot automatik (bot protection). Sila isi nama & info produk secara manual.'
                            }), { status: 200, headers: corsHeaders });
                        }

                        return new Response(JSON.stringify({
                            success: true,
                            url: finalUrl,
                            title: decodedTitle,
                            description: decodedDesc,
                            image: image
                        }), { status: 200, headers: corsHeaders });
                    } catch (err) {
                        return new Response(JSON.stringify({
                            success: false,
                            message: `Failed to scrape URL: ${err.message}`
                        }), { status: 200, headers: corsHeaders });
                    }
                }

                case '/api/ai/url-autoposter-direct': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (activeWorkspace.role === 'viewer') {
                        return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot create content.' }), { status: 403, headers: corsHeaders });
                    }

                    try {
                        const { url: rawUrlInput, mediaUrl, context, tone, language, postFormat, timezoneOffset, index, triggerType, triggerThreshold } = await request.json();
                        if (!rawUrlInput) {
                            return new Response(JSON.stringify({ message: 'URL is required.' }), { status: 400, headers: corsHeaders });
                        }
                        // Sanitize URL: strip invisible/control characters that can cause URI malformed errors
                        const url = rawUrlInput.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '').trim();

                        // Get custom instructions from workspace settings
                        const wsAI = await env.DB.prepare(
                            "SELECT ai_model, ai_api_key_enc, custom_ai_instructions FROM workspaces WHERE id = ?"
                        ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                        const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                        // Extract context from frontend or scrape URL for product details
                        let productContext = context || "";
                        
                        // Always try to scrape URL for richer product details
                        let scrapedTitle = "";
                        let scrapedDescription = "";
                        let scrapedImage = "";
                        let scrapedImages = [];
                        try {
                            const scrapeRes = await fetch(url, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                    'Accept-Language': 'ms-MY,ms;q=0.9,en-MY;q=0.8,en;q=0.7',
                                    'Accept-Encoding': 'gzip, deflate, br',
                                    'Cache-Control': 'no-cache',
                                    'Referer': new URL(url).origin + '/',
                                    'Sec-Fetch-Mode': 'navigate',
                                    'Sec-Fetch-Site': 'none',
                                    'Sec-Fetch-Dest': 'document',
                                    'Upgrade-Insecure-Requests': '1'
                                },
                                redirect: 'follow'
                            });

                            if (scrapeRes.ok) {
                                const html = await scrapeRes.text();

                                 const metas = extractMetaTags(html);
                                 if (metas.title) scrapedTitle = metas.title;
                                 if (metas.description) scrapedDescription = metas.description;
                                 if (metas.image) {
                                     scrapedImage = metas.image;
                                     scrapedImages.push(metas.image);
                                 }

                                 // Extract Telegram post gallery photos
                                 if (isTelegramPostUrl(url)) {
                                     const photoMatches = [...html.matchAll(/tgme_widget_message_photo_wrap[^>]+style=["'][^"']*background-image\s*:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)];
                                     const extracted = photoMatches.map(m => m[1].trim()).filter(Boolean);
                                     if (extracted.length > 0) {
                                         scrapedImages = extracted;
                                         scrapedImage = extracted[0];
                                     }
                                 }

                                  // If it is a Telegram post, check if the image is just the channel's profile picture
                                  if (scrapedImage && isTelegramPostUrl(url)) {
                                      try {
                                          const u = new URL(url);
                                          const parts = u.pathname.split('/').filter(Boolean);
                                          if (parts.length > 1) {
                                              const channelUrl = `${u.origin}/${parts[0]}`;
                                              const channelRes = await fetch(channelUrl, {
                                                  headers: {
                                                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                                                  },
                                                  redirect: 'follow'
                                              });
                                              if (channelRes.ok) {
                                                  const channelHtml = await channelRes.text();
                                                  const channelMetas = extractMetaTags(channelHtml);
                                                  if (channelMetas.image && scrapedImage === channelMetas.image) {
                                                      scrapedImage = ""; // Ignore default channel profile picture
                                                  }
                                              }
                                          }
                                      } catch (_) {}
                                  }

                                // JSON-LD extraction
                                if (!scrapedDescription || scrapedDescription.length < 50) {
                                    const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
                                    for (const m of jsonLdMatches) {
                                        try {
                                            const ld = JSON.parse(m[1]);
                                            const objs = Array.isArray(ld) ? ld : [ld];
                                            for (const obj of objs) {
                                                if (!scrapedTitle && obj.name) scrapedTitle = obj.name;
                                                if (!scrapedDescription && obj.description) scrapedDescription = obj.description.substring(0, 1000);
                                                if (obj.address) {
                                                    const addr = typeof obj.address === 'string' ? obj.address : [obj.address.streetAddress, obj.address.addressLocality, obj.address.addressRegion].filter(Boolean).join(', ');
                                                    if (addr) scrapedDescription = (scrapedDescription || '') + ' Location: ' + addr;
                                                }
                                                if (scrapedDescription) break;
                                            }
                                        } catch (_) {}
                                        if (scrapedDescription) break;
                                    }
                                }

                                // Body text fallback
                                if (!scrapedDescription) {
                                    let bodyText = html
                                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                        .replace(/<[^>]+>/g, ' ')
                                        .replace(/\s+/g, ' ')
                                        .trim();
                                    scrapedDescription = bodyText.substring(0, 1500);
                                }
                            }
                        } catch (_) {
                            // Scrape failed
                        }

                        // If secondary mediaUrl is provided, fetch it to scrape and override the image
                        if (mediaUrl) {
                            try {
                                const mediaRes = await fetch(mediaUrl.trim(), {
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                                    },
                                    redirect: 'follow'
                                });
                                if (mediaRes.ok) {
                                    const mediaHtml = await mediaRes.text();
                                    const mediaMetas = extractMetaTags(mediaHtml);
                                    if (mediaMetas.image) {
                                        scrapedImage = mediaMetas.image;
                                        scrapedImages = [mediaMetas.image];
                                    }
                                    if (isTelegramPostUrl(mediaUrl.trim())) {
                                        const photoMatches = [...mediaHtml.matchAll(/tgme_widget_message_photo_wrap[^>]+style=["'][^"']*background-image\s*:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi)];
                                        const extracted = photoMatches.map(m => m[1].trim()).filter(Boolean);
                                        if (extracted.length > 0) {
                                            scrapedImages = extracted;
                                            scrapedImage = extracted[0];
                                        }
                                    }
                                }
                            } catch (_) {
                                // Scrape failed
                            }
                        }

                        // Decode HTML entities in scraped content
                        const decodeEntities = (str) => {
                            if (!str) return "";
                            return str.replace(/&#(\d+);/g, (m, d) => String.fromCharCode(d))
                                      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
                                      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                                      .replace(/&nbsp;/g, ' ');
                        };
                        scrapedTitle = cleanScrapedTitle(decodeEntities(scrapedTitle));
                        scrapedDescription = decodeEntities(scrapedDescription);

                        // Clean up Telegram boilerplate landing page metadata if scraper got redirected
                        if (scrapedDescription && (scrapedDescription.includes('View @') || scrapedDescription.includes('View in Telegram') || scrapedDescription.includes('View In Channel') || scrapedDescription.includes('tgme_page_description'))) {
                            scrapedDescription = "";
                            scrapedTitle = "";
                        }

                        // Combine: frontend context + scraped data for maximum richness
                        if (scrapedDescription) {
                            productContext = productContext
                                ? `${productContext}\n\nScraped from URL:\n${scrapedTitle ? scrapedTitle + '\n' : ''}${scrapedDescription}`
                                : `${scrapedTitle ? scrapedTitle + '\n' : ''}${scrapedDescription}`;
                        }

                        // Sanitize productContext — remove agent-specific contact details so AI doesn't reproduce them
                        // Removes: phone numbers, REN numbers, wasap.my / wa.me links, agent self-intro phrases
                        if (productContext) {
                            productContext = productContext
                                // Remove wasap.my and wa.me links (full URL)
                                .replace(/https?:\/\/(www\.)?wasap\.my\/[^\s]*/gi, '')
                                .replace(/https?:\/\/wa\.me\/[^\s]*/gi, '')
                                // Remove phone numbers in various formats: +60123456789, 60123456789, 019-1234567, 0191234567
                                .replace(/(?:\+?60|0)[\s-]?\d{1,2}[\s-]?\d{3,4}[\s-]?\d{4}/g, '')
                                // Remove REN/PEA/REA registration numbers e.g. "REN 49260", "REN49260"
                                .replace(/\b(REN|PEA|REA|VE|E)\s*\d{3,6}\b/gi, '')
                                // Remove agent self-intro lines: "Saya [Name]," / "I am [Name]," / "Nama saya [Name]"
                                .replace(/(?:^|\n)[^\n]*(?:saya adalah|my name is|nama saya|hubungi saya di|contact me at)[^\n]*/gi, '')
                                // Remove lines that are just a name followed by a comma and REN/contact info
                                .replace(/(?:^|\n)[^\n]{2,40},\s*(?:REN|ejen|agent|agen)\s*[\d,\s]*/gi, '')
                                // Clean up extra whitespace/newlines left behind
                                .replace(/[ \t]+/g, ' ')
                                .replace(/\n{3,}/g, '\n\n')
                                .trim();
                        }

                        // For affiliate/ecommerce links (Shopee, TikTok, Lazada) — strip price mentions and
                        // spec/feature bullet lines from productContext so AI doesn't leak pricing in copywriting.
                        // This preserves the curiosity gap that drives clicks.
                        const isAffiliateUrl = /shopee\.|tiktok\.|lazada\.|aliexpress\./i.test(url);
                        if (isAffiliateUrl && productContext) {
                            productContext = productContext
                                // Remove RM price mentions e.g. "RM30.39", "RM 30.39", "harga RM 30", "price RM30"
                                .replace(/(?:harga|price|dari|from|mulai|serendah|as low as)?\s*RM\s*[\d,.]+/gi, '')
                                // Remove lines that are mostly specs/numbers (e.g. "100% Polyester", "30x40cm", "Size: XL")
                                .replace(/(?:^|\n)[^\n]*(?:size|saiz|dimension|material|bahan|weight|berat|cm|mm|inch|%):[^\n]*/gi, '\n')
                                // Clean up
                                .replace(/\n{3,}/g, '\n\n')
                                .trim();
                        }


                        // URL slug fallback only if we still have nothing
                        if (!productContext) {
                            try {
                                const u = new URL(url);
                                const slug = (u.pathname + ' ' + u.search)
                                    .replace(/[-_/]/g, ' ')
                                    .replace(/\.htm.*$/i, '')
                                    .replace(/\d{5,}/g, '')
                                    .replace(/[^a-zA-Z ]/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                                const stopWords = ['www','com','my','html','for','sale','buy','the','and','with','share','listing','item','product','page'];
                                const words = slug.split(' ').filter(w => w.length > 2 && !stopWords.includes(w.toLowerCase()));
                                productContext = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            } catch (_) {}
                            if (!productContext) productContext = "produk Malaysia";
                        }

                        // Determine schedule time using Queue-Based Auto-Staggering
                        const idx = parseInt(index) || 0;
                        const staggerMinutes = 30; // 30 minutes spacing

                        // Find the latest scheduled or draft post for this workspace
                        const lastPost = await env.DB.prepare(
                            "SELECT publish_at FROM scheduled_posts WHERE workspace_id = ? AND status IN ('scheduled', 'draft') ORDER BY publish_at DESC LIMIT 1"
                        ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                        let baseTime = new Date(Date.now() + 15 * 60 * 1000); // default to 15 minutes from now
                        if (lastPost && lastPost.publish_at) {
                            const lastTime = new Date(lastPost.publish_at);
                            if (lastTime.getTime() > Date.now()) {
                                baseTime = lastTime;
                            }
                        }

                        // Add flat stagger spacing (30 minutes after the last post)
                        const publishAtDate = new Date(baseTime.getTime() + staggerMinutes * 60 * 1000);
                        const publishAt = publishAtDate.toISOString();

                        // Resolve social account
                        const socialAccount = await env.DB.prepare(
                            "SELECT id FROM social_accounts WHERE workspace_id = ? AND platform = 'threads' AND status = 'active' LIMIT 1"
                        ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                        const accountId = socialAccount ? socialAccount.id : null;
                        const finalStatus = accountId ? 'scheduled' : 'draft';

                        // Domain routing & WhatsApp link auto-generation
                        const isEcommerceOrMarketplace = (rawUrl) => {
                            try {
                                let u;
                        try { u = new URL(rawUrl); } catch(_) { return false; }
                                const hostname = u.hostname.toLowerCase();
                                const ecommerceDomains = [
                                    'shopee.com', 'shopee.com.my', 'shopee.co.id', 'shopee.sg',
                                    'tiktok.com', 'vt.tiktok.com',
                                    'lazada.com', 'lazada.com.my',
                                    'mudah.my', 'www.mudah.my',
                                    'propmall.my', 'www.propmall.my'
                                ];
                                return ecommerceDomains.some(d => hostname === d || hostname.endsWith('.' + d));
                            } catch (_) {
                                return false;
                            }
                        };

                        let finalCtaUrl = url;
                        let linkType = 'product';

                        if (isEcommerceOrMarketplace(url)) {
                            // Automatically generate short link for ecommerce redirect
                            try {
                                const code = Math.random().toString(36).substring(2, 8); // random 6 chars
                                const titleClean = cleanScrapedTitle(scrapedTitle || "Auto-Shortened Link");
                                
                                await env.DB.prepare(
                                    `INSERT INTO short_links (code, target_url, title, description, workspace_id)
                                     VALUES (?, ?, ?, ?, ?)`
                                ).bind(
                                    code,
                                    url,
                                    titleClean,
                                    scrapedDescription ? scrapedDescription.substring(0, 200) : "Sila klik untuk melihat produk.",
                                    activeWorkspace.workspace_id
                                ).run();

                                finalCtaUrl = `https://nakcuba.my/l/${code}`;
                            } catch (e) {
                                console.error("Auto-shortener failed, falling back to raw URL:", e);
                            }
                        }

                        if (!isEcommerceOrMarketplace(url) && activeWorkspace.whatsapp_number) {
                            linkType = 'whatsapp';
                            const whatsappNum = activeWorkspace.whatsapp_number.replace(/\D/g, ''); // digits only

                            let productTitle = cleanScrapedTitle(scrapedTitle || "");
                            if (isTelegramPostUrl(url) || /Telegram|View\s*@|Listing\s*|Hartanah/i.test(productTitle)) {
                                productTitle = extractTelegramTitle(productTitle, scrapedDescription);
                            }

                            if ((!productTitle || productTitle.trim() === "") && productContext) {
                                productTitle = productContext.split('\n')[0].substring(0, 80);
                            }

                            let locationInfo = "";
                            if (scrapedDescription) {
                                // Try explicit Location/Lokasi label first (restricted to horizontal whitespace to avoid matching next lines)
                                const locMatch = scrapedDescription.match(/(?:Location|Lokasi|Located\s+at|Terletak\s+di)[ \t]*[:\-]?[ \t]*([^\n,]+)/i);
                                if (locMatch) {
                                    locationInfo = locMatch[1].trim();
                                } else {
                                    // Try to extract from the property type line: area names after common area keywords
                                    const areaKeywords = /\b(Bandar|Taman|Pandan|Subang|Shah Alam|Petaling|Ampang|Rawang|Semenyih|Dengkil|Klang|Cheras|Setapak|Puchong|Serdang|Cyberjaya|Putrajaya|Kajang|Sepang|Sri|Damansara|Kepong|Selayang|Batu|Seremban|Nilai|Saujana|Putra|Prima|BSP|SP\s*\d+)\b[\w\s]*/i;
                                    const lines = scrapedDescription.split('\n').map(l => l.trim()).filter(Boolean);
                                    for (const line of lines) {
                                        const areaMatch = line.match(areaKeywords);
                                        if (areaMatch && areaMatch[0].length > 3) {
                                            // Extract the full line (cleaned of emojis and bullet points) for complete address context (e.g. "Seksyen 11 Shah Alam")
                                            locationInfo = line.replace(/^[✅✨🏠📌🔥*‼️•⁠🏡❗️❗\-–\s]+/, '').trim().substring(0, 50);
                                            break;
                                        }
                                    }
                                }
                            }

                            const matchedPrice = extractPrice(scrapedDescription) || extractPrice(productContext);
                            const priceText = matchedPrice ? ` (${matchedPrice})` : "";

                            // Build a clean, professional WhatsApp greeting
                            let greetingTitle = productTitle.trim();
                            // Remove any hashtags
                            greetingTitle = greetingTitle.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
                            // Remove any leading bullet, dash, or spec-looking text
                            greetingTitle = greetingTitle.replace(/^[•\-–\s]+/, '').replace(/(?:Land\s*Area|Built\s*Up)\s*\d+.*/i, '').trim();
                            if (greetingTitle.length > 150) {
                                greetingTitle = greetingTitle.substring(0, 147) + "...";
                            }
                            if (!greetingTitle) greetingTitle = "hartanah yang anda senaraikan";

                            let greetingText = `Hai, saya berminat dengan ${greetingTitle}`;
                            if (locationInfo && !greetingTitle.toLowerCase().includes(locationInfo.toLowerCase().split(' ')[0].toLowerCase())) {
                                greetingText += ` di ${locationInfo}`;
                            }
                             if (priceText) {
                                 greetingText += priceText;
                             }
                             let refText = "";
                            if (url) {
                                try {
                                    const u = new URL(url);
                                    if (u.hostname === 't.me' || u.hostname === 'telegram.me' || u.hostname === 'telesco.pe') {
                                        const parts = u.pathname.split('/').filter(Boolean);
                                        if (parts.length > 0) {
                                            refText = `\n\n[Ref: ${parts[0]}]`;
                                        }
                                    } else {
                                        refText = `\n\n[Ref: ${u.hostname.replace('www.', '')}]`;
                                    }
                                } catch (_) {}
                            }
                            greetingText += `. Boleh bagi details?${refText}`;

                            // Safely encode greeting — scraped text may contain malformed Unicode (lone surrogates)
                            let safeGreeting = greetingText
                                .replace(/[\uD800-\uDFFF]/g, '') // remove lone surrogates
                                .replace(/[^\u0000-\uFFFF]/g, '') // remove non-BMP chars that can't be encoded
                                .trim();
                            let encodedGreeting;
                            try {
                                encodedGreeting = encodeURIComponent(safeGreeting);
                            } catch (_) {
                                encodedGreeting = encodeURIComponent(`Hai, saya berminat dengan hartanah ini. Boleh bagi details?`);
                            }
                            finalCtaUrl = `https://wa.me/${whatsappNum}?text=${encodedGreeting}`;
                        }

                        let ctaPromptInstructions = "";
                        if (linkType === 'whatsapp') {
                            ctaPromptInstructions = `write a creative and engaging call to action phrase asking the user to WhatsApp or contact for more details (e.g. "Berminat? WhatsApp saya sekarang!", "Hubungi saya untuk details lanjut!", etc.). Do NOT include the URL link itself. If workspace copywriting guidelines/knowledge base are provided, follow them to write this CTA phrase.`;
                        } else {
                            ctaPromptInstructions = `Write a very casual, non-pushy, laid-back Malaysian conversational redirect phrase for the link (e.g. "Nah link kalau ada yang nak ushar:", "Korang tengoklah sendiri kat sini:", "Kot lah ada yang nak ushar:", "Aku drop link kat sini kalau ada yang nak ushar:", "Saja kongsi link ni kot-kot ada yang perlukan:"). STRICTLY FORBIDDEN: Do NOT mention any platform names such as Shopee, TikTok, TikTok Shop, Lazada, Tokopedia, or any marketplace name in the CTA phrase. Do NOT make it sound like a pushy sales pitch (strictly avoid phrases like "Dapatkan sekarang!", "Beli hari ini!", "Jangan terlepas!", "Grab sekarang!"). Keep it super casual, friendly, and natural as if sharing with a friend. Do NOT include the URL link itself.`;
                        }

                        // Compile the AI copywriting generation prompt
                        let formatInstructions = "";
                        if (postFormat === 'short_thread') {
                            formatInstructions = `MUST be a Thread Storm (berangkai) consisting of exactly 2 to 3 posts/slides. Split different slides using the exact separator string '---thread-separator---'. For example: 'Slide 1 content\\n---thread-separator---\\nSlide 2 content\\n---thread-separator---\\nSlide 3 content'. Each individual slide must be under 300 characters.`;
                        } else if (postFormat === 'deep_thread') {
                            formatInstructions = `MUST be a deep-dive Thread Storm (berangkai) consisting of exactly 3 to 5 posts/slides. Split different slides using the exact separator string '---thread-separator---'. For example: 'Slide 1 content\\n---thread-separator---\\nSlide 2 content\\n---thread-separator---\\nSlide 3 content\\n---thread-separator---\\nSlide 4 content'. Each individual slide must be under 300 characters.`;
                        } else {
                            formatInstructions = `must be a standard single post, under 350 characters.`;
                        }

                        // Add specific tone instructions
                        let toneInstruction = "";
                        if (tone === 'Ultra-Realistic Malay') {
                            toneInstruction = `Tone: Ultra-Realistic Malaysian Malay.
CRITICAL TONE RULES:
- Write exactly like a real human writing a personal post on Threads, NOT like an AI assistant.
- Mix English and Malay naturally (Bahasa Rojak/Manglish). E.g. use terms like 'literally', 'our financial', 'time tu', 'which is', 'I mean'.
- Use repeated letters in words for emotional or casual emphasis (e.g. 'neverrrrr', 'sapaaaa', 'lajuuuuu'). Do NOT hardcode, anchor, or overuse specific slangs like 'weyh' or 'weh'.
- The opening hook MUST be a direct statement, reflection, or opinion (not a question like "Korang tahu tak..."). 
- Keep sentences short, conversational, and punchy.
- DO NOT use any emojis in the main hook caption. Avoid emoji spam entirely.`;
                        } else {
                            toneInstruction = `- Tone: ${tone || 'Friendly & Casual'}`;
                        }

                        // Add workspace-specific copywriting guidelines and system niche rules
                        const nicheData = await getNicheInstructions(env.DB, productContext);
                        
                        const lowerCtx = (productContext || "").toLowerCase();
                        const isProperty = lowerCtx.includes("apartment") || lowerCtx.includes("semi d") || lowerCtx.includes("teres") || lowerCtx.includes("kondo") || lowerCtx.includes("house") || lowerCtx.includes("property") || lowerCtx.includes("hartanah") || lowerCtx.includes("bilik") || lowerCtx.includes("sqft") || lowerCtx.includes("rumah") || lowerCtx.includes("sewa") || lowerCtx.includes("landed") || lowerCtx.includes("tingkat") || lowerCtx.includes("bilik air") || lowerCtx.includes("lot") || lowerCtx.includes("freehold") || lowerCtx.includes("leasehold") || url.includes("propmall") || url.includes("mudah") || (nicheData && (nicheData.niche_key === 'hartanah' || nicheData.niche_key === 'property'));

                        const provider = AIFactory.getProvider(aiEnv);

                        let customGuidelinesBlock = [
                            getFactPreservingInstructions(aiEnv.custom_ai_instructions),
                            formatInstructions,
                            toneInstruction,
                            `CTA Instructions: ${ctaPromptInstructions}`
                        ].filter(Boolean).join('\n\n');

                        // Smart Business Type Classifier for Bulk Auto-Schedule
                        let classifiedBusinessType = 'Products & Affiliate';
                        const lowerUrl = url.toLowerCase();
                        const lowerTitle = (scrapedTitle || "").toLowerCase();
                        const lowerDesc = (scrapedDescription || "").toLowerCase();
                        
                        const isRecruitment = lowerUrl.includes("forms.gle") || 
                                              lowerUrl.includes("docs.google.com/forms") || 
                                              lowerUrl.includes("jotform") || 
                                              lowerUrl.includes("typeform") ||
                                              lowerUrl.includes("careers") ||
                                              lowerUrl.includes("hiring") ||
                                              lowerUrl.includes("recruitment") ||
                                              lowerTitle.includes("rekrut") || 
                                              lowerTitle.includes("hiring") || 
                                              lowerTitle.includes("jawatan kosong") || 
                                              lowerTitle.includes("dropship") || 
                                              lowerTitle.includes("ejen") || 
                                              lowerTitle.includes("agen") ||
                                              lowerDesc.includes("join team") ||
                                              lowerDesc.includes("cari dropship") ||
                                              lowerDesc.includes("tambah pendapatan");
                                              
                        if (isProperty) {
                            classifiedBusinessType = 'Real Estate';
                        } else if (isRecruitment) {
                            classifiedBusinessType = 'Recruitment & Team Hiring';
                        } else if (!lowerUrl.includes("shopee") && !lowerUrl.includes("tiktok") && !lowerUrl.includes("lazada") && !lowerUrl.includes("aliexpress")) {
                            // Custom links (Canva portfolio, own business website, digital services, local brand links)
                            classifiedBusinessType = 'Business & Services Promotion';
                        }

                        const systemPrompt = provider.assembleCaptionPrompt({
                            businessType: classifiedBusinessType,
                            product: productContext,
                            targetAudience: 'Malaysian social media users',
                            goal: 'Engagement & Lead Generation',
                            tone: tone || 'Friendly & Casual',
                            language: language || 'Malay',
                            postFormat: postFormat === 'deep_thread' ? 'deep_thread' : (postFormat === 'short_thread' ? 'short_thread' : 'single'),
                            funnelStage: 'none',
                            customInstructions: customGuidelinesBlock,
                            nicheRules: nicheData ? nicheData.rules : null,
                            nicheExampleOutput: nicheData ? nicheData.example_output : null
                        });
                        
                        let responseText = "";
                        let modelUsed = provider.model || "unknown";

                        try {
                            if (provider.constructor?.name === 'CloudflareAIProvider' || typeof provider.ai?.run === 'function') {
                                const res = await provider.ai.run(provider.model || '@cf/meta/llama-3.2-3b-instruct', {
                                    messages: [
                                        { role: "system", content: "You must output strictly a JSON object." },
                                        { role: "user", content: systemPrompt }
                                    ]
                                });
                                responseText = typeof res === 'string' ? res : (res.choices?.[0]?.message?.content || res.response || JSON.stringify(res));
                            } else if (provider.constructor?.name === 'GeminiProvider') {
                                const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${provider.apiKey}`;
                                const isThinkingModel = provider.model && (provider.model.includes('pro') || provider.model.includes('thinking'));
                                const res = await fetch(genUrl, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        contents: [{ parts: [{ text: systemPrompt }] }],
                                        generationConfig: {
                                            responseMimeType: "application/json",
                                            ...(isThinkingModel ? { thinkingConfig: { thinkingBudget: 0 } } : {})
                                        }
                                    })
                                 });
                                if (res.ok) {
                                    const data = await res.json();
                                    const parts = data.candidates?.[0]?.content?.parts || [];
                                    // Scan all parts for the text output (thinking models may split across multiple parts)
                                    responseText = parts.find(p => p.text && !p.thoughtSignature)?.text
                                        || parts.find(p => p.text)?.text
                                        || "";
                                } else {
                                    const errText = await res.text();
                                    console.error(`Gemini Direct API call failed: ${res.status} - ${errText}`);
                                }
                            } else {
                                // OpenAI or OpenRouter
                                const endpoint = provider.constructor?.name === 'OpenAIProvider' 
                                    ? "https://api.openai.com/v1/chat/completions" 
                                    : "https://openrouter.ai/api/v1/chat/completions";
                                const headers = {
                                    "Authorization": `Bearer ${provider.apiKey}`,
                                    "Content-Type": "application/json"
                                };
                                if (provider.constructor?.name === 'OpenRouterProvider') {
                                    headers["HTTP-Referer"] = "https://socialhub.zaimrosli.my";
                                    headers["X-Title"] = "SocialHub Autoposter";
                                }
                                const isReasoning = provider.model && (
                                    provider.model.toLowerCase().startsWith('o1') || 
                                    provider.model.toLowerCase().startsWith('o3') || 
                                    provider.model.toLowerCase().startsWith('o4') || 
                                    provider.model.toLowerCase().startsWith('gpt-5') || 
                                    provider.model.toLowerCase().includes('gpt-5.')
                                );
                                const res = await fetch(endpoint, {
                                    method: "POST",
                                    headers,
                                    body: JSON.stringify({
                                        model: provider.model,
                                        messages: [{ role: "user", content: systemPrompt }],
                                        ...(isReasoning ? {} : { temperature: 0.7 })
                                    })
                                });
                                if (res.ok) {
                                    const data = await res.json();
                                    responseText = data.choices?.[0]?.message?.content || "";
                                } else {
                                    const errText = await res.text();
                                    console.error(`OpenRouter/OpenAI API call failed: ${res.status} - ${errText}`);
                                }
                            }
                        } catch (e) {
                            console.error("Primary AI provider call failed:", e);
                        }

                        // Robust fallback: If selected provider failed or returned empty response, fall back using our helper
                        if (!responseText) {
                            console.warn(`Primary AI model ${modelUsed} failed. Retrying with robust fallbacks...`);
                            const fallback = await runFallbackAI(systemPrompt, env);
                            if (fallback) {
                                responseText = fallback.text;
                                modelUsed = `${modelUsed} (failed, fell back to ${fallback.model})`;
                            }
                        }

                        if (!responseText) {
                            throw new Error("AI provider returned empty response.");
                        }

                        // Robust JSON extraction — handles:
                        // 1. Markdown code fences (```json ... ```)
                        // 2. Reasoning model preamble text before the JSON
                        // 3. Truncated responses (find the last complete JSON object)
                        function extractJSON(raw) {
                            if (!raw) return null;
                            // Strip markdown fences
                            let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                            // Try parsing directly first
                            try { return JSON.parse(s); } catch (_) {}
                            // Find first { and last } and try to parse that slice
                            const start = s.indexOf('{');
                            const end = s.lastIndexOf('}');
                            if (start !== -1 && end !== -1 && end > start) {
                                try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
                            }
                            return null;
                        }
                        const parsed = extractJSON(responseText);
                        if (!parsed) {
                            throw new Error(`AI response could not be parsed as JSON. Model: ${modelUsed}`);
                        }

                        // Normalize caption — some AI models (e.g. OpenAI) return caption as an array of slides
                        const rawCaption = parsed.caption || parsed.text || parsed.content || "";
                        const caption = Array.isArray(rawCaption)
                            ? rawCaption.map(s => (typeof s === 'string' ? s : JSON.stringify(s))).join('\n---thread-separator---\n')
                            : (typeof rawCaption === 'string' ? rawCaption : String(rawCaption || ""));

                        const rawHashtags = parsed.hashtags || parsed.tags || [];
                        let hashtagsText = Array.isArray(rawHashtags) ? rawHashtags.join(' ') : (typeof rawHashtags === 'string' ? rawHashtags : '');



                        const isAffiliate = (nicheData && nicheData.niche_key === 'affiliate') || 
                                            (url.includes('shopee') || url.includes('tiktok') || url.includes('lazada') || url.includes('aliexpress') || url.includes('nakcuba.my'));

                        // Sale vs Rent detection: check scraped content + WA URL text (encoded)
                        // Check full product context AND scraped content for keywords
                        const fullDetectionText = (productContext + " " + scrapedTitle + " " + scrapedDescription + " " + url).toLowerCase();
                        const hasSaleSignals = fullDetectionText.includes("jual") || fullDetectionText.includes("dijual") || 
                            fullDetectionText.includes("wts") || fullDetectionText.includes("sale") || 
                            fullDetectionText.includes("for sale") || fullDetectionText.includes("untu kdijual") ||
                            fullDetectionText.includes("hartanahuntukdijual") || fullDetectionText.includes("rumahuntukdijual") ||
                            /rm\s*\d{2,3}[,.]\d{3}/.test(fullDetectionText) || // price pattern like RM350,000
                            /rm\d{2,3}k/.test(fullDetectionText); // price pattern like RM350k
                        const hasRentSignals = !hasSaleSignals && (
                            fullDetectionText.includes("sewa") || fullDetectionText.includes("wtl") ||
                            fullDetectionText.includes("rent") || fullDetectionText.includes("lease") ||
                            fullDetectionText.includes("/bulan") || fullDetectionText.includes("per month")
                        );
                        const isSale = hasSaleSignals;
                        const isRent = hasRentSignals;

                        if (isProperty) {
                            const saleTags = ["#jualbelirumah", "#jualrumah", "#rumahuntukdijual", "#hartanahuntukdijual"];
                            const rentTags = ["#sewahartanah", "#sewarumah", "#rumahsewa", "#sewakondominium", "#biliksewa"];

                            let tagsArray = hashtagsText.split(/\s+/).filter(Boolean);
                            if (isSale) {
                                // Filter out rent tags
                                tagsArray = tagsArray.filter(t => !rentTags.includes(t.toLowerCase()) && t.toLowerCase() !== '#sewa' && t.toLowerCase() !== '#rent');
                                // Add missing sale tags
                                saleTags.forEach(t => {
                                    if (!tagsArray.map(x => x.toLowerCase()).includes(t.toLowerCase())) {
                                        tagsArray.push(t);
                                    }
                                });
                            } else if (isRent) {
                                // Filter out sale tags
                                tagsArray = tagsArray.filter(t => !saleTags.includes(t.toLowerCase()) && t.toLowerCase() !== '#jual' && t.toLowerCase() !== '#buy' && t.toLowerCase() !== '#beli');
                                // Add missing rent tags
                                rentTags.forEach(t => {
                                    if (!tagsArray.map(x => x.toLowerCase()).includes(t.toLowerCase())) {
                                        tagsArray.push(t);
                                    }
                                });
                            }
                            hashtagsText = tagsArray.join(" ");
                        } else if (isAffiliate) {
                            const affiliateTags = ["#affiliate", "#shopee", "#shopeefinds", "#racunshopee"];
                            if (url.toLowerCase().includes("tiktok")) {
                                affiliateTags.push("#tiktokshop", "#racuntiktok");
                            }
                            
                            let tagsArray = hashtagsText.split(/\s+/).filter(Boolean).map(t => t.startsWith('#') ? t : `#${t}`);
                            affiliateTags.forEach(t => {
                                if (!tagsArray.map(x => x.toLowerCase()).includes(t.toLowerCase())) {
                                    tagsArray.push(t);
                                }
                            });
                            hashtagsText = tagsArray.join(" ");
                        }

                        // Retrieve dynamic CTA and format properly
                        let ctaText = "";
                        if (isProperty) {
                            if (linkType === 'whatsapp') {
                                // For property listings that redirect to WhatsApp (like Telegram listings)
                                // We provide different random variations based on whether it is for Sale or Rent
                                if (isRent) {
                                    const rentVariations = [
                                        `Klik link WhatsApp ni untuk roger aku sekarang sebelum unit ni disambar orang lain: ➡️ ${finalCtaUrl}`,
                                        `Berminat nak sewa? Roger aku sekarang sebelum unit sewa ni terlepas ke orang lain: ➡️ ${finalCtaUrl}`,
                                        `Tekan link ni untuk WhatsApp aku terus kalau nak set viewing / booking unit sewa ni: ➡️ ${finalCtaUrl}`,
                                        `Unit sewa macam ni selalunya laju kena grab. Cepat WhatsApp aku kat sini: ➡️ ${finalCtaUrl}`,
                                        `Kalau nak booking atau nak datang tengok rumah, klik link ni untuk roger aku terus: ➡️ ${finalCtaUrl}`
                                    ];
                                    const randomIndex = Math.floor(Math.random() * rentVariations.length);
                                    ctaText = rentVariations[randomIndex];
                                } else {
                                    const saleVariations = [
                                        `Terus WhatsApp aku sekarang untuk semak kelayakan/viewing atau maklumat lanjut: ➡️ ${finalCtaUrl}`,
                                        `Kalau berminat nak viewing atau semak kelayakan loan, klik link ni untuk WhatsApp aku terus: ➡️ ${finalCtaUrl}`,
                                        `Berminat nak tahu details lanjut atau nak set viewing? WhatsApp aku kat sini: ➡️ ${finalCtaUrl}`,
                                        `Tekan link ni untuk WhatsApp aku terus kalau nak semak kelayakan / viewing unit ni: ➡️ ${finalCtaUrl}`,
                                        `Berminat nak beli? WhatsApp aku terus untuk semak kelayakan loan atau booking unit: ➡️ ${finalCtaUrl}`
                                    ];
                                    const randomIndex = Math.floor(Math.random() * saleVariations.length);
                                    ctaText = saleVariations[randomIndex];
                                }
                            } else {
                                // For property listings that link to marketplaces (Propmall / Mudah) where direct buttons exist on-page
                                ctaText = `Korang tengok details kat sini: ➡️ ${finalCtaUrl}\n\nKalau ok, terus WhatsApp/Call aku dari link tu untuk semak kelayakan/viewing atau maklumat lanjut.`;
                            }
                        } else {
                            let finalCtaText = parsed.cta ? parsed.cta.trim() : "";
                            finalCtaText = finalCtaText.replace(/➡️/g, '').replace(/->/g, '').replace(/:$/g, '').trim();

                            const isGeneric = !finalCtaText || 
                                              finalCtaText.toLowerCase().includes("klik") || 
                                              finalCtaText.toLowerCase().includes("click") || 
                                              finalCtaText.toLowerCase().includes("link") ||
                                              finalCtaText.length < 10;

                            if (isGeneric) {
                                if (classifiedBusinessType === 'Recruitment & Team Hiring') {
                                    const recruitmentVariations = [
                                        `Berminat nak tambah income or join team? Isi borang/set slot kat sini: ➡️ ${finalCtaUrl}`,
                                        `Pendaftaran dropship/ejen baru tengah open, jom register sekarang: ➡️ ${finalCtaUrl}`,
                                        `Nak start jana income kedua? WhatsApp/Daftar kat sini terus: ➡️ ${finalCtaUrl}`,
                                        `Slot kemasukan ahli baru sangat terhad, lock slot korang kat link ni: ➡️ ${finalCtaUrl}`
                                    ];
                                    const rIndex = (index !== undefined && index !== null)
                                        ? (parseInt(index) % recruitmentVariations.length)
                                        : Math.floor(Math.random() * recruitmentVariations.length);
                                    ctaText = recruitmentVariations[rIndex];
                                } else if (classifiedBusinessType === 'Business & Services Promotion') {
                                    const businessVariations = [
                                        `Ushar details penuh / tempah slot servis kat link ni: ➡️ ${finalCtaUrl}`,
                                        `Korang tengok portfolio kerja & senarai servis kami kat sini: ➡️ ${finalCtaUrl}`,
                                        `Berminat nak bincang projek or dapatkan quotation? Roger aku kat sini: ➡️ ${finalCtaUrl}`,
                                        `Tengok senarai harga & service detail kat website rasmi kami: ➡️ ${finalCtaUrl}`
                                    ];
                                    const bIndex = (index !== undefined && index !== null)
                                        ? (parseInt(index) % businessVariations.length)
                                        : Math.floor(Math.random() * businessVariations.length);
                                    ctaText = businessVariations[bIndex];
                                } else {
                                    // Products & Affiliate
                                    const affiliateVariations = [
                                        `Korang check sendiri review & rating buyer kat sini: ➡️ ${finalCtaUrl}`,
                                        `Ushar harga & baki stok kat link ni: ➡️ ${finalCtaUrl}`,
                                        `Benda viral ni tengah ada discount, ushar cepat kat link ni: ➡️ ${finalCtaUrl}`,
                                        `Aku drop link kat sini kalau ada yang nak ushar dulu: ➡️ ${finalCtaUrl}`,
                                        `Nah link kalau ada yang nak try sendiri: ➡️ ${finalCtaUrl}`,
                                        `Saja kongsi link ni kot-kot ada yang perlukan juga: ➡️ ${finalCtaUrl}`,
                                        `Kot lah ada yang tengah cari barang ni, ni link dia: ➡️ ${finalCtaUrl}`,
                                        `Boleh check details or ushar design lain kat link ni: ➡️ ${finalCtaUrl}`,
                                        `Aku ambil dari seller ni sebab trusted & rating tinggi: ➡️ ${finalCtaUrl}`,
                                        `Mana yang berminat nak tengok spec penuh, roger link ni: ➡️ ${finalCtaUrl}`,
                                        `Korang tengok lah sendiri feedback buyer kat link ni: ➡️ ${finalCtaUrl}`,
                                        `Ini pautan kedai yang aku beli hari tu, shipping laju: ➡️ ${finalCtaUrl}`,
                                        `Try ushar link ni cepat sebelum stok habis or harga naik: ➡️ ${finalCtaUrl}`,
                                        `Nah, aku share link kedai ni untuk mudahkan korang: ➡️ ${finalCtaUrl}`,
                                        `Kalau nak dapatkan barang ni terus, boleh pergi kat link ni: ➡️ ${finalCtaUrl}`
                                    ];
                                    const aIndex = (index !== undefined && index !== null)
                                        ? (parseInt(index) % affiliateVariations.length)
                                        : Math.floor(Math.random() * affiliateVariations.length);
                                    ctaText = affiliateVariations[aIndex];
                                }
                            } else {
                                ctaText = `${finalCtaText} ➡️ ${finalCtaUrl}`;
                            }
                        }
                        
                        // Insert into DB
                        const hasTrigger = triggerType === 'views' || triggerType === 'likes';
                        
                        let processedCaption = caption;
                        let replacedPlaceholder = false;
                        if (/\{\{(SHOPEE_LINK|link)\}\}/i.test(processedCaption)) {
                            processedCaption = processedCaption.replace(/(?:➡️\s*)?\{\{(SHOPEE_LINK|link)\}\}/gi, `➡️ ${finalCtaUrl}`);
                            replacedPlaceholder = true;
                        }
                        
                        if (replacedPlaceholder) {
                            ctaText = "";
                        }

                        const cards = (postFormat === 'short_thread' || postFormat === 'deep_thread')
                            ? processedCaption.split(/[\n\r]*---thread-separator---[\n\r]*/).map(c => c.trim()).filter(Boolean)
                            : [];

                        if (hasTrigger && cards.length > 1) {
                            // 1. Insert Slide 1 (Parent)
                            const parentImageSuffix = (!isProperty && scrapedImages && scrapedImages[0]) ? `\n\n📷 ${scrapedImages[0]}` : "";
                            const parentContent = `${cards[0]}${parentImageSuffix}`.trim();

                            const result = await env.DB.prepare(
                                `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, status, publish_at, source_url, created_at, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, (datetime('now')), (datetime('now')))`
                            ).bind(
                                user.id,
                                activeWorkspace.workspace_id,
                                accountId,
                                'threads',
                                parentContent,
                                finalStatus,
                                publishAt,
                                url
                            ).run();
                            
                            const parentId = result.meta.last_row_id;

                            // 2. Insert subsequent slides as child posts waiting for trigger
                            for (let i = 1; i < cards.length; i++) {
                                let slideText = cards[i];
                                let slideImage = null;
                                
                                if (i === cards.length - 1) {
                                    // Last slide image logic:
                                    // - Dual links (2+ images): use scrapedImages[1] (Link 2 image)
                                    // - Single Propmall/Mudah link: use scrapedImages[0] (proper listing photo)
                                    // - Single Telegram link: NO image (suppress owner's promo card)
                                    const isSingleTelegramLink = !mediaUrl && scrapedImages && scrapedImages.length === 1 && (url.includes('t.me') || url.includes('telegram.me') || url.includes('telesco.pe') || url.includes('nakcuba.my'));
                                    slideImage = (scrapedImages && scrapedImages.length > 1) ? scrapedImages[1] : (isSingleTelegramLink ? null : (scrapedImages && scrapedImages[0] ? scrapedImages[0] : null));
                                } else if (!isProperty) {
                                    // Non-property niche: distribute sequentially
                                    slideImage = (scrapedImages && scrapedImages[i]) ? scrapedImages[i] : null;
                                }
                                
                                const slideImageSuffix = slideImage ? `\n\n📷 ${slideImage}` : "";

                                if (i === cards.length - 1) {
                                    slideText = `${slideText}\n\n${ctaText}\n\n${hashtagsText}${slideImageSuffix}`.trim();
                                } else if (slideImage) {
                                    slideText = `${slideText}${slideImageSuffix}`.trim();
                                }
                                
                                await env.DB.prepare(
                                    `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, status, publish_at, trigger_type, trigger_threshold, parent_post_id, source_url, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, 'waiting_trigger', ?, ?, ?, ?, ?, (datetime('now')), (datetime('now')))`
                                ).bind(
                                    user.id,
                                    activeWorkspace.workspace_id,
                                    accountId,
                                    'threads',
                                    slideText,
                                    publishAt,
                                    triggerType,
                                    parseInt(triggerThreshold) || 100,
                                    parentId
                                ).run();
                            }
                        } else {
                            const imageSuffix = scrapedImage ? `\n\n📷 ${scrapedImage}` : "";
                            // Standard single post or non-conditional thread storm insertion
                            let fullContent = "";
                            if (postFormat === 'short_thread' || postFormat === 'deep_thread') {
                                if (cards.length > 0) {
                                    // Distribute scraped images across cards
                                    for (let i = 0; i < cards.length; i++) {
                                        let cardImage = null;
                                        if (i === cards.length - 1) {
                                            // Last slide image logic:
                                            // - Dual links (2+ images): use scrapedImages[1] (Link 2 image)
                                            // - Single Propmall/Mudah link: use scrapedImages[0] (proper listing photo)
                                            // - Single Telegram link: NO image (suppress owner's promo card)
                                            const isSingleTelegramLink = !mediaUrl && scrapedImages && scrapedImages.length === 1 && (url.includes('t.me') || url.includes('telegram.me') || url.includes('telesco.pe') || url.includes('nakcuba.my'));
                                            cardImage = (scrapedImages && scrapedImages.length > 1) ? scrapedImages[1] : (isSingleTelegramLink ? null : (scrapedImages && scrapedImages[0] ? scrapedImages[0] : null));
                                        } else if (i === 0) {
                                            cardImage = (!isProperty && scrapedImages && scrapedImages[0]) ? scrapedImages[0] : null;
                                        } else if (!isProperty) {
                                            cardImage = (scrapedImages && scrapedImages[i]) ? scrapedImages[i] : null;
                                        }
                                        
                                        const cardImageSuffix = cardImage ? `\n\n📷 ${cardImage}` : "";

                                        if (i === cards.length - 1) {
                                            cards[i] = `${cards[i]}\n\n${ctaText}\n\n${hashtagsText}${cardImageSuffix}`.trim();
                                        } else if (cardImage) {
                                            cards[i] = `${cards[i]}${cardImageSuffix}`.trim();
                                        }
                                    }
                                    fullContent = cards.join('\n---thread-separator---\n');
                                } else {
                                    fullContent = `${processedCaption}\n\n${ctaText}\n\n${hashtagsText}${imageSuffix}`.trim();
                                }
                            } else {
                                fullContent = `${processedCaption}\n\n${ctaText}\n\n${hashtagsText}${imageSuffix}`.trim();
                            }

                            await env.DB.prepare(
                                `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, status, publish_at, source_url, created_at, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, (datetime('now')), (datetime('now')))`
                            ).bind(
                                user.id,
                                activeWorkspace.workspace_id,
                                accountId,
                                'threads',
                                fullContent,
                                finalStatus,
                                publishAt,
                                url
                            ).run();
                        }

                        // Log AI generation usage for billing credits
                        await logActivity(
                            activeWorkspace.workspace_id,
                            user.id,
                            'ai_generate',
                            `Autoposter URL generation (model: ${modelUsed}): url=${(url || '').substring(0, 40)}`
                        );

                        return new Response(JSON.stringify({ success: true, status: finalStatus, publishAt, model_used: modelUsed }), { status: 200, headers: corsHeaders });
                    } catch (err) {
                        console.error("Autoposter direct endpoint failed:", err);
                        return new Response(JSON.stringify({ success: false, message: err.message }), { status: 200, headers: corsHeaders });
                    }
                }

                case '/api/ai/generate-threads-from-url': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot generate content.' }), { status: 403, headers: corsHeaders });

                    // Read workspace AI preferences from DB
                    const wsAI = await env.DB.prepare(
                        "SELECT ai_model, ai_api_key_enc, custom_ai_instructions FROM workspaces WHERE id = ?"
                    ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                    const plan = activeWorkspace.subscription_plan;
                    const maxCredits = PLANS[plan].ai_credits;

                    // Bypass monthly limits check if a workspace-specific API key is set, or if we are in local development
                    const hasCustomKey = !!(wsAI?.ai_api_key_enc);
                    const isDev = env.ENVIRONMENT === 'development';
                    let currentCreditsUsed = 0;

                    if (!hasCustomKey && !isDev) {
                        const startOfMonth = getBillingCycleStart(activeWorkspace.created_at);
                        const creditsRes = await env.DB.prepare(
                            "SELECT COUNT(*) as count FROM audit_logs WHERE workspace_id = ? AND action = 'ai_generate' AND created_at >= ?"
                        ).bind(activeWorkspace.workspace_id, startOfMonth).first();

                        currentCreditsUsed = creditsRes ? (creditsRes.count || 0) : 0;
                        if (currentCreditsUsed >= maxCredits) {
                            return new Response(JSON.stringify({ message: `AI credit limit reached: Your ${plan} plan allows up to ${maxCredits} AI generations per month. Please add your own API key in Settings to bypass this limit or upgrade your subscription.` }), { status: 403, headers: corsHeaders });
                        }
                    }

                    try {
                        const { url, scrapedTitle, scrapedDescription, tone, language } = await request.json();
                        if (!url || !scrapedTitle) {
                            return new Response(JSON.stringify({ message: 'URL and Title are required.' }), { status: 400, headers: corsHeaders });
                        }

                        const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                        let combinedInstructions = getFactPreservingInstructions(aiEnv.custom_ai_instructions || "");
                        const systemNicheRulesBlock = await getNicheInstructionsPrompt(env.DB, scrapedTitle + " " + (scrapedDescription || ""));
                        combinedInstructions = combinedInstructions 
                            ? `${combinedInstructions}\n\nSYSTEM NICHE GUIDELINES:\n${systemNicheRulesBlock}`
                            : systemNicheRulesBlock;
                        if (tone === 'Ultra-Realistic Malay') {
                            const toneRules = `\nTone: Ultra-Realistic Malaysian Malay.
CRITICAL TONE RULES:
- Write exactly like a real human writing a personal post on Threads, NOT like an AI assistant.
- Mix English and Malay naturally (Bahasa Rojak/Manglish). E.g. use terms like 'literally', 'our financial', 'time tu', 'which is', 'I mean'.
- Use repeated letters in words for emotional or casual emphasis (e.g. 'neverrrrr', 'sapaaaa', 'lajuuuuu'). Do NOT hardcode, anchor, or overuse specific slangs like 'weyh' or 'weh'.
- The opening hook MUST be a direct statement, reflection, or opinion (not a question like "Korang tahu tak..."). 
- Keep sentences short, conversational, and punchy.
- DO NOT use any emojis in the main hook caption. Avoid emoji spam entirely.`;
                            combinedInstructions = combinedInstructions ? `${combinedInstructions}\n${toneRules}` : toneRules;
                        }

                        const provider = AIFactory.getProvider(aiEnv);
                        const result = await provider.generateThreadStorm({
                            title: cleanScrapedTitle(scrapedTitle),
                            description: scrapedDescription || "",
                            url,
                            tone: tone || 'Friendly & Casual',
                            language: language || 'Bahasa Melayu',
                            customInstructions: combinedInstructions
                        });

                        await logActivity(activeWorkspace.workspace_id, user.id, 'ai_generate', `Generated thread storm from URL: ${url.substring(0, 30)}...`);

                        return new Response(JSON.stringify({
                            success: true,
                            result,
                            model_used: aiEnv.OPENROUTER_MODEL,
                            credits_remaining: maxCredits - currentCreditsUsed - 1
                        }), { status: 200, headers: corsHeaders });
                    } catch (e) {
                        return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                    }
                }

                case '/api/ai/quick-schedule': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot create content.' }), { status: 403, headers: corsHeaders });

                    // Read workspace AI preferences from DB
                    const wsAI = await env.DB.prepare(
                        "SELECT ai_model, ai_api_key_enc, custom_ai_instructions FROM workspaces WHERE id = ?"
                    ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                    const plan = activeWorkspace.subscription_plan;
                    const maxCredits = PLANS[plan].ai_credits;

                    const hasCustomKey = !!(wsAI?.ai_api_key_enc);
                    const isDev = env.ENVIRONMENT === 'development';
                    let currentCreditsUsed = 0;

                    if (!hasCustomKey && !isDev) {
                        const startOfMonth = getBillingCycleStart(activeWorkspace.created_at);
                        const creditsRes = await env.DB.prepare(
                            "SELECT COUNT(*) as count FROM audit_logs WHERE workspace_id = ? AND action = 'ai_generate' AND created_at >= ?"
                        ).bind(activeWorkspace.workspace_id, startOfMonth).first();

                        currentCreditsUsed = creditsRes ? (creditsRes.count || 0) : 0;
                        if (currentCreditsUsed >= maxCredits) {
                            return new Response(JSON.stringify({ message: `AI credit limit reached: Your ${plan} plan allows up to ${maxCredits} AI generations per month. Please add your own API key in Settings to bypass this limit or upgrade your subscription.` }), { status: 403, headers: corsHeaders });
                        }
                    }

                    try {
                        const { url, tone, language } = await request.json();
                        if (!url) {
                            return new Response(JSON.stringify({ message: 'URL is required.' }), { status: 400, headers: corsHeaders });
                        }

                        let title = "";
                        let description = "";
                        let pageText = "";
                        
                        // Helper: extract keywords from URL slug as fallback
                        const extractSlugKeywords = (rawUrl) => {
                            try {
                                const u = new URL(rawUrl);
                                const slug = (u.pathname + ' ' + u.search)
                                    .replace(/[-_/]/g, ' ')
                                    .replace(/\.htm.*$/i, '')
                                    .replace(/\d{5,}/g, '')
                                    .replace(/[^a-zA-Z ]/g, ' ')
                                    .replace(/\s+/g, ' ')
                                    .trim();
                                const words = slug.split(' ').filter(w => w.length > 2 && !['www','com','my','html','for','sale','buy','the','and','with'].includes(w.toLowerCase()));
                                return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            } catch (_) { return ''; }
                        };

                        try {
                            const finalUrl = url.trim();
                            const res = await fetch(finalUrl, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                    'Accept-Language': 'ms-MY,ms;q=0.9,en-MY;q=0.8,en;q=0.7',
                                    'Accept-Encoding': 'gzip, deflate, br',
                                    'Cache-Control': 'no-cache',
                                    'Referer': new URL(url.trim()).origin + '/',
                                    'Sec-Fetch-Mode': 'navigate',
                                    'Sec-Fetch-Site': 'none',
                                    'Sec-Fetch-Dest': 'document',
                                    'Upgrade-Insecure-Requests': '1'
                                },
                                redirect: 'follow'
                            });

                            if (res.ok) {
                                const html = await res.text();

                                 // Title extraction
                                 const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                                 if (titleMatch) title = titleMatch[1].trim();

                                 const metas = extractMetaTags(html);
                                 if (metas.title) title = metas.title;
                                 if (metas.description) description = metas.description;

                                // JSON-LD structured data extraction
                                if (!description || description.length < 50) {
                                    const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
                                    for (const match of jsonLdMatches) {
                                        try {
                                            const ld = JSON.parse(match[1]);
                                            const objs = Array.isArray(ld) ? ld : [ld];
                                            for (const obj of objs) {
                                                if (!title && obj.name) title = obj.name;
                                                if (!description && obj.description) description = obj.description.substring(0, 500);
                                                if (obj.address) {
                                                    const addr = typeof obj.address === 'string' ? obj.address : [obj.address.streetAddress, obj.address.addressLocality, obj.address.addressRegion].filter(Boolean).join(', ');
                                                    if (addr) description = (description || '') + ' Location: ' + addr;
                                                }
                                                if (description) break;
                                            }
                                        } catch (_) {}
                                        if (description) break;
                                    }
                                }

                                let bodyText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                                   .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                                   .replace(/<[^>]+>/g, ' ')
                                                   .replace(/\s+/g, ' ')
                                                   .trim();
                                pageText = bodyText.substring(0, 3000);
                            }
                        } catch (_) {
                            // Scrape failed — will fall through to URL slug fallback
                        }

                        // URL slug fallback: if scrape returned nothing useful, parse keywords from URL
                        if (!title || title.length < 5) {
                            title = extractSlugKeywords(url);
                        }

                        // Check block signatures
                        const decodeHtmlEntities = (str) => {
                            if (!str) return "";
                            return str.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
                                      .replace(/&quot;/g, '"')
                                      .replace(/&amp;/g, '&')
                                      .replace(/&lt;/g, '<')
                                      .replace(/&gt;/g, '>')
                                      .replace(/&nbsp;/g, ' ');
                        };

                        const decodedTitle = decodeHtmlEntities(title);
                        const decodedDesc = decodeHtmlEntities(description || pageText.substring(0, 500));
                        const lowerText = (decodedTitle + " " + decodedDesc).toLowerCase();
                        const isBlocked = !decodedTitle ||
                                          lowerText.includes("enable javascript") || 
                                          lowerText.includes("javascript is disabled") ||
                                          lowerText.includes("cloudflare") ||
                                          lowerText.includes("captcha") ||
                                          lowerText.includes("security check") ||
                                          lowerText.includes("access denied") ||
                                          lowerText.includes("robot") ||
                                          lowerText.includes("unsupported browser") ||
                                          (decodedTitle.includes("Shopee") && decodedDesc.includes("JavaScript"));

                        if (isBlocked) {
                            return new Response(JSON.stringify({
                                success: false,
                                is_blocked: true,
                                message: "Situs web menyekat bot automatik (bot protection). Sila isi nama & info produk secara manual."
                            }), { status: 200, headers: corsHeaders });
                        }

                        const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                        let combinedInstructions = aiEnv.custom_ai_instructions || "";
                        if (tone === 'Ultra-Realistic Malay') {
                            const toneRules = `\nTone: Ultra-Realistic Malaysian Malay.
CRITICAL TONE RULES:
- Write exactly like a real human writing a personal post on Threads, NOT like an AI assistant.
- Mix English and Malay naturally (Bahasa Rojak/Manglish). E.g. use terms like 'literally', 'our financial', 'time tu', 'which is', 'I mean'.
- Use repeated letters in words for emotional or casual emphasis (e.g. 'neverrrrr', 'sapaaaa', 'lajuuuuu'). Do NOT hardcode, anchor, or overuse specific slangs like 'weyh' or 'weh'.
- The opening hook MUST be a direct statement, reflection, or opinion (not a question like "Korang tahu tak...").
- Keep sentences short, conversational, and punchy.
- DO NOT use any emojis in the main hook caption. Avoid emoji spam entirely.`;
                            combinedInstructions = combinedInstructions ? `${combinedInstructions}\n${toneRules}` : toneRules;
                        }

                        // URL slug fallback for url-autoposter-direct: if description still empty after scrape
                        const extractSlugKeywordsQ = (rawUrl) => {
                            try {
                                const u = new URL(rawUrl);
                                const slug = (u.pathname + ' ' + u.search).replace(/[-_/]/g, ' ').replace(/\.htm.*$/i, '').replace(/\d{5,}/g, '').replace(/[^a-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
                                const words = slug.split(' ').filter(w => w.length > 2 && !['www','com','my','html','for','sale','buy','the','and','with'].includes(w.toLowerCase()));
                                return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            } catch (_) { return ''; }
                        };
                        if (!decodedTitle || decodedTitle.length < 5) {
                            const slugFallback = extractSlugKeywordsQ(url);
                            if (slugFallback) title = slugFallback;
                        }

                        const provider = AIFactory.getProvider(aiEnv);
                        const data = await provider.generateThreadStorm({
                            title: decodedTitle,
                            description: decodedDesc,
                            url,
                            tone: tone || 'Friendly & Casual',
                            language: language || 'Bahasa Melayu',
                            customInstructions: combinedInstructions
                        });

                        if (!data || !data.threads || data.threads.length === 0) {
                            throw new Error("AI failed to generate Thread Storm contents.");
                        }

                        const socialAccount = await env.DB.prepare(
                            "SELECT id FROM social_accounts WHERE workspace_id = ? AND platform = 'threads' AND status = 'active' LIMIT 1"
                        ).bind(activeWorkspace.workspace_id).first();

                        if (!socialAccount) {
                            return new Response(JSON.stringify({ message: 'No active Threads account connected in this workspace.' }), { status: 400, headers: corsHeaders });
                        }

                        let publishAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
                        const lastPost = await env.DB.prepare(
                            "SELECT publish_at FROM scheduled_posts WHERE workspace_id = ? AND status = 'scheduled' ORDER BY publish_at DESC LIMIT 1"
                        ).bind(activeWorkspace.workspace_id).first();

                        if (lastPost && lastPost.publish_at) {
                            const lastTime = new Date(lastPost.publish_at);
                            if (lastTime.getTime() > Date.now()) {
                                publishAt = new Date(lastTime.getTime() + 4 * 60 * 60 * 1000); // stagger by 4 hours
                            }
                        }

                        let fullContent = data.threads.join('\n\n---thread-separator---\n\n');
                        if (data.cta) {
                            fullContent += `\n\n${data.cta}`;
                        }
                        if (data.hashtags && data.hashtags.length > 0) {
                            const hashtagsStr = data.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
                            fullContent += `\n\n${hashtagsStr}`;
                        }

                        const publishTimeStr = publishAt.toISOString();
                        await env.DB.prepare(
                            `INSERT INTO scheduled_posts 
                             (user_id, account_id, platform, content, media_urls, status, publish_at, timezone, retry_count, workspace_id, created_at, updated_at) 
                             VALUES (?, ?, 'threads', ?, '[]', 'scheduled', ?, 'UTC', 0, ?, datetime('now'), datetime('now'))`
                        ).bind(user.id, socialAccount.id, fullContent, publishTimeStr, activeWorkspace.workspace_id).run();

                        await logActivity(activeWorkspace.workspace_id, user.id, 'quick_schedule', `Quick scheduled post from URL: ${url.substring(0, 30)}...`);

                        return new Response(JSON.stringify({
                            success: true,
                            message: 'Post successfully generated and scheduled!',
                            publish_at: publishTimeStr
                        }), { status: 200, headers: corsHeaders });

                    } catch (e) {
                        return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                    }
                }

                case '/api/ai/chat/history': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    const history = await env.DB.prepare(
                        `SELECT sender, message, created_at FROM agent_chat_history 
                         WHERE workspace_id = ? 
                         ORDER BY id ASC LIMIT 50`
                    ).bind(activeWorkspace.workspace_id).all();

                    return new Response(JSON.stringify({ success: true, history: history.results || [] }), { status: 200, headers: corsHeaders });
                }

                case '/api/ai/chat/send': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    const { message } = await request.json();
                    if (!message || !message.trim()) {
                        return new Response(JSON.stringify({ message: 'Message content is required' }), { status: 400, headers: corsHeaders });
                    }

                    // Save user message to database
                    await env.DB.prepare(
                        `INSERT INTO agent_chat_history (workspace_id, user_id, sender, message) VALUES (?, ?, 'user', ?)`
                    ).bind(activeWorkspace.workspace_id, user.id, message.trim()).run();

                    // Load last 10 messages for context
                    const dbHistory = await env.DB.prepare(
                        `SELECT sender, message FROM agent_chat_history 
                         WHERE workspace_id = ? 
                         ORDER BY id DESC LIMIT 10`
                    ).bind(activeWorkspace.workspace_id).all();

                    // Reverse to chronological order
                    const conversationHistory = (dbHistory.results || []).reverse();

                    // Retrieve workspace AI model & key preferences
                    const wsAI = await env.DB.prepare(
                        "SELECT ai_model, ai_api_key_enc FROM workspaces WHERE id = ?"
                    ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                    const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                    // Build messages array with system instructions
                    const systemInstructions = `You are 'SocialHub AI Agent', a helpful, professional, and friendly social media marketing assistant for this workspace. 
Your role is to help the user draft captions, plan social campaigns, suggest ideas, and organize their schedule.
Keep your answers clear, conversational, and concise (under 3 paragraphs if possible). 

CRITICAL LANGUAGE / SPEECH RULES:
1. When communicating in Malay, write in a very natural, friendly Malaysian conversational style (Bahasa Rojak / colloquial speech). E.g. use "je", "lah", "tau", "ni", "nak", "korang", "weyy". 
2. Do NOT use formal, Google-translate-style Malay. Do NOT sound robotic.
3. If the user asks for a caption or property post, ensure you follow appropriate niche guidelines (e.g. for properties, must include RM price, no agent phone numbers).`;

                    const messages = [
                        { role: 'system', content: systemInstructions }
                    ];

                    // Append historical messages (excluding the last one since we'll append it manually to ensure correct prompt)
                    const histToAppend = conversationHistory.slice(0, -1);
                    histToAppend.forEach(h => {
                        messages.push({
                            role: h.sender === 'user' ? 'user' : 'assistant',
                            content: h.message
                        });
                    });

                    // Add current prompt
                    messages.push({ role: 'user', content: message.trim() });

                    try {
                        const provider = AIFactory.getProvider(aiEnv);
                        const responseText = await provider.generateChatResponse(messages);

                        // Save agent message to database
                        await env.DB.prepare(
                            `INSERT INTO agent_chat_history (workspace_id, user_id, sender, message) VALUES (?, ?, 'agent', ?)`
                        ).bind(activeWorkspace.workspace_id, user.id, responseText.trim()).run();

                        // Log activity
                        await logActivity(activeWorkspace.workspace_id, user.id, 'ai_chat', `Chatted with AI Agent: ${message.trim().substring(0, 30)}...`);

                        return new Response(JSON.stringify({ success: true, message: responseText.trim() }), { status: 200, headers: corsHeaders });
                    } catch (chatError) {
                        console.error("AI Chat generation failed:", chatError);
                        const fallbackMsg = `Maaf sangat, ada ralat sambungan dengan model AI (${chatError.message}). Sila cuba sekali lagi sebentar saja.`;
                        
                        await env.DB.prepare(
                            `INSERT INTO agent_chat_history (workspace_id, user_id, sender, message) VALUES (?, ?, 'agent', ?)`
                        ).bind(activeWorkspace.workspace_id, user.id, fallbackMsg).run();

                        return new Response(JSON.stringify({ success: true, message: fallbackMsg }), { status: 200, headers: corsHeaders });
                    }
                }

                case '/api/ai/autopilot': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot create content.' }), { status: 403, headers: corsHeaders });

                    const { niche, targetAudience, platform, count, language, timezoneOffset, frequency, ctaLink, postFormat } = await request.json();
                    if (!niche) {
                        return new Response(JSON.stringify({ message: 'Business niche is required.' }), { status: 400, headers: corsHeaders });
                    }

                    const wsAI = await env.DB.prepare(
                        "SELECT ai_model, ai_api_key_enc FROM workspaces WHERE id = ?"
                    ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                    // Build env-like object overriding with workspace preferences
                    const aiEnv = await getAIEnvironment(env.DB, activeWorkspace.workspace_id, env, encryptionSecret);

                    try {
                        const provider = AIFactory.getProvider(aiEnv);
                        const autopilotService = new AutopilotService(provider);
                        const performanceFeedback = await getPerformanceFeedback(env.DB, activeWorkspace.workspace_id);
                        
                        const campaign = await autopilotService.generateAutopilotCampaign({
                            niche: niche + performanceFeedback,
                            targetAudience: targetAudience || 'General public',
                            platform: platform || 'threads',
                            count: parseInt(count) || 3,
                            language: language || 'Bahasa Melayu',
                            timezoneOffset: parseInt(timezoneOffset) || -480,
                            frequency: parseInt(frequency) || 1,
                            ctaLink,
                            postFormat
                        });

                        // Find connected account for this workspace & platform
                        const socialAccount = await env.DB.prepare(
                            "SELECT id FROM social_accounts WHERE workspace_id = ? AND platform = ? AND status = 'active' LIMIT 1"
                        ).bind(activeWorkspace.workspace_id, platform || 'threads').first();

                        const accountId = socialAccount ? socialAccount.id : null;
                        const finalStatus = accountId ? 'scheduled' : 'draft';

                        const dbInsert = env.DB.prepare(
                            `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, status, publish_at, created_at, updated_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, (datetime('now')), (datetime('now')))`
                        );

                        const insertedPosts = [];
                        for (const post of campaign) {
                            const result = await dbInsert.bind(
                                user.id,
                                activeWorkspace.workspace_id,
                                accountId,
                                platform || 'threads',
                                post.content,
                                finalStatus,
                                post.publish_at
                            ).run();
                            
                            // Log AI generation usage for billing credits
                            await logActivity(
                                activeWorkspace.workspace_id,
                                user.id,
                                'ai_generate',
                                `Autopilot campaign generation: platform=${platform || 'threads'}, niche=${(niche || '').substring(0, 30)}`
                            );
                            
                            insertedPosts.push({
                                id: result.meta?.last_row_id || null,
                                content: post.content,
                                publish_at: post.publish_at,
                                status: finalStatus
                            });
                        }
                        await createNotification(
                            env.DB,
                            activeWorkspace.workspace_id,
                            user.id,
                            "Kempen Autopilot Selesai 🤖",
                            `Sistem berjaya menjana & menjadualkan ${campaign.length} post baharu di platform ${(platform || 'threads').toUpperCase()} untuk niche "${niche.substring(0, 30)}...".`,
                            "success",
                            "/schedule.html"
                        );

                        await logActivity(
                            activeWorkspace.workspace_id,
                            user.id,
                            'ai_autopilot',
                            `Generated autopilot campaign: ${campaign.length} posts scheduled as ${finalStatus} for niche "${niche.substring(0, 30)}..."`
                        );

                        return new Response(JSON.stringify({
                            success: true,
                            posts: insertedPosts,
                            model_used: aiEnv.OPENROUTER_MODEL,
                            scheduled_count: campaign.length,
                            status: finalStatus
                        }), { status: 200, headers: corsHeaders });

                    } catch (e) {
                        return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                    }
                }

                case '/api/notifications': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT id, title, message, type, is_read, created_at, link 
                             FROM notifications 
                             WHERE workspace_id = ? 
                             ORDER BY created_at DESC LIMIT 20`
                        ).bind(activeWorkspace.workspace_id).all();

                        return new Response(JSON.stringify({ success: true, notifications: results || [] }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/notifications/read': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method === 'POST') {
                        let notificationId = null;
                        try {
                            const body = await request.json();
                            notificationId = body?.notification_id;
                        } catch (_) {}

                        if (notificationId) {
                            await env.DB.prepare(
                                "UPDATE notifications SET is_read = 1 WHERE id = ? AND workspace_id = ?"
                            ).bind(notificationId, activeWorkspace.workspace_id).run();
                        } else {
                            await env.DB.prepare(
                                "UPDATE notifications SET is_read = 1 WHERE workspace_id = ?"
                            ).bind(activeWorkspace.workspace_id).run();
                        }

                        return new Response(JSON.stringify({ success: true, message: "Notifications marked as read" }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/workspaces': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT w.id, w.uuid, w.name, w.slug, w.subscription_plan, w.subscription_status, m.role
                             FROM workspace_members m
                             JOIN workspaces w ON m.workspace_id = w.id
                             WHERE m.user_id = ?
                             ORDER BY w.id ASC`
                        ).bind(user.id).all();
                        return new Response(JSON.stringify({ success: true, workspaces: results }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        // Check if current workspace has a premium plan (pro, agency, enterprise)
                        if (!['pro', 'agency', 'enterprise'].includes(activeWorkspace.subscription_plan)) {
                            return new Response(JSON.stringify({ message: 'Upgrade to PRO plan to create multiple workspaces!' }), { status: 403, headers: corsHeaders });
                        }

                        const { name, slug } = await request.json();
                        if (!name || !name.trim()) return new Response(JSON.stringify({ message: 'Workspace name is required' }), { status: 400, headers: corsHeaders });
                        
                        const wsName = name.trim();
                        const wsSlug = slug ? slug.trim().toLowerCase() : `workspace-${Date.now()}`;

                        try {
                            const wsUuid = crypto.randomUUID();
                            const wsResult = await env.DB.prepare(
                                `INSERT INTO workspaces (uuid, name, slug, subscription_plan, subscription_status)
                                 VALUES (?, ?, ?, 'free', 'active')`
                            ).bind(wsUuid, wsName, wsSlug).run();
                            const newWsId = wsResult.meta.last_row_id;

                            // Add user as owner
                            await env.DB.prepare(
                                `INSERT INTO workspace_members (workspace_id, user_id, role)
                                 VALUES (?, ?, 'owner')`
                            ).bind(newWsId, user.id).run();

                            // Auto-switch to this workspace
                            await env.DB.prepare("UPDATE users SET active_workspace_id = ? WHERE id = ?").bind(newWsId, user.id).run();

                            await logActivity(newWsId, user.id, 'create_workspace', `Created workspace "${wsName}"`);

                            return new Response(JSON.stringify({ success: true, message: 'Workspace created and switched successfully!' }), { status: 201, headers: corsHeaders });
                        } catch (e) {
                            return new Response(JSON.stringify({ message: 'Slug already taken or creation failed' }), { status: 400, headers: corsHeaders });
                        }
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/workspaces/switch': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    const { workspace_id } = await request.json();
                    if (!workspace_id) return new Response(JSON.stringify({ message: 'Workspace ID is required' }), { status: 400, headers: corsHeaders });

                    // Verify membership
                    const member = await env.DB.prepare(
                        "SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?"
                    ).bind(workspace_id, user.id).first();

                    if (!member) {
                        return new Response(JSON.stringify({ message: 'Forbidden: You are not a member of this workspace' }), { status: 403, headers: corsHeaders });
                    }

                    await env.DB.prepare("UPDATE users SET active_workspace_id = ? WHERE id = ?").bind(workspace_id, user.id).run();
                    
                    return new Response(JSON.stringify({ success: true, message: 'Workspace switched successfully' }), { status: 200, headers: corsHeaders });
                }

                case '/api/workspaces/me': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) {
                        return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                    }

                    if (request.method === 'GET') {
                        const plan = activeWorkspace.subscription_plan;
                        const limits = PLANS[plan];
                        return new Response(JSON.stringify({
                            success: true,
                            workspace: activeWorkspace,
                            limits,
                            features: limits.features
                        }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'PUT') {
                        if (activeWorkspace.role !== 'owner') {
                            return new Response(JSON.stringify({ message: 'Forbidden: Only the workspace Owner can update details.' }), { status: 403, headers: corsHeaders });
                        }
                        const { name, slug, whatsapp_number } = await request.json();
                        if (!name || !slug) return new Response(JSON.stringify({ message: 'Name and slug are required' }), { status: 400, headers: corsHeaders });

                        try {
                            await env.DB.prepare(
                                "UPDATE workspaces SET name = ?, slug = ?, whatsapp_number = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(name.trim(), slug.trim().toLowerCase(), whatsapp_number ? whatsapp_number.trim() : null, activeWorkspace.workspace_id).run();

                            await logActivity(activeWorkspace.workspace_id, user.id, 'update_workspace', `Renamed workspace to "${name}" and updated settings`);
                            return new Response(JSON.stringify({ success: true, message: 'Workspace updated successfully' }), { status: 200, headers: corsHeaders });
                        } catch (e) {
                            return new Response(JSON.stringify({ message: 'Slug already taken or update failed' }), { status: 400, headers: corsHeaders });
                        }
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/workspaces/members': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (!['owner', 'admin'].includes(activeWorkspace.role)) {
                        return new Response(JSON.stringify({ message: 'Forbidden: Access restricted to Owner and Admin' }), { status: 403, headers: corsHeaders });
                    }

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT m.id, m.role, u.name, u.email, u.uuid 
                             FROM workspace_members m
                             JOIN users u ON m.user_id = u.id
                             WHERE m.workspace_id = ?`
                        ).bind(activeWorkspace.workspace_id).all();

                        return new Response(JSON.stringify({ success: true, members: results }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        const { email, role } = await request.json();
                        if (!email || !role) return new Response(JSON.stringify({ message: 'Email and role are required' }), { status: 400, headers: corsHeaders });

                        const targetUser = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email.toLowerCase().trim()).first();
                        if (!targetUser) return new Response(JSON.stringify({ message: 'User not found in SocialHub directory' }), { status: 404, headers: corsHeaders });

                        try {
                            await env.DB.prepare(
                                "INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)"
                            ).bind(activeWorkspace.workspace_id, targetUser.id, role).run();

                            await logActivity(activeWorkspace.workspace_id, user.id, 'add_member', `Added ${targetUser.name} (${email}) as ${role}`);
                            return new Response(JSON.stringify({ success: true, message: 'Member added successfully' }), { status: 201, headers: corsHeaders });
                        } catch (e) {
                            return new Response(JSON.stringify({ message: 'User is already a member of this workspace' }), { status: 400, headers: corsHeaders });
                        }
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/clients': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    const limits = PLANS[activeWorkspace.subscription_plan];
                    if (!limits.features.includes('clients')) {
                        return new Response(JSON.stringify({ message: 'Feature locked: Upgrade subscription plan to access Agency Clients management.' }), { status: 403, headers: corsHeaders });
                    }

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare("SELECT * FROM clients WHERE workspace_id = ?").bind(activeWorkspace.workspace_id).all();
                        return new Response(JSON.stringify({ success: true, clients: results }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden: Viewer cannot edit' }), { status: 403, headers: corsHeaders });
                        const { name, email } = await request.json();
                        if (!name) return new Response(JSON.stringify({ message: 'Client name is required' }), { status: 400, headers: corsHeaders });

                        const result = await env.DB.prepare(
                            "INSERT INTO clients (workspace_id, name, email) VALUES (?, ?, ?)"
                        ).bind(activeWorkspace.workspace_id, name.trim(), email ? email.trim() : null).run();

                        await logActivity(activeWorkspace.workspace_id, user.id, 'create_client', `Created client: ${name}`);
                        return new Response(JSON.stringify({ success: true, message: 'Client created successfully', id: result.meta.last_row_id }), { status: 201, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/audit-logs': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (!['owner', 'admin'].includes(activeWorkspace.role)) {
                        return new Response(JSON.stringify({ message: 'Forbidden: Audit logs restricted to Owner/Admin' }), { status: 403, headers: corsHeaders });
                    }

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT a.*, u.name as user_name, u.email as user_email 
                             FROM audit_logs a
                             LEFT JOIN users u ON a.user_id = u.id
                             WHERE a.workspace_id = ?
                             ORDER BY a.created_at DESC`
                        ).bind(activeWorkspace.workspace_id).all();

                        return new Response(JSON.stringify({ success: true, logs: results }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/subscriptions/create': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                    if (activeWorkspace.role !== 'owner') return new Response(JSON.stringify({ message: 'Forbidden: Only workspace Owner can change plans.' }), { status: 403, headers: corsHeaders });

                    if (request.method === 'POST') {
                        const { plan } = await request.json();
                        if (!PLANS[plan]) return new Response(JSON.stringify({ message: 'Invalid plan selected' }), { status: 400, headers: corsHeaders });

                        const subId = `billplz-sub-${crypto.randomUUID().substring(0, 8)}`;
                        await env.DB.prepare(
                            "UPDATE workspaces SET billplz_sub_id = ? WHERE id = ?"
                        ).bind(subId, activeWorkspace.workspace_id).run();

                        await logActivity(activeWorkspace.workspace_id, user.id, 'initiate_subscription', `Initiated subscription plan change to ${plan}`);
                        
                        const checkoutUrl = `https://socialhub.zaimrosli.my/billing-checkout-mock?sub_id=${subId}&plan=${plan}`;
                        return new Response(JSON.stringify({ success: true, checkout_url: checkoutUrl, sub_id: subId }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/integration/telegram/code': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    const code = Math.floor(100000 + Math.random() * 900000).toString();
                    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

                    await env.DB.prepare(
                        `INSERT OR REPLACE INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)`
                    ).bind(code, user.id, expiresAt).run();

                    const botUsername = env.TELEGRAM_BOT_USERNAME || "SocialHubRobot";

                    return new Response(JSON.stringify({
                        success: true,
                        code,
                        bot_username: botUsername,
                        link: `https://t.me/${botUsername}?start=${code}`
                    }), { status: 200, headers: corsHeaders });
                }

                case '/api/integration/telegram/debug-token': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    
                    const token = env.TELEGRAM_BOT_TOKEN || "";
                    let cleanToken = token.trim();
                    if (cleanToken.toLowerCase().startsWith('bot')) {
                        cleanToken = cleanToken.substring(3);
                    }

                    const getMeUrl = `https://api.telegram.org/bot${cleanToken}/getMe`;
                    const res = await fetch(getMeUrl);
                    const resJson = await res.json().catch(() => ({}));

                    return new Response(JSON.stringify({
                        success: true,
                        length: token.length,
                        starts_with_bot: token.toLowerCase().startsWith('bot'),
                        prefix: token.substring(0, 8),
                        suffix: token.substring(token.length - 8),
                        clean_prefix: cleanToken.substring(0, 8),
                        clean_suffix: cleanToken.substring(cleanToken.length - 8),
                        clean_length: cleanToken.length,
                        telegram_get_me: resJson
                    }), { status: 200, headers: corsHeaders });
                }

                case '/api/integration/telegram/status': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const connection = await env.DB.prepare(
                        `SELECT telegram_chat_id, created_at FROM user_telegram_connections WHERE user_id = ?`
                    ).bind(user.id).first().catch(() => null);

                    return new Response(JSON.stringify({
                        success: true,
                        connected: !!connection,
                        chat_id: connection?.telegram_chat_id || null,
                        created_at: connection?.created_at || null
                    }), { status: 200, headers: corsHeaders });
                }

                case '/api/integration/telegram/disconnect': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    await env.DB.prepare(
                        `DELETE FROM user_telegram_connections WHERE user_id = ?`
                    ).bind(user.id).run();

                    return new Response(JSON.stringify({ success: true, message: 'Disconnected successfully' }), { status: 200, headers: corsHeaders });
                }

                case '/api/webhooks/telegram': {
                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    try {
                        const payload = await request.json();
                        ctx.waitUntil(handleTelegramUpdate(payload, env, encryptionSecret, jwtSecret));
                        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
                    } catch (err) {
                        return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400, headers: corsHeaders });
                    }
                }

                case '/api/webhooks/billplz': {
                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    let payload = {};
                    try {
                        const contentType = request.headers.get('Content-Type') || '';
                        if (contentType.includes('application/json')) {
                            payload = await request.json();
                        } else {
                            const formData = await request.formData();
                            for (const [key, value] of formData.entries()) {
                                payload[key] = value;
                            }
                        }
                    } catch (e) {
                        return new Response(JSON.stringify({ error: 'Invalid payload request' }), { status: 400, headers: corsHeaders });
                    }

                    const subId = payload.sub_id || payload.id;
                    const plan = payload.plan || 'pro';
                    const status = payload.status === 'paid' || payload.status === 'active' ? 'active' : 'canceled';

                    if (subId) {
                        const workspace = await env.DB.prepare("SELECT id FROM workspaces WHERE billplz_sub_id = ?").bind(subId).first();
                        if (workspace) {
                            await env.DB.prepare(
                                `UPDATE workspaces 
                                 SET subscription_plan = ?, subscription_status = ?, updated_at = (datetime('now')) 
                                 WHERE id = ?`
                            ).bind(plan, status, workspace.id).run();

                            await logActivity(workspace.id, null, 'billplz_webhook', `Processed payment status callback: plan=${plan}, status=${status}`);
                            return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
                        }
                    }
                    return new Response(JSON.stringify({ error: 'Subscription ID not found' }), { status: 404, headers: corsHeaders });
                }

                // ==================== SCHEDULING & QUEUE ENGINE REST API ====================

                case '/api/queue': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    // 1. GET /api/queue - List queue timelines
                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT q.*, p.title, p.caption 
                             FROM publish_queue q 
                             JOIN posts p ON q.post_id = p.id 
                             WHERE p.workspace_id = ? 
                             ORDER BY q.scheduled_at ASC`
                        ).bind(activeWorkspace.workspace_id).all();

                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    // 2. POST /api/queue - Insert new schedule
                    if (request.method === 'POST') {
                        if (activeWorkspace.role === 'viewer') {
                            return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot create publications.' }), { status: 403, headers: corsHeaders });
                        }

                        const { post_id, platform, scheduled_at, timezone } = await request.json();

                        if (!post_id || !platform || !scheduled_at) {
                            return new Response(JSON.stringify({ message: 'Missing required parameters' }), { status: 400, headers: corsHeaders });
                        }

                        // Prevent duplicate active queue entries for the same post on the same platform
                        const duplicateCheck = await env.DB.prepare(
                            "SELECT id FROM publish_queue WHERE post_id = ? AND platform = ? AND status IN ('queued', 'retrying', 'publishing')"
                        ).bind(post_id, platform).first();

                        if (duplicateCheck) {
                            return new Response(JSON.stringify({ message: 'Post is already active in the queue for this platform' }), { status: 409, headers: corsHeaders });
                        }

                        const result = await env.DB.prepare(
                            `INSERT INTO publish_queue (post_id, user_id, platform, scheduled_at, timezone, status) 
                             VALUES (?, ?, ?, ?, ?, 'queued')`
                        ).bind(post_id, user.id, platform, scheduled_at, timezone || 'UTC').run();

                        // Set post status to 'scheduled' in posts table
                        await env.DB.prepare("UPDATE posts SET status = 'scheduled', scheduled_at = ? WHERE id = ?")
                            .bind(scheduled_at, post_id)
                            .run();

                        await logActivity(activeWorkspace.workspace_id, user.id, 'schedule_post', `Queued post ID ${post_id} for platform: ${platform}`);

                        return new Response(JSON.stringify({
                            success: true,
                            message: 'Post queued for scheduling successfully',
                            id: result.meta.last_row_id
                        }), { status: 201, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/queue/bulk-delete': {
                    if (request.method !== 'POST') {
                        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    }

                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (activeWorkspace.role === 'viewer') {
                        return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot cancel schedules.' }), { status: 403, headers: corsHeaders });
                    }

                    const { ids } = await request.json();
                    if (!ids || !Array.isArray(ids) || ids.length === 0) {
                        return new Response(JSON.stringify({ message: 'IDs array required' }), { status: 400, headers: corsHeaders });
                    }

                    // Bulk delete from queue and reset post status to draft if no other queues exist
                    for (const queueId of ids) {
                        const queueItem = await env.DB.prepare(
                            `SELECT q.post_id FROM publish_queue q 
                             JOIN posts p ON q.post_id = p.id 
                             WHERE q.id = ? AND p.workspace_id = ?`
                        ).bind(queueId, activeWorkspace.workspace_id).first();

                        if (queueItem) {
                            await env.DB.prepare("DELETE FROM publish_queue WHERE id = ?").bind(queueId).run();
                            
                            // Check if post has other scheduled items
                            const activeCount = await env.DB.prepare("SELECT COUNT(*) as count FROM publish_queue WHERE post_id = ? AND status IN ('queued', 'publishing', 'retrying')").bind(queueItem.post_id).first();
                            if (!activeCount || activeCount.count === 0) {
                                await env.DB.prepare("UPDATE posts SET status = 'draft', scheduled_at = NULL WHERE id = ?").bind(queueItem.post_id).run();
                            }
                        }
                    }

                    await logActivity(activeWorkspace.workspace_id, user.id, 'bulk_cancel_schedule', `Bulk cancelled ${ids.length} schedules.`);
                    return new Response(JSON.stringify({ success: true, message: 'Bulk schedules cancelled successfully' }), { status: 200, headers: corsHeaders });
                }

                // ==================== POSTS COMPOSER REST API ====================

                case '/api/posts': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare("SELECT id, user_id, title, caption, status, visibility, scheduled_at, published_at, created_at, updated_at FROM posts WHERE workspace_id = ? ORDER BY created_at DESC")
                            .bind(activeWorkspace.workspace_id)
                            .all();
                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        if (activeWorkspace.role === 'viewer') {
                            return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot create posts.' }), { status: 403, headers: corsHeaders });
                        }

                        const plan = activeWorkspace.subscription_plan;
                        const limit = PLANS[plan].posts;
                        const startOfMonth = getBillingCycleStart(activeWorkspace.created_at);
                        const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM posts WHERE workspace_id = ? AND created_at >= ?").bind(activeWorkspace.workspace_id, startOfMonth).first();
                        if (countRes && countRes.count >= limit) {
                            return new Response(JSON.stringify({ message: `Subscription limit reached: Maximum ${limit} posts per month allowed on ${plan} plan.` }), { status: 403, headers: corsHeaders });
                        }

                        const { title, caption, status, visibility, scheduled_at } = await request.json();

                        const result = await env.DB.prepare("INSERT INTO posts (user_id, workspace_id, title, caption, status, visibility, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
                            .bind(user.id, activeWorkspace.workspace_id, title || '', caption || '', status || 'draft', visibility || 'public', scheduled_at || null)
                            .run();

                        await logActivity(activeWorkspace.workspace_id, user.id, 'create_post', `Created post "${title || 'Untitled'}"`);

                        return new Response(JSON.stringify({
                            success: true,
                            message: 'Post created successfully',
                            id: result.meta.last_row_id
                        }), { status: 201, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                // ==================== REUSABLE SCHEDULER REST API ====================

                case '/api/scheduled-posts': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT sp.*, sa.account_name 
                             FROM scheduled_posts sp
                             LEFT JOIN social_accounts sa ON sp.account_id = sa.id
                             WHERE sp.workspace_id = ? 
                             ORDER BY sp.publish_at ASC`
                        ).bind(activeWorkspace.workspace_id).all();
                        
                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        if (activeWorkspace.role === 'viewer') {
                            return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot schedule posts.' }), { status: 403, headers: corsHeaders });
                        }

                        const plan = activeWorkspace.subscription_plan;
                        const limit = PLANS[plan].posts;
                        const startOfMonth = getBillingCycleStart(activeWorkspace.created_at);
                        const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM scheduled_posts WHERE workspace_id = ? AND created_at >= ?").bind(activeWorkspace.workspace_id, startOfMonth).first();
                        if (countRes && countRes.count >= limit) {
                            return new Response(JSON.stringify({ message: `Subscription limit reached: Maximum ${limit} posts per month allowed on ${plan} plan.` }), { status: 403, headers: corsHeaders });
                        }

                        const { title, content, targets, publish_at, timezone, triggerType, triggerThreshold } = await request.json();
                        
                        if (!content || !targets || !Array.isArray(targets) || targets.length === 0 || !publish_at) {
                            return new Response(JSON.stringify({ message: 'Missing required parameters' }), { status: 400, headers: corsHeaders });
                        }

                        let finalPublishAt = publish_at;
                        if (publish_at === 'auto') {
                            const lastPost = await env.DB.prepare(
                                "SELECT publish_at FROM scheduled_posts WHERE workspace_id = ? AND status IN ('scheduled', 'draft') ORDER BY publish_at DESC LIMIT 1"
                            ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                            let baseTime = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now
                            if (lastPost && lastPost.publish_at) {
                                const lastTime = new Date(lastPost.publish_at);
                                if (lastTime.getTime() > Date.now()) {
                                    baseTime = lastTime;
                                }
                            }
                            const publishAtDate = new Date(baseTime.getTime() + 15 * 60 * 1000); // 15 minutes stagger
                            finalPublishAt = publishAtDate.toISOString();
                        }

                        let finalContent = content;
                        try {
                            finalContent = await autoShortenTextLinks(env.DB, content, user.id, activeWorkspace.workspace_id);
                        } catch (e) {
                            console.error("Auto-shortener content replacement failed:", e);
                        }

                        const insertedIds = [];
                        const hasTrigger = triggerType === 'views' || triggerType === 'likes';
                        
                        for (const target of targets) {
                            const isThreads = target.platform === 'threads';
                            const cards = (isThreads && hasTrigger && (finalContent.includes('---thread-separator---') || finalContent.includes('[THREAD_DELIMITER]')))
                                ? finalContent.split(/[\n\r]*(?:---thread-separator---|\[THREAD_DELIMITER\])[\n\r]*/).map(c => c.trim()).filter(Boolean)
                                : [];

                            if (isThreads && hasTrigger && cards.length > 1) {
                                // 1. Insert Slide 1 (Parent)
                                const result = await env.DB.prepare(
                                    `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, media_urls, status, publish_at, timezone) 
                                     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
                                ).bind(
                                    user.id, 
                                    activeWorkspace.workspace_id,
                                    target.accountId || null, 
                                    target.platform, 
                                    cards[0], 
                                    JSON.stringify([]), 
                                    finalPublishAt, 
                                    timezone || 'UTC'
                                ).run();
                                
                                const parentId = result.meta.last_row_id;
                                insertedIds.push(parentId);

                                // 2. Insert child slides as waiting_trigger
                                for (let i = 1; i < cards.length; i++) {
                                    await env.DB.prepare(
                                        `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, media_urls, status, publish_at, timezone, trigger_type, trigger_threshold, parent_post_id) 
                                         VALUES (?, ?, ?, ?, ?, ?, 'waiting_trigger', ?, ?, ?, ?, ?)`
                                    ).bind(
                                        user.id,
                                        activeWorkspace.workspace_id,
                                        target.accountId || null,
                                        target.platform,
                                        cards[i],
                                        JSON.stringify([]),
                                        finalPublishAt,
                                        timezone || 'UTC',
                                        triggerType,
                                        parseInt(triggerThreshold) || 100,
                                        parentId
                                    ).run();
                                }
                            } else {
                                // Standard single post
                                const result = await env.DB.prepare(
                                    `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, media_urls, status, publish_at, timezone) 
                                     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
                                ).bind(
                                    user.id, 
                                    activeWorkspace.workspace_id,
                                    target.accountId || null, 
                                    target.platform, 
                                    finalContent, 
                                    JSON.stringify([]), 
                                    finalPublishAt, 
                                    timezone || 'UTC'
                                ).run();
                                
                                insertedIds.push(result.meta.last_row_id);
                            }
                        }

                        await logActivity(activeWorkspace.workspace_id, user.id, 'schedule_posts', `Scheduled ${targets.length} posts targets.`);

                        return new Response(JSON.stringify({
                            success: true,
                            message: 'Posts scheduled successfully',
                            ids: insertedIds
                        }), { status: 201, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/scheduled-posts/summary': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'GET') {
                        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    }

                    const now = new Date();
                    
                    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
                    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
                    
                    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
                    const endOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59, 999).toISOString();
                    
                    const endOf7Days = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999).toISOString();

                    const summary = {
                        scheduled: 0,
                        publishing: 0,
                        failed: 0,
                        upcoming_today: 0,
                        upcoming_tomorrow: 0,
                        next_7_days: 0,
                        published_today: 0
                    };

                    const counts = await env.DB.prepare(
                        `SELECT status, COUNT(*) as count FROM scheduled_posts WHERE workspace_id = ? GROUP BY status`
                    ).bind(activeWorkspace.workspace_id).all();

                    counts.results.forEach(row => {
                        if (row.status === 'scheduled') summary.scheduled = row.count;
                        if (row.status === 'publishing') summary.publishing = row.count;
                        if (row.status === 'failed') summary.failed = row.count;
                    });

                    const upcomingTodayRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE workspace_id = ? AND status = 'scheduled' AND publish_at >= ? AND publish_at <= ?`
                    ).bind(activeWorkspace.workspace_id, startOfToday, endOfToday).first();
                    summary.upcoming_today = upcomingTodayRes ? upcomingTodayRes.count : 0;

                    const upcomingTomorrowRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE workspace_id = ? AND status = 'scheduled' AND publish_at >= ? AND publish_at <= ?`
                    ).bind(activeWorkspace.workspace_id, startOfTomorrow, endOfTomorrow).first();
                    summary.upcoming_tomorrow = upcomingTomorrowRes ? upcomingTomorrowRes.count : 0;

                    const next7DaysRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE workspace_id = ? AND status = 'scheduled' AND publish_at >= ? AND publish_at <= ?`
                    ).bind(activeWorkspace.workspace_id, startOfToday, endOf7Days).first();
                    summary.next_7_days = next7DaysRes ? next7DaysRes.count : 0;

                    const publishedTodayRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE workspace_id = ? AND status = 'published' AND published_at >= ? AND published_at <= ?`
                    ).bind(activeWorkspace.workspace_id, startOfToday, endOfToday).first();
                    summary.published_today = publishedTodayRes ? publishedTodayRes.count : 0;

                    return new Response(JSON.stringify({ success: true, summary }), { status: 200, headers: corsHeaders });
                }

                case '/api/cron/sync': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method !== 'POST') {
                        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    }

                    try {
                        const nowStr = new Date().toISOString();
                        const jwtSecret = env.JWT_SECRET || "socialhub-dev-super-secret-key-12345!@#";
                        const encryptionSecret = env.ENCRYPTION_KEY || jwtSecret;

                        const duePosts = await env.DB.prepare(
                            `SELECT * FROM scheduled_posts 
                             WHERE status = 'scheduled' AND publish_at <= ? 
                             ORDER BY publish_at ASC 
                             LIMIT 20`
                        ).bind(nowStr).all();

                        let processedCount = 0;
                        let successCount = 0;

                        if (duePosts.results && duePosts.results.length > 0) {
                            for (const post of duePosts.results) {
                                processedCount++;
                                const lockResult = await env.DB.prepare(
                                    "UPDATE scheduled_posts SET status = 'publishing', updated_at = (datetime('now')) WHERE id = ? AND status = 'scheduled'"
                                ).bind(post.id).run();

                                if (lockResult.meta.changes !== 1) continue;

                                try {
                                    const socialAccount = await env.DB.prepare(
                                        "SELECT * FROM social_accounts WHERE id = ? AND user_id = ?"
                                    ).bind(post.account_id, post.user_id).first();

                                    if (!socialAccount) throw new Error('Social account not found');

                                    const decryptedAccessToken = await decryptToken(socialAccount.access_token, encryptionSecret);
                                    const credentials = { access_token: decryptedAccessToken, account_id: socialAccount.account_id };

                                    const publisher = PublisherFactory.getPublisher(post.platform);
                                    const postObj = { title: '', caption: post.content, media: [] };

                                    const result = await publisher.publish(postObj, credentials);

                                    if (result.success) {
                                        successCount++;
                                        const completedAt = new Date().toISOString();
                                        await env.DB.prepare(
                                            `UPDATE scheduled_posts 
                                             SET status = 'published', published_at = ?, external_post_id = ?, error_message = NULL, updated_at = (datetime('now'))
                                             WHERE id = ?`
                                        ).bind(completedAt, result.provider_post_id, post.id).run();

                                        await env.DB.prepare(
                                            `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
                                 VALUES (NULL, ?, 'success', NULL, ?, ?, ?)`
                                        ).bind(socialAccount.id, result.provider_post_id, JSON.stringify(result), completedAt).run();
                                    } else {
                                        throw new Error(result.error_message);
                                    }
                                } catch (err) {
                                    const newRetryCount = (post.retry_count || 0) + 1;
                                    if (newRetryCount >= 3) {
                                        await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', retry_count = ?, error_message = ?, updated_at = (datetime('now')) WHERE id = ?").bind(newRetryCount, err.message, post.id).run();
                                    } else {
                                        let delayMin = 5;
                                        if (newRetryCount === 2) delayMin = 15;
                                        const retryTime = new Date();
                                        retryTime.setMinutes(retryTime.getMinutes() + delayMin);
                                        await env.DB.prepare("UPDATE scheduled_posts SET status = 'scheduled', publish_at = ?, retry_count = ?, error_message = ?, updated_at = (datetime('now')) WHERE id = ?").bind(retryTime.toISOString(), newRetryCount, err.message, post.id).run();
                                    }

                                    await env.DB.prepare("INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, response_payload, published_at) VALUES (?, ?, 'failed', ?, ?, (datetime('now')))")
                                        .bind(post.account_id, err.message, JSON.stringify({ error: err.message }))
                                        .run();
                                }
                            }
                        }

                        // ==================== METRICS INSIGHTS SYNC LOOP ====================
                        const publishedPosts = await env.DB.prepare(
                            `SELECT sp.*, sa.access_token as sa_access_token, sa.account_id as sa_account_id
                             FROM scheduled_posts sp
                             JOIN social_accounts sa ON sp.account_id = sa.id
                             WHERE sp.status = 'published' AND sp.platform = 'threads' AND sp.external_post_id IS NOT NULL
                             AND (sp.last_insights_sync IS NULL OR sp.last_insights_sync <= ?)
                             ORDER BY sp.published_at DESC
                             LIMIT 10`
                        ).bind(new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()).all();

                        if (publishedPosts.results && publishedPosts.results.length > 0) {
                            for (const post of publishedPosts.results) {
                                try {
                                    const decryptedAccessToken = await decryptToken(post.sa_access_token, encryptionSecret);
                                    let views = 0;
                                    let likes = 0;
                                    let replies = 0;
                                    let reposts = 0;
                                    let quotes = 0;
                                    let shares = 0;

                                    if (decryptedAccessToken.includes('mock-threads-token') || env.ENVIRONMENT === 'development') {
                                        const hoursSincePublish = (Date.now() - new Date(post.published_at).getTime()) / (3600 * 1000);
                                        const baseMultiplier = Math.min(24, Math.max(1, hoursSincePublish));
                                        views = Math.floor(50 * baseMultiplier + Math.random() * 200);
                                        likes = Math.floor(views * (0.05 + Math.random() * 0.08));
                                        replies = Math.floor(likes * (0.05 + Math.random() * 0.1));
                                        reposts = Math.floor(likes * (0.02 + Math.random() * 0.05));
                                        quotes = Math.floor(likes * (0.01 + Math.random() * 0.03));
                                        shares = Math.floor(likes * (0.03 + Math.random() * 0.05));
                                    } else {
                                        // Threads API supported metrics: views, likes, replies, reposts, quotes, shares
                                        // NOTE: 'reach' is NOT a valid Threads API metric — use 'views' for impression data
                                        const insightsUrl = `https://graph.threads.net/v1.0/${post.external_post_id}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${decryptedAccessToken}`;
                                        const insightsRes = await fetch(insightsUrl);
                                        if (insightsRes.ok) {
                                            const data = await insightsRes.json();
                                            if (data && Array.isArray(data.data)) {
                                                views = data.data.find(m => m.name === 'views')?.values?.[0]?.value || 0;
                                                likes = data.data.find(m => m.name === 'likes')?.values?.[0]?.value || 0;
                                                replies = data.data.find(m => m.name === 'replies')?.values?.[0]?.value || 0;
                                                reposts = data.data.find(m => m.name === 'reposts')?.values?.[0]?.value || 0;
                                                quotes = data.data.find(m => m.name === 'quotes')?.values?.[0]?.value || 0;
                                                shares = data.data.find(m => m.name === 'shares')?.values?.[0]?.value || 0;
                                            }
                                        }
                                    }

                                    await env.DB.prepare(
                                        `UPDATE scheduled_posts 
                                         SET views_count = ?, likes_count = ?, replies_count = ?, reposts_count = ?, quotes_count = ?, shares_count = ?, last_insights_sync = ?, updated_at = (datetime('now'))
                                         WHERE id = ?`
                                    ).bind(views, likes, replies, reposts, quotes, shares, new Date().toISOString(), post.id).run();

                                    console.log(`[CronSync] Synced insights for post ID ${post.id}: views=${views}, likes=${likes}, reposts=${reposts}, quotes=${quotes}, shares=${shares}`);

                                    // Check if there are any child posts waiting for trigger from this parent
                                    const nextChild = await env.DB.prepare(
                                        `SELECT * FROM scheduled_posts 
                                         WHERE parent_post_id = ? AND status = 'waiting_trigger'
                                         ORDER BY id ASC LIMIT 1`
                                    ).bind(post.id).first().catch(() => null);

                                    if (nextChild) {
                                        const threshold = nextChild.trigger_threshold || 100;
                                        let isTriggered = false;
                                        if (nextChild.trigger_type === 'views' && views >= threshold) {
                                            isTriggered = true;
                                        } else if (nextChild.trigger_type === 'likes' && likes >= threshold) {
                                            isTriggered = true;
                                        }

                                        if (isTriggered) {
                                            const completedAt = new Date().toISOString();
                                            await env.DB.prepare(
                                                `UPDATE scheduled_posts 
                                                 SET status = 'scheduled', publish_at = ?, reply_to_external_id = ?, updated_at = (datetime('now'))
                                                 WHERE id = ?`
                                            ).bind(completedAt, post.external_post_id, nextChild.id).run();
                                            console.log(`[CronSync] Trigger met! Released child post ID ${nextChild.id} under parent ${post.id}: type=${nextChild.trigger_type}, val=${nextChild.trigger_type === 'views' ? views : likes} >= ${threshold}`);
                                        }
                                    }
                                } catch (insightErr) {
                                    console.error(`[CronSync] Failed to sync insights for post ${post.id}:`, insightErr.message);
                                }
                            }
                        }

                        // ==================== FOLLOWER COUNT SYNC (per workspace account) ====================
                        try {
                            const threadAccounts = await env.DB.prepare(
                                `SELECT DISTINCT sa.id as account_id, sa.access_token, sa.account_id as threads_user_id, sa.workspace_id
                                 FROM social_accounts sa
                                 WHERE sa.platform = 'threads' AND sa.access_token IS NOT NULL`
                            ).all();

                            if (threadAccounts.results && threadAccounts.results.length > 0) {
                                for (const acct of threadAccounts.results) {
                                    try {
                                        const decryptedToken = await decryptToken(acct.access_token, encryptionSecret);
                                        let followersCount = 0;

                                        if (decryptedToken.includes('mock-threads-token') || env.ENVIRONMENT === 'development') {
                                            // Mock: grow slowly over time
                                            const lastRow = await env.DB.prepare(
                                                `SELECT followers_count FROM workspace_analytics WHERE account_id = ? ORDER BY recorded_at DESC LIMIT 1`
                                            ).bind(acct.account_id).first().catch(() => null);
                                            followersCount = (lastRow?.followers_count || 100) + Math.floor(Math.random() * 5);
                                        } else {
                                            const insightsUrl = `https://graph.threads.net/v1.0/${acct.threads_user_id}/threads_insights?metric=followers_count&access_token=${decryptedToken}`;
                                            const insightsRes = await fetch(insightsUrl);
                                            if (insightsRes.ok) {
                                                const insightsData = await insightsRes.json();
                                                followersCount = insightsData.data?.[0]?.total_value?.value || 0;
                                            } else {
                                                const errText = await insightsRes.text().catch(() => '');
                                                console.error(`[CronSync] Followers API fail for ${acct.account_id}: ${insightsRes.status} - ${errText}`);
                                            }
                                        }

                                        await env.DB.prepare(
                                            `INSERT INTO workspace_analytics (workspace_id, account_id, platform, followers_count, recorded_at)
                                             VALUES (?, ?, 'threads', ?, datetime('now'))`
                                        ).bind(acct.workspace_id, acct.account_id, followersCount).run();

                                        console.log(`[CronSync] Follower count for account ${acct.account_id}: ${followersCount}`);
                                    } catch (followerErr) {
                                        console.error(`[CronSync] Failed to sync followers for account ${acct.account_id}:`, followerErr.message);
                                    }
                                }
                            }
                        } catch (followerSyncErr) {
                            console.error('[CronSync] Follower sync block error:', followerSyncErr.message);
                        }

                        return new Response(JSON.stringify({
                            success: true,
                            status: 'sync_completed',
                            processed: processedCount,
                            succeeded: successCount,
                            execution_id: `sync_${Date.now()}`
                        }), { status: 200, headers: corsHeaders });
                    } catch (err) {
                        return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500, headers: corsHeaders });
                    }
                }
                // ==================== ANALYTICS API ====================

                case '/api/analytics': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    try {
                        const days = parseInt(url.searchParams.get('days') || '30');
                        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
                        const wsId = activeWorkspace.workspace_id;

                        // ── 1. Summary totals ──
                        const totals = await env.DB.prepare(
                            `SELECT
                                COUNT(*) as total_posts,
                                COALESCE(SUM(views_count), 0) as total_views,
                                COALESCE(SUM(likes_count), 0) as total_likes,
                                COALESCE(SUM(replies_count), 0) as total_replies,
                                COALESCE(SUM(reposts_count), 0) as total_reposts,
                                COALESCE(SUM(quotes_count), 0) as total_quotes,
                                COALESCE(SUM(shares_count), 0) as total_shares
                             FROM scheduled_posts
                             WHERE workspace_id = ? AND status = 'published' AND published_at >= ?`
                        ).bind(wsId, since).first();

                        // Engagement rate = (likes + replies + reposts + quotes + shares) / views * 100
                        const engagements = (totals.total_likes + totals.total_replies + totals.total_reposts + totals.total_quotes + totals.total_shares);
                        const engagementRate = totals.total_views > 0
                            ? ((engagements / totals.total_views) * 100).toFixed(2)
                            : '0.00';

                        // ── 2. Previous period for delta comparison ──
                        const prevSince = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000).toISOString();
                        const prevTotals = await env.DB.prepare(
                            `SELECT
                                COALESCE(SUM(views_count), 0) as total_views,
                                COALESCE(SUM(shares_count), 0) as total_shares,
                                COALESCE(SUM(likes_count + replies_count + reposts_count + quotes_count), 0) as total_engagements
                             FROM scheduled_posts
                             WHERE workspace_id = ? AND status = 'published' AND published_at >= ? AND published_at < ?`
                        ).bind(wsId, prevSince, since).first();

                        // ── 3. Daily views + shares breakdown (for chart) ──
                        const daily = await env.DB.prepare(
                            `SELECT
                                DATE(published_at) as day,
                                COALESCE(SUM(views_count), 0) as views,
                                COALESCE(SUM(shares_count), 0) as shares,
                                COALESCE(SUM(likes_count), 0) as likes,
                                COALESCE(SUM(replies_count + reposts_count + quotes_count), 0) as other_engagements,
                                COUNT(*) as posts_count
                             FROM scheduled_posts
                             WHERE workspace_id = ? AND status = 'published' AND published_at >= ?
                             GROUP BY DATE(published_at)
                             ORDER BY day ASC`
                        ).bind(wsId, since).all();

                        // ── 4. Top posts by engagement score ──
                        const topPosts = await env.DB.prepare(
                            `SELECT id, content, published_at, platform,
                                views_count, likes_count, replies_count, reposts_count, quotes_count, shares_count,
                                (likes_count + replies_count * 2 + reposts_count + quotes_count + shares_count) as engagement_score
                             FROM scheduled_posts
                             WHERE workspace_id = ? AND status = 'published' AND views_count > 0
                             ORDER BY engagement_score DESC
                             LIMIT 10`
                        ).bind(wsId).all();

                        // ── 5. Follower growth trend ──
                        const followerHistory = await env.DB.prepare(
                            `SELECT DATE(recorded_at) as day, MAX(followers_count) as followers
                             FROM workspace_analytics
                             WHERE workspace_id = ? AND recorded_at >= ?
                             GROUP BY DATE(recorded_at)
                             ORDER BY day ASC`
                        ).bind(wsId, since).all();

                        // Latest follower count
                        const latestFollowers = await env.DB.prepare(
                            `SELECT followers_count FROM workspace_analytics
                             WHERE workspace_id = ? ORDER BY recorded_at DESC LIMIT 1`
                        ).bind(wsId).first().catch(() => null);

                        return new Response(JSON.stringify({
                            success: true,
                            period_days: days,
                            summary: {
                                total_posts: totals.total_posts || 0,
                                total_views: totals.total_views || 0,
                                total_shares: totals.total_shares || 0,
                                total_likes: totals.total_likes || 0,
                                total_replies: totals.total_replies || 0,
                                total_reposts: totals.total_reposts || 0,
                                total_quotes: totals.total_quotes || 0,
                                engagement_rate: engagementRate,
                                followers_count: latestFollowers?.followers_count || 0,
                                prev_views: prevTotals?.total_views || 0,
                                prev_shares: prevTotals?.total_shares || 0,
                                prev_engagements: prevTotals?.total_engagements || 0,
                            },
                            daily: daily.results || [],
                            top_posts: topPosts.results || [],
                            follower_history: followerHistory.results || [],
                        }), { status: 200, headers: corsHeaders });

                    } catch (err) {
                        console.error('[Analytics] Error:', err.message);
                        return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500, headers: corsHeaders });
                    }
                }

                // ==================== MEDIA LIBRARY REST API ====================

                case '/api/media': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare("SELECT * FROM media WHERE workspace_id = ? ORDER BY created_at DESC")
                            .bind(activeWorkspace.workspace_id)
                            .all();
                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/media/upload': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (activeWorkspace.role === 'viewer') {
                        return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot upload media.' }), { status: 403, headers: corsHeaders });
                    }

                    const formData = await request.formData();
                    const file = formData.get('file');
                    const width = parseInt(formData.get('width')) || null;
                    const height = parseInt(formData.get('height')) || null;

                    if (!file) return new Response(JSON.stringify({ message: 'No file uploaded' }), { status: 400, headers: corsHeaders });

                    const originalName = file.name;
                    const mimeType = file.type;
                    const fileSize = file.size;
                    const filename = sanitizeFilename(originalName);

                    const plan = activeWorkspace.subscription_plan;
                    const limits = PLANS[plan];
                    const sizeRes = await env.DB.prepare("SELECT SUM(file_size) as total FROM media WHERE workspace_id = ?").bind(activeWorkspace.workspace_id).first();
                    const currentTotal = sizeRes ? (sizeRes.total || 0) : 0;
                    if ((currentTotal + fileSize) > limits.storage) {
                        return new Response(JSON.stringify({ message: "Subscription limit reached: Storage capacity exceeded." }), { status: 403, headers: corsHeaders });
                    }

                    const buffer = await file.arrayBuffer();
                    const base64Str = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                    const dataUrl = `data:${mimeType};base64,${base64Str}`;

                    const result = await env.DB.prepare("INSERT INTO media (user_id, workspace_id, filename, original_name, mime_type, file_size, width, height, storage_provider, storage_key, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)")
                        .bind(user.id, activeWorkspace.workspace_id, filename, originalName, mimeType, fileSize, width, height, dataUrl, dataUrl)
                        .run();

                    const newMediaId = result.meta.last_row_id;
                    const uploadedRecord = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(newMediaId).first();

                    await logActivity(activeWorkspace.workspace_id, user.id, 'upload_media', `Uploaded file: ${filename} (${fileSize} bytes)`);

                    return new Response(JSON.stringify({ success: true, message: 'Uploaded successfully', media: uploadedRecord }), { status: 201, headers: corsHeaders });
                }

                // ==================== OAUTH FLOWS ====================

                case '/api/oauth/connect': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                    if (!['owner', 'admin'].includes(activeWorkspace.role)) {
                        return new Response(JSON.stringify({ message: 'Forbidden: Only Admin/Owner can connect social accounts.' }), { status: 403, headers: corsHeaders });
                    }

                    const platform = url.searchParams.get('platform');
                    const provider = OAuthProviders[platform];
                    if (!provider) return new Response(JSON.stringify({ message: `Platform '${platform}' not supported` }), { status: 400, headers: corsHeaders });

                    const clientIdKey = `${platform.toUpperCase()}_CLIENT_ID`;
                    let clientId = env[clientIdKey];
                    if (!clientId) {
                        if (env.ENVIRONMENT === 'development') {
                            clientId = "mock-client-id-123456";
                        } else {
                            return new Response(JSON.stringify({ error: `Environment variable '${clientIdKey}' is missing or not configured on Cloudflare.` }), { status: 500, headers: corsHeaders });
                        }
                    }

                    const stateToken = await signJWT({ sub: user.uuid, platform, exp: Math.floor(Date.now() / 1000) + 600 }, jwtSecret);
                    const redirectUri = platform === 'threads'
                        ? 'https://api.socialhub.zaimrosli.my/oauth/threads/callback'
                        : `${url.origin}/api/oauth/callback`;

                    const authUrl = provider.getAuthUrl(stateToken, redirectUri, clientId);
                    
                    if (platform === 'threads') {
                        console.log('📢 Threads OAuth Debug Log:');
                        console.log({
                            authorizeUrl: authUrl,
                            client_id: clientId,
                            redirect_uri: redirectUri,
                            scope: 'threads_basic,threads_content_publish,threads_manage_insights',
                            response_type: 'code',
                            state: stateToken
                        });
                    }

                    return new Response(JSON.stringify({ success: true, redirect_url: authUrl }), { status: 200, headers: corsHeaders });
                }

                case '/oauth/threads/callback':
                case '/api/oauth/callback': {
                    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

                    const code = url.searchParams.get('code');
                    const state = url.searchParams.get('state');
                    const frontendOrigin = env.FRONTEND_ORIGIN || "http://localhost:5173";

                    // Handle OAuth error or cancellation from Meta/Threads
                    const oauthError = url.searchParams.get('error') || url.searchParams.get('error_reason');
                    if (oauthError || !code) {
                        const errorDesc = url.searchParams.get('error_description') || oauthError || 'auth_cancelled';
                        return Response.redirect(`${frontendOrigin}/accounts.html?error=${encodeURIComponent(errorDesc)}`, 302);
                    }

                    if (!state) return Response.redirect(`${frontendOrigin}/accounts.html?error=state_missing`, 302);

                    const statePayload = await verifyJWT(state, jwtSecret);
                    if (!statePayload || !statePayload.sub || !statePayload.platform) return Response.redirect(`${frontendOrigin}/accounts.html?error=invalid_state`, 302);

                    const userUuid = statePayload.sub;
                    const platform = statePayload.platform;
                    const provider = OAuthProviders[platform];
                    if (!provider) return Response.redirect(`${frontendOrigin}/accounts.html?error=provider_missing`, 302);
                    if (!env.DB) return Response.redirect(`${frontendOrigin}/accounts.html?error=db_missing`, 302);

                    const user = await env.DB.prepare("SELECT id, active_workspace_id FROM users WHERE uuid = ?").bind(userUuid).first();
                    if (!user) return Response.redirect(`${frontendOrigin}/accounts.html?error=user_not_found`, 302);

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return Response.redirect(`${frontendOrigin}/accounts.html?error=no_workspace`, 302);
                    if (!['owner', 'admin'].includes(activeWorkspace.role)) return Response.redirect(`${frontendOrigin}/accounts.html?error=forbidden`, 302);

                    const plan = activeWorkspace.subscription_plan;
                    const limits = PLANS[plan];
                    const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM social_accounts WHERE workspace_id = ?").bind(activeWorkspace.workspace_id).first();
                    const existingAccountCheck = await env.DB.prepare("SELECT id FROM social_accounts WHERE workspace_id = ? AND platform = ?").bind(activeWorkspace.workspace_id, platform).first();
                    
                    if (!existingAccountCheck && countRes && countRes.count >= limits.accounts) {
                        return Response.redirect(`${frontendOrigin}/accounts.html?error=limit_exceeded`, 302);
                    }

                    const clientIdKey = `${platform.toUpperCase()}_CLIENT_ID`;
                    const clientSecretKey = `${platform.toUpperCase()}_CLIENT_SECRET`;
                    let clientId = env[clientIdKey];
                    let clientSecret = env[clientSecretKey];

                    if (!clientId || !clientSecret) {
                        if (env.ENVIRONMENT === 'development' || (code && code.includes("mock"))) {
                            clientId = "mock-client-id-123456";
                            clientSecret = "mock-client-secret-123456";
                        } else {
                            return new Response(`OAuth Configuration Error: Missing '${clientIdKey}' or '${clientSecretKey}' environment variables on Cloudflare.`, { status: 500 });
                        }
                    }

                    const redirectUri = platform === 'threads'
                        ? 'https://api.socialhub.zaimrosli.my/oauth/threads/callback'
                        : `${url.origin}/api/oauth/callback`;

                    let tokenData;
                    try {
                        tokenData = await provider.exchangeCode(code, redirectUri, clientId, clientSecret);
                    } catch (err) {
                        return new Response(`Exchange failed: ${err.message}`, { status: 400 });
                    }

                    const encryptedAccessToken = await encryptToken(tokenData.access_token, encryptionSecret);
                    const encryptedRefreshToken = await encryptToken(tokenData.refresh_token, encryptionSecret);
                    const expiresAt = tokenData.expires_in ? new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString() : null;
                    const nowStr = new Date().toISOString();

                    // Determine account status: 'disconnected' means FB user token stored but page not yet selected
                    const accountStatus = tokenData.needsPageSelection ? 'disconnected' : 'active';

                    const existingAccount = await env.DB.prepare("SELECT id FROM social_accounts WHERE workspace_id = ? AND platform = ? AND account_id = ?")
                        .bind(activeWorkspace.workspace_id, platform, tokenData.account_id)
                        .first();

                    let savedAccountId;
                    if (existingAccount) {
                        await env.DB.prepare(`UPDATE social_accounts SET account_name = ?, access_token = ?, refresh_token = ?, expires_at = ?, status = ?, updated_at = ? WHERE id = ?`)
                            .bind(tokenData.account_name, encryptedAccessToken, encryptedRefreshToken, expiresAt, accountStatus, nowStr, existingAccount.id)
                            .run();
                        savedAccountId = existingAccount.id;
                    } else {
                        const insertResult = await env.DB.prepare(`INSERT INTO social_accounts (user_id, workspace_id, platform, account_name, account_id, access_token, refresh_token, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                            .bind(user.id, activeWorkspace.workspace_id, platform, tokenData.account_name, tokenData.account_id, encryptedAccessToken, encryptedRefreshToken, expiresAt, accountStatus)
                            .run();
                        savedAccountId = insertResult.meta.last_row_id;
                    }

                    await logActivity(activeWorkspace.workspace_id, user.id, 'connect_account', `Connected ${platform} account: ${tokenData.account_name}`);
                    
                    if (platform === 'threads') {
                        ctx.waitUntil(syncHistoricalThreadsPosts(env, user.id, activeWorkspace.workspace_id, savedAccountId, tokenData.access_token, tokenData.account_id));
                    }

                    // If Facebook needs page selection, redirect to the page picker UI
                    if (tokenData.needsPageSelection) {
                        return Response.redirect(`${frontendOrigin}/accounts.html?fb_pending=${savedAccountId}`, 302);
                    }

                    return Response.redirect(`${frontendOrigin}/accounts.html?success=true`, 302);
                }

                case '/api/debug-fb': {
                    const fbAcc = await env.DB.prepare("SELECT * FROM social_accounts WHERE platform = 'facebook'").first();
                    if (!fbAcc) return new Response('No Facebook account found', { status: 404, headers: corsHeaders });

                    const decrypted = await decryptToken(fbAcc.access_token, encryptionSecret);
                    
                    // Fetch permissions
                    const permRes = await fetch(`https://graph.facebook.com/v18.0/me/permissions?access_token=${decrypted}`);
                    const permissions = await permRes.json();

                    // Fetch accounts
                    const pageRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${decrypted}`);
                    const accounts = await pageRes.json();

                    return new Response(JSON.stringify({
                        success: true,
                        permissions,
                        accounts
                    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
                }

                // ── Temp: Update Facebook Page Access Token manually ──
                case '/api/update-fb-token': {
                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                    if (!['owner', 'admin'].includes(activeWorkspace.role)) {
                        return new Response(JSON.stringify({ message: 'Forbidden: Only Admin/Owner can update tokens.' }), { status: 403, headers: corsHeaders });
                    }

                    const { page_access_token, page_id, account_id } = await request.json();
                    if (!page_access_token) {
                        return new Response(JSON.stringify({ message: 'page_access_token is required' }), { status: 400, headers: corsHeaders });
                    }

                    // Validate the token against Facebook's debug endpoint
                    const debugRes = await fetch(`https://graph.facebook.com/v18.0/debug_token?input_token=${page_access_token}&access_token=${page_access_token}`);
                    const debugData = await debugRes.json();

                    // Also get page name
                    const meRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${page_access_token}`);
                    const meData = await meRes.json();
                    if (meData.error) {
                        return new Response(JSON.stringify({ 
                            success: false, 
                            message: `Token validation failed: ${meData.error.message}` 
                        }), { status: 400, headers: corsHeaders });
                    }

                    const actualPageId = page_id || meData.id;
                    const pageName = meData.name ? `${meData.name} (FB Page)` : `Page ${actualPageId} (FB Page)`;

                    // Encrypt the token
                    const encryptedToken = await encryptToken(page_access_token, encryptionSecret);

                    // Update or insert into social_accounts
                    const lookupId = account_id || null;
                    let targetRow = null;
                    if (lookupId) {
                        targetRow = await env.DB.prepare("SELECT id FROM social_accounts WHERE id = ? AND workspace_id = ?").bind(lookupId, activeWorkspace.workspace_id).first();
                    }
                    if (!targetRow) {
                        // Find existing Facebook account for this workspace
                        targetRow = await env.DB.prepare("SELECT id FROM social_accounts WHERE workspace_id = ? AND platform = 'facebook' AND account_id = ?").bind(activeWorkspace.workspace_id, actualPageId).first();
                    }

                    const nowStr = new Date().toISOString();
                    if (targetRow) {
                        await env.DB.prepare(
                            "UPDATE social_accounts SET access_token = ?, account_name = ?, account_id = ?, expires_at = NULL, status = 'active', updated_at = ? WHERE id = ?"
                        ).bind(encryptedToken, pageName, actualPageId, nowStr, targetRow.id).run();
                    } else {
                        await env.DB.prepare(
                            "INSERT INTO social_accounts (user_id, workspace_id, platform, account_name, account_id, access_token, refresh_token, expires_at, status) VALUES (?, ?, 'facebook', ?, ?, ?, NULL, NULL, 'active')"
                        ).bind(user.id, activeWorkspace.workspace_id, pageName, actualPageId, encryptedToken).run();
                    }

                    await logActivity(activeWorkspace.workspace_id, user.id, 'update_fb_token', `Manually updated Facebook Page Access Token for page: ${pageName}`);

                    return new Response(JSON.stringify({
                        success: true,
                        message: 'Facebook Page Access Token updated successfully!',
                        page_name: pageName,
                        page_id: actualPageId,
                        debug_info: debugData.data || {}
                    }), { status: 200, headers: corsHeaders });
                }

                // ==================== SOCIAL CHANNELS REST API ====================

                case '/api/social/accounts': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    const { results } = await env.DB.prepare("SELECT id, platform, account_name, account_id, expires_at, status, created_at FROM social_accounts WHERE workspace_id = ?").bind(activeWorkspace.workspace_id).all();
                    return new Response(JSON.stringify({ success: true, accounts: results }), { status: 200, headers: corsHeaders });
                }

                case '/api/system/test-threads': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'DB missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace' }), { status: 404, headers: corsHeaders });

                    const threadsAccount = await env.DB.prepare(
                        "SELECT * FROM social_accounts WHERE workspace_id = ? AND platform = 'threads' LIMIT 1"
                    ).bind(activeWorkspace.workspace_id).first();

                    if (!threadsAccount) {
                        return new Response(JSON.stringify({ success: false, message: "No Threads account connected in this workspace." }), { status: 400, headers: corsHeaders });
                    }

                    const decryptedToken = await decryptToken(threadsAccount.access_token, encryptionSecret);
                    if (!decryptedToken) {
                        return new Response(JSON.stringify({ success: false, message: "Failed to decrypt Threads token." }), { status: 500, headers: corsHeaders });
                    }

                    // 1. Fetch profile info
                    const profileRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username,threads_profile_picture_url&access_token=${decryptedToken}`);
                    const profileStatus = profileRes.status;
                    const profileData = await profileRes.json().catch(() => ({}));

                    // 2. Try creating container
                    const containerRes = await fetch(`https://graph.threads.net/v1.0/${threadsAccount.account_id}/threads?media_type=TEXT&text=test_connection&access_token=${decryptedToken}`, {
                        method: 'POST'
                    });
                    const containerStatus = containerRes.status;
                    const containerData = await containerRes.json().catch(() => ({}));

                    return new Response(JSON.stringify({
                        success: true,
                        account_name: threadsAccount.account_name,
                        account_id: threadsAccount.account_id,
                        token_preview: decryptedToken.substring(0, 15) + "..." + decryptedToken.substring(decryptedToken.length - 15),
                        profile_api: {
                            status: profileStatus,
                            data: profileData
                        },
                        container_api: {
                            status: containerStatus,
                            data: containerData
                        }
                    }), { status: 200, headers: corsHeaders });
                }

                case '/api/system/debug-report': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'DB missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace' }), { status: 404, headers: corsHeaders });

                    // 1. Gather social accounts status (without sensitive token values)
                    const accountsRes = await env.DB.prepare(
                        "SELECT id, platform, account_name, account_id, expires_at, status, created_at FROM social_accounts WHERE workspace_id = ?"
                    ).bind(activeWorkspace.workspace_id).all();

                    // 2. Fetch last 15 failed publish logs (including timeouts from scheduled_posts)
                    const publishLogsRes = await env.DB.prepare(`
                        SELECT pl.id, pl.status, pl.error_message, pl.published_at, sa.platform, sa.account_name
                        FROM publish_logs pl
                        JOIN social_accounts sa ON pl.social_account_id = sa.id
                        WHERE sa.workspace_id = ? AND pl.status = 'failed'
                        UNION ALL
                        SELECT sp.id, sp.status, sp.error_message, sp.publish_at as published_at, sp.platform, sa.account_name
                        FROM scheduled_posts sp
                        JOIN social_accounts sa ON sp.account_id = sa.id
                        WHERE sa.workspace_id = ? AND sp.status = 'failed'
                        ORDER BY published_at DESC LIMIT 15
                    `).bind(activeWorkspace.workspace_id, activeWorkspace.workspace_id).all();

                    // 3. Fetch last 15 audit logs
                    const auditLogsRes = await env.DB.prepare(`
                        SELECT id, action, details, created_at
                        FROM audit_logs
                        WHERE workspace_id = ?
                        ORDER BY created_at DESC LIMIT 15
                    `).bind(activeWorkspace.workspace_id).all();

                    // 4. Compile metadata
                    const report = {
                        timestamp: new Date().toISOString(),
                        app: 'SocialHub SaaS',
                        environment: env.ENVIRONMENT || 'production',
                        system_time: new Date().toString(),
                        workspace: {
                            id: activeWorkspace.workspace_id,
                            name: activeWorkspace.workspace_name,
                            plan: activeWorkspace.subscription_plan,
                            role: activeWorkspace.role
                        },
                        user: {
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role
                        },
                        connected_channels: (accountsRes.results || []).map(acc => ({
                            id: acc.id,
                            platform: acc.platform,
                            name: acc.account_name,
                            account_id: acc.account_id,
                            status: acc.status,
                            created_at: acc.created_at,
                            expires_at: acc.expires_at,
                            has_expires: !!acc.expires_at,
                            is_expired: acc.expires_at ? (new Date(acc.expires_at) < new Date()) : false
                        })),
                        failed_publish_logs: publishLogsRes.results || [],
                        audit_logs: auditLogsRes.results || []
                    };

                    return new Response(JSON.stringify({ success: true, report }), { status: 200, headers: corsHeaders });
                }

                // ==================== FACEBOOK PAGE SELECTION ====================

                case '/api/social/facebook/pages': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'DB missing' }), { status: 500, headers: corsHeaders });

                    const accountId = parseInt(url.searchParams.get('account_id'));
                    if (!accountId) return new Response(JSON.stringify({ message: 'account_id required' }), { status: 400, headers: corsHeaders });

                    const account = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ? AND user_id = ?").bind(accountId, user.id).first();
                    if (!account) return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: corsHeaders });

                    const userToken = await decryptToken(account.access_token, encryptionSecret);
                    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userToken}&fields=id,name,category,fan_count`);
                    if (!pagesRes.ok) {
                        const err = await pagesRes.json().catch(() => ({}));
                        return new Response(JSON.stringify({ success: false, message: err.error?.message || 'Failed to fetch pages from Facebook' }), { status: 400, headers: corsHeaders });
                    }
                    const pagesData = await pagesRes.json();
                    return new Response(JSON.stringify({ success: true, pages: pagesData.data || [] }), { status: 200, headers: corsHeaders });
                }

                case '/api/social/facebook/select-page': {
                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'DB missing' }), { status: 500, headers: corsHeaders });

                    const { account_id: acctId, page_id } = await request.json();
                    if (!acctId || !page_id) return new Response(JSON.stringify({ message: 'account_id and page_id required' }), { status: 400, headers: corsHeaders });

                    const account = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ? AND user_id = ?").bind(acctId, user.id).first();
                    if (!account) return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: corsHeaders });

                    const userToken = await decryptToken(account.access_token, encryptionSecret);

                    // Fetch pages with their permanent access tokens
                    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userToken}&fields=id,name,access_token`);
                    if (!pagesRes.ok) {
                        return new Response(JSON.stringify({ success: false, message: 'Failed to fetch pages from Facebook' }), { status: 400, headers: corsHeaders });
                    }
                    const pagesData = await pagesRes.json();
                    const selectedPage = (pagesData.data || []).find(p => p.id === page_id);
                    if (!selectedPage) {
                        return new Response(JSON.stringify({ success: false, message: `Page ID ${page_id} not found in your managed pages.` }), { status: 404, headers: corsHeaders });
                    }

                    // Save the permanent Page Access Token
                    const encryptedPageToken = await encryptToken(selectedPage.access_token, encryptionSecret);
                    const nowStr2 = new Date().toISOString();
                    await env.DB.prepare(
                        "UPDATE social_accounts SET access_token = ?, account_name = ?, account_id = ?, status = 'active', expires_at = NULL, updated_at = ? WHERE id = ?"
                    ).bind(encryptedPageToken, `${selectedPage.name} (FB Page)`, selectedPage.id, nowStr2, acctId).run();

                    await logActivity(account.workspace_id, user.id, 'fb_page_selected', `Selected Facebook Page: ${selectedPage.name} (${selectedPage.id})`);

                    return new Response(JSON.stringify({ success: true, message: `Facebook Page "${selectedPage.name}" connected successfully!`, page_name: selectedPage.name }), { status: 200, headers: corsHeaders });
                }

                case '/api/social/facebook/manual-token': {
                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'DB missing' }), { status: 500, headers: corsHeaders });

                    const { account_id: manualAcctId, page_access_token, page_name: manualPageName } = await request.json();
                    if (!manualAcctId || !page_access_token) {
                        return new Response(JSON.stringify({ success: false, message: 'account_id and page_access_token required' }), { status: 400, headers: corsHeaders });
                    }

                    // Verify the token is valid by calling /me on Facebook
                    const verifyRes = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${page_access_token}`);
                    if (!verifyRes.ok) {
                        const verifyErr = await verifyRes.json().catch(() => ({}));
                        return new Response(JSON.stringify({ success: false, message: `Invalid token: ${verifyErr.error?.message || 'Facebook rejected this token'}` }), { status: 400, headers: corsHeaders });
                    }
                    const verifyData = await verifyRes.json();
                    const resolvedPageName = manualPageName || verifyData.name || 'Facebook Page';
                    const resolvedPageId = verifyData.id;

                    // Verify ownership — this account must belong to the requesting user
                    const manualAccount = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ? AND user_id = ?").bind(manualAcctId, user.id).first();
                    if (!manualAccount) return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: corsHeaders });

                    const encryptedManualToken = await encryptToken(page_access_token, encryptionSecret);
                    const nowManual = new Date().toISOString();
                    await env.DB.prepare(
                        "UPDATE social_accounts SET access_token = ?, account_name = ?, account_id = ?, status = 'active', expires_at = NULL, updated_at = ? WHERE id = ?"
                    ).bind(encryptedManualToken, `${resolvedPageName} (FB Page)`, resolvedPageId, nowManual, manualAcctId).run();

                    await logActivity(manualAccount.workspace_id, user.id, 'fb_manual_token', `Manually connected Facebook Page: ${resolvedPageName} (${resolvedPageId})`);

                    return new Response(JSON.stringify({ success: true, message: `Facebook Page "${resolvedPageName}" connected successfully!`, page_name: resolvedPageName }), { status: 200, headers: corsHeaders });
                }

                // ==================== SAAS ADMIN API ENDPOINTS ====================
                case '/api/admin/system-settings': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method === 'GET') {
                        const rows = await env.DB.prepare(
                            "SELECT setting_key, setting_value FROM settings WHERE user_id = 1 AND setting_key IN ('sys_gemini_disabled', 'sys_openai_disabled')"
                        ).all().catch(() => null);
                        
                        const sys_gemini_disabled = rows?.results?.some(r => r.setting_key === 'sys_gemini_disabled' && r.setting_value === 'true') || false;
                        const sys_openai_disabled = rows?.results?.some(r => r.setting_key === 'sys_openai_disabled' && r.setting_value === 'true') || false;

                        return new Response(JSON.stringify({
                            success: true,
                            settings: {
                                sys_gemini_disabled,
                                sys_openai_disabled
                            }
                        }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        const { sys_gemini_disabled, sys_openai_disabled } = await request.json();
                        
                        // Insert or Update sys_gemini_disabled
                        await env.DB.prepare(
                            `INSERT OR REPLACE INTO settings (user_id, setting_key, setting_value, updated_at) 
                             VALUES (1, 'sys_gemini_disabled', ?, datetime('now'))`
                        ).bind(sys_gemini_disabled === true ? "true" : "false").run();

                        // Insert or Update sys_openai_disabled
                        await env.DB.prepare(
                            `INSERT OR REPLACE INTO settings (user_id, setting_key, setting_value, updated_at) 
                             VALUES (1, 'sys_openai_disabled', ?, datetime('now'))`
                        ).bind(sys_openai_disabled === true ? "true" : "false").run();

                        return new Response(JSON.stringify({
                            success: true,
                            message: "System API Key settings updated successfully."
                        }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/admin/stats': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const totalUsers = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
                    const totalWorkspaces = await env.DB.prepare("SELECT COUNT(*) as count FROM workspaces").first();
                    const totalSchedules = await env.DB.prepare("SELECT COUNT(*) as count FROM scheduled_posts").first();
                    
                    // Monthly AI usage (count of ai_generate audit logs this month)
                    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
                    const monthlyAiUsage = await env.DB.prepare(
                        "SELECT COUNT(*) as count FROM audit_logs WHERE action = 'ai_generate' AND created_at >= ?"
                    ).bind(startOfMonth).first();

                    return new Response(JSON.stringify({
                        success: true,
                        stats: {
                            users: totalUsers?.count || 0,
                            workspaces: totalWorkspaces?.count || 0,
                            scheduled_posts: totalSchedules?.count || 0,
                            ai_usage_monthly: monthlyAiUsage?.count || 0
                        }
                    }), { status: 200, headers: corsHeaders });
                }

                case '/api/admin/users': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const { results } = await env.DB.prepare(
                        `SELECT u.id, u.uuid, u.name, u.email, u.role, u.status, u.created_at, u.last_login, w.name as workspace_name 
                         FROM users u
                         LEFT JOIN workspaces w ON u.active_workspace_id = w.id
                         ORDER BY u.created_at DESC`
                    ).all();

                    return new Response(JSON.stringify({ success: true, users: results }), { status: 200, headers: corsHeaders });
                }

                case '/api/admin/workspaces': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
                    const { results } = await env.DB.prepare(
                        `SELECT w.id, w.name, w.subscription_plan, w.subscription_status, w.created_at, u.email as owner_email,
                                (SELECT COUNT(*) FROM audit_logs WHERE workspace_id = w.id AND action = 'ai_generate' AND created_at >= ?) as ai_credits_used
                         FROM workspaces w
                         LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.role = 'owner'
                         LEFT JOIN users u ON wm.user_id = u.id
                         ORDER BY w.created_at DESC`
                    ).bind(startOfMonth).all();

                    return new Response(JSON.stringify({ success: true, workspaces: results }), { status: 200, headers: corsHeaders });
                }

                case '/api/admin/logs': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const { results } = await env.DB.prepare(
                        `SELECT al.id, al.action, al.details, al.created_at, u.email as user_email, w.name as workspace_name 
                         FROM audit_logs al
                         LEFT JOIN users u ON al.user_id = u.id
                         LEFT JOIN workspaces w ON al.workspace_id = w.id
                         ORDER BY al.created_at DESC
                         LIMIT 100`
                    ).all();

                    return new Response(JSON.stringify({ success: true, logs: results }), { status: 200, headers: corsHeaders });
                }

                case '/api/publish/logs': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ results: [] }), { status: 200, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    const { results } = await env.DB.prepare(
                        `SELECT l.*, q.platform, p.title 
                         FROM publish_logs l 
                         JOIN social_accounts sa ON l.social_account_id = sa.id
                         LEFT JOIN publish_queue q ON l.schedule_id = q.id 
                         LEFT JOIN posts p ON q.post_id = p.id 
                         WHERE sa.workspace_id = ?
                         ORDER BY l.published_at DESC`
                    ).bind(activeWorkspace.workspace_id).all();
                    return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                }

                default: {
                    // Match /api/admin/users/:id/reset-password
                    const adminUserResetPwMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
                    if (adminUserResetPwMatch) {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const targetUserId = parseInt(adminUserResetPwMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        try {
                            const { newPassword } = await request.json();
                            if (!newPassword || newPassword.trim().length < 8) {
                                return new Response(JSON.stringify({ message: 'Password must be at least 8 characters long' }), { status: 400, headers: corsHeaders });
                            }

                            const hashed = await hashPassword(newPassword.trim());
                            const updateRes = await env.DB.prepare(
                                "UPDATE users SET password_hash = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(hashed, targetUserId).run();

                            if (updateRes.meta.changes === 0) {
                                return new Response(JSON.stringify({ message: 'User not found' }), { status: 404, headers: corsHeaders });
                            }

                            await logActivity(null, user.id, 'admin_reset_password', `Admin reset password for user ID ${targetUserId}`);

                            return new Response(JSON.stringify({ success: true, message: 'Password reset successfully' }), { status: 200, headers: corsHeaders });
                        } catch (e) {
                            return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                        }
                    }

                    // Match /api/admin/users/:id/role
                    const adminUserRoleMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/role$/);
                    if (adminUserRoleMatch) {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const targetUserId = parseInt(adminUserRoleMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        try {
                            const { role } = await request.json();
                            if (!['user', 'admin'].includes(role)) {
                                return new Response(JSON.stringify({ message: 'Invalid role value' }), { status: 400, headers: corsHeaders });
                            }

                            const updateRes = await env.DB.prepare(
                                "UPDATE users SET role = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(role, targetUserId).run();

                            if (updateRes.meta.changes === 0) {
                                return new Response(JSON.stringify({ message: 'User not found' }), { status: 404, headers: corsHeaders });
                            }

                            await logActivity(null, user.id, 'admin_change_role', `Admin changed role of user ID ${targetUserId} to ${role}`);

                            return new Response(JSON.stringify({ success: true, message: `Role updated to ${role} successfully` }), { status: 200, headers: corsHeaders });
                        } catch (e) {
                            return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                        }
                    }

                    // Match /api/admin/workspaces/:id/plan
                    const adminWorkspacePlanMatch = url.pathname.match(/^\/api\/admin\/workspaces\/(\d+)\/plan$/);
                    if (adminWorkspacePlanMatch) {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const wsId = parseInt(adminWorkspacePlanMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        try {
                            const { plan } = await request.json();
                            if (!['free', 'pro', 'agency', 'enterprise'].includes(plan)) {
                                return new Response(JSON.stringify({ message: 'Invalid plan value' }), { status: 400, headers: corsHeaders });
                            }

                            const updateRes = await env.DB.prepare(
                                "UPDATE workspaces SET subscription_plan = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(plan, wsId).run();

                            if (updateRes.meta.changes === 0) {
                                return new Response(JSON.stringify({ message: 'Workspace not found' }), { status: 404, headers: corsHeaders });
                            }

                            await logActivity(wsId, user.id, 'admin_change_plan', `Admin changed workspace plan to ${plan}`);

                            return new Response(JSON.stringify({ success: true, message: `Workspace plan updated to ${plan} successfully` }), { status: 200, headers: corsHeaders });
                        } catch (e) {
                            return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                        }
                    }

                    // Match /api/admin/niche-rules
                    if (url.pathname === '/api/admin/niche-rules') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        if (request.method === 'GET') {
                            try {
                                const niches = await env.DB.prepare("SELECT * FROM system_niche_rules ORDER BY id ASC").all();
                                return new Response(JSON.stringify({ success: true, results: niches.results || [] }), { status: 200, headers: corsHeaders });
                            } catch (e) {
                                return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                            }
                        }

                        if (request.method === 'POST') {
                            try {
                                const { id, niche_key, name, detection_keywords, rules, example_output } = await request.json();
                                if (!niche_key || !name || !detection_keywords || !rules) {
                                    return new Response(JSON.stringify({ message: 'All fields are required.' }), { status: 400, headers: corsHeaders });
                                }

                                if (id) {
                                    await env.DB.prepare(
                                        "UPDATE system_niche_rules SET niche_key = ?, name = ?, detection_keywords = ?, rules = ?, example_output = ?, updated_at = datetime('now') WHERE id = ?"
                                    ).bind(niche_key.trim(), name.trim(), detection_keywords.trim(), typeof rules === 'string' ? rules : JSON.stringify(rules), example_output ? example_output.trim() : null, id).run();
                                } else {
                                    await env.DB.prepare(
                                        "INSERT INTO system_niche_rules (niche_key, name, detection_keywords, rules, example_output) VALUES (?, ?, ?, ?, ?)"
                                    ).bind(niche_key.trim(), name.trim(), detection_keywords.trim(), typeof rules === 'string' ? rules : JSON.stringify(rules), example_output ? example_output.trim() : null).run();
                                }

                                return new Response(JSON.stringify({ success: true, message: 'Niche rule saved successfully.' }), { status: 200, headers: corsHeaders });
                            } catch (e) {
                                return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                            }
                        }
                    }

                    // Match /api/admin/niche-rules/:id (DELETE)
                    const adminNicheRuleDeleteMatch = url.pathname.match(/^\/api\/admin\/niche-rules\/(\d+)$/);
                    if (adminNicheRuleDeleteMatch) {
                        if (request.method !== 'DELETE') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const ruleId = parseInt(adminNicheRuleDeleteMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (user.role !== 'admin') return new Response(JSON.stringify({ message: 'Forbidden: Admin access only' }), { status: 403, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        try {
                            await env.DB.prepare("DELETE FROM system_niche_rules WHERE id = ?").bind(ruleId).run();
                            return new Response(JSON.stringify({ success: true, message: 'Niche rule deleted successfully.' }), { status: 200, headers: corsHeaders });
                        } catch (e) {
                            return new Response(JSON.stringify({ message: e.message }), { status: 500, headers: corsHeaders });
                        }
                    }

                    // Match /api/scheduled-posts/:id/publish
                    const spPublishMatch = url.pathname.match(/^\/api\/scheduled-posts\/(\d+)\/publish$/);
                    if (spPublishMatch) {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const spId = parseInt(spPublishMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        try {
                            const scheduledPost = await env.DB.prepare(
                                "SELECT * FROM scheduled_posts WHERE id = ? AND user_id = ?"
                            ).bind(spId, user.id).first();

                            if (!scheduledPost) {
                                return new Response(JSON.stringify({ message: 'Scheduled post not found' }), { status: 404, headers: corsHeaders });
                            }

                            await env.DB.prepare("UPDATE scheduled_posts SET status = 'publishing' WHERE id = ?").bind(spId).run();

                            const socialAccount = await env.DB.prepare(
                                "SELECT * FROM social_accounts WHERE id = ? AND user_id = ?"
                            ).bind(scheduledPost.account_id, user.id).first();

                            if (!socialAccount) {
                                throw new Error('Connected social account not found.');
                            }

                            const decryptedAccessToken = await decryptToken(socialAccount.access_token, encryptionSecret);
                            const credentials = { access_token: decryptedAccessToken, account_id: socialAccount.account_id };

                            const publisher = PublisherFactory.getPublisher(scheduledPost.platform);
                            
                            const postObj = {
                                title: '',
                                caption: scheduledPost.content,
                                media: []
                            };

                            const result = await publisher.publish(postObj, credentials);

                            if (result.success) {
                                const nowStr = new Date().toISOString();
                                await env.DB.prepare(
                                    `UPDATE scheduled_posts 
                                      SET status = 'published', published_at = ?, external_post_id = ?, error_message = NULL, updated_at = (datetime('now'))
                                      WHERE id = ?`
                                 ).bind(nowStr, result.provider_post_id, spId).run();

                                 await env.DB.prepare(
                                     `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
                                 VALUES (NULL, ?, 'success', NULL, ?, ?, ?)`
                                 ).bind(socialAccount.id, result.provider_post_id, JSON.stringify(result), nowStr).run();
 
                                 return new Response(JSON.stringify({ success: true, message: 'Published successfully', result }), { status: 200, headers: corsHeaders });
                             } else {
                                 await env.DB.prepare(
                                     `UPDATE scheduled_posts 
                                      SET status = 'failed', error_message = ?, updated_at = (datetime('now'))
                                      WHERE id = ?`
                                 ).bind(result.error_message, spId).run();
 
                                 await env.DB.prepare(
                                     `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, response_payload, published_at) 
                                 VALUES (NULL, ?, 'failed', ?, ?, (datetime('now')))`
                                 ).bind(socialAccount.id, result.error_message, JSON.stringify(result)).run();
 
                                 return new Response(JSON.stringify({ success: false, message: result.error_message }), { status: 400, headers: corsHeaders });
                             }
                         } catch (err) {
                             await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', error_message = ?, updated_at = (datetime('now')) WHERE id = ?").bind(err.message, spId).run();
                             
                             // Insert into logs
                             if (scheduledPost && scheduledPost.account_id) {
                                 await env.DB.prepare(
                                     `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, response_payload, published_at) 
                                 VALUES (NULL, ?, 'failed', ?, ?, (datetime('now')))`
                                 ).bind(scheduledPost.account_id, err.message, JSON.stringify({ error: err.message })).run();
                             }

                            return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500, headers: corsHeaders });
                        }
                    }

                    // Match /api/scheduled-posts/:id
                    const spMatch = url.pathname.match(/^\/api\/scheduled-posts\/(\d+)$/);
                    if (spMatch) {
                        const spId = parseInt(spMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        if (request.method === 'GET') {
                            const post = await env.DB.prepare("SELECT * FROM scheduled_posts WHERE id = ? AND user_id = ?").bind(spId, user.id).first();
                            if (!post) return new Response(JSON.stringify({ message: 'Scheduled post not found' }), { status: 404, headers: corsHeaders });
                            return new Response(JSON.stringify({ success: true, post }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'PUT') {
                            const { status, publish_at, timezone, content, media_urls } = await request.json();
                            
                            const fields = [];
                            const binds = [];
                            
                            if (status !== undefined) {
                                fields.push("status = ?");
                                binds.push(status);
                            }
                            if (publish_at !== undefined) {
                                fields.push("publish_at = ?");
                                binds.push(publish_at);
                            }
                            if (timezone !== undefined) {
                                fields.push("timezone = ?");
                                binds.push(timezone);
                            }
                            if (content !== undefined) {
                                fields.push("content = ?");
                                binds.push(content);
                            }
                            if (media_urls !== undefined) {
                                fields.push("media_urls = ?");
                                binds.push(media_urls);
                            }

                            if (fields.length === 0) {
                                return new Response(JSON.stringify({ message: 'No fields to update' }), { status: 400, headers: corsHeaders });
                            }

                            binds.push(spId, user.id);
                            
                            await env.DB.prepare(
                                `UPDATE scheduled_posts SET ${fields.join(', ')}, updated_at = (datetime('now')) WHERE id = ? AND user_id = ?`
                            ).bind(...binds).run();

                            return new Response(JSON.stringify({ success: true, message: 'Scheduled post updated successfully' }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            await env.DB.prepare("DELETE FROM scheduled_posts WHERE id = ? AND user_id = ?").bind(spId, user.id).run();
                            return new Response(JSON.stringify({ success: true, message: 'Scheduled post deleted successfully' }), { status: 200, headers: corsHeaders });
                        }

                        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    }

                    // Match /api/queue/:id/publish (Immediate manual publish through PublishingEngine)
                    const queuePublishMatch = url.pathname.match(/^\/api\/queue\/(\d+)\/publish$/);
                    if (queuePublishMatch) {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const queueId = parseInt(queuePublishMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        try {
                            const result = await PublishingEngine.publishQueueItem(env.DB, queueId, user.id, encryptionSecret);
                            return new Response(JSON.stringify({ success: result.success, message: result.success ? 'Published successfully' : (result.error_message || 'Execution failed'), result }), { status: result.success ? 200 : 400, headers: corsHeaders });
                        } catch (err) {
                            return new Response(JSON.stringify({ success: false, message: err.message }), { status: 500, headers: corsHeaders });
                        }
                    }

                    // Match /api/queue/:id/retry (Retry failed job)
                    const queueRetryMatch = url.pathname.match(/^\/api\/queue\/(\d+)\/retry$/);
                    if (queueRetryMatch) {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const queueId = parseInt(queueRetryMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'DB missing' }), { status: 500, headers: corsHeaders });

                        const nowStr = new Date().toISOString();
                        
                        await env.DB.prepare("UPDATE publish_queue SET status = 'queued', attempt_count = 0, last_attempt = NULL, next_retry = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
                            .bind(nowStr, queueId, user.id)
                            .run();

                        return new Response(JSON.stringify({ success: true, message: 'Job rescheduled for retry' }), { status: 200, headers: corsHeaders });
                    }

                    // Match /api/queue/:id (PUT updates scheduled date, DELETE cancels schedule)
                    const queueMatch = url.pathname.match(/^\/api\/queue\/(\d+)$/);
                    if (queueMatch) {
                        const queueId = parseInt(queueMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        if (request.method === 'PUT') {
                            const { scheduled_at, timezone, status } = await request.json();
                            const nowStr = new Date().toISOString();

                            const result = await env.DB.prepare(
                                `UPDATE publish_queue 
                                 SET scheduled_at = COALESCE(?, scheduled_at), 
                                     timezone = COALESCE(?, timezone), 
                                     status = COALESCE(?, status), 
                                     updated_at = ? 
                                 WHERE id = ? AND user_id = ?`
                            ).bind(scheduled_at || null, timezone || null, status || null, nowStr, queueId, user.id).run();

                            if (result.meta.changes === 0) {
                                return new Response(JSON.stringify({ message: 'Schedule not found or unauthorized' }), { status: 404, headers: corsHeaders });
                            }

                            // If date changed, sync posts table
                            if (scheduled_at) {
                                const queueItem = await env.DB.prepare("SELECT post_id FROM publish_queue WHERE id = ?").bind(queueId).first();
                                if (queueItem) {
                                    await env.DB.prepare("UPDATE posts SET scheduled_at = ? WHERE id = ?").bind(scheduled_at, queueItem.post_id).run();
                                }
                            }

                            return new Response(JSON.stringify({ success: true, message: 'Schedule updated successfully' }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            const queueItem = await env.DB.prepare("SELECT post_id FROM publish_queue WHERE id = ? AND user_id = ?").bind(queueId, user.id).first();
                            if (!queueItem) {
                                return new Response(JSON.stringify({ message: 'Schedule not found' }), { status: 404, headers: corsHeaders });
                            }

                            // Delete D1 queue record
                            await env.DB.prepare("DELETE FROM publish_queue WHERE id = ?").bind(queueId).run();

                            // Re-evaluate post status in posts table (if no remaining active schedules, revert to draft)
                            const activeCount = await env.DB.prepare("SELECT COUNT(*) as count FROM publish_queue WHERE post_id = ? AND status IN ('queued', 'publishing', 'retrying')").bind(queueItem.post_id).first();
                            if (!activeCount || activeCount.count === 0) {
                                await env.DB.prepare("UPDATE posts SET status = 'draft', scheduled_at = NULL WHERE id = ?").bind(queueItem.post_id).run();
                            }

                            return new Response(JSON.stringify({ success: true, message: 'Schedule cancelled and removed' }), { status: 200, headers: corsHeaders });
                        }
                    }

                    // Match /api/workspaces/members/:id
                    const wsMemberMatch = url.pathname.match(/^\/api\/workspaces\/members\/(\d+)$/);
                    if (wsMemberMatch) {
                        const memberId = parseInt(wsMemberMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                        if (!['owner', 'admin'].includes(activeWorkspace.role)) {
                            return new Response(JSON.stringify({ message: 'Forbidden: Only Owner/Admin can remove members.' }), { status: 403, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            const result = await env.DB.prepare(
                                "DELETE FROM workspace_members WHERE id = ? AND workspace_id = ?"
                            ).bind(memberId, activeWorkspace.workspace_id).run();

                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Member not found or not in workspace' }), { status: 404, headers: corsHeaders });

                            await logActivity(activeWorkspace.workspace_id, user.id, 'remove_member', `Removed workspace member ID ${memberId}`);
                            return new Response(JSON.stringify({ success: true, message: 'Member removed successfully' }), { status: 200, headers: corsHeaders });
                        }
                    }

                    // Match /api/clients/:id
                    const clientMatch = url.pathname.match(/^\/api\/clients\/(\d+)$/);
                    if (clientMatch) {
                        const clientId = parseInt(clientMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        const limits = PLANS[activeWorkspace.subscription_plan];
                        if (!limits.features.includes('clients')) {
                            return new Response(JSON.stringify({ message: 'Feature locked: Upgrade subscription plan to access clients.' }), { status: 403, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });
                            const result = await env.DB.prepare(
                                "DELETE FROM clients WHERE id = ? AND workspace_id = ?"
                            ).bind(clientId, activeWorkspace.workspace_id).run();

                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Client not found or not in workspace' }), { status: 404, headers: corsHeaders });

                            await logActivity(activeWorkspace.workspace_id, user.id, 'delete_client', `Deleted client ID ${clientId}`);
                            return new Response(JSON.stringify({ success: true, message: 'Client deleted successfully' }), { status: 200, headers: corsHeaders });
                        }
                    }

                    // Match /api/media/:id
                    const mediaMatch = url.pathname.match(/^\/api\/media\/(\d+)$/);
                    if (mediaMatch) {
                        const mediaId = parseInt(mediaMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        if (request.method === 'PUT') {
                            if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });
                            const { filename, is_favorite } = await request.json();
                            const nowStr = new Date().toISOString();

                            if (filename !== undefined) {
                                const cleanFilename = sanitizeFilename(filename);
                                await env.DB.prepare("UPDATE media SET filename = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
                                    .bind(cleanFilename, nowStr, mediaId, activeWorkspace.workspace_id)
                                    .run();
                            }

                            if (is_favorite !== undefined) {
                                const favInt = is_favorite ? 1 : 0;
                                await env.DB.prepare("UPDATE media SET is_favorite = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
                                    .bind(favInt, nowStr, mediaId, activeWorkspace.workspace_id)
                                    .run();
                            }

                            const updatedMedia = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(mediaId).first();
                            return new Response(JSON.stringify({ success: true, media: updatedMedia }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });
                            const result = await env.DB.prepare("DELETE FROM media WHERE id = ? AND workspace_id = ?").bind(mediaId, activeWorkspace.workspace_id).run();
                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Asset not found or unauthorized' }), { status: 404, headers: corsHeaders });
                            
                            await logActivity(activeWorkspace.workspace_id, user.id, 'delete_media', `Deleted media asset ID ${mediaId}`);
                            return new Response(JSON.stringify({ success: true, message: 'Media asset deleted' }), { status: 200, headers: corsHeaders });
                        }
                    }

                    // Match /api/posts/:id/media/:mediaId
                    const postMediaDetachMatch = url.pathname.match(/^\/api\/posts\/(\d+)\/media\/(\d+)$/);
                    if (postMediaDetachMatch) {
                        if (request.method !== 'DELETE') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const postId = parseInt(postMediaDetachMatch[1]);
                        const mediaId = parseInt(postMediaDetachMatch[2]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                        if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });

                        const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND workspace_id = ?").bind(postId, activeWorkspace.workspace_id).first();
                        if (!post) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });

                        await env.DB.prepare("DELETE FROM post_media WHERE post_id = ? AND media_id = ?").bind(postId, mediaId).run();
                        return new Response(JSON.stringify({ success: true, message: 'Media detached' }), { status: 200, headers: corsHeaders });
                    }

                    // Match /api/posts/:id/media
                    const postMediaMatch = url.pathname.match(/^\/api\/posts\/(\d+)\/media$/);
                    if (postMediaMatch) {
                        const postId = parseInt(postMediaMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND workspace_id = ?").bind(postId, activeWorkspace.workspace_id).first();
                        if (!post) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });

                        if (request.method === 'GET') {
                            const { results } = await env.DB.prepare("SELECT m.* FROM media m JOIN post_media pm ON m.id = pm.media_id WHERE pm.post_id = ?").bind(postId).all();
                            return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'POST') {
                            if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });
                            const { media_id } = await request.json();
                            await env.DB.prepare("INSERT OR IGNORE INTO post_media (post_id, media_id) VALUES (?, ?)")
                                .bind(postId, media_id)
                                .run();
                            return new Response(JSON.stringify({ success: true, message: 'Media attached' }), { status: 201, headers: corsHeaders });
                        }
                    }

                    // Match /api/posts/:id/duplicate
                    const postDuplicateMatch = url.pathname.match(/^\/api\/posts\/(\d+)\/duplicate$/);
                    if (postDuplicateMatch) {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const postId = parseInt(postDuplicateMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                        if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });

                        // Check post limits
                        const plan = activeWorkspace.subscription_plan;
                        const limit = PLANS[plan].posts;
                        const startOfMonth = getBillingCycleStart(activeWorkspace.created_at);
                        const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM posts WHERE workspace_id = ? AND created_at >= ?").bind(activeWorkspace.workspace_id, startOfMonth).first();
                        if (countRes && countRes.count >= limit) {
                            return new Response(JSON.stringify({ message: `Subscription limit reached: Maximum ${limit} posts per month allowed on ${plan} plan.` }), { status: 403, headers: corsHeaders });
                        }

                        const original = await env.DB.prepare("SELECT * FROM posts WHERE id = ? AND workspace_id = ?").bind(postId, activeWorkspace.workspace_id).first();
                        if (!original) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });

                        const newTitle = original.title ? `${original.title} (Copy)` : 'Copy';
                        const result = await env.DB.prepare("INSERT INTO posts (user_id, workspace_id, title, caption, status, visibility, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
                            .bind(user.id, activeWorkspace.workspace_id, newTitle, original.caption, 'draft', original.visibility, null)
                            .run();

                        const newPostId = result.meta.last_row_id;

                        const mediaAttachments = await env.DB.prepare("SELECT media_id FROM post_media WHERE post_id = ?").bind(postId).all();
                        for (const row of mediaAttachments.results) {
                            await env.DB.prepare("INSERT INTO post_media (post_id, media_id) VALUES (?, ?)").bind(newPostId, row.media_id).run();
                        }

                        await logActivity(activeWorkspace.workspace_id, user.id, 'duplicate_post', `Duplicated post ID ${postId} to ${newPostId}`);

                        return new Response(JSON.stringify({ success: true, message: 'Post duplicated successfully', id: newPostId }), { status: 201, headers: corsHeaders });
                    }

                    // Match /api/posts/:id
                    const postMatch = url.pathname.match(/^\/api\/posts\/(\d+)$/);
                    if (postMatch) {
                        const postId = parseInt(postMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        if (request.method === 'GET') {
                            const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ? AND workspace_id = ?").bind(postId, activeWorkspace.workspace_id).first();
                            if (!post) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });
                            return new Response(JSON.stringify({ success: true, post }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'PUT') {
                            if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });
                            const { title, caption, status, visibility, scheduled_at } = await request.json();
                            const nowStr = new Date().toISOString();
                            
                            const result = await env.DB.prepare("UPDATE posts SET title = ?, caption = ?, status = ?, visibility = ?, scheduled_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
                                .bind(title, caption, status, visibility, scheduled_at || null, nowStr, postId, activeWorkspace.workspace_id)
                                .run();

                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });
                            
                            await logActivity(activeWorkspace.workspace_id, user.id, 'update_post', `Updated post ID ${postId}: "${title || 'Untitled'}"`);
                            return new Response(JSON.stringify({ success: true, message: 'Post updated successfully' }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: corsHeaders });
                            const result = await env.DB.prepare("DELETE FROM posts WHERE id = ? AND workspace_id = ?").bind(postId, activeWorkspace.workspace_id).run();
                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });
                            
                            await logActivity(activeWorkspace.workspace_id, user.id, 'delete_post', `Deleted post ID ${postId}`);
                            return new Response(JSON.stringify({ success: true, message: 'Post deleted successfully' }), { status: 200, headers: corsHeaders });
                        }
                    }

                    // Match /api/social/accounts/:id
                    const accountMatch = url.pathname.match(/^\/api\/social\/accounts\/(\d+)$/);
                    if (accountMatch) {
                        const accountId = parseInt(accountMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database binding missing' }), { status: 500, headers: corsHeaders });

                        const activeWorkspace = await getActiveWorkspace(user);
                        if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });
                        if (!['owner', 'admin'].includes(activeWorkspace.role)) {
                            return new Response(JSON.stringify({ message: 'Forbidden: Only Admin/Owner can manage social accounts.' }), { status: 403, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            // Prevent cascade deletion of posts associated with this account by nullifying account_id first
                            await env.DB.prepare("UPDATE scheduled_posts SET account_id = NULL WHERE account_id = ? AND workspace_id = ?").bind(accountId, activeWorkspace.workspace_id).run();
                            
                            await env.DB.prepare("DELETE FROM social_accounts WHERE id = ? AND workspace_id = ?").bind(accountId, activeWorkspace.workspace_id).run();
                            await logActivity(activeWorkspace.workspace_id, user.id, 'disconnect_account', `Disconnected account ID ${accountId}`);
                            return new Response(JSON.stringify({ success: true, message: 'Account link deleted successfully' }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'POST') {
                            const account = await env.DB.prepare("SELECT platform FROM social_accounts WHERE id = ? AND workspace_id = ?").bind(accountId, activeWorkspace.workspace_id).first();
                            if (!account) return new Response(JSON.stringify({ message: 'Account not found' }), { status: 404, headers: corsHeaders });

                            const clientIdKey = `${account.platform.toUpperCase()}_CLIENT_ID`;
                            const clientId = env[clientIdKey];
                            if (!clientId) {
                                return new Response(JSON.stringify({ error: `Environment variable '${clientIdKey}' is missing or not configured on Cloudflare.` }), { status: 500, headers: corsHeaders });
                            }

                            const stateToken = await signJWT({ sub: user.uuid, platform: account.platform, exp: Math.floor(Date.now() / 1000) + 600 }, jwtSecret);
                            const redirectUri = account.platform === 'threads'
                                ? 'https://api.socialhub.zaimrosli.my/oauth/threads/callback'
                                : `${url.origin}/api/oauth/callback`;
                            const authUrl = OAuthProviders[account.platform].getAuthUrl(stateToken, redirectUri, clientId);

                            return new Response(JSON.stringify({ success: true, redirect_url: authUrl }), { status: 200, headers: corsHeaders });
                        }
                    }

                    if (url.pathname === '/api/auth/register') {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const { name, email, password } = await request.json();
                        if (!name || !email || !password) return new Response(JSON.stringify({ message: 'All fields are required' }), { status: 400, headers: corsHeaders });
                        if (password.length < 8) return new Response(JSON.stringify({ message: 'Password must be at least 8 characters long' }), { status: 400, headers: corsHeaders });
                        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response(JSON.stringify({ message: 'Invalid email address' }), { status: 400, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'DB binding missing' }), { status: 500, headers: corsHeaders });

                        const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email.toLowerCase().trim()).first();
                        if (existingUser) return new Response(JSON.stringify({ message: 'Email address already registered' }), { status: 400, headers: corsHeaders });

                        const passwordHash = await hashPassword(password);
                        const userUuid = crypto.randomUUID();
                        
                        const result = await env.DB.prepare("INSERT INTO users (uuid, name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'user', 'active')").bind(userUuid, name.trim(), email.toLowerCase().trim(), passwordHash).run();
                        const userId = result.meta.last_row_id;

                        // Auto-create personal workspace
                        const wsUuid = crypto.randomUUID();
                        const wsSlug = `personal-${userId}`;
                        const wsResult = await env.DB.prepare(
                            `INSERT INTO workspaces (uuid, name, slug, subscription_plan, subscription_status)
                             VALUES (?, ?, ?, 'free', 'active')`
                        ).bind(wsUuid, `${name.trim()}'s Workspace`, wsSlug).run();
                        const wsId = wsResult.meta.last_row_id;

                        // Add user as owner of their workspace
                        await env.DB.prepare(
                            `INSERT INTO workspace_members (workspace_id, user_id, role)
                             VALUES (?, ?, 'owner')`
                        ).bind(wsId, userId).run();

                        await logActivity(wsId, userId, 'register', 'User registered and personal workspace provisioned');

                        return new Response(JSON.stringify({ success: true, message: 'Registration successful!' }), { status: 201, headers: corsHeaders });
                    }

                    if (url.pathname === '/api/auth/login') {
                        if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                        const { email, password, rememberMe } = await request.json();
                        if (!email || !password) return new Response(JSON.stringify({ message: 'Email and password are required' }), { status: 400, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'DB binding missing' }), { status: 500, headers: corsHeaders });

                        const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email.toLowerCase().trim()).first();
                        if (!user) return new Response(JSON.stringify({ message: 'Invalid email or password' }), { status: 401, headers: corsHeaders });

                        const isPasswordCorrect = await verifyPassword(password, user.password_hash);
                        if (!isPasswordCorrect) return new Response(JSON.stringify({ message: 'Invalid email or password' }), { status: 401, headers: corsHeaders });

                        if (user.status !== 'active') return new Response(JSON.stringify({ message: 'Account suspended' }), { status: 403, headers: corsHeaders });

                        const nowStr = new Date().toISOString();
                        await env.DB.prepare("UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?").bind(nowStr, nowStr, user.id).run();

                        const expiresInSeconds = rememberMe ? (30 * 24 * 60 * 60) : (24 * 60 * 60);
                        const expiration = Math.floor(Date.now() / 1000) + expiresInSeconds;
                        const token = await signJWT({ sub: user.uuid, email: user.email, name: user.name, role: user.role, exp: expiration }, jwtSecret);

                        return new Response(JSON.stringify({ success: true, token, user: { uuid: user.uuid, name: user.name, email: user.email, role: user.role } }), { status: 200, headers: corsHeaders });
                    }

                    if (url.pathname === '/api/auth/logout') {
                        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
                    }

                    if (url.pathname === '/api/users/me') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });

                        if (request.method === 'GET') {
                            return new Response(JSON.stringify({ success: true, user }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'PUT') {
                            const { name } = await request.json();
                            if (!name || !name.trim()) return new Response(JSON.stringify({ message: 'Name is required' }), { status: 400, headers: corsHeaders });

                            const newName = name.trim();
                            await env.DB.prepare(
                                "UPDATE users SET name = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(newName, user.id).run();

                            // Re-generate JWT with new name
                            const now = Math.floor(Date.now() / 1000);
                            const expiration = now + (24 * 60 * 60); 
                            const token = await signJWT({ sub: user.uuid, email: user.email, name: newName, role: user.role, exp: expiration }, jwtSecret);

                            return new Response(JSON.stringify({
                                success: true,
                                token,
                                user: { uuid: user.uuid, name: newName, email: user.email, role: user.role }
                            }), { status: 200, headers: corsHeaders });
                        }

                        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    }

                    if (url.pathname === '/api/health') {
                        return new Response(JSON.stringify({ status: 'operational', environment: env.ENVIRONMENT || 'production', bindings: { d1_database: env.DB ? 'configured' : 'missing' } }), { status: 200, headers: corsHeaders });
                    }

                    // ==================== WORKSPACE API KEYS (Hermes/Agent Integration) ====================

                    if (url.pathname === '/api/auth/api-keys' && request.method === 'GET') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                        const workspace = await getActiveWorkspace(user);
                        if (!workspace) return new Response(JSON.stringify({ message: 'No active workspace' }), { status: 400, headers: corsHeaders });

                        const keys = await env.DB.prepare(
                            `SELECT id, key_prefix, name, created_at, last_used_at FROM workspace_api_keys WHERE workspace_id = ? ORDER BY created_at DESC`
                        ).bind(workspace.workspace_id).all();

                        return new Response(JSON.stringify({ success: true, keys: keys.results || [] }), { status: 200, headers: corsHeaders });
                    }

                    if (url.pathname === '/api/auth/api-keys' && request.method === 'POST') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                        const workspace = await getActiveWorkspace(user);
                        if (!workspace) return new Response(JSON.stringify({ message: 'No active workspace' }), { status: 400, headers: corsHeaders });

                        const body = await request.json().catch(() => ({}));
                        const keyName = (body.name || 'Default Key').trim().substring(0, 80);

                        // Generate a cryptographically secure random key
                        const rawBytes = crypto.getRandomValues(new Uint8Array(32));
                        const rawKey = Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join('');
                        const fullKey = `sk-sh-${rawKey}`;
                        const prefix = `sk-sh-${rawKey.substring(0, 8)}...`;

                        // Store only the SHA-256 hash — never the plaintext key
                        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fullKey));
                        const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

                        await env.DB.prepare(
                            `INSERT INTO workspace_api_keys (workspace_id, user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)`
                        ).bind(workspace.workspace_id, user.id, keyHash, prefix, keyName).run();

                        // Return the full key ONCE — it will never be shown again
                        return new Response(JSON.stringify({
                            success: true,
                            key: fullKey,
                            prefix,
                            name: keyName,
                            warning: 'Save this key now. It will not be shown again.'
                        }), { status: 201, headers: corsHeaders });
                    }

                    if (url.pathname.startsWith('/api/auth/api-keys/') && request.method === 'DELETE') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                        const workspace = await getActiveWorkspace(user);
                        if (!workspace) return new Response(JSON.stringify({ message: 'No active workspace' }), { status: 400, headers: corsHeaders });

                        const keyId = parseInt(url.pathname.split('/').pop(), 10);
                        if (!keyId) return new Response(JSON.stringify({ message: 'Invalid key ID' }), { status: 400, headers: corsHeaders });

                        const result = await env.DB.prepare(
                            `DELETE FROM workspace_api_keys WHERE id = ? AND workspace_id = ?`
                        ).bind(keyId, workspace.workspace_id).run();

                        if (result.changes === 0) return new Response(JSON.stringify({ message: 'Key not found' }), { status: 404, headers: corsHeaders });

                        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
                    }

                    // --- Link Shortener & Cloaker Endpoints ---
                    if (url.pathname === '/api/links' && request.method === 'GET') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                        const workspace = await getActiveWorkspace(user);
                        if (!workspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        const links = await env.DB.prepare("SELECT * FROM short_links WHERE workspace_id = ? ORDER BY id DESC").bind(workspace.workspace_id).all().catch(() => ({ results: [] }));
                        return new Response(JSON.stringify({ success: true, links: links.results || [] }), { status: 200, headers: corsHeaders });
                    }

                    if (url.pathname === '/api/links' && request.method === 'POST') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                        const workspace = await getActiveWorkspace(user);
                        if (!workspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        const { target_url, code: customCode, title, description } = await request.json();
                        if (!target_url || !target_url.trim()) {
                            return new Response(JSON.stringify({ message: 'Target URL is required' }), { status: 400, headers: corsHeaders });
                        }

                        // Validate target URL format
                        try {
                            new URL(target_url.trim());
                        } catch (_) {
                            return new Response(JSON.stringify({ message: 'Invalid Target URL format' }), { status: 400, headers: corsHeaders });
                        }

                        let code = (customCode || '').trim();
                        if (code) {
                            // Validate custom code format
                            if (!/^[a-zA-Z0-9\-_]+$/.test(code)) {
                                return new Response(JSON.stringify({ message: 'Custom alias can only contain letters, numbers, hyphens and underscores' }), { status: 400, headers: corsHeaders });
                            }
                            // Check uniqueness
                            const existing = await env.DB.prepare("SELECT id FROM short_links WHERE code = ?").bind(code).first().catch(() => null);
                            if (existing) {
                                return new Response(JSON.stringify({ message: 'Custom alias is already taken' }), { status: 400, headers: corsHeaders });
                            }
                        } else {
                            // Generate random unique 6-char code
                            let isUnique = false;
                            const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                            let attempts = 0;
                            while (!isUnique && attempts < 10) {
                                code = '';
                                for (let i = 0; i < 6; i++) {
                                    code += chars.charAt(Math.floor(Math.random() * chars.length));
                                }
                                const existing = await env.DB.prepare("SELECT id FROM short_links WHERE code = ?").bind(code).first().catch(() => null);
                                if (!existing) {
                                    isUnique = true;
                                }
                                attempts++;
                            }
                            if (!isUnique) {
                                return new Response(JSON.stringify({ message: 'Failed to generate a unique short link. Please try again.' }), { status: 500, headers: corsHeaders });
                            }
                        }

                        const result = await env.DB.prepare(
                            "INSERT INTO short_links (workspace_id, code, target_url, title, description) VALUES (?, ?, ?, ?, ?)"
                        ).bind(workspace.workspace_id, code, target_url.trim(), title ? title.trim() : null, description ? description.trim() : null).run().catch(e => {
                            console.error("Failed to insert short link:", e);
                            return null;
                        });

                        if (!result) {
                            return new Response(JSON.stringify({ message: 'Failed to save short link' }), { status: 500, headers: corsHeaders });
                        }

                        const newLink = {
                            id: result.meta.last_row_id,
                            workspace_id: workspace.workspace_id,
                            code,
                            target_url: target_url.trim(),
                            title: title ? title.trim() : null,
                            description: description ? description.trim() : null,
                            clicks_count: 0,
                            created_at: new Date().toISOString()
                        };

                        return new Response(JSON.stringify({ success: true, link: newLink }), { status: 201, headers: corsHeaders });
                    }

                    if (url.pathname.startsWith('/api/links/') && request.method === 'DELETE') {
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401, headers: corsHeaders });
                        const workspace = await getActiveWorkspace(user);
                        if (!workspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                        const linkId = parseInt(url.pathname.split('/').pop(), 10);
                        if (!linkId) return new Response(JSON.stringify({ message: 'Invalid Link ID' }), { status: 400, headers: corsHeaders });

                        const result = await env.DB.prepare("DELETE FROM short_links WHERE id = ? AND workspace_id = ?").bind(linkId, workspace.workspace_id).run().catch(() => null);
                        if (!result || result.changes === 0) {
                            return new Response(JSON.stringify({ message: 'Short link not found or unauthorized' }), { status: 404, headers: corsHeaders });
                        }

                        return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Not Found', requested_path: url.pathname }), { status: 404, headers: corsHeaders });
                }
            }
        } catch (error) {
            console.error(`Worker execution crash: ${error.message}`);
            return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), { status: 500, headers: corsHeaders });
        }
    },

    async scheduled(event, env, ctx) {
        console.log("⏰ Cloudflare Worker Cron Trigger Fired");
        const jwtSecret = env.JWT_SECRET || "socialhub-dev-super-secret-key-12345!@#";
        const encryptionSecret = env.ENCRYPTION_KEY || jwtSecret;
        
        if (!env.DB) {
            console.error("D1 database binding missing in Cron Trigger");
            return;
        }
        
        const nowStr = new Date().toISOString();

        // 0. Recover stuck 'publishing' posts (timeout/aborted connection recovery)
        try {
            const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const stuckPosts = await env.DB.prepare(
                `SELECT * FROM scheduled_posts 
                 WHERE status = 'publishing' 
                 AND (updated_at <= ? OR (updated_at IS NULL AND publish_at <= ?))`
            ).bind(tenMinsAgo, tenMinsAgo).all();

            if (stuckPosts.results && stuckPosts.results.length > 0) {
                console.log(`[Cron] Found ${stuckPosts.results.length} posts stuck in publishing status. Recovering...`);
                for (const post of stuckPosts.results) {
                    const timeWindowStart = new Date(new Date(post.publish_at).getTime() - 5 * 60 * 1000).toISOString();
                    const timeWindowEnd = new Date(new Date(post.publish_at).getTime() + 15 * 60 * 1000).toISOString();

                    const successLog = await env.DB.prepare(
                        `SELECT * FROM publish_logs 
                         WHERE social_account_id = ? AND status = 'success' 
                         AND (schedule_id = ? OR (published_at >= ? AND published_at <= ?))
                         ORDER BY id DESC LIMIT 1`
                    ).bind(post.account_id, post.id, timeWindowStart, timeWindowEnd).first().catch(() => null);

                    if (successLog) {
                        console.log(`[Cron] Post ID: ${post.id} was actually published successfully (Log ID: ${successLog.id}). Updating status...`);
                        await env.DB.prepare(
                            `UPDATE scheduled_posts 
                             SET status = 'published', published_at = ?, external_post_id = ?, error_message = NULL, updated_at = (datetime('now'))
                             WHERE id = ?`
                        ).bind(successLog.published_at, successLog.external_post_id, post.id).run();
                    } else {
                        console.log(`[Cron] Post ID: ${post.id} failed/timed out. Marking as failed.`);
                        await env.DB.prepare(
                            `UPDATE scheduled_posts 
                             SET status = 'failed', error_message = 'Publishing timed out or worker execution was aborted.', updated_at = (datetime('now'))
                             WHERE id = ?`
                        ).bind(post.id).run();
                    }
                }
            }
        } catch (recoverErr) {
            console.error("[Cron] Stuck posts recovery error:", recoverErr.message);
        }

        // 1. Process legacy publish_queue (if any exist)
        try {
            const { results } = await env.DB.prepare(
                "SELECT id, user_id FROM publish_queue WHERE status IN ('queued', 'retrying') AND scheduled_at <= ?"
            ).bind(nowStr).all();
            
            if (results && results.length > 0) {
                console.log(`Processing ${results.length} due publish queue items...`);
                for (const item of results) {
                    try {
                        console.log(`Processing queue item ID: ${item.id}`);
                        await PublishingEngine.publishQueueItem(env.DB, item.id, item.user_id, encryptionSecret);
                    } catch (e) {
                        console.error(`Error processing queue item ${item.id}:`, e.message);
                    }
                }
            }
        } catch (err) {
            console.error("Failed to run legacy publish queue runner:", err.message);
        }

        // 2. Process new scheduled_posts table
        try {
            console.log("[Cron] Running Scheduled Posts Queue Check...");
            
            const duePosts = await env.DB.prepare(
                `SELECT * FROM scheduled_posts 
                 WHERE status = 'scheduled' AND publish_at <= ? 
                 ORDER BY publish_at ASC 
                 LIMIT 20`
            ).bind(nowStr).all();

            if (duePosts.results && duePosts.results.length > 0) {
                console.log(`[Cron] Found ${duePosts.results.length} due scheduled posts.`);
                
                for (const post of duePosts.results) {
                    const startTime = Date.now();
                    console.log(`[Cron] Attempting to publish scheduled post ID: ${post.id}`);

                    // Optimistic locking
                    const lockResult = await env.DB.prepare(
                        "UPDATE scheduled_posts SET status = 'publishing', updated_at = (datetime('now')) WHERE id = ? AND status = 'scheduled'"
                    ).bind(post.id).run();

                    if (lockResult.meta.changes !== 1) {
                        console.warn(`[Cron] Post ID: ${post.id} was already locked or state changed, skipping.`);
                        continue;
                    }

                    try {
                        const socialAccount = await env.DB.prepare(
                            "SELECT * FROM social_accounts WHERE id = ? AND workspace_id = ?"
                        ).bind(post.account_id, post.workspace_id).first();

                        if (!socialAccount) {
                            throw new Error('Connected social account not found.');
                        }

                        const decryptedAccessToken = await decryptToken(socialAccount.access_token, encryptionSecret);
                        const credentials = { access_token: decryptedAccessToken, account_id: socialAccount.account_id };

                        const publisher = PublisherFactory.getPublisher(post.platform);
                        
                        const postObj = {
                            title: '',
                            caption: post.content,
                            media: [],
                            reply_to_id: post.reply_to_external_id || null
                        };

                        const result = await publisher.publish(postObj, credentials);

                        const duration = Date.now() - startTime;

                        if (result.success) {
                            const completedAt = new Date().toISOString();
                            await env.DB.prepare(
                                `UPDATE scheduled_posts 
                                 SET status = 'published', published_at = ?, external_post_id = ?, error_message = NULL, updated_at = (datetime('now'))
                                 WHERE id = ?`
                            ).bind(completedAt, result.provider_post_id, post.id).run();

                            // Audit Log
                            await env.DB.prepare(
                                `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
                                 VALUES (NULL, ?, 'success', NULL, ?, ?, ?)`
                            ).bind(socialAccount.id, result.provider_post_id, JSON.stringify(result), completedAt).run();

                            await createNotification(
                                env.DB,
                                post.workspace_id,
                                post.user_id,
                                "Post Berjaya Diterbitkan 🚀",
                                `Post dijadualkan anda berjaya diterbitkan di platform ${post.platform.toUpperCase()} (${socialAccount.account_name})`,
                                "success",
                                "/schedule.html"
                            );

                            console.log(`[Cron] Post ID: ${post.id} successfully published in ${duration}ms.`);

                            // Chain reaction: Release the next child post in the thread queue immediately
                            const nextChild = await env.DB.prepare(
                                `SELECT id FROM scheduled_posts 
                                 WHERE parent_post_id = ? AND status = 'waiting_trigger' 
                                 ORDER BY id ASC LIMIT 1`
                            ).bind(post.parent_post_id || post.id).first().catch(() => null);

                            if (nextChild) {
                                await env.DB.prepare(
                                    `UPDATE scheduled_posts 
                                     SET status = 'scheduled', publish_at = ?, reply_to_external_id = ?, updated_at = (datetime('now'))
                                     WHERE id = ?`
                                 ).bind(completedAt, result.provider_post_id, nextChild.id).run();
                                console.log(`[Cron] Chain reaction: Released child post ID ${nextChild.id} as a reply to Thread ID ${result.provider_post_id}`);
                            }
                        } else {
                            throw new Error(result.error_message || 'API Response Error');
                        }
                    } catch (err) {
                        const duration = Date.now() - startTime;
                        console.error(`[Cron] Post ID: ${post.id} failed to publish: ${err.message}`);
                        
                        const newRetryCount = (post.retry_count || 0) + 1;
                        
                        if (newRetryCount >= 3) {
                            await env.DB.prepare(
                                `UPDATE scheduled_posts 
                                 SET status = 'failed', retry_count = ?, error_message = ?, updated_at = (datetime('now'))
                                 WHERE id = ?`
                            ).bind(newRetryCount, err.message, post.id).run();

                            await createNotification(
                                env.DB,
                                post.workspace_id,
                                post.user_id,
                                "Gagal Menerbitkan Post ❌",
                                `Sistem gagal menerbitkan post anda di ${post.platform.toUpperCase()} (${socialAccount?.account_name || 'Akaun'}) selepas 3 cubaan. Ralat: ${err.message}`,
                                "error",
                                "/schedule.html"
                            );

                            console.error(`[Cron] Post ID: ${post.id} reached maximum retries (3) and failed permanently.`);
                        } else {
                            let delayMin = 5;
                            if (newRetryCount === 2) delayMin = 15;
                            else if (newRetryCount === 3) delayMin = 30;

                            const retryTime = new Date();
                            retryTime.setMinutes(retryTime.getMinutes() + delayMin);
                            const retryTimeStr = retryTime.toISOString();

                            await env.DB.prepare(
                                `UPDATE scheduled_posts 
                                 SET status = 'scheduled', publish_at = ?, retry_count = ?, error_message = ?, updated_at = (datetime('now'))
                                 WHERE id = ?`
                            ).bind(retryTimeStr, newRetryCount, err.message, post.id).run();

                            await createNotification(
                                env.DB,
                                post.workspace_id,
                                post.user_id,
                                "Cubaan Penerbitan Gagal ⚠️",
                                `Cubaan menerbitkan post anda di ${post.platform.toUpperCase()} (${socialAccount?.account_name || 'Akaun'}) gagal. Penjadualan semula dibuat pada ${retryTime.toLocaleTimeString()}. Ralat: ${err.message}`,
                                "warning",
                                "/schedule.html"
                            );

                            console.log(`[Cron] Post ID: ${post.id} rescheduled for retry at ${retryTimeStr} (Attempt ${newRetryCount} of 3)`);
                        }

                        await env.DB.prepare(
                            `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, response_payload, published_at) 
                                 VALUES (NULL, ?, 'failed', ?, ?, (datetime('now')))`
                        ).bind(post.account_id, err.message, JSON.stringify({ error: err.message, duration_ms: duration })).run();
                    }
                }
            }
        } catch (err) {
            console.error("Failed to run scheduled posts automation engine:", err.message);
        }

        // ==================== METRICS INSIGHTS SYNC (scheduled handler) ====================
        try {
            const publishedPosts = await env.DB.prepare(
                `SELECT sp.id, sp.external_post_id, sp.views_count, sp.likes_count,
                        sa.access_token as sa_access_token, sa.account_id as sa_account_id
                 FROM scheduled_posts sp
                 JOIN social_accounts sa ON sp.account_id = sa.id
                 WHERE sp.status = 'published' AND sp.platform = 'threads' AND sp.external_post_id IS NOT NULL
                 AND (sp.last_insights_sync IS NULL OR sp.last_insights_sync <= ?)
                 ORDER BY sp.published_at DESC
                 LIMIT 10`
            ).bind(new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()).all();

            if (publishedPosts.results && publishedPosts.results.length > 0) {
                console.log(`[CronSync] Syncing insights for ${publishedPosts.results.length} posts...`);
                for (const post of publishedPosts.results) {
                    try {
                        const decryptedAccessToken = await decryptToken(post.sa_access_token, encryptionSecret);
                        let views = 0, likes = 0, replies = 0, reposts = 0, quotes = 0;

                        // Only real Threads API — no mock in scheduled handler
                        // Proven metrics only: views, likes, replies, reposts, quotes
                        const insightsUrl = `https://graph.threads.net/v1.0/${post.external_post_id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${decryptedAccessToken}`;
                        const insightsRes = await fetch(insightsUrl);

                        if (insightsRes.ok) {
                            const data = await insightsRes.json();
                            if (data && Array.isArray(data.data)) {
                                views   = data.data.find(m => m.name === 'views')?.values?.[0]?.value   || 0;
                                likes   = data.data.find(m => m.name === 'likes')?.values?.[0]?.value   || 0;
                                replies = data.data.find(m => m.name === 'replies')?.values?.[0]?.value || 0;
                                reposts = data.data.find(m => m.name === 'reposts')?.values?.[0]?.value || 0;
                                quotes  = data.data.find(m => m.name === 'quotes')?.values?.[0]?.value  || 0;
                            }
                        } else {
                            // API failed — log error but SKIP DB update to preserve existing data
                            const errBody = await insightsRes.text().catch(() => '');
                            console.error(`[CronSync] Threads API ${insightsRes.status} for post ${post.id}: ${errBody.substring(0, 200)}`);
                            continue;
                        }

                        await env.DB.prepare(
                            `UPDATE scheduled_posts
                             SET views_count = ?, likes_count = ?, replies_count = ?, reposts_count = ?, quotes_count = ?,
                                 last_insights_sync = ?, updated_at = (datetime('now'))
                             WHERE id = ?`
                        ).bind(views, likes, replies, reposts, quotes, new Date().toISOString(), post.id).run();

                        console.log(`[CronSync] Post ${post.id}: views=${views}, likes=${likes}, replies=${replies}, reposts=${reposts}, quotes=${quotes}`);

                        // Trigger child posts if threshold met
                        const nextChild = await env.DB.prepare(
                            `SELECT * FROM scheduled_posts WHERE parent_post_id = ? AND status = 'waiting_trigger' ORDER BY id ASC LIMIT 1`
                        ).bind(post.id).first().catch(() => null);

                        if (nextChild) {
                            const threshold = nextChild.trigger_threshold || 100;
                            let isTriggered = false;
                            if (nextChild.trigger_type === 'views' && views >= threshold) isTriggered = true;
                            else if (nextChild.trigger_type === 'likes' && likes >= threshold) isTriggered = true;
                            if (isTriggered) {
                                await env.DB.prepare(
                                    `UPDATE scheduled_posts SET status = 'scheduled', publish_at = ?, reply_to_external_id = ?, updated_at = (datetime('now')) WHERE id = ?`
                                ).bind(new Date().toISOString(), post.external_post_id, nextChild.id).run();
                                console.log(`[CronSync] Trigger met! Released child post ${nextChild.id}`);
                            }
                        }
                    } catch (insightErr) {
                        console.error(`[CronSync] Error syncing post ${post.id}: ${insightErr.message}`);
                    }
                }
            }
        } catch (insightsSyncErr) {
            console.error('[CronSync] Insights sync block error:', insightsSyncErr.message);
        }

        // ==================== FOLLOWER COUNT SYNC (scheduled handler) ====================
        try {
            const threadAccounts = await env.DB.prepare(
                `SELECT DISTINCT sa.id as account_id, sa.access_token, sa.account_id as threads_user_id, sa.workspace_id
                 FROM social_accounts sa
                 WHERE sa.platform = 'threads' AND sa.access_token IS NOT NULL`
            ).all();
 
            if (threadAccounts.results && threadAccounts.results.length > 0) {
                for (const acct of threadAccounts.results) {
                    try {
                        const decryptedToken = await decryptToken(acct.access_token, encryptionSecret);
                        // Fetch real-time followers_count from Insights endpoint
                        const insightsUrl = `https://graph.threads.net/v1.0/${acct.threads_user_id}/threads_insights?metric=followers_count&access_token=${decryptedToken}`;
                        const insightsRes = await fetch(insightsUrl);
                        if (insightsRes.ok) {
                            const insightsData = await insightsRes.json();
                            if (insightsData.error) {
                                console.log(`[CronSync] followers_count not available for account ${acct.account_id}: ${insightsData.error.message}`);
                            } else if (insightsData.data && Array.isArray(insightsData.data)) {
                                const followersCount = insightsData.data[0]?.total_value?.value || 0;
                                await env.DB.prepare(
                                    `INSERT INTO workspace_analytics (workspace_id, account_id, platform, followers_count, recorded_at)
                                     VALUES (?, ?, 'threads', ?, datetime('now'))`
                                ).bind(acct.workspace_id, acct.account_id, followersCount).run();
                                console.log(`[CronSync] Real-time followers count account ${acct.account_id}: ${followersCount}`);
                            } else {
                                console.log(`[CronSync] followers_count field not returned for account ${acct.account_id}, skipping.`);
                            }
                        } else {
                            const errBody = await insightsRes.text().catch(() => '');
                            console.log(`[CronSync] Follower API ${insightsRes.status} for account ${acct.account_id}: ${errBody.substring(0, 100)}`);
                        }
                    } catch (followerErr) {
                        console.error(`[CronSync] Follower error account ${acct.account_id}: ${followerErr.message}`);
                    }
                }
            }
        } catch (followerSyncErr) {
            console.error('[CronSync] Follower sync block error:', followerSyncErr.message);
        }
    }
};
