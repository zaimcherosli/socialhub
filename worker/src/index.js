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
            url.searchParams.set("scope", "threads_basic,threads_content_publish");
            url.searchParams.set("response_type", "code");
            url.searchParams.set("state", state);
            return url.toString() + '#weblink';
        },
        async exchangeCode(code, redirectUri, clientId, clientSecret) {
            if (clientId.includes("mock") || code.includes("mock") || redirectUri.includes("localhost") || redirectUri.includes("127.0.0.1")) {
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
            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                accountName = `@${profile.username}`;
            }

            return {
                access_token: finalToken,
                refresh_token: data.refresh_token || "threads-no-refresh-token",
                expires_in: expiresIn,
                account_name: accountName,
                account_id: accountId.toString()
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
                console.error("[Facebook] Failed to exchange User token for long-lived token:", await fbExchangeResponse.text());
            }

            // 3. Fetch managed Facebook Pages with the long-lived User token to get permanent Page tokens
            const pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${longLivedUserToken}`);
            
            let finalToken = longLivedUserToken;
            let accountName = "Facebook User";
            let accountId = "facebook_user";
            
            if (pagesResponse.ok) {
                const pagesData = await pagesResponse.json();
                const pages = pagesData.data || [];
                if (pages.length > 0) {
                    // Use the Page Access Token which is permanent (never expires)
                    finalToken = pages[0].access_token;
                    accountName = `${pages[0].name} (FB Page)`;
                    accountId = pages[0].id;
                } else {
                    throw new Error("No Facebook Pages found. Ensure you manage at least one Page and granted pages_show_list permission.");
                }
            } else {
                throw new Error("Failed to retrieve Facebook Pages from User profile.");
            }

            return {
                access_token: finalToken,
                refresh_token: "facebook-no-refresh-token",
                expires_in: 5184000, // 60 days reference representation
                account_name: accountName,
                account_id: accountId.toString()
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

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }

        // Shared Auth helper
        const getAuthUser = async () => {
            const authHeader = request.headers.get('Authorization');
            if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
            
            const token = authHeader.split(' ')[1];
            const payload = await verifyJWT(token, jwtSecret);
            if (!payload || !payload.sub) return null;            if (!env.DB) return { uuid: payload.sub, email: payload.email, name: payload.name, role: payload.role };

            return await env.DB.prepare("SELECT id, uuid, name, email, role, status FROM users WHERE uuid = ?")
                .bind(payload.sub)
                .first();
        };

        const PLANS = {
            free: { accounts: 1, posts: 10, ai_credits: 15, storage: 50 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant'] },
            starter: { accounts: 3, posts: 50, ai_credits: 10, storage: 500 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant'] },
            pro: { accounts: 10, posts: 500, ai_credits: 100, storage: 5 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics'] },
            agency: { accounts: 30, posts: 5000, ai_credits: 1000, storage: 50 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics', 'clients'] },
            enterprise: { accounts: 99999, posts: 999999, ai_credits: 999999, storage: 1000 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics', 'clients', 'custom_branding'] }
        };

        const getActiveWorkspace = async (user) => {
            if (!user) return null;
            return await env.DB.prepare(
                `SELECT m.role, w.id as workspace_id, w.uuid, w.name, w.slug, w.subscription_plan, w.subscription_status
                 FROM workspace_members m
                 JOIN workspaces w ON m.workspace_id = w.id
                 WHERE m.user_id = ?
                 ORDER BY w.id ASC`
            ).bind(user.id).first();
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

                    // GET: return current settings + usage
                    if (request.method === 'GET') {
                        const ws = await env.DB.prepare(
                            "SELECT ai_model, ai_api_key_enc FROM workspaces WHERE id = ?"
                        ).bind(activeWorkspace.workspace_id).first();

                        const plan = activeWorkspace.subscription_plan;
                        const maxCredits = PLANS[plan]?.ai_credits ?? 0;
                        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
                        const creditsRes = await env.DB.prepare(
                            "SELECT COUNT(*) as count FROM audit_logs WHERE workspace_id = ? AND action = 'ai_generate' AND created_at >= ?"
                        ).bind(activeWorkspace.workspace_id, startOfMonth).first();

                        return new Response(JSON.stringify({
                            success: true,
                            model: ws?.ai_model || env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-3b-instruct:free',
                            has_api_key: !!(ws?.ai_api_key_enc),
                            credits_used: creditsRes?.count || 0,
                            credits_max: maxCredits
                        }), { status: 200, headers: corsHeaders });
                    }

                    // POST: save model and/or API key
                    if (request.method === 'POST') {
                        if (activeWorkspace.role === 'viewer') {
                            return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot change settings.' }), { status: 403, headers: corsHeaders });
                        }
                        const { model, api_key } = await request.json();
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
                                "UPDATE workspaces SET ai_model = ?, ai_api_key_enc = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(model, encKey, activeWorkspace.workspace_id).run();
                        } else {
                            await env.DB.prepare(
                                "UPDATE workspaces SET ai_model = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(model, activeWorkspace.workspace_id).run();
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
                        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
                        const creditsRes = await env.DB.prepare(
                            "SELECT COUNT(*) as count FROM audit_logs WHERE workspace_id = ? AND action = 'ai_generate' AND created_at >= ?"
                        ).bind(activeWorkspace.workspace_id, startOfMonth).first();

                        currentCreditsUsed = creditsRes ? (creditsRes.count || 0) : 0;
                        if (currentCreditsUsed >= maxCredits) {
                            return new Response(JSON.stringify({ message: `AI credit limit reached: Your ${plan} plan allows up to ${maxCredits} AI generations per month. Please add your own API key in Settings to bypass this limit or upgrade your subscription.` }), { status: 403, headers: corsHeaders });
                        }
                    }

                    try {
                        const { businessType, product, targetAudience, goal, tone, language } = await request.json();
                        if (!businessType || !product) {
                            return new Response(JSON.stringify({ message: 'Business type and product/service are required.' }), { status: 400, headers: corsHeaders });
                        }

                        // Build env-like object overriding with workspace preferences
                        const aiEnv = { ...env };
                        if (wsAI?.ai_model) {
                            aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                        }
                        if (wsAI?.ai_api_key_enc) {
                            try {
                                // Attempt decrypt, fallback to raw value
                                const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                                if (decrypted) {
                                    aiEnv.OPENROUTER_API_KEY = decrypted;
                                    aiEnv.GEMINI_API_KEY = decrypted;
                                }
                            } catch (_) {
                                aiEnv.OPENROUTER_API_KEY = wsAI.ai_api_key_enc;
                                aiEnv.GEMINI_API_KEY = wsAI.ai_api_key_enc;
                            }
                        }

                        const provider = AIFactory.getProvider(aiEnv);
                        const performanceFeedback = await getPerformanceFeedback(env.DB, activeWorkspace.workspace_id);
                        const result = await provider.generateCaption({
                            businessType,
                            product: product + performanceFeedback,
                            targetAudience: targetAudience || 'General public',
                            goal: goal || 'Brand awareness',
                            tone: tone || 'Professional',
                            language: language || 'Bahasa Melayu'
                        });

                        await logActivity(activeWorkspace.workspace_id, user.id, 'ai_generate', `Generated caption for business "${businessType}": ${product.substring(0, 30)}...`);

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

                case '/api/ai/autopilot': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    const activeWorkspace = await getActiveWorkspace(user);
                    if (!activeWorkspace) return new Response(JSON.stringify({ message: 'No active workspace found' }), { status: 404, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    if (activeWorkspace.role === 'viewer') return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot create content.' }), { status: 403, headers: corsHeaders });

                    const { niche, targetAudience, platform, count, language, timezoneOffset, frequency } = await request.json();
                    if (!niche) {
                        return new Response(JSON.stringify({ message: 'Business niche is required.' }), { status: 400, headers: corsHeaders });
                    }

                    const wsAI = await env.DB.prepare(
                        "SELECT ai_model, ai_api_key_enc FROM workspaces WHERE id = ?"
                    ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                    // Build env-like object overriding with workspace preferences
                    const aiEnv = { ...env };
                    if (wsAI?.ai_model) {
                        aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                    }
                    if (wsAI?.ai_api_key_enc) {
                        try {
                            const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                            if (decrypted) {
                                aiEnv.OPENROUTER_API_KEY = decrypted;
                                aiEnv.GEMINI_API_KEY = decrypted;
                            }
                        } catch (_) {
                            aiEnv.OPENROUTER_API_KEY = wsAI.ai_api_key_enc;
                            aiEnv.GEMINI_API_KEY = wsAI.ai_api_key_enc;
                        }
                    }

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
                            frequency: parseInt(frequency) || 1
                        });

                        // Find connected account for this user & platform
                        const socialAccount = await env.DB.prepare(
                            "SELECT id FROM social_accounts WHERE user_id = ? AND platform = ? AND status = 'active' LIMIT 1"
                        ).bind(user.id, platform || 'threads').first();

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
                            
                            insertedPosts.push({
                                id: result.meta?.last_row_id || null,
                                content: post.content,
                                publish_at: post.publish_at,
                                status: finalStatus
                            });
                        }

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
                        const { name, slug } = await request.json();
                        if (!name || !slug) return new Response(JSON.stringify({ message: 'Name and slug are required' }), { status: 400, headers: corsHeaders });

                        try {
                            await env.DB.prepare(
                                "UPDATE workspaces SET name = ?, slug = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(name.trim(), slug.trim().toLowerCase(), activeWorkspace.workspace_id).run();

                            await logActivity(activeWorkspace.workspace_id, user.id, 'update_workspace', `Renamed workspace to "${name}"`);
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
                        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
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
                        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
                        const countRes = await env.DB.prepare("SELECT COUNT(*) as count FROM scheduled_posts WHERE workspace_id = ? AND created_at >= ?").bind(activeWorkspace.workspace_id, startOfMonth).first();
                        if (countRes && countRes.count >= limit) {
                            return new Response(JSON.stringify({ message: `Subscription limit reached: Maximum ${limit} posts per month allowed on ${plan} plan.` }), { status: 403, headers: corsHeaders });
                        }

                        const { title, content, targets, publish_at, timezone } = await request.json();
                        
                        if (!content || !targets || !Array.isArray(targets) || targets.length === 0 || !publish_at) {
                            return new Response(JSON.stringify({ message: 'Missing required parameters' }), { status: 400, headers: corsHeaders });
                        }

                        const insertedIds = [];
                        
                        for (const target of targets) {
                            const result = await env.DB.prepare(
                                `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, media_urls, status, publish_at, timezone) 
                                 VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`
                            ).bind(
                                user.id, 
                                activeWorkspace.workspace_id,
                                target.accountId || null, 
                                target.platform, 
                                content, 
                                JSON.stringify([]), 
                                publish_at, 
                                timezone || 'UTC'
                            ).run();
                            
                            insertedIds.push(result.meta.last_row_id);
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
                                             SET status = 'published', published_at = ?, error_message = NULL, updated_at = (datetime('now'))
                                             WHERE id = ?`
                                        ).bind(completedAt, post.id).run();

                                        await env.DB.prepare(
                                            `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
                                             VALUES (?, ?, 'success', NULL, ?, ?, ?)`
                                        ).bind(post.id, socialAccount.id, result.provider_post_id, JSON.stringify(result), completedAt).run();
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

                                    await env.DB.prepare("INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, response_payload, published_at) VALUES (?, ?, 'failure', ?, ?, (datetime('now')))")
                                        .bind(post.id, post.account_id, err.message, JSON.stringify({ error: err.message }))
                                        .run();
                                }
                            }
                        }

                        // ==================== METRICS INSIGHTS SYNC LOOP ====================
                        const publishedPosts = await env.DB.prepare(
                            `SELECT sp.*, sa.access_token as sa_access_token, sa.account_id as sa_account_id, pl.external_post_id
                             FROM scheduled_posts sp
                             JOIN social_accounts sa ON sp.account_id = sa.id
                             JOIN publish_logs pl ON sp.id = pl.schedule_id
                             WHERE sp.status = 'published' AND sp.platform = 'threads'
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

                                    if (decryptedAccessToken.includes('mock-threads-token') || env.ENVIRONMENT === 'development') {
                                        const hoursSincePublish = (Date.now() - new Date(post.published_at).getTime()) / (3600 * 1000);
                                        const baseMultiplier = Math.min(24, Math.max(1, hoursSincePublish));
                                        views = Math.floor(50 * baseMultiplier + Math.random() * 200);
                                        likes = Math.floor(views * (0.05 + Math.random() * 0.08));
                                        replies = Math.floor(likes * (0.05 + Math.random() * 0.1));
                                        reposts = Math.floor(likes * (0.02 + Math.random() * 0.05));
                                    } else {
                                        const insightsUrl = `https://graph.threads.net/v1.0/${post.external_post_id}/insights?metric=views,likes,replies,reposts&access_token=${decryptedAccessToken}`;
                                        const insightsRes = await fetch(insightsUrl);
                                        if (insightsRes.ok) {
                                            const data = await insightsRes.json();
                                            if (data && Array.isArray(data.data)) {
                                                views = data.data.find(m => m.name === 'views')?.values?.[0]?.value || 0;
                                                likes = data.data.find(m => m.name === 'likes')?.values?.[0]?.value || 0;
                                                replies = data.data.find(m => m.name === 'replies')?.values?.[0]?.value || 0;
                                                reposts = data.data.find(m => m.name === 'reposts')?.values?.[0]?.value || 0;
                                            }
                                        }
                                    }

                                    await env.DB.prepare(
                                        `UPDATE scheduled_posts 
                                         SET views_count = ?, likes_count = ?, replies_count = ?, reposts_count = ?, last_insights_sync = ?, updated_at = (datetime('now'))
                                         WHERE id = ?`
                                    ).bind(views, likes, replies, reposts, new Date().toISOString(), post.id).run();

                                    console.log(`[CronSync] Synced insights for post ID ${post.id}: views=${views}, likes=${likes}`);
                                } catch (insightErr) {
                                    console.error(`[CronSync] Failed to sync insights for post ${post.id}:`, insightErr.message);
                                }
                            }
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
                            scope: 'threads_basic,threads_content_publish',
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

                    if (!state) return Response.redirect(`${frontendOrigin}/accounts.html?error=state_missing`, 302);

                    const statePayload = await verifyJWT(state, jwtSecret);
                    if (!statePayload || !statePayload.sub || !statePayload.platform) return Response.redirect(`${frontendOrigin}/accounts.html?error=invalid_state`, 302);

                    const userUuid = statePayload.sub;
                    const platform = statePayload.platform;
                    const provider = OAuthProviders[platform];
                    if (!provider) return Response.redirect(`${frontendOrigin}/accounts.html?error=provider_missing`, 302);
                    if (!env.DB) return Response.redirect(`${frontendOrigin}/accounts.html?error=db_missing`, 302);

                    const user = await env.DB.prepare("SELECT id FROM users WHERE uuid = ?").bind(userUuid).first();
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

                    const existingAccount = await env.DB.prepare("SELECT id FROM social_accounts WHERE workspace_id = ? AND platform = ? AND account_id = ?")
                        .bind(activeWorkspace.workspace_id, platform, tokenData.account_id)
                        .first();

                    if (existingAccount) {
                        await env.DB.prepare("UPDATE social_accounts SET account_name = ?, access_token = ?, refresh_token = ?, expires_at = ?, status = 'active', updated_at = ? WHERE id = ?")
                            .bind(tokenData.account_name, encryptedAccessToken, encryptedRefreshToken, expiresAt, nowStr, existingAccount.id)
                            .run();
                    } else {
                        await env.DB.prepare("INSERT INTO social_accounts (user_id, workspace_id, platform, account_name, account_id, access_token, refresh_token, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')")
                            .bind(user.id, activeWorkspace.workspace_id, platform, tokenData.account_name, tokenData.account_id, encryptedAccessToken, encryptedRefreshToken, expiresAt)
                            .run();
                    }

                    await logActivity(activeWorkspace.workspace_id, user.id, 'connect_account', `Connected ${platform} account: ${tokenData.account_name}`);

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
                                     SET status = 'published', published_at = ?, error_message = NULL 
                                     WHERE id = ?`
                                ).bind(nowStr, spId).run();

                                await env.DB.prepare(
                                    `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
                                     VALUES (NULL, ?, 'success', NULL, ?, ?, ?)`
                                ).bind(socialAccount.id, result.provider_post_id, JSON.stringify(result), nowStr).run();

                                return new Response(JSON.stringify({ success: true, message: 'Published successfully', result }), { status: 200, headers: corsHeaders });
                            } else {
                                await env.DB.prepare(
                                    `UPDATE scheduled_posts 
                                     SET status = 'failed', error_message = ? 
                                     WHERE id = ?`
                                ).bind(result.error_message, spId).run();

                                return new Response(JSON.stringify({ success: false, message: result.error_message }), { status: 400, headers: corsHeaders });
                            }
                        } catch (err) {
                            await env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', error_message = ? WHERE id = ?").bind(err.message, spId).run();
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
                        const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
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
                        return new Response(JSON.stringify({ success: true, user }), { status: 200, headers: corsHeaders });
                    }

                    if (url.pathname === '/api/health') {
                        return new Response(JSON.stringify({ status: 'operational', environment: env.ENVIRONMENT || 'production', bindings: { d1_database: env.DB ? 'configured' : 'missing' } }), { status: 200, headers: corsHeaders });
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
                            media: []
                        };

                        const result = await publisher.publish(postObj, credentials);

                        const duration = Date.now() - startTime;

                        if (result.success) {
                            const completedAt = new Date().toISOString();
                            await env.DB.prepare(
                                `UPDATE scheduled_posts 
                                 SET status = 'published', published_at = ?, error_message = NULL, updated_at = (datetime('now'))
                                 WHERE id = ?`
                            ).bind(completedAt, post.id).run();

                            // Audit Log
                            await env.DB.prepare(
                                `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
                                 VALUES (?, ?, 'success', NULL, ?, ?, ?)`
                            ).bind(post.id, socialAccount.id, result.provider_post_id, JSON.stringify(result), completedAt).run();

                            console.log(`[Cron] Post ID: ${post.id} successfully published in ${duration}ms.`);
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

                            console.log(`[Cron] Post ID: ${post.id} rescheduled for retry at ${retryTimeStr} (Attempt ${newRetryCount} of 3)`);
                        }

                        await env.DB.prepare(
                            `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, response_payload, published_at) 
                             VALUES (?, ?, 'failure', ?, ?, (datetime('now')))`
                        ).bind(post.id, post.account_id, err.message, JSON.stringify({ error: err.message, duration_ms: duration })).run();
                    }
                }
            }
        } catch (err) {
            console.error("Failed to run scheduled posts automation engine:", err.message);
        }
    }
};
