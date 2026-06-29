/* SocialHub R2 Asset Storage Abstraction Facade
   Wraps mediaService and uploadService to maintain backward compatibility with Phase 1 components. */

import { mediaService } from './mediaService.js';
import { uploadService } from './uploadService.js';
import { imageService } from './imageService.js';

export const storageService = {
    /**
     * Upload asset wrapper
     * @param {File} fileObject Browser File instance
     * @param {Function} onProgress progress callback
     * @returns {Promise<object>} Uploaded asset record
     */
    async uploadMedia(fileObject, onProgress = null) {
        console.log(`[StorageService Facade] Dispatching upload request for: ${fileObject.name}`);
        
        let dimensions = {};
        try {
            if (fileObject.type.startsWith('image/')) {
                dimensions = await imageService.getImageDimensions(fileObject);
            }
        } catch (e) {
            console.warn('[StorageService Facade] Dimension parsing skipped:', e);
        }

        const data = await uploadService.uploadFile(fileObject, dimensions, onProgress);
        return data.media;
    },

    /**
     * Get media assets list
     * @param {object} filters 
     * @returns {Promise<Array>} List of media objects
     */
    async getMedia(filters = {}) {
        console.log('[StorageService Facade] Dispatching fetch request');
        return await mediaService.getMedia();
    },

    /**
     * Delete media asset
     * @param {number|string} mediaId 
     * @returns {Promise<boolean>} Success confirmation
     */
    async deleteMedia(mediaId) {
        console.log(`[StorageService Facade] Dispatching delete request for ID: ${mediaId}`);
        return await mediaService.deleteMedia(mediaId);
    }
};

export default storageService;
