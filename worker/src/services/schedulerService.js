export const schedulerService = {
    async createSchedules(db, userId, postData) {
        const { content, targets, publish_at, timezone } = postData;
        const ids = [];
        for (const target of targets) {
            const result = await db.prepare(
                `INSERT INTO scheduled_posts (user_id, account_id, platform, content, media_urls, status, publish_at, timezone) 
                 VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?)`
            ).bind(
                userId, 
                target.accountId || null, 
                target.platform, 
                content, 
                JSON.stringify([]), 
                publish_at, 
                timezone || 'UTC'
            ).run();
            ids.push(result.meta.last_row_id);
        }
        return ids;
    }
};

export default schedulerService;
