/**
 * SlotManager.js
 * Smart Slot-Filling Post Scheduling Engine
 * Enforces standard Malaysian peak engagement publishing slots (MYT / UTC+8):
 *   09:00 (Pagi)
 *   12:00 (Tengah hari)
 *   15:00 (Petang)
 *   18:00 (Petang/Malam)
 *   21:00 (Malam)
 * 
 * Supports independent per-account / per-platform slot queues,
 * batch collision avoidance, and automatic multi-platform stagger.
 */

export const STANDARD_SLOTS = [9, 12, 15, 18, 21]; // Local hours (09:00, 12:00, 15:00, 18:00, 21:00)
export const DEFAULT_OFFSET_HOURS = 8; // UTC+8 for Asia/Kuala_Lumpur
export const MIN_LEAD_MINUTES = 15; // Minimum minutes in the future for today's slots
export const SLOT_WINDOW_MINUTES = 45; // Minutes window to consider a slot "occupied"

export class SlotManager {
    /**
     * Resolves timezone offset in hours.
     * Supports offset in minutes (-480 -> 8), offset hours, or timezone string.
     */
    static resolveOffsetHours(timezoneOrOffset) {
        if (typeof timezoneOrOffset === 'number') {
            if (Math.abs(timezoneOrOffset) >= 60) {
                // Timezone offset in minutes (JS getTimezoneOffset format: -480 for UTC+8)
                return -Math.round(timezoneOrOffset / 60);
            }
            return timezoneOrOffset;
        }

        if (typeof timezoneOrOffset === 'string') {
            const tz = timezoneOrOffset.trim().toLowerCase();
            if (tz.includes('kuala_lumpur') || tz.includes('singapore') || tz === 'gmt+8' || tz === 'utc+8') {
                return 8;
            }
            if (tz === 'utc' || tz === 'gmt') {
                return 0;
            }
            // Parse "+08:00" or "-05:00"
            const match = timezoneOrOffset.match(/([+-])(\d{1,2}):?(\d{2})?/);
            if (match) {
                const sign = match[1] === '-' ? -1 : 1;
                const hours = parseInt(match[2], 10);
                return sign * hours;
            }
        }

        return DEFAULT_OFFSET_HOURS;
    }

    /**
     * Finds the next available standard slot for a given workspace and account/platform.
     * 
     * @param {Object} db - Cloudflare D1 database or mock DB
     * @param {Object} params
     * @param {string|number} params.workspaceId - Active workspace ID
     * @param {string|number|null} [params.accountId] - Target social account ID
     * @param {string} [params.platform] - Target platform (e.g. 'threads', 'facebook')
     * @param {Date} [params.startDate] - Earliest date to look from (defaults to now)
     * @param {number|string} [params.timezone] - Timezone or offset
     * @param {Array<Object>} [params.existingBookedSlots] - In-memory list of already booked slots in batch: [{ accountId, platform, slotDate }]
     * @param {number} [params.staggerMinutes] - Stagger offset (e.g. +1 min for 2nd platform)
     * @returns {Promise<{ publishAt: string, slotHour: number, localDateStr: string }>}
     */
    static async findNextAvailableSlot(db, {
        workspaceId,
        accountId = null,
        platform = null,
        startDate = new Date(),
        timezone = DEFAULT_OFFSET_HOURS,
        existingBookedSlots = [],
        staggerMinutes = 0
    }) {
        const offsetHours = this.resolveOffsetHours(timezone);
        const now = startDate instanceof Date ? startDate : new Date(startDate);
        const minTimeMs = now.getTime() + MIN_LEAD_MINUTES * 60 * 1000;

        // 1. Fetch all currently booked / active posts from DB for this workspace
        // from beginning of today (UTC) onwards
        const todayUtcStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        
        let dbPosts = [];
        if (db && typeof db.prepare === 'function') {
            try {
                let query = `
                    SELECT id, account_id, platform, publish_at, status 
                    FROM scheduled_posts 
                    WHERE workspace_id = ? 
                      AND status IN ('scheduled', 'draft', 'publishing', 'published')
                      AND publish_at >= ?
                `;
                const binds = [workspaceId, todayUtcStart];

                // If specific account or platform is provided, filter or query all
                const res = await db.prepare(query).bind(...binds).all();
                dbPosts = res.results || [];
            } catch (err) {
                console.error("[SlotManager] Error querying existing scheduled posts:", err);
                dbPosts = [];
            }
        }

        // Filter booked posts relevant to this account/platform
        const isPostMatchingAccount = (post) => {
            if (accountId && post.account_id) {
                return String(post.account_id) === String(accountId);
            }
            if (platform && post.platform) {
                return post.platform.toLowerCase() === platform.toLowerCase();
            }
            return true;
        };

        const relevantDbPosts = dbPosts.filter(isPostMatchingAccount);

        // Helper to check if a specific candidate slot timestamp is occupied
        const isSlotOccupied = (slotTimestampMs) => {
            // Check against DB posts
            for (const post of relevantDbPosts) {
                if (!post.publish_at) continue;
                const postTimeMs = new Date(post.publish_at).getTime();
                if (Math.abs(postTimeMs - slotTimestampMs) <= SLOT_WINDOW_MINUTES * 60 * 1000) {
                    return true;
                }
            }

            // Check against in-memory booked slots for this batch
            for (const booked of existingBookedSlots) {
                const bookedTimeMs = booked.slotDate instanceof Date 
                    ? booked.slotDate.getTime() 
                    : new Date(booked.slotDate || booked.publishAt).getTime();

                const sameAccount = (accountId && booked.accountId)
                    ? String(booked.accountId) === String(accountId)
                    : (platform && booked.platform ? booked.platform.toLowerCase() === platform.toLowerCase() : true);

                if (sameAccount && Math.abs(bookedTimeMs - slotTimestampMs) <= SLOT_WINDOW_MINUTES * 60 * 1000) {
                    return true;
                }
            }

            return false;
        };

        // 2. Iterate through days (up to 30 days ahead)
        // Convert 'now' to local date representation
        const localNowMs = now.getTime() + offsetHours * 60 * 60 * 1000;
        const localDateObj = new Date(localNowMs);
        const localYear = localDateObj.getUTCFullYear();
        const localMonth = localDateObj.getUTCMonth();
        const localDay = localDateObj.getUTCDate();

        const MAX_DAYS = 30;
        for (let dayOffset = 0; dayOffset < MAX_DAYS; dayOffset++) {
            for (const slotHour of STANDARD_SLOTS) {
                // Construct slot in UTC
                const slotUtcMs = Date.UTC(localYear, localMonth, localDay + dayOffset, slotHour - offsetHours, 0, 0, 0);

                // Slot must be at least MIN_LEAD_MINUTES in the future
                if (slotUtcMs <= minTimeMs) {
                    continue;
                }

                // Check if slot is free for this account
                if (!isSlotOccupied(slotUtcMs)) {
                    // Apply stagger minutes (e.g. +1 min for second channel)
                    const finalTimestampMs = slotUtcMs + (staggerMinutes * 60 * 1000);
                    const finalDate = new Date(finalTimestampMs);
                    const localDateStr = `${localYear}-${String(localMonth + 1).padStart(2, '0')}-${String(localDay + dayOffset).padStart(2, '0')}`;

                    return {
                        publishAt: finalDate.toISOString(),
                        nominalSlotAt: new Date(slotUtcMs).toISOString(),
                        slotHour,
                        localDateStr,
                        dayOffset
                    };
                }
            }
        }

        // Fallback if 30 days are completely packed
        const fallbackDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        return {
            publishAt: fallbackDate.toISOString(),
            nominalSlotAt: fallbackDate.toISOString(),
            slotHour: 9,
            localDateStr: fallbackDate.toISOString().slice(0, 10),
            dayOffset: 1
        };
    }
}
