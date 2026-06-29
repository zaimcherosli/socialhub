/**
 * SocialHub Cloudflare Worker Backend Pipeline
 * Handles secure user authentication, PBKDF2 password hashing, HS256 JWT sessions,
 * OAuth platforms registry connection, RESTful post drafts composer, media asset galleries,
 * and the Core Scheduling & Queue Engine.
 */

import { PublishingEngine } from './publishers/PublishingEngine.js';
import { PublisherFactory } from './publishers/PublisherFactory.js';

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
            const url = new URL("https://www.threads.net/oauth/authorize");
            url.searchParams.set("client_id", clientId);
            url.searchParams.set("redirect_uri", redirectUri);
            url.searchParams.set("scope", "threads_basic,threads_content_publish");
            url.searchParams.set("response_type", "code");
            url.searchParams.set("state", state);
            return url.toString();
        },
        async exchangeCode(code, redirectUri, clientId, clientSecret) {
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
                throw new Error(err.error_message || "Meta Threads access token exchange failed");
            }

            const data = await response.json();
            const accessToken = data.access_token;
            const accountId = data.user_id;

            const profileResponse = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${accessToken}`);
            let accountName = `@threads_user_${accountId}`;
            if (profileResponse.ok) {
                const profile = await profileResponse.json();
                accountName = `@${profile.username}`;
            }

            return {
                access_token: accessToken,
                refresh_token: data.refresh_token || "threads-no-refresh-token",
                expires_in: data.expires_in || (86400 * 60),
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
            if (!payload || !payload.sub) return null;

            if (!env.DB) return { uuid: payload.sub, email: payload.email, name: payload.name, role: payload.role };

            return await env.DB.prepare("SELECT id, uuid, name, email, role, status FROM users WHERE uuid = ?")
                .bind(payload.sub)
                .first();
        };

        try {
            switch (url.pathname) {

                // ==================== SCHEDULING & QUEUE ENGINE REST API ====================

                case '/api/queue': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    // 1. GET /api/queue - List queue timelines
                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT q.*, p.title, p.caption 
                             FROM publish_queue q 
                             JOIN posts p ON q.post_id = p.id 
                             WHERE q.user_id = ? 
                             ORDER BY q.scheduled_at ASC`
                        ).bind(user.id).all();

                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    // 2. POST /api/queue - Insert new schedule
                    if (request.method === 'POST') {
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

                    const { ids } = await request.json();
                    if (!ids || !Array.isArray(ids) || ids.length === 0) {
                        return new Response(JSON.stringify({ message: 'IDs array required' }), { status: 400, headers: corsHeaders });
                    }

                    // Bulk delete from queue and reset post status to draft if no other queues exist
                    for (const queueId of ids) {
                        const queueItem = await env.DB.prepare("SELECT post_id FROM publish_queue WHERE id = ? AND user_id = ?").bind(queueId, user.id).first();
                        if (queueItem) {
                            await env.DB.prepare("DELETE FROM publish_queue WHERE id = ?").bind(queueId).run();
                            
                            // Check if post has other scheduled items
                            const activeCount = await env.DB.prepare("SELECT COUNT(*) as count FROM publish_queue WHERE post_id = ? AND status IN ('queued', 'publishing', 'retrying')").bind(queueItem.post_id).first();
                            if (!activeCount || activeCount.count === 0) {
                                await env.DB.prepare("UPDATE posts SET status = 'draft', scheduled_at = NULL WHERE id = ?").bind(queueItem.post_id).run();
                            }
                        }
                    }

                    return new Response(JSON.stringify({ success: true, message: 'Bulk schedules cancelled successfully' }), { status: 200, headers: corsHeaders });
                }

                // ==================== POSTS COMPOSER REST API ====================

                case '/api/posts': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare("SELECT id, user_id, title, caption, status, visibility, scheduled_at, published_at, created_at, updated_at FROM posts WHERE user_id = ? ORDER BY created_at DESC")
                            .bind(user.id)
                            .all();
                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        const { title, caption, status, visibility, scheduled_at } = await request.json();

                        const result = await env.DB.prepare("INSERT INTO posts (user_id, title, caption, status, visibility, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)")
                            .bind(user.id, title || '', caption || '', status || 'draft', visibility || 'public', scheduled_at || null)
                            .run();

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

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare(
                            `SELECT sp.*, sa.account_name 
                             FROM scheduled_posts sp
                             LEFT JOIN social_accounts sa ON sp.account_id = sa.id
                             WHERE sp.user_id = ? 
                             ORDER BY sp.publish_at ASC`
                        ).bind(user.id).all();
                        
                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    if (request.method === 'POST') {
                        const { title, content, targets, publish_at, timezone } = await request.json();
                        
                        if (!content || !targets || !Array.isArray(targets) || targets.length === 0 || !publish_at) {
                            return new Response(JSON.stringify({ message: 'Missing required parameters' }), { status: 400, headers: corsHeaders });
                        }

                        const insertedIds = [];
                        
                        for (const target of targets) {
                            const result = await env.DB.prepare(
                                `INSERT INTO scheduled_posts (user_id, account_id, platform, content, media_urls, status, publish_at, timezone) 
                                 VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`
                            ).bind(
                                user.id, 
                                target.accountId || null, 
                                target.platform, 
                                content, 
                                JSON.stringify([]), 
                                publish_at, 
                                timezone || 'UTC'
                            ).run();
                            
                            insertedIds.push(result.meta.last_row_id);
                        }

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
                        `SELECT status, COUNT(*) as count FROM scheduled_posts WHERE user_id = ? GROUP BY status`
                    ).bind(user.id).all();

                    counts.results.forEach(row => {
                        if (row.status === 'scheduled') summary.scheduled = row.count;
                        if (row.status === 'publishing') summary.publishing = row.count;
                        if (row.status === 'failed') summary.failed = row.count;
                    });

                    const upcomingTodayRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE user_id = ? AND status = 'scheduled' AND publish_at >= ? AND publish_at <= ?`
                    ).bind(user.id, startOfToday, endOfToday).first();
                    summary.upcoming_today = upcomingTodayRes ? upcomingTodayRes.count : 0;

                    const upcomingTomorrowRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE user_id = ? AND status = 'scheduled' AND publish_at >= ? AND publish_at <= ?`
                    ).bind(user.id, startOfTomorrow, endOfTomorrow).first();
                    summary.upcoming_tomorrow = upcomingTomorrowRes ? upcomingTomorrowRes.count : 0;

                    const next7DaysRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE user_id = ? AND status = 'scheduled' AND publish_at >= ? AND publish_at <= ?`
                    ).bind(user.id, startOfToday, endOf7Days).first();
                    summary.next_7_days = next7DaysRes ? next7DaysRes.count : 0;

                    const publishedTodayRes = await env.DB.prepare(
                        `SELECT COUNT(*) as count FROM scheduled_posts 
                         WHERE user_id = ? AND status = 'published' AND published_at >= ? AND published_at <= ?`
                    ).bind(user.id, startOfToday, endOfToday).first();
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
                                    const credentials = { access_token: decryptedAccessToken };

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

                    if (request.method === 'GET') {
                        const { results } = await env.DB.prepare("SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC")
                            .bind(user.id)
                            .all();
                        return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                }

                case '/api/media/upload': {
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

                    const formData = await request.formData();
                    const file = formData.get('file');
                    const width = parseInt(formData.get('width')) || null;
                    const height = parseInt(formData.get('height')) || null;

                    if (!file) return new Response(JSON.stringify({ message: 'No file uploaded' }), { status: 400, headers: corsHeaders });

                    const originalName = file.name;
                    const mimeType = file.type;
                    const fileSize = file.size;
                    const filename = sanitizeFilename(originalName);

                    const buffer = await file.arrayBuffer();
                    const base64Str = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                    const dataUrl = `data:${mimeType};base64,${base64Str}`;

                    const result = await env.DB.prepare("INSERT INTO media (user_id, filename, original_name, mime_type, file_size, width, height, storage_provider, storage_key, thumbnail) VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?)")
                        .bind(user.id, filename, originalName, mimeType, fileSize, width, height, dataUrl, dataUrl)
                        .run();

                    const newMediaId = result.meta.last_row_id;
                    const uploadedRecord = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(newMediaId).first();

                    return new Response(JSON.stringify({ success: true, message: 'Uploaded successfully', media: uploadedRecord }), { status: 201, headers: corsHeaders });
                }

                // ==================== OAUTH FLOWS ====================

                case '/api/oauth/connect': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });

                    const platform = url.searchParams.get('platform');
                    const provider = OAuthProviders[platform];
                    if (!provider) return new Response(JSON.stringify({ message: `Platform '${platform}' not supported` }), { status: 400, headers: corsHeaders });

                    const clientIdKey = `${platform.toUpperCase()}_CLIENT_ID`;
                    const clientId = env[clientIdKey];
                    if (!clientId) {
                        return new Response(JSON.stringify({ error: `Environment variable '${clientIdKey}' is missing or not configured on Cloudflare.` }), { status: 500, headers: corsHeaders });
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
                    if (!state) return new Response('State parameter missing', { status: 400 });

                    const statePayload = await verifyJWT(state, jwtSecret);
                    if (!statePayload || !statePayload.sub || !statePayload.platform) return new Response('Invalid state', { status: 403 });

                    const userUuid = statePayload.sub;
                    const platform = statePayload.platform;
                    const provider = OAuthProviders[platform];
                    if (!provider) return new Response('Provider missing', { status: 400 });
                    if (!env.DB) return new Response('DB missing', { status: 500 });

                    const user = await env.DB.prepare("SELECT id FROM users WHERE uuid = ?").bind(userUuid).first();
                    if (!user) return new Response('User not found', { status: 404 });

                    const clientIdKey = `${platform.toUpperCase()}_CLIENT_ID`;
                    const clientSecretKey = `${platform.toUpperCase()}_CLIENT_SECRET`;
                    const clientId = env[clientIdKey];
                    const clientSecret = env[clientSecretKey];

                    if (!clientId || !clientSecret) {
                        return new Response(`OAuth Configuration Error: Missing '${clientIdKey}' or '${clientSecretKey}' environment variables on Cloudflare.`, { status: 500 });
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

                    const existingAccount = await env.DB.prepare("SELECT id FROM social_accounts WHERE user_id = ? AND platform = ? AND account_id = ?")
                        .bind(user.id, platform, tokenData.account_id)
                        .first();

                    if (existingAccount) {
                        await env.DB.prepare("UPDATE social_accounts SET account_name = ?, access_token = ?, refresh_token = ?, expires_at = ?, status = 'active', updated_at = ? WHERE id = ?")
                            .bind(tokenData.account_name, encryptedAccessToken, encryptedRefreshToken, expiresAt, nowStr, existingAccount.id)
                            .run();
                    } else {
                        await env.DB.prepare("INSERT INTO social_accounts (user_id, platform, account_name, account_id, access_token, refresh_token, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')")
                            .bind(user.id, platform, tokenData.account_name, tokenData.account_id, encryptedAccessToken, encryptedRefreshToken, expiresAt)
                            .run();
                    }

                    const frontendOrigin = env.FRONTEND_ORIGIN || "http://localhost:5173";
                    return Response.redirect(`${frontendOrigin}/accounts.html?success=true`, 302);
                }

                // ==================== SOCIAL CHANNELS REST API ====================

                case '/api/social/accounts': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: corsHeaders });

                    const { results } = await env.DB.prepare("SELECT id, platform, account_name, account_id, expires_at, status, created_at FROM social_accounts WHERE user_id = ?").bind(user.id).all();
                    return new Response(JSON.stringify({ success: true, accounts: results }), { status: 200, headers: corsHeaders });
                }

                case '/api/publish/logs': {
                    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
                    const user = await getAuthUser();
                    if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                    if (!env.DB) return new Response(JSON.stringify({ results: [] }), { status: 200, headers: corsHeaders });

                    const { results } = await env.DB.prepare(
                        `SELECT l.*, q.platform, p.title 
                         FROM publish_logs l 
                         LEFT JOIN publish_queue q ON l.schedule_id = q.id 
                         LEFT JOIN posts p ON q.post_id = p.id 
                         ORDER BY l.published_at DESC`
                    ).all();
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
                            const credentials = { access_token: decryptedAccessToken };

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
                                     VALUES (?, ?, 'success', NULL, ?, ?, ?)`
                                ).bind(spId, socialAccount.id, result.provider_post_id, JSON.stringify(result), nowStr).run();

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

                        if (request.method === 'PUT') {
                            const { status, publish_at, timezone, content } = await request.json();
                            
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

                    // Match /api/media/:id
                    const mediaMatch = url.pathname.match(/^\/api\/media\/(\d+)$/);
                    if (mediaMatch) {
                        const mediaId = parseInt(mediaMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        if (request.method === 'PUT') {
                            const { filename, is_favorite } = await request.json();
                            const nowStr = new Date().toISOString();

                            if (filename !== undefined) {
                                const cleanFilename = sanitizeFilename(filename);
                                await env.DB.prepare("UPDATE media SET filename = ?, updated_at = ? WHERE id = ? AND user_id = ?")
                                    .bind(cleanFilename, nowStr, mediaId, user.id)
                                    .run();
                            }

                            if (is_favorite !== undefined) {
                                const favInt = is_favorite ? 1 : 0;
                                await env.DB.prepare("UPDATE media SET is_favorite = ?, updated_at = ? WHERE id = ? AND user_id = ?")
                                    .bind(favInt, nowStr, mediaId, user.id)
                                    .run();
                            }

                            const updatedMedia = await env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(mediaId).first();
                            return new Response(JSON.stringify({ success: true, media: updatedMedia }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            const result = await env.DB.prepare("DELETE FROM media WHERE id = ? AND user_id = ?").bind(mediaId, user.id).run();
                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Asset not found' }), { status: 404, headers: corsHeaders });
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

                        if (request.method === 'GET') {
                            const { results } = await env.DB.prepare("SELECT m.* FROM media m JOIN post_media pm ON m.id = pm.media_id WHERE pm.post_id = ?").bind(postId).all();
                            return new Response(JSON.stringify({ success: true, results }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'POST') {
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

                        const original = await env.DB.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").bind(postId, user.id).first();
                        if (!original) return new Response(JSON.stringify({ message: 'Post not found' }), { status: 404, headers: corsHeaders });

                        const newTitle = original.title ? `${original.title} (Copy)` : 'Copy';
                        const result = await env.DB.prepare("INSERT INTO posts (user_id, title, caption, status, visibility, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)")
                            .bind(user.id, newTitle, original.caption, 'draft', original.visibility, null)
                            .run();

                        const newPostId = result.meta.last_row_id;

                        const mediaAttachments = await env.DB.prepare("SELECT media_id FROM post_media WHERE post_id = ?").bind(postId).all();
                        for (const row of mediaAttachments.results) {
                            await env.DB.prepare("INSERT INTO post_media (post_id, media_id) VALUES (?, ?)").bind(newPostId, row.media_id).run();
                        }

                        return new Response(JSON.stringify({ success: true, message: 'Post duplicated successfully', id: newPostId }), { status: 201, headers: corsHeaders });
                    }

                    // Match /api/posts/:id
                    const postMatch = url.pathname.match(/^\/api\/posts\/(\d+)$/);
                    if (postMatch) {
                        const postId = parseInt(postMatch[1]);
                        const user = await getAuthUser();
                        if (!user) return new Response(JSON.stringify({ message: 'Unauthorized session' }), { status: 401, headers: corsHeaders });
                        if (!env.DB) return new Response(JSON.stringify({ message: 'Database missing' }), { status: 500, headers: corsHeaders });

                        if (request.method === 'GET') {
                            const post = await env.DB.prepare("SELECT * FROM posts WHERE id = ? AND user_id = ?").bind(postId, user.id).first();
                            if (!post) return new Response(JSON.stringify({ message: 'Post not found' }), { status: 404, headers: corsHeaders });
                            return new Response(JSON.stringify({ success: true, post }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'PUT') {
                            const { title, caption, status, visibility, scheduled_at } = await request.json();
                            const nowStr = new Date().toISOString();
                            
                            const result = await env.DB.prepare("UPDATE posts SET title = ?, caption = ?, status = ?, visibility = ?, scheduled_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
                                .bind(title, caption, status, visibility, scheduled_at || null, nowStr, postId, user.id)
                                .run();

                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });
                            return new Response(JSON.stringify({ success: true, message: 'Post updated successfully' }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'DELETE') {
                            const result = await env.DB.prepare("DELETE FROM posts WHERE id = ? AND user_id = ?").bind(postId, user.id).run();
                            if (result.meta.changes === 0) return new Response(JSON.stringify({ message: 'Post not found or unauthorized' }), { status: 404, headers: corsHeaders });
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

                        if (request.method === 'DELETE') {
                            await env.DB.prepare("DELETE FROM social_accounts WHERE id = ? AND user_id = ?").bind(accountId, user.id).run();
                            return new Response(JSON.stringify({ success: true, message: 'Account link deleted successfully' }), { status: 200, headers: corsHeaders });
                        }

                        if (request.method === 'POST') {
                            const account = await env.DB.prepare("SELECT platform FROM social_accounts WHERE id = ? AND user_id = ?").bind(accountId, user.id).first();
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

                            if (account.platform === 'threads') {
                                console.log('📢 Threads OAuth Reconnect Debug Log:');
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
                    }

                    // ==================== AUTH PORTIONS ====================
                    
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
                        await env.DB.prepare("INSERT INTO users (uuid, name, email, password_hash, role, status) VALUES (?, ?, ?, ?, 'user', 'active')").bind(userUuid, name.trim(), email.toLowerCase().trim(), passwordHash).run();

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
                            "SELECT * FROM social_accounts WHERE id = ? AND user_id = ?"
                        ).bind(post.account_id, post.user_id).first();

                        if (!socialAccount) {
                            throw new Error('Connected social account not found.');
                        }

                        const decryptedAccessToken = await decryptToken(socialAccount.access_token, encryptionSecret);
                        const credentials = { access_token: decryptedAccessToken };

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
