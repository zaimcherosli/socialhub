/**
 * TextFittingEngine.js
 * Deterministic text measurement, multi-line wrapping, and progressive shrink-to-fit engine.
 *
 * Mandatory Copy-Integrity Rules (Issue 3):
 * - ZERO ellipsis (...) or truncation allowed on validated poster copy.
 * - Every character and word from the Creative Brief must be preserved verbatim.
 * - Allowed operations: word wrapping, reducing font size down to minFontSize, adjusting line height.
 * - If copy still exceeds bounds at minFontSize: returns a controlled overflow error state
 *   ({ overflow: true, error: { code: 'COPY_DOES_NOT_FIT', role } }) rather than clipping text.
 */

export class TextFittingEngine {
    // Minimum readable font sizes at 1080x1080
    static MIN_SIZES = {
        headline: 54,
        subheadline: 28,
        body: 26,
        bullet: 26,
        cta: 28,
        badge: 20,
        disclaimer: 18
    };

    /**
     * Wrap text into lines based on maxWidth and current context font
     */
    static wrapText(ctx, text, maxWidth) {
        if (!text || typeof text !== 'string') return [];
        const raw = text.trim().replace(/\s+/g, ' ');
        if (!raw) return [];

        const words = raw.split(' ');
        const lines = [];
        let currentLine = '';

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }

        if (currentLine) {
            lines.push(currentLine);
        }

        return lines;
    }

    /**
     * Measure multi-line text height and max line width
     */
    static measureMultiline(ctx, lines, lineHeight) {
        let maxLineWidth = 0;
        for (const line of lines) {
            const w = ctx.measureText(line).width;
            if (w > maxLineWidth) maxLineWidth = w;
        }
        return {
            width: maxLineWidth,
            height: lines.length * lineHeight
        };
    }

    /**
     * Fit text to a bounding box by progressively reducing font size down to minFontSize.
     * ZERO ellipsis or truncation. Returns controlled error if content exceeds box at min size.
     */
    static fitTextToBox(ctx, text, options = {}) {
        const {
            role = 'body',
            maxWidth = 800,
            maxHeight = 300,
            maxLines = 4,
            initialFontSize = 32,
            fontFamily = `'Inter', sans-serif`,
            fontWeight = '500',
            lineHeightMultiplier = 1.25,
            minFontSize = this.MIN_SIZES[role] || 24
        } = options;

        if (!text || typeof text !== 'string' || !text.trim()) {
            return {
                lines: [],
                fontSize: initialFontSize,
                font: `${fontWeight} ${initialFontSize}px ${fontFamily}`,
                lineHeight: Math.round(initialFontSize * lineHeightMultiplier),
                totalHeight: 0,
                width: 0,
                isReduced: false,
                overflow: false,
                warning: null,
                error: null
            };
        }

        const cleanText = text.trim();
        let currentSize = Math.max(initialFontSize, minFontSize);
        let isReduced = false;

        // Progressive shrink-to-fit loop
        while (currentSize >= minFontSize) {
            const fontString = `${fontWeight} ${currentSize}px ${fontFamily}`;
            ctx.font = fontString;
            const lineHeight = Math.round(currentSize * lineHeightMultiplier);
            const wrapped = this.wrapText(ctx, cleanText, maxWidth);
            const totalH = wrapped.length * lineHeight;

            if (wrapped.length <= maxLines && totalH <= maxHeight) {
                // Fits cleanly without dropping any content
                const measured = this.measureMultiline(ctx, wrapped, lineHeight);
                return {
                    lines: wrapped,
                    fontSize: currentSize,
                    font: fontString,
                    lineHeight,
                    totalHeight: totalH,
                    width: measured.width,
                    isReduced,
                    overflow: false,
                    warning: null,
                    error: null
                };
            }

            // Decrement font size progressively
            isReduced = true;
            currentSize -= 2;
        }

        // At minFontSize: Wrap without dropping or ellipsizing words
        currentSize = minFontSize;
        const fontString = `${fontWeight} ${currentSize}px ${fontFamily}`;
        ctx.font = fontString;
        const lineHeight = Math.round(currentSize * lineHeightMultiplier);
        const wrapped = this.wrapText(ctx, cleanText, maxWidth);
        const totalH = wrapped.length * lineHeight;
        const measured = this.measureMultiline(ctx, wrapped, lineHeight);

        const exceedsLines = wrapped.length > maxLines;
        const exceedsHeight = totalH > maxHeight;

        if (exceedsLines || exceedsHeight) {
            // Controlled non-crashing failure state (Issue 3: NEVER truncate or ellipsize)
            return {
                lines: wrapped,
                fontSize: currentSize,
                font: fontString,
                lineHeight,
                totalHeight: totalH,
                width: measured.width,
                isReduced: true,
                overflow: true,
                warning: `Text for '${role}' exceeds bounding box at minimum size (${minFontSize}px). Total lines: ${wrapped.length}/${maxLines}.`,
                error: {
                    code: 'COPY_DOES_NOT_FIT',
                    role,
                    field: role,
                    currentLines: wrapped.length,
                    maxLines,
                    totalHeight: totalH,
                    maxHeight,
                    fontSize: minFontSize
                }
            };
        }

        return {
            lines: wrapped,
            fontSize: currentSize,
            font: fontString,
            lineHeight,
            totalHeight: totalH,
            width: measured.width,
            isReduced: true,
            overflow: false,
            warning: null,
            error: null
        };
    }

    /**
     * Render all text lines cleanly on canvas
     */
    static renderLines(ctx, lines, x, y, options = {}) {
        const {
            lineHeight = 32,
            align = 'left',
            color = '#111111',
            font = null
        } = options;

        if (!lines || lines.length === 0) return 0;

        ctx.save();
        if (font) ctx.font = font;
        ctx.fillStyle = color;
        ctx.textAlign = align;
        ctx.textBaseline = 'top';

        let currentY = y;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], x, currentY);
            currentY += lineHeight;
        }

        ctx.restore();
        return currentY - y;
    }
}
