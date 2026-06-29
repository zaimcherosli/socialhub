import { PublisherFactory } from '../publishers/PublisherFactory.js';

export const publishService = {
    async publishPost(db, spId, userId, encryptionSecret) {
        // Architecture abstraction placeholder for publisher trigger
        return { success: true };
    }
};

export default publishService;
