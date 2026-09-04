/* SocialHub Media Upload Progress Coordinator Service
   Handles file type constraints, size limits, and initiates XHR uploads to track percentages. */

import { sessionService } from './sessionService.js';
import { CONFIG } from '../config/config.js';
import { imageService } from './imageService.js';

const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm'
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB Limit

export const uploadService = {
    /**
     * Validate file qualities
     * @param {File} file 
     * @returns {object} { isValid, error }
     */
    validateFile(file) {
        if (!file) {
            return { isValid: false, error: 'No file provided.' };
        }

        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return { 
                isValid: false, 
                error: `Format '${file.type}' not supported. Please upload JPEG, PNG, WEBP, GIF, or MP4.` 
            };
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            return { 
                isValid: false, 
                error: `File size exceeds the 10MB limit (Size: ${(file.size / 1024 / 1024).toFixed(1)}MB).` 
            };
        }

        return { isValid: true, error: null };
    },

    /**
     * Upload asset via XMLHttpRequest to support progress tracking
     * @param {File} file 
     * @param {object} dimensions { width, height }
     * @param {Function} onProgress Triggered with (percentageInt)
     * @returns {Promise<object>} Upload response
     */
    async uploadFile(file, dimensions = {}, onProgress = null) {
        const validation = this.validateFile(file);
        if (!validation.isValid) {
            throw new Error(validation.error);
        }

        // Auto-compress heavy images client-side before sending to server/D1
        let uploadPayload = file;
        if (file.type && file.type.startsWith('image/') && file.size > 350 * 1024) {
            try {
                uploadPayload = await imageService.compressImage(file, 0.82, 1920, 1920);
                if (uploadPayload !== file && (!dimensions.width || !dimensions.height)) {
                    const newDims = await imageService.getImageDimensions(uploadPayload);
                    dimensions = { ...dimensions, ...newDims };
                }
            } catch (compErr) {
                console.warn('[UploadService] Auto-compression fallback:', compErr);
                uploadPayload = file;
            }
        }

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const url = `${CONFIG.API_BASE_URL}/media/upload`;
            
            xhr.open('POST', url, true);
            
            // Inject JWT session authorization header
            const token = sessionService.getToken();
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }

            // Track upload progress percentage
            if (xhr.upload && onProgress) {
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = Math.round((e.loaded / e.total) * 100);
                        onProgress(percentComplete);
                    }
                };
            }

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        resolve(response);
                    } catch (e) {
                        reject(new Error('Invalid JSON response returned by upload API.'));
                    }
                } else {
                    try {
                        const errBody = JSON.parse(xhr.responseText);
                        reject(new Error(errBody.message || `Upload failed with status code: ${xhr.status}`));
                    } catch (e) {
                        reject(new Error(`Upload failed with status code: ${xhr.status}`));
                    }
                }
            };

            xhr.onerror = () => {
                reject(new Error('Connection interrupted during file upload dispatch.'));
            };

            // Package file chunk data
            const formData = new FormData();
            formData.append('file', file);
            if (dimensions.width) formData.append('width', dimensions.width);
            if (dimensions.height) formData.append('height', dimensions.height);
            
            xhr.send(formData);
        });
    }
};

export default uploadService;
