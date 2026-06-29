/* SocialHub Global Configuration Registry */

export const CONFIG = {
    API_BASE_URL: window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname.startsWith('192.168.') ||
                  window.location.hostname.startsWith('10.') ||
                  window.location.hostname.startsWith('172.')
        ? `http://${window.location.hostname}:8787/api`
        : 'https://api.socialhub.zaimrosli.my/api',
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
