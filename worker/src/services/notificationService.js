export const notificationService = {
    async sendFailureAlert(userId, postData, errorMessage) {
        console.warn(`[Alert] User: ${userId}, Post failed to publish: ${errorMessage}`);
    }
};

export default notificationService;
