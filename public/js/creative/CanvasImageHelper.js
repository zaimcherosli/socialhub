/**
 * CanvasImageHelper.js
 * Aspect-ratio preserving image rendering, safe CORS handling, focal point cropping,
 * and photographic contrast overlays for the 1080x1080 Canvas Engine.
 *
 * Mandatory Safeguard 1:
 * - Uses image.crossOrigin = 'anonymous' safely on remote URLs
 * - Does not bypass browser CORS security
 * - Supports data URLs, local blob URLs, and remote media URLs
 */

export class CanvasImageHelper {
    /**
     * Parse focal point hints from art_direction.composition
     */
    static parseFocal(compositionHint = '') {
        const text = (compositionHint || '').toLowerCase();
        let focalX = 0.5;
        let focalY = 0.5;

        if (text.includes('kiri') || text.includes('left')) {
            focalX = 0.25;
        } else if (text.includes('kanan') || text.includes('right')) {
            focalX = 0.75;
        }

        if (text.includes('atas') || text.includes('top') || text.includes('upper')) {
            focalY = 0.3;
        } else if (text.includes('bawah') || text.includes('bottom') || text.includes('lower')) {
            focalY = 0.7;
        }

        return { focalX, focalY };
    }

    /**
     * Load an image safely respecting CORS and data URLs
     */
    static async loadImage(source) {
        if (!source) return null;
        if (typeof source !== 'string') {
            // Already an Image, Canvas, or ImageBitmap
            if (source.width && source.height) return source;
            return null;
        }

        return new Promise((resolve, reject) => {
            const img = new Image();

            // Only set crossOrigin on non-data URLs
            if (!source.startsWith('data:')) {
                img.crossOrigin = 'anonymous';
            }

            img.onload = () => resolve(img);
            img.onerror = (err) => {
                const warn = new Error(`Failed to load image from source: ${source.slice(0, 100)}`);
                warn.code = 'IMAGE_LOAD_FAILED';
                reject(warn);
            };

            img.src = source;
        });
    }

    /**
     * Draw image covering the designated area without stretching/distortion.
     * Respects focal offset to position human subjects optimally.
     */
    static drawImageCover(ctx, img, x, y, width, height, focalX = 0.5, focalY = 0.5) {
        if (!img || !img.width || !img.height) return;

        const imgWidth = img.width;
        const imgHeight = img.height;

        const scale = Math.max(width / imgWidth, height / imgHeight);
        const sourceWidth = width / scale;
        const sourceHeight = height / scale;

        // Position crop window according to focal points (0.0 to 1.0)
        let sourceX = (imgWidth - sourceWidth) * focalX;
        let sourceY = (imgHeight - sourceHeight) * focalY;

        // Clamp to image boundaries
        sourceX = Math.max(0, Math.min(sourceX, imgWidth - sourceWidth));
        sourceY = Math.max(0, Math.min(sourceY, imgHeight - sourceHeight));

        ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
    }

    /**
     * Draw image contained entirely within target dimensions with letterboxing/centering
     */
    static drawImageContain(ctx, img, x, y, width, height) {
        if (!img || !img.width || !img.height) return;

        const scale = Math.min(width / img.width, height / img.height);
        const targetW = img.width * scale;
        const targetH = img.height * scale;
        const targetX = x + (width - targetW) / 2;
        const targetY = y + (height - targetH) / 2;

        ctx.drawImage(img, targetX, targetY, targetW, targetH);
    }

    /**
     * Draw photographic subject in a clean rounded frame (Fallback when cutout_mode=true lacks transparency)
     */
    static drawFramedFallback(ctx, img, x, y, width, height, radius = 20, borderColor = 'rgba(255,255,255,0.2)') {
        if (!img) return;

        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, width, height, radius);
        } else {
            ctx.rect(x, y, width, height);
        }
        ctx.clip();

        this.drawImageCover(ctx, img, x, y, width, height, 0.5, 0.3);
        ctx.restore();

        // Border stroke
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, width, height, radius);
        } else {
            ctx.rect(x, y, width, height);
        }
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }

    /**
     * Apply subtle gradient contrast overlay to ensure headline & card readability over photos
     */
    static applyContrastOverlay(ctx, x, y, width, height, direction = 'vertical', baseColor = '#FFFFFF') {
        ctx.save();
        let grad;
        if (direction === 'vertical') {
            grad = ctx.createLinearGradient(x, y, x, y + height);
        } else {
            grad = ctx.createLinearGradient(x, y, x + width, y);
        }

        // Detect if baseColor is light or dark
        const isLight = baseColor.toLowerCase() === '#ffffff' || baseColor.toLowerCase() === '#fff' || 
                        baseColor.startsWith('rgba(255') || baseColor.startsWith('rgb(255');

        if (isLight) {
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
            grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.75)');
            grad.addColorStop(0.70, 'rgba(255, 255, 255, 0.70)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
        } else {
            const darkHex = baseColor.startsWith('#') ? baseColor : '#111111';
            grad.addColorStop(0, darkHex);
            grad.addColorStop(0.55, 'rgba(17, 17, 17, 0.65)');
            grad.addColorStop(1, darkHex);
        }

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, width, height);
        ctx.restore();
    }

    /**
     * Apply radial vignette to focus attention inward
     */
    static applyVignette(ctx, width, height, strength = 0.5) {
        ctx.save();
        const centerX = width / 2;
        const centerY = height / 2;
        const outerRadius = Math.sqrt(centerX * centerX + centerY * centerY);

        const grad = ctx.createRadialGradient(centerX, centerY, outerRadius * 0.35, centerX, centerY, outerRadius);
        grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        grad.addColorStop(1, `rgba(0, 0, 0, ${strength})`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }
}
