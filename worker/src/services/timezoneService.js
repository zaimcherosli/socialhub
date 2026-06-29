export const timezoneService = {
    getCurrentTimeUtc() {
        return new Date().toISOString();
    }
};

export default timezoneService;
