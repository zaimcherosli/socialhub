/**
 * SocialHub Platform Publisher Resolver Factory
 * Resolves specific BasePublisher provider strategy patterns.
 */

import { ThreadsPublisher } from './ThreadsPublisher.js';
import { FacebookPublisher } from './FacebookPublisher.js';
import { InstagramPublisher } from './InstagramPublisher.js';
import { LinkedInPublisher } from './LinkedInPublisher.js';
import { XPublisher } from './XPublisher.js';
import { TikTokPublisher } from './TikTokPublisher.js';

const PROVIDERS_MAP = {
    threads: ThreadsPublisher,
    facebook: FacebookPublisher,
    instagram: InstagramPublisher,
    linkedin: LinkedInPublisher,
    twitter: XPublisher,
    tiktok: TikTokPublisher
};

export class PublisherFactory {
    /**
     * Resolve and return a platform publisher strategy instance
     * @param {string} platform Target platform key
     * @returns {BasePublisher}
     */
    static getPublisher(platform) {
        const PlatformClass = PROVIDERS_MAP[platform.toLowerCase().trim()];
        if (!PlatformClass) {
            throw new Error(`Platform publisher target '${platform}' is unsupported or unregistered.`);
        }
        return new PlatformClass();
    }
}

export default PublisherFactory;
