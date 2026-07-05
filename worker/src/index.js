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
    const cleanLines = rawLines.map(l => l.replace(/[✅✨🏠📌🔥*‼️•⁠🏡]/g, '').replace(/^[-–\s]+/, '').trim());

    // Priority 1: Find the main listing line containing property type + transaction type
    // e.g. "For Sale - Semi D Cluster Two Storey House SP 10 Bandar Saujana Putra"
    const mainListingRegex = /(?:For\s*Sale|WTS|WTL|For\s*Rent|Sewa|Jual).*(?:Storey|Tingkat|Terrace|Teres|Semi.?D|Bungalow|Banglo|Condo|Apartment|Pangsapuri|Flat|House|Rumah)/i;
    const mainLine = cleanLines.find(l => mainListingRegex.test(l));
    if (mainLine) {
        // Strip the "For Sale - " prefix to get the actual property description
        return mainLine.replace(/^(?:For\s*Sale|WTS|WTL|For\s*Rent|Sewa|Jual)\s*[-–:]?\s*/i, '').substring(0, 100).trim();
    }

    // Priority 2: Find a line that combines property type AND a location/area name
    const propertyTypeRegex = /\b(?:Storey|Tingkat|Sty|Terrace|Teres|Semi.?D|Bungalow|Banglo|Condo|Condominium|Kondominium|Apartment|Pangsapuri|Flat|Townhouse|House|Rumah|Suite|Office|Shoplot|Land|Tanah|Lot|Cluster)\b/i;
    const locationKeyword = /\b(?:Bandar|Taman|Pandan|Subang|Shah Alam|Petaling|Ampang|Rawang|Semenyih|Dengkil|Klang|Cheras|Setapak|Puchong|Serdang|Cyberjaya|Putrajaya|Kajang|Sepang|Sri|KL|Kuala Lumpur|Damansara|Kepong|Selayang|Batu|Seremban|Nilai|Alam|Perdana|Indah|Permai|Damai|Maju|Jaya|Murni|Harmoni|Saujana|Putra|Prima|Utama|Raya|Seksyen|BSP|SP\s*\d+)\b/i;
    const bestTypeLine = cleanLines.find(l => propertyTypeRegex.test(l) && locationKeyword.test(l));
    if (bestTypeLine) return bestTypeLine.substring(0, 100).trim();

    // Priority 3: Any line with just a property type keyword
    const anyTypeLine = cleanLines.find(l => l.length > 5 && propertyTypeRegex.test(l) && !/Asking\s*Price|ASKING|PRICE|Land\s*Area|Built\s*Up|Bedrooms|Bathrooms|sqft/i.test(l));
    if (anyTypeLine) return anyTypeLine.substring(0, 100).trim();

    // Priority 4: Fallback to first non-trivial line
    const firstLine = cleanLines.find(l => l.length > 10 && !/^\d+|MAHAFIZ|IQI|REN|PEA|NEARBY|DETAILS|EASY\s*ACCESS|ASKING|PRICE/i.test(l));
    return firstLine ? firstLine.substring(0, 100).trim() : (scrapedTitle || "");
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

         throw new Error(result.error_message);
    }
}

// ── Telegram Bot API HTTP Helpers ──
async function sendTelegramMessage(token, chatId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
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
    return response.ok;
}

async function editTelegramMessage(token, chatId, messageId, text, replyMarkup = null) {
    const url = `https://api.telegram.org/bot${token}/editMessageText`;
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
    return response.ok;
}

async function answerCallbackQuery(token, callbackQueryId, text = null) {
    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
    const body = { callback_query_id: callbackQueryId };
    if (text) {
        body.text = text;
    }
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
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

                    const aiEnv = { ...env };
                    if (wsAI?.ai_model) {
                        aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                    }
                    if (wsAI?.ai_api_key_enc) {
                        try {
                            const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                            const resolvedKey = decrypted || wsAI.ai_api_key_enc;
                            if (resolvedKey) {
                                aiEnv.OPENROUTER_API_KEY = resolvedKey;
                                aiEnv.GEMINI_API_KEY = resolvedKey;
                                aiEnv.OPENAI_API_KEY = resolvedKey;
                                aiEnv._workspaceKeySet = true;
                            }
                        } catch (_) {}
                    }

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
                            getFactPreservingInstructions(wsAI?.custom_ai_instructions),
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
                            aiEnv.OPENAI_API_KEY = decrypted;
                            aiEnv._workspaceKeySet = true;
                        }
                    } catch (_) {}
                }

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
            free: { accounts: 1, posts: 10, ai_credits: 15, storage: 50 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant'] },
            starter: { accounts: 3, posts: 50, ai_credits: 10, storage: 500 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant'] },
            pro: { accounts: 10, posts: 500, ai_credits: 100, storage: 5 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics'] },
            agency: { accounts: 30, posts: 5000, ai_credits: 1000, storage: 50 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics', 'clients'] },
            enterprise: { accounts: 99999, posts: 999999, ai_credits: 999999, storage: 1000 * 1024 * 1024 * 1024, features: ['calendar', 'queue', 'ai_assistant', 'analytics', 'clients', 'custom_branding'] }
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
                    `SELECT m.role, w.id as workspace_id, w.uuid, w.name, w.slug, w.subscription_plan, w.subscription_status, w.whatsapp_number
                     FROM workspace_members m
                     JOIN workspaces w ON m.workspace_id = w.id
                     WHERE m.user_id = ? AND w.id = ?`
                ).bind(user.id, user.active_workspace_id).first();
                if (ws) return ws;
            }

            // Fallback to first available workspace
            const fallbackWs = await env.DB.prepare(
                `SELECT m.role, w.id as workspace_id, w.uuid, w.name, w.slug, w.subscription_plan, w.subscription_status, w.whatsapp_number
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
                            "SELECT ai_model, ai_api_key_enc, custom_ai_instructions FROM workspaces WHERE id = ?"
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
                            custom_ai_instructions: ws?.custom_ai_instructions || '',
                            credits_used: creditsRes?.count || 0,
                            credits_max: maxCredits
                        }), { status: 200, headers: corsHeaders });
                    }

                    // POST: save model and/or API key
                    if (request.method === 'POST') {
                        if (activeWorkspace.role === 'viewer') {
                            return new Response(JSON.stringify({ message: 'Forbidden: Viewers cannot change settings.' }), { status: 403, headers: corsHeaders });
                        }
                        const { model, api_key, custom_ai_instructions } = await request.json();
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
                                "UPDATE workspaces SET ai_model = ?, ai_api_key_enc = ?, custom_ai_instructions = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(model, encKey, custom_ai_instructions || null, activeWorkspace.workspace_id).run();
                        } else {
                            await env.DB.prepare(
                                "UPDATE workspaces SET ai_model = ?, custom_ai_instructions = ?, updated_at = (datetime('now')) WHERE id = ?"
                            ).bind(model, custom_ai_instructions || null, activeWorkspace.workspace_id).run();
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
                        let { businessType, product, targetAudience, goal, tone, language, presetType, customNote, localTimeContext } = await request.json();

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
                        const aiEnv = { ...env };
                        if (wsAI?.ai_model) {
                            aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                        }
                        if (wsAI?.ai_api_key_enc) {
                            try {
                                // Attempt decrypt, fallback to raw value
                                const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                                const resolvedKey = decrypted || wsAI.ai_api_key_enc;
                                const isValidKey = resolvedKey && (resolvedKey.startsWith('sk-') || resolvedKey.startsWith('AIza') || resolvedKey.length > 40);
                                if (isValidKey) {
                                    aiEnv.OPENROUTER_API_KEY = resolvedKey;
                                    aiEnv.GEMINI_API_KEY = resolvedKey;
                                    aiEnv.OPENAI_API_KEY = resolvedKey;
                                    aiEnv._workspaceKeySet = true;
                                }
                            } catch (_) {}
                        }

                        const provider = AIFactory.getProvider(aiEnv);
                        const performanceFeedback = await getPerformanceFeedback(env.DB, activeWorkspace.workspace_id);
                        const result = await provider.generateCaption({
                            businessType,
                            product: product + performanceFeedback,
                            targetAudience: targetAudience || 'General public',
                            goal: goal || 'Brand awareness',
                            tone: tone || 'Professional',
                            language: language || 'Bahasa Melayu',
                            customInstructions: [
                                getFactPreservingInstructions(wsAI?.custom_ai_instructions),
                                await getNicheInstructionsPrompt(env.DB, product)
                            ].filter(Boolean).join('\n\n')
                        });

                        await logActivity(activeWorkspace.workspace_id, user.id, 'ai_generate', `Generated caption for business "${businessType}": ${(product || '').substring(0, 30)}...`);

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
                        const { url, mediaUrl, context, tone, language, postFormat, timezoneOffset, index, triggerType, triggerThreshold } = await request.json();
                        if (!url) {
                            return new Response(JSON.stringify({ message: 'URL is required.' }), { status: 400, headers: corsHeaders });
                        }

                        // Get custom instructions from workspace settings
                        const wsAI = await env.DB.prepare(
                            "SELECT ai_model, ai_api_key_enc, custom_ai_instructions FROM workspaces WHERE id = ?"
                        ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                        const aiEnv = { ...env };
                        if (wsAI?.ai_model) {
                            aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                        }
                        if (wsAI?.ai_api_key_enc) {
                            try {
                                const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                                const resolvedKey = decrypted || wsAI.ai_api_key_enc;
                                // Only use if it looks like a real API key (sk-, AIza, or long enough)
                                const isValidKey = resolvedKey && (resolvedKey.startsWith('sk-') || resolvedKey.startsWith('AIza') || resolvedKey.length > 40);
                                if (isValidKey) {
                                    aiEnv.OPENROUTER_API_KEY = resolvedKey;
                                    aiEnv.GEMINI_API_KEY = resolvedKey;
                                    aiEnv.OPENAI_API_KEY = resolvedKey;
                                    aiEnv._workspaceKeySet = true;
                                }
                            } catch (_) {}
                        }

                        // Extract context from frontend or scrape URL for product details
                        let productContext = context || "";
                        
                        // Always try to scrape URL for richer product details
                        let scrapedTitle = "";
                        let scrapedDescription = "";
                        let scrapedImage = "";
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
                                 if (metas.image) scrapedImage = metas.image;

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

                        // Find the latest scheduled post for this workspace
                        const lastPost = await env.DB.prepare(
                            "SELECT publish_at FROM scheduled_posts WHERE workspace_id = ? AND status = 'scheduled' ORDER BY publish_at DESC LIMIT 1"
                        ).bind(activeWorkspace.workspace_id).first().catch(() => null);

                        let baseTime = new Date(Date.now() + 15 * 60 * 1000); // default to 15 minutes from now
                        if (lastPost && lastPost.publish_at) {
                            const lastTime = new Date(lastPost.publish_at);
                            if (lastTime.getTime() > Date.now()) {
                                baseTime = lastTime;
                            }
                        }

                        // Add stagger spacing based on the batch index (idx)
                        const publishAtDate = new Date(baseTime.getTime() + (idx + 1) * staggerMinutes * 60 * 1000);
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
                                const u = new URL(rawUrl);
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
                                // Try explicit Location/Lokasi label first
                                const locMatch = scrapedDescription.match(/(?:Location|Lokasi|Located\s*at|Terletak\s*di)\s*[:\-]?\s*([^\n,]+)/i);
                                if (locMatch) {
                                    locationInfo = locMatch[1].trim();
                                } else {
                                    // Try to extract from the property type line: area names after common area keywords
                                    const areaKeywords = /\b(Bandar|Taman|Pandan|Subang|Shah Alam|Petaling|Ampang|Rawang|Semenyih|Dengkil|Klang|Cheras|Setapak|Puchong|Serdang|Cyberjaya|Putrajaya|Kajang|Sepang|Sri|Damansara|Kepong|Selayang|Batu|Seremban|Nilai|Saujana|Putra|Prima|BSP|SP\s*\d+)\b[\w\s]*/i;
                                    const lines = scrapedDescription.split('\n').map(l => l.trim()).filter(Boolean);
                                    for (const line of lines) {
                                        const areaMatch = line.match(areaKeywords);
                                        if (areaMatch && areaMatch[0].length > 3) {
                                            locationInfo = areaMatch[0].trim().substring(0, 50);
                                            break;
                                        }
                                    }
                                }
                            }

                            const matchedPrice = extractPrice(scrapedDescription) || extractPrice(productContext);
                            const priceText = matchedPrice ? ` (${matchedPrice})` : "";

                            // Build a clean, professional WhatsApp greeting
                            let greetingTitle = productTitle.trim();
                            // Remove any leading bullet, dash, or spec-looking text
                            greetingTitle = greetingTitle.replace(/^[•\-–\s]+/, '').replace(/(?:Land\s*Area|Built\s*Up)\s*\d+.*/i, '').trim();
                            if (!greetingTitle) greetingTitle = "hartanah yang anda senaraikan";

                            let greetingText = `Hai, saya berminat dengan ${greetingTitle}`;
                            if (locationInfo && !greetingTitle.toLowerCase().includes(locationInfo.toLowerCase().split(' ')[0].toLowerCase())) {
                                greetingText += ` di ${locationInfo}`;
                            }
                            if (priceText) {
                                greetingText += priceText;
                            }
                            greetingText += `. Boleh bagi details?`;

                            finalCtaUrl = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(greetingText)}`;
                        }

                        let ctaPromptInstructions = "";
                        if (linkType === 'whatsapp') {
                            ctaPromptInstructions = `write a creative and engaging call to action phrase asking the user to WhatsApp or contact for more details (e.g. "Berminat? WhatsApp saya sekarang!", "Hubungi saya untuk details lanjut!", etc.). Do NOT include the URL link itself. If workspace copywriting guidelines/knowledge base are provided, follow them to write this CTA phrase.`;
                        } else {
                            ctaPromptInstructions = `write a creative and engaging call to action phrase that naturally fits the product or service described above, without mentioning specific platform names (do not say Shopee, Lazada, TikTok unless the product context explicitly mentions them). Do not include the URL itself. If workspace copywriting guidelines/knowledge base are provided, follow them to write this CTA phrase.`;
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
                        let customGuidelinesBlock = "";
                        const systemNicheRulesBlock = await getNicheInstructionsPrompt(env.DB, productContext);
                        
                        if (wsAI?.custom_ai_instructions) {
                            customGuidelinesBlock = `\n4. Follow these workspace-specific copywriting guidelines/knowledge base closely:\n${getFactPreservingInstructions(wsAI.custom_ai_instructions)}\n\n5. Follow these niche guidelines:\n${systemNicheRulesBlock}`;
                        } else {
                            customGuidelinesBlock = `\n4. Follow these niche guidelines:\n${systemNicheRulesBlock}`;
                        }

                        const systemPrompt = `You are a professional social media marketing expert in Malaysia.
Generate a high-converting, engaging post based on the following product/property details:
- Product/property info: ${productContext}
- Target Platform: Threads
- ${toneInstruction}
- Language: ${language || 'Malay'}

FACT PRESERVATION RULE:
You must strictly preserve the real facts from the product/property info (such as the actual location, price, room count, and amenities). Under no circumstances should you invent, guess, or hallucinate a fake price (like RM800,000) or a fake location (like Shah Alam) if it is not in the product info.
If your guidelines or rules ask you to avoid revealing the actual price or project name, simply do not mention them at all (omit them) or use general phrases like 'harga berpatutan' or 'lokasi strategik'. DO NOT fabricate or invent fake details.

CRITICAL RULES:
1. For general physical products (like Shopee, Lazada, TikTok Shop), DO NOT include the price (e.g. RMxx) in the copywriting. Keep the price secret to make the audience curious so they click the link.
2. For real estate, houses, apartments, or property listings (like PropMall, Mudah, Telegram real estate channels), you MUST include the property price (e.g. RM 325,000 or RM 325k) in the copywriting to attract buyers.
3. The copywriting ${formatInstructions}
4. If writing in Malay, use natural, casual, and conversational Malaysian Malay slangs/vocabulary (e.g. 'korang', 'je', 'boleh', 'nak') instead of formal Indonesian words ('kamu', 'bisa', 'yuk', 'sih', 'deh'). Do NOT always start the hooks with the same word (e.g. vary the opening hooks and sentence structure so they do not all start with 'weyh' or 'weh').
5. Focus on the ACTUAL product/property details (type, location, size, features, facilities) from the product info above. DO NOT write about the seller name, channel name, or listing source/platform name. Write as if YOU personally found or own this product/property.
6. NEVER include any phone numbers (e.g. 017-xxx xxxx, 601x-xxx xxxx), agent names, agency names (e.g. IQI Realty, PropNex), REN numbers, PEA numbers, or any contact details from the listing in the caption or CTA. The only contact method is via the link provided separately.
7. For real estate/properties, include specific hashtags based on transaction type:
   - If the property is for sale (contains WTS, Sale, Jual), include: #jualbelirumah #jualrumah #rumahuntukdijual #hartanahuntukdijual
   - If the property is for rent/lease (contains WTL, Rent, Sewa, Lease), include: #sewahartanah #sewarumah #rumahsewa #sewakondominium${customGuidelinesBlock}

Provide the output in a strict JSON format with the following keys. Return ONLY the JSON object, with no markdown code blocks or extra explanations:
{
  "caption": "write the caption here (include thread separators if thread storm)",
  "cta": "${ctaPromptInstructions.replace(/"/g, '\\"')}",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"]
}`;

                        const provider = AIFactory.getProvider(aiEnv);
                        
                        let responseText = "";
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
                            const res = await fetch(genUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    contents: [{ parts: [{ text: systemPrompt }] }],
                                    generationConfig: { responseMimeType: "application/json" }
                                })
                             });
                            if (res.ok) {
                                const data = await res.json();
                                responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
                            const res = await fetch(endpoint, {
                                method: "POST",
                                headers,
                                body: JSON.stringify({
                                    model: provider.model,
                                    messages: [{ role: "user", content: systemPrompt }],
                                    temperature: 0.7
                                })
                            });
                            if (res.ok) {
                                const data = await res.json();
                                responseText = data.choices?.[0]?.message?.content || "";
                            }
                        }

                        if (!responseText) {
                            throw new Error("AI provider returned empty response.");
                        }

                        // Clean up markdown block wrapping
                        const cleaned = responseText.replace(/```json/i, '').replace(/```/g, '').trim();
                        const parsed = JSON.parse(cleaned);

                        const caption = parsed.caption || parsed.text || parsed.content || "";
                        const rawHashtags = parsed.hashtags || parsed.tags || [];
                        let hashtagsText = Array.isArray(rawHashtags) ? rawHashtags.join(' ') : (typeof rawHashtags === 'string' ? rawHashtags : '');

                        // Programmatic topics/hashtags injection for real estate listings
                        const lowerCtx = (productContext || "").toLowerCase();
                        const isProperty = lowerCtx.includes("apartment") || lowerCtx.includes("semi d") || lowerCtx.includes("teres") || lowerCtx.includes("kondo") || lowerCtx.includes("house") || lowerCtx.includes("property") || lowerCtx.includes("hartanah") || lowerCtx.includes("bilik") || lowerCtx.includes("sqft") || url.includes("propmall") || url.includes("mudah");

                        if (isProperty) {
                            const isSale = lowerCtx.includes("wts") || lowerCtx.includes("sale") || lowerCtx.includes("jual");
                            const isRent = lowerCtx.includes("wtl") || lowerCtx.includes("rent") || lowerCtx.includes("sewa") || lowerCtx.includes("lease");

                            const saleTags = ["#jualbelirumah", "#jualrumah", "#rumahuntukdijual", "#hartanahuntukdijual"];
                            const rentTags = ["#sewahartanah", "#sewarumah", "#rumahsewa", "#sewakondominium"];

                            let extraTags = [];
                            if (isSale) {
                                extraTags = saleTags.filter(t => !hashtagsText.toLowerCase().includes(t.toLowerCase()));
                            } else if (isRent) {
                                extraTags = rentTags.filter(t => !hashtagsText.toLowerCase().includes(t.toLowerCase()));
                            }

                            if (extraTags.length > 0) {
                                hashtagsText = (hashtagsText + " " + extraTags.join(" ")).trim();
                            }
                        }

                        // Retrieve dynamic CTA from AI and sanitize
                        let finalCtaText = parsed.cta ? parsed.cta.trim() : "";
                        finalCtaText = finalCtaText.replace(/➡️/g, '').replace(/->/g, '').replace(/:$/g, '').trim();

                        const ctaText = finalCtaText 
                            ? `${finalCtaText} ➡️ ${finalCtaUrl}` 
                            : (linkType === 'whatsapp' ? `WhatsApp saya untuk info lanjut! ➡️ ${finalCtaUrl}` : `Dapatkan di sini! ➡️ ${finalCtaUrl}`);
                        
                        // Insert into DB
                        const hasTrigger = triggerType === 'views' || triggerType === 'likes';
                        const cards = (postFormat === 'short_thread' || postFormat === 'deep_thread')
                            ? caption.split(/[\n\r]*---thread-separator---[\n\r]*/).map(c => c.trim()).filter(Boolean)
                            : [];

                        if (hasTrigger && cards.length > 1) {
                            // 1. Insert Slide 1 (Parent)
                            const result = await env.DB.prepare(
                                `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, status, publish_at, created_at, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, (datetime('now')), (datetime('now')))`
                            ).bind(
                                user.id,
                                activeWorkspace.workspace_id,
                                accountId,
                                'threads',
                                cards[0],
                                finalStatus,
                                publishAt
                            ).run();
                            
                            const parentId = result.meta.last_row_id;
                            const imageSuffix = scrapedImage ? `\n\n📷 ${scrapedImage}` : "";

                            // 2. Insert subsequent slides as child posts waiting for trigger
                            for (let i = 1; i < cards.length; i++) {
                                let slideText = cards[i];
                                if (i === cards.length - 1) {
                                    slideText = `${slideText}\n\n${ctaText}\n\n${hashtagsText}${imageSuffix}`.trim();
                                }
                                
                                await env.DB.prepare(
                                    `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, status, publish_at, trigger_type, trigger_threshold, parent_post_id, created_at, updated_at)
                                     VALUES (?, ?, ?, ?, ?, 'waiting_trigger', ?, ?, ?, ?, (datetime('now')), (datetime('now')))`
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
                                    const lastCardIdx = cards.length - 1;
                                    cards[lastCardIdx] = `${cards[lastCardIdx]}\n\n${ctaText}\n\n${hashtagsText}${imageSuffix}`.trim();
                                    fullContent = cards.join('\n---thread-separator---\n');
                                } else {
                                    fullContent = `${caption}\n\n${ctaText}\n\n${hashtagsText}${imageSuffix}`.trim();
                                }
                            } else {
                                fullContent = `${caption}\n\n${ctaText}\n\n${hashtagsText}${imageSuffix}`.trim();
                            }

                            await env.DB.prepare(
                                `INSERT INTO scheduled_posts (user_id, workspace_id, account_id, platform, content, status, publish_at, created_at, updated_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, (datetime('now')), (datetime('now')))`
                            ).bind(
                                user.id,
                                activeWorkspace.workspace_id,
                                accountId,
                                'threads',
                                fullContent,
                                finalStatus,
                                publishAt
                            ).run();
                        }

                        return new Response(JSON.stringify({ success: true, status: finalStatus, publishAt }), { status: 200, headers: corsHeaders });
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
                        const { url, scrapedTitle, scrapedDescription, tone, language } = await request.json();
                        if (!url || !scrapedTitle) {
                            return new Response(JSON.stringify({ message: 'URL and Title are required.' }), { status: 400, headers: corsHeaders });
                        }

                        // Build env-like object overriding with workspace preferences
                        const aiEnv = { ...env };
                        if (wsAI?.ai_model) {
                            aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                        }
                        if (wsAI?.ai_api_key_enc) {
                            try {
                                const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                                const resolvedKey = decrypted || wsAI.ai_api_key_enc;
                                const isValidKey = resolvedKey && (resolvedKey.startsWith('sk-') || resolvedKey.startsWith('AIza') || resolvedKey.length > 40);
                                if (isValidKey) {
                                    aiEnv.OPENROUTER_API_KEY = resolvedKey;
                                    aiEnv.GEMINI_API_KEY = resolvedKey;
                                    aiEnv.OPENAI_API_KEY = resolvedKey;
                                    aiEnv._workspaceKeySet = true;
                                }
                            } catch (_) {}
                        }

                        let combinedInstructions = getFactPreservingInstructions(wsAI?.custom_ai_instructions || "");
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

                        // Build env-like object
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
                                    aiEnv.OPENAI_API_KEY = decrypted;
                                    aiEnv._workspaceKeySet = true;
                                }
                            } catch (_) {
                                aiEnv.OPENROUTER_API_KEY = wsAI.ai_api_key_enc;
                                aiEnv.GEMINI_API_KEY = wsAI.ai_api_key_enc;
                                aiEnv.OPENAI_API_KEY = wsAI.ai_api_key_enc;
                                aiEnv._workspaceKeySet = true;
                            }
                        }

                        let combinedInstructions = wsAI?.custom_ai_instructions || "";
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

                    const aiEnv = { ...env };
                    if (wsAI?.ai_model) {
                        aiEnv.OPENROUTER_MODEL = wsAI.ai_model;
                    }
                    if (wsAI?.ai_api_key_enc) {
                        try {
                            const decrypted = await decryptToken(wsAI.ai_api_key_enc, encryptionSecret);
                            const resolvedKey = decrypted || wsAI.ai_api_key_enc;
                            const isValidKey = resolvedKey && (resolvedKey.startsWith('sk-') || resolvedKey.startsWith('AIza') || resolvedKey.length > 40);
                            if (isValidKey) {
                                aiEnv.OPENROUTER_API_KEY = resolvedKey;
                                aiEnv.GEMINI_API_KEY = resolvedKey;
                                aiEnv.OPENAI_API_KEY = resolvedKey;
                                aiEnv._workspaceKeySet = true;
                            }
                        } catch (_) {}
                    }

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
                                aiEnv.OPENAI_API_KEY = decrypted;
                                aiEnv._workspaceKeySet = true;
                            }
                        } catch (_) {
                            aiEnv.OPENROUTER_API_KEY = wsAI.ai_api_key_enc;
                            aiEnv.GEMINI_API_KEY = wsAI.ai_api_key_enc;
                            aiEnv.OPENAI_API_KEY = wsAI.ai_api_key_enc;
                            aiEnv._workspaceKeySet = true;
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

                        const { title, content, targets, publish_at, timezone, triggerType, triggerThreshold } = await request.json();
                        
                        if (!content || !targets || !Array.isArray(targets) || targets.length === 0 || !publish_at) {
                            return new Response(JSON.stringify({ message: 'Missing required parameters' }), { status: 400, headers: corsHeaders });
                        }

                        const insertedIds = [];
                        const hasTrigger = triggerType === 'views' || triggerType === 'likes';
                        
                        for (const target of targets) {
                            const isThreads = target.platform === 'threads';
                            const cards = (isThreads && hasTrigger && (content.includes('---thread-separator---') || content.includes('[THREAD_DELIMITER]')))
                                ? content.split(/[\n\r]*(?:---thread-separator---|\[THREAD_DELIMITER\])[\n\r]*/).map(c => c.trim()).filter(Boolean)
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
                                    publish_at, 
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
                                        publish_at,
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
                                    content, 
                                    JSON.stringify([]), 
                                    publish_at, 
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
                                            const profileUrl = `https://graph.threads.net/v1.0/${acct.threads_user_id}?fields=threads_profile_picture_url,threads_biography,followers_count&access_token=${decryptedToken}`;
                                            const profileRes = await fetch(profileUrl);
                                            if (profileRes.ok) {
                                                const profileData = await profileRes.json();
                                                followersCount = profileData.followers_count || 0;
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

                    // 2. Fetch last 15 failed publish logs
                    const publishLogsRes = await env.DB.prepare(`
                        SELECT pl.id, pl.status, pl.error_message, pl.published_at, sa.platform, sa.account_name
                        FROM publish_logs pl
                        JOIN social_accounts sa ON pl.social_account_id = sa.id
                        WHERE sa.workspace_id = ? AND pl.status = 'failed'
                        ORDER BY pl.published_at DESC LIMIT 15
                    `).bind(activeWorkspace.workspace_id).all();

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

                    const { results } = await env.DB.prepare(
                        `SELECT w.id, w.name, w.subscription_plan, w.subscription_status, w.created_at, u.email as owner_email 
                         FROM workspaces w
                         LEFT JOIN workspace_members wm ON w.id = wm.workspace_id AND wm.role = 'owner'
                         LEFT JOIN users u ON wm.user_id = u.id
                         ORDER BY w.created_at DESC`
                    ).all();

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
                                const { id, niche_key, name, detection_keywords, rules } = await request.json();
                                if (!niche_key || !name || !detection_keywords || !rules) {
                                    return new Response(JSON.stringify({ message: 'All fields are required.' }), { status: 400, headers: corsHeaders });
                                }

                                if (id) {
                                    await env.DB.prepare(
                                        "UPDATE system_niche_rules SET niche_key = ?, name = ?, detection_keywords = ?, rules = ?, updated_at = datetime('now') WHERE id = ?"
                                    ).bind(niche_key.trim(), name.trim(), detection_keywords.trim(), typeof rules === 'string' ? rules : JSON.stringify(rules), id).run();
                                } else {
                                    await env.DB.prepare(
                                        "INSERT INTO system_niche_rules (niche_key, name, detection_keywords, rules) VALUES (?, ?, ?, ?)"
                                    ).bind(niche_key.trim(), name.trim(), detection_keywords.trim(), typeof rules === 'string' ? rules : JSON.stringify(rules)).run();
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
                        // Fetch real-time followers_count from Profile fields endpoint instead of insights API (no 24h delay)
                        const profileUrl = `https://graph.threads.net/v1.0/${acct.threads_user_id}?fields=followers_count&access_token=${decryptedToken}`;
                        const profileRes = await fetch(profileUrl);
                        if (profileRes.ok) {
                            const profileData = await profileRes.json();
                            const followersCount = profileData.followers_count || 0;
                            await env.DB.prepare(
                                `INSERT INTO workspace_analytics (workspace_id, account_id, platform, followers_count, recorded_at)
                                 VALUES (?, ?, 'threads', ?, datetime('now'))`
                            ).bind(acct.workspace_id, acct.account_id, followersCount).run();
                            console.log(`[CronSync] Real-time followers count account ${acct.account_id}: ${followersCount}`);
                        } else {
                            const errBody = await profileRes.text().catch(() => '');
                            console.error(`[CronSync] Real-time Follower API ${profileRes.status} for account ${acct.account_id}: ${errBody.substring(0, 100)}`);
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
