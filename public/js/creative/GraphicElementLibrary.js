/**
 * GraphicElementLibrary.js
 * High-performance, deterministic Canvas 2D vector primitives for SocialHub Creative Studio.
 *
 * Supported primitives:
 * - drawBadge
 * - drawCard
 * - drawRoughCard (Editorial accent card)
 * - drawHighlightBar
 * - drawBrushUnderline
 * - drawCheckMarker
 * - drawCrossMarker
 * - drawArrow
 * - drawCTA
 * - drawDisclaimer
 * - drawDotGrid
 *
 * Adheres strictly to:
 * - Zero external SVG URLs or copyrighted assets
 * - Pure Canvas 2D path math
 * - Brand tokens for all styling
 */

export class GraphicElementLibrary {
    /**
     * Draw top header containing company logo (if provided) and category/audience badge.
     * When logo is present, renders logo on top-left and badge on top-right within safe bounds.
     * When logo is absent, falls back to badge at top-left.
     */
    static drawHeader(ctx, { logoAsset, badgeText, safeMargin = 56, contentWidth = 968, tokens, width = 1080, currentY = 56 }) {
        if (logoAsset) {
            const imgW = logoAsset.naturalWidth || logoAsset.width || 200;
            const imgH = logoAsset.naturalHeight || logoAsset.height || 50;
            const maxW = 220;
            const maxH = 50;
            const ratio = Math.min(maxW / imgW, maxH / imgH, 1);
            const drawW = Math.round(imgW * ratio);
            const drawH = Math.round(imgH * ratio);

            ctx.drawImage(logoAsset, safeMargin, currentY, drawW, drawH);

            if (badgeText) {
                ctx.save();
                ctx.font = `900 20px ${tokens.typography?.accent_family || 'sans-serif'}`;
                const textWidth = ctx.measureText(badgeText.trim().toUpperCase()).width;
                ctx.restore();
                const badgeWidth = textWidth + 36;
                const badgeX = Math.max(safeMargin + drawW + 16, width - safeMargin - badgeWidth);
                const badgeY = currentY + Math.max(0, Math.round((drawH - 38) / 2));

                this.drawBadge(ctx, {
                    text: badgeText,
                    x: badgeX,
                    y: badgeY,
                    tokens,
                    variant: 'primary'
                });
            }
            return currentY + Math.max(drawH, 38) + 18;
        }

        // Fallback when no logo asset is present
        if (badgeText) {
            this.drawBadge(ctx, {
                text: badgeText,
                x: safeMargin,
                y: currentY,
                tokens,
                variant: 'primary'
            });
            return currentY + 46;
        }

        return currentY;
    }

    /**
     * Draw category or audience badge pill
     */
    static drawBadge(ctx, { text, x, y, tokens, variant = 'primary' }) {
        if (!text) return 0;
        ctx.save();

        const badgeText = text.trim().toUpperCase();
        const font = `900 20px ${tokens.typography.accent_family || 'sans-serif'}`;
        ctx.font = font;
        const textWidth = ctx.measureText(badgeText).width;

        const padX = 18;
        const height = 38;
        const width = textWidth + padX * 2;
        const radius = tokens.radius.pill || 999;

        // Background
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, width, height, radius);
        } else {
            ctx.rect(x, y, width, height);
        }

        if (variant === 'primary') {
            ctx.fillStyle = tokens.colors.primary;
        } else if (variant === 'surface') {
            ctx.fillStyle = tokens.colors.surface_card;
        } else {
            ctx.fillStyle = tokens.colors.accent;
        }
        ctx.fill();

        // Border
        ctx.strokeStyle = variant === 'surface' ? tokens.colors.surface_card_border : 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Text
        ctx.fillStyle = variant === 'primary' ? tokens.colors.text_inverse : tokens.colors.text_primary;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, x + padX, y + height / 2);

        ctx.restore();
        return width;
    }

    /**
     * Draw styled rounded card block
     */
    static drawCard(ctx, { x, y, width, height, radius = 16, background, border, shadow = true }) {
        ctx.save();

        if (shadow) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
            ctx.shadowBlur = 24;
            ctx.shadowOffsetY = 10;
        }

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, width, height, radius);
        } else {
            ctx.rect(x, y, width, height);
        }

        ctx.fillStyle = background || '#111827';
        ctx.fill();

        if (shadow) {
            ctx.shadowColor = 'transparent';
        }

        if (border) {
            ctx.strokeStyle = border;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Draw editorial card with top or left accent stripe (Deterministic "torn-paper" / editorial callout)
     */
    static drawRoughCard(ctx, { x, y, width, height, radius = 16, background, accentColor, stripePosition = 'top' }) {
        this.drawCard(ctx, { x, y, width, height, radius, background, border: 'rgba(255,255,255,0.08)' });

        if (accentColor) {
            ctx.save();
            ctx.beginPath();
            if (stripePosition === 'top') {
                const stripeHeight = 6;
                if (ctx.roundRect) {
                    ctx.roundRect(x, y, width, stripeHeight, [radius, radius, 0, 0]);
                } else {
                    ctx.rect(x, y, width, stripeHeight);
                }
            } else {
                const stripeWidth = 6;
                if (ctx.roundRect) {
                    ctx.roundRect(x, y, stripeWidth, height, [radius, 0, 0, radius]);
                } else {
                    ctx.rect(x, y, stripeWidth, height);
                }
            }
            ctx.fillStyle = accentColor;
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * Draw text highlight bar marker
     */
    static drawHighlightBar(ctx, { x, y, width, height = 28, color = 'rgba(245, 158, 11, 0.35)' }) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(x, y + height * 0.45, width, height * 0.55);
        ctx.restore();
    }

    /**
     * Draw energetic underline
     */
    static drawBrushUnderline(ctx, { x, y, width, color = '#F59E0B', height = 5 }) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, width, height, height / 2);
        } else {
            ctx.rect(x, y, width, height);
        }
        ctx.fill();
        ctx.restore();
    }

    /**
     * Draw check marker glyph for positive/after lists
     */
    static drawCheckMarker(ctx, { x, y, size = 26, color = '#10B981', bgColor = 'rgba(16, 185, 129, 0.15)' }) {
        ctx.save();
        const r = size / 2;
        const cx = x + r;
        const cy = y + r;

        // Background Circle
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Checkmark Path
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.45, cy - r * 0.05);
        ctx.lineTo(cx - r * 0.1, cy + r * 0.35);
        ctx.lineTo(cx + r * 0.45, cy - r * 0.35);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Draw cross marker glyph for negative/before/problem lists
     */
    static drawCrossMarker(ctx, { x, y, size = 26, color = '#EF4444', bgColor = 'rgba(239, 68, 68, 0.15)' }) {
        ctx.save();
        const r = size / 2;
        const cx = x + r;
        const cy = y + r;

        // Background Circle
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Cross Path
        const offset = r * 0.35;
        ctx.beginPath();
        ctx.moveTo(cx - offset, cy - offset);
        ctx.lineTo(cx + offset, cy + offset);
        ctx.moveTo(cx + offset, cy - offset);
        ctx.lineTo(cx - offset, cy + offset);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.stroke();

        ctx.restore();
    }

    /**
     * Draw directional transformation arrow
     */
    static drawArrow(ctx, { fromX, fromY, toX, toY, color = '#F59E0B', width = 3 }) {
        ctx.save();
        const headlen = 12;
        const angle = Math.atan2(toY - fromY, toX - fromX);

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    /**
     * Draw high-impact CTA button
     */
    static drawCTA(ctx, { text, x, y, width, height = 66, tokens }) {
        ctx.save();
        const radius = tokens.radius.pill || 999;

        // Drop shadow for CTA
        ctx.shadowColor = tokens.shadows.glow || 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 20;
        ctx.shadowOffsetY = 8;

        // Button background
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, width, height, radius);
        } else {
            ctx.rect(x, y, width, height);
        }
        ctx.fillStyle = tokens.colors.primary;
        ctx.fill();

        ctx.shadowColor = 'transparent';

        // Subtle highlight inner glow / border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // CTA Text
        const ctaFont = `900 30px ${tokens.typography.body_family || 'sans-serif'}`;
        ctx.font = ctaFont;
        ctx.fillStyle = tokens.colors.text_inverse;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Include right arrow chevron
        const arrowGlyph = ' →';
        ctx.fillText(`${text.trim()}${arrowGlyph}`, x + width / 2, y + height / 2);

        ctx.restore();
    }

    /**
     * Draw compliant disclaimer in bottom safe area
     */
    static drawDisclaimer(ctx, { text, x, y, width, tokens }) {
        if (!text) return 0;
        ctx.save();

        const disclaimerFont = `400 18px ${tokens.typography.body_family || 'sans-serif'}`;
        ctx.font = disclaimerFont;
        ctx.fillStyle = tokens.colors.text_muted || '#64748B';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        // Use simple word wrap for disclaimer if needed
        const words = text.trim().split(' ');
        const lines = [];
        let currentLine = '';

        for (let i = 0; i < words.length; i++) {
            const test = currentLine ? `${currentLine} ${words[i]}` : words[i];
            if (ctx.measureText(test).width > width && currentLine) {
                lines.push(currentLine);
                currentLine = words[i];
            } else {
                currentLine = test;
            }
        }
        if (currentLine) lines.push(currentLine);

        let currentY = y;
        const lineHeight = 24;
        for (const line of lines) {
            ctx.fillText(line, x + width / 2, currentY);
            currentY += lineHeight;
        }

        ctx.restore();
        return currentY - y;
    }

    /**
     * Draw subtle dot grid pattern for technical/corporate texture
     */
    static drawDotGrid(ctx, { x, y, width, height, color = 'rgba(255,255,255,0.06)', dotSize = 2, spacing = 22 }) {
        ctx.save();
        ctx.fillStyle = color;

        for (let px = x; px <= x + width; px += spacing) {
            for (let py = y; py <= y + height; py += spacing) {
                ctx.beginPath();
                ctx.arc(px, py, dotSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }
}
