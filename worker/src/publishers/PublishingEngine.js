/**
 * SocialHub Core Publishing Engine
 * Coordinates post validation, account authorizations, Strategy Pattern provider selection,
 * latency tracking, event logging, and status transitions.
 */

import { PublisherFactory } from './PublisherFactory.js';

// Simple event listeners registry
const eventListeners = {
    onPublishStart: [],
    onPublishSuccess: [],
    onPublishFailed: [],
    onRetryScheduled: []
};

// AES-GCM Decryption Helper
async function getEncryptionKey(secret) {
    const encoder = new TextEncoder();
    const secretBytes = encoder.encode(secret);
    const hash = await crypto.subtle.digest("SHA-256", secretBytes);
    return await crypto.subtle.importKey(
        "raw",
        hash,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );
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

export const PublishingEngine = {
    // ==================== EVENTS EMITTER ====================
    
    addEventListener(event, callback) {
        if (eventListeners[event]) {
            eventListeners[event].push(callback);
        }
    },

    emit(event, data) {
        if (eventListeners[event]) {
            eventListeners[event].forEach(cb => {
                try { cb(data); } catch (e) { console.error(`[PublishingEngine Event Error] ${e.message}`); }
            });
        }
    },

    // ==================== MAIN WORKFLOW PROCESSOR ====================

    /**
     * Process publication flow for a specific queue job
     * @param {object} db Cloudflare D1 Database binding
     * @param {number} queueId Queue ID
     * @param {number} userId User ID
     * @param {string} encryptionSecret AES Secret Key
     * @returns {Promise<object>} Standardized publisher result
     */
    async publishQueueItem(db, queueId, userId, encryptionSecret) {
        const startTime = Date.now();
        console.log(`[PublishingEngine] Initiating publication pipeline for queue ID: ${queueId}`);

        // 1. Fetch queue item joined with post contents scoping by workspace membership
        const queueItem = await db.prepare(
            `SELECT q.*, p.title, p.caption, p.workspace_id 
             FROM publish_queue q 
             JOIN posts p ON q.post_id = p.id 
             WHERE q.id = ? AND p.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = ?)`
        ).bind(queueId, userId).first();

        if (!queueItem) {
            throw new Error(`Schedule item ${queueId} not found or unauthorized.`);
        }

        // 2. Lock Queue Item to prevent race conditions
        const workerLockId = `worker-lock-${crypto.randomUUID()}`;
        await db.prepare("UPDATE publish_queue SET status = 'publishing', worker_id = ?, updated_at = ? WHERE id = ?")
            .bind(workerLockId, new Date().toISOString(), queueId)
            .run();

        this.emit('onPublishStart', { queueId, platform: queueItem.platform });

        // 3. Resolve OAuth Credentials from workspace
        const socialAccount = await db.prepare(
            "SELECT id, access_token, refresh_token FROM social_accounts WHERE workspace_id = ? AND platform = ? AND status = 'active'"
        ).bind(queueItem.workspace_id, queueItem.platform).first();

        if (!socialAccount) {
            const errStr = `Connected account credentials missing for platform: ${queueItem.platform}`;
            await this._handleFailure(db, queueId, queueItem, errStr, startTime, 0, false);
            return { success: false, error_message: errStr };
        }

        // Decrypt access token in memory (never exposed in returns)
        const decryptedToken = await decryptToken(socialAccount.access_token, encryptionSecret);

        // 4. Load Strategy Pattern Provider
        let publisher;
        try {
            publisher = PublisherFactory.getPublisher(queueItem.platform);
        } catch (e) {
            await this._handleFailure(db, queueId, queueItem, e.message, startTime, socialAccount.id, false);
            return { success: false, error_message: e.message };
        }

        // 5. Execute validations and publish
        const nowStr = new Date().toISOString();
        const duration = Date.now() - startTime;

        let result;
        try {
            result = await publisher.publish(queueItem, { access_token: decryptedToken });
        } catch (e) {
            result = {
                success: false,
                provider: queueItem.platform,
                provider_post_id: null,
                published_at: null,
                error_code: 'UNEXPECTED_ERROR',
                error_message: e.message,
                retryable: true // Retryable on uncaught network crash
            };
        }

        const endTime = Date.now();
        const executionDuration = endTime - startTime;

        if (result.success) {
            // SUCCESS FLOW
            await db.prepare(
                `UPDATE publish_queue 
                 SET status = 'published', last_attempt = ?, attempt_count = attempt_count + 1, worker_id = NULL, updated_at = ? 
                 WHERE id = ?`
            ).bind(nowStr, nowStr, queueId).run();

            await db.prepare("UPDATE posts SET status = 'published', published_at = ? WHERE id = ?")
                .bind(nowStr, queueItem.post_id)
                .run();

            // Write success logs
            await db.prepare(
                `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
                 VALUES (?, ?, 'success', NULL, ?, ?, ?)`
            ).bind(queueId, socialAccount.id, result.provider_post_id, JSON.stringify(result), nowStr).run();

            this.emit('onPublishSuccess', { queueId, provider_post_id: result.provider_post_id });
        } else {
            // FAILURE FLOW
            const isRetryable = result.retryable && queueItem.attempt_count < 2; // Capped at 3 total attempts (0, 1, 2)
            await this._handleFailure(db, queueId, queueItem, result.error_message || result.error_code, startTime, socialAccount.id, isRetryable);
        }

        return result;
    },

    // Private failure handler
    async _handleFailure(db, queueId, queueItem, errorMsg, startTime, socialAccountId, isRetryable) {
        const nowStr = new Date().toISOString();
        const duration = Date.now() - startTime;
        const newAttempts = queueItem.attempt_count + 1;

        if (isRetryable) {
            // Calculate backoff minutes (1m, 5m, 15m)
            const intervals = [1, 5, 15];
            const nextMinutes = intervals[Math.min(queueItem.attempt_count, intervals.length - 1)];
            const nextRetryDate = new Date(Date.now() + (nextMinutes * 60 * 1000)).toISOString();

            await db.prepare(
                `UPDATE publish_queue 
                 SET status = 'retrying', last_attempt = ?, attempt_count = ?, next_retry = ?, worker_id = NULL, updated_at = ? 
                 WHERE id = ?`
            ).bind(nowStr, newAttempts, nextRetryDate, nowStr, queueId).run();

            this.emit('onRetryScheduled', { queueId, attempt: newAttempts, nextRetry: nextRetryDate });
        } else {
            // Set statuses to failed
            await db.prepare(
                `UPDATE publish_queue 
                 SET status = 'failed', last_attempt = ?, attempt_count = ?, worker_id = NULL, updated_at = ? 
                 WHERE id = ?`
            ).bind(nowStr, newAttempts, nowStr, queueId).run();

            await db.prepare("UPDATE posts SET status = 'failed' WHERE id = ?")
                .bind(queueItem.post_id)
                .run();

            this.emit('onPublishFailed', { queueId, error: errorMsg });
        }

        // Record failed log audit trail
        await db.prepare(
            `INSERT INTO publish_logs (schedule_id, social_account_id, status, error_message, external_post_id, response_payload, published_at) 
             VALUES (?, ?, 'failed', ?, NULL, ?, ?)`
        ).bind(
            queueId, 
            socialAccountId, 
            errorMsg, 
            JSON.stringify({ error: errorMsg, duration_ms: duration }), 
            nowStr
        ).run();
    }
};

export default PublishingEngine;
