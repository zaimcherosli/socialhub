/* SocialHub Image Operations Service
   Extracts visual dimensions and packages placeholders for client-side resizing, compression, and WebP transcoding. */

export const imageService = {
    /**
     * Parse dimension constraints from image file object
     * @param {File} file 
     * @returns {Promise<object>} { width, height }
     */
    getImageDimensions(file) {
        return new Promise((resolve) => {
            if (!file || !file.type.startsWith('image/')) {
                resolve({ width: null, height: null });
                return;
            }

            const img = new Image();
            img.onload = () => {
                const dimensions = {
                    width: img.naturalWidth,
                    height: img.naturalHeight
                };
                // Purge object URLs to avoid memory leaks
                URL.revokeObjectURL(img.src);
                resolve(dimensions);
            };
            img.onerror = () => {
                resolve({ width: null, height: null });
            };
            img.src = URL.createObjectURL(file);
        });
    },

    /**
     * Compresses and optionally downscales an image file using browser HTMLCanvasElement.
     * Preserves aspect ratio, reduces multi-megabyte photos/posters down to lightweight payloads
     * (~100KB-300KB) that upload instantaneously and fit comfortably within database limits.
     * @param {File} file 
     * @param {number} quality 0.1 - 1.0 scale (default: 0.82)
     * @param {number} maxWidth Maximum width constraint (default: 1920)
     * @param {number} maxHeight Maximum height constraint (default: 1920)
     * @returns {Promise<File>} Compressed File instance
     */
    async compressImage(file, quality = 0.82, maxWidth = 1920, maxHeight = 1920) {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            return file;
        }

        // Animated GIF and vector SVG should not be rasterized via canvas
        if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
            return file;
        }

        // Environment safety (Node.js test runners without DOM)
        if (typeof document === 'undefined' || typeof Image === 'undefined') {
            return file;
        }

        return new Promise((resolve) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(objectUrl);

                let { width, height } = img;

                // Calculate aspect ratio scaling
                if (width > maxWidth || height > maxHeight) {
                    const ratio = Math.min(maxWidth / width, maxHeight / height);
                    width = Math.max(1, Math.round(width * ratio));
                    height = Math.max(1, Math.round(height * ratio));
                }

                // If already lightweight (< 350KB) and within max dimensions, preserve original
                if (file.size <= 350 * 1024 && width === img.width && height === img.height) {
                    return resolve(file);
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return resolve(file);
                }

                // PNG preservation for small graphics or transparency, JPEG for heavy photos
                const isPng = file.type === 'image/png';
                const outputType = (isPng && file.size < 400 * 1024) ? 'image/png' : 'image/jpeg';

                if (outputType === 'image/jpeg') {
                    // Fill white background to prevent dark artifacts on transparent PNGs
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, width, height);
                }

                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob || blob.size >= file.size) {
                        // Fallback to original if compression did not yield size savings
                        return resolve(file);
                    }

                    const ext = outputType === 'image/jpeg' ? '.jpg' : (outputType === 'image/webp' ? '.webp' : '.png');
                    const baseName = file.name.replace(/\.[^/.]+$/, '');
                    const newFileName = `${baseName}${ext}`;

                    const compressedFile = new File([blob], newFileName, {
                        type: outputType,
                        lastModified: Date.now()
                    });

                    console.log(`[ImageService] Auto-compressed ${file.name} from ${(file.size / 1024).toFixed(0)}KB to ${(compressedFile.size / 1024).toFixed(0)}KB`);
                    resolve(compressedFile);
                }, outputType, quality);
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(file);
            };

            img.src = objectUrl;
        });
    },

    /**
     * Resizes images to match platform specifications
     * @param {File} file 
     * @param {number} maxWidth 
     * @param {number} maxHeight 
     * @returns {Promise<File>} Resized file object
     */
    async resizeImage(file, maxWidth = 1920, maxHeight = 1080) {
        return this.compressImage(file, 0.85, maxWidth, maxHeight);
    },

    /**
     * Convert images to WebP format
     * @param {File} file 
     * @returns {Promise<File>} WebP converted file object
     */
    async convertToWebP(file) {
        if (!file || !file.type || !file.type.startsWith('image/')) return file;
        if (typeof document === 'undefined' || typeof Image === 'undefined') return file;

        return new Promise((resolve) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(file);

            img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(file);

                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => {
                    if (!blob) return resolve(file);
                    const baseName = file.name.replace(/\.[^/.]+$/, '');
                    const webpFile = new File([blob], `${baseName}.webp`, {
                        type: 'image/webp',
                        lastModified: Date.now()
                    });
                    resolve(webpFile);
                }, 'image/webp', 0.85);
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(file);
            };

            img.src = objectUrl;
        });
    }
};

export default imageService;
