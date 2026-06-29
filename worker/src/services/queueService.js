export const queueService = {
    async getPendingQueueItems(db, nowStr) {
        const { results } = await db.prepare(
            "SELECT * FROM scheduled_posts WHERE status = 'scheduled' AND publish_at <= ?"
        ).bind(nowStr).all();
        return results || [];
    }
};

export default queueService;
