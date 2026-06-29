/* SocialHub Global Configuration Registry */

export const CONFIG = {
    API_BASE_URL: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:8787/api'
        : (window.location.origin.includes('zaimrosli.my')
            ? 'https://socialhub-worker.zaimrosli.my/api'
            : '/api'),
    PLATFORMS: {
        THREADS: 'threads',
        FACEBOOK: 'facebook',
        INSTAGRAM: 'instagram',
        LINKEDIN: 'linkedin',
        TIKTOK: 'tiktok',
        TWITTER: 'twitter'
    },
    SUPPORTED_MEDIA: {
        IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        VIDEO_TYPES: ['video/mp4', 'video/quicktime'],
        MAX_SIZE_MB: 50
    },
    SCHEDULER: {
        MIN_INTERVAL_MINUTES: 5,
        MAX_FUTURE_DAYS: 90
    }
};

export default CONFIG;
