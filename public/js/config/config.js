/* SocialHub Global Configuration Registry */

const hostname = typeof window !== 'undefined' && window.location ? window.location.hostname : 'localhost';

export const CONFIG = {
    API_BASE_URL: hostname === 'localhost' || 
                  hostname === '127.0.0.1' ||
                  hostname.startsWith('192.168.') ||
                  hostname.startsWith('10.') ||
                  hostname.startsWith('172.')
        ? `http://${hostname}:8787/api`
        : 'https://api.socialhub.kwikezee.my/api',
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
