/**
 * ProfessionSpecificRenderer.js
 * Deterministic Canvas 2D renderer for the PROFESSION_SPECIFIC poster archetype.
 *
 * Visual Strategy:
 * - Person-led composition with high visual prominence for the professional hero photo
 * - Specialized profession/niche badge pill
 * - Dominant, empathetic headline addressing the profession's specific scenario
 * - Structured advisory checklist card block
 * - Prominent bottom CTA and compliant disclaimer in safe area
 * - Structural label localization (Issue 4)
 * - Exact copy integrity with zero ellipsis (Issue 3)
 */

import { BrandDesignSystem } from '../BrandDesignSystem.js';
import { TextFittingEngine } from '../TextFittingEngine.js';
import { CanvasImageHelper } from '../CanvasImageHelper.js';
import { GraphicElementLibrary } from '../GraphicElementLibrary.js';

export class ProfessionSpecificRenderer {
    static render({ ctx, width, height, brief, brand, tokens, imageAsset, logoAsset }) {
        const warnings = [];
        const metrics = {};
        const safeMargin = tokens.spacing.safe_margin || 56;
        const contentWidth = width - safeMargin * 2;

        // Resolve localized structural labels
        const lang = brand?.preferred_language || brief?.preferred_language || 'ms';
        const labels = BrandDesignSystem.getLabels(lang);

        // 1. Render Background & Hero Photo
        ctx.fillStyle = tokens.colors.background || '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        if (imageAsset) {
            const focal = CanvasImageHelper.parseFocal(brief.art_direction?.composition || 'right');
            CanvasImageHelper.drawImageCover(ctx, imageAsset, 0, 0, width, height, focal.focalX, focal.focalY);
            CanvasImageHelper.applyContrastOverlay(ctx, 0, 0, width, height, 'vertical', tokens.colors.background);
        } else {
            GraphicElementLibrary.drawDotGrid(ctx, {
                x: safeMargin,
                y: safeMargin,
                width: contentWidth,
                height: height - safeMargin * 2,
                color: 'rgba(0, 0, 0, 0.05)'
            });
            warnings.push('Image asset not provided; rendered textured background fallback.');
        }

        // 2. Parse canvas_direction creative hints safely
        const canvasDir = brief.canvas_direction || {};
        const hints = Array.isArray(canvasDir.graphic_elements) ? canvasDir.graphic_elements.join(' ').toLowerCase() : '';
        const useRoughCards = hints.includes('torn') || hints.includes('rough') || hints.includes('editorial');
        const useHighlight = hints.includes('highlight') || hints.includes('bar') || hints.includes('marker') || true;

        let currentY = safeMargin;

        // 3. Top Header: Company Logo and/or Profession Spotlight Badge
        const badgeText = brief.badge || (brief.target_audience ? `KHAS UNTUK ${brief.target_audience.toUpperCase()}` : 'KONSULTASI KHAS');
        currentY = GraphicElementLibrary.drawHeader(ctx, {
            logoAsset,
            badgeText,
            safeMargin,
            contentWidth,
            tokens,
            width,
            currentY
        });

        // 4. Dominant Headline
        const headlineFit = TextFittingEngine.fitTextToBox(ctx, brief.headline, {
            role: 'headline',
            maxWidth: contentWidth,
            maxHeight: 190,
            maxLines: 3,
            initialFontSize: 72,
            minFontSize: 54,
            fontFamily: tokens.typography.heading_family,
            fontWeight: tokens.typography.heading_weight,
            lineHeightMultiplier: 1.06
        });

        if (headlineFit.error) {
            return { success: false, code: 'COPY_DOES_NOT_FIT', field: 'headline', warnings: [headlineFit.warning] };
        }
        if (headlineFit.warning) warnings.push(headlineFit.warning);
        metrics.headlineFontSize = headlineFit.fontSize;

        // Optional highlight bar behind headline
        if (useHighlight) {
            GraphicElementLibrary.drawHighlightBar(ctx, {
                x: safeMargin,
                y: currentY + headlineFit.totalHeight - 30,
                width: Math.min(headlineFit.width, contentWidth),
                height: 26,
                color: tokens.colors.highlight_bg || 'rgba(255, 212, 0, 0.40)'
            });
        }

        TextFittingEngine.renderLines(ctx, headlineFit.lines, safeMargin, currentY, {
            lineHeight: headlineFit.lineHeight,
            align: 'left',
            color: tokens.colors.text_on_bg,
            font: headlineFit.font
        });
        currentY += headlineFit.totalHeight + 10;

        // 5. Optional Subheadline
        if (brief.subheadline) {
            const subheadFit = TextFittingEngine.fitTextToBox(ctx, brief.subheadline, {
                role: 'subheadline',
                maxWidth: contentWidth,
                maxHeight: 75,
                maxLines: 2,
                initialFontSize: 28,
                minFontSize: 28,
                fontFamily: tokens.typography.body_family,
                fontWeight: '500',
                lineHeightMultiplier: 1.25
            });

            if (subheadFit.error) {
                return { success: false, code: 'COPY_DOES_NOT_FIT', field: 'subheadline', warnings: [subheadFit.warning] };
            }
            if (subheadFit.warning) warnings.push(subheadFit.warning);

            TextFittingEngine.renderLines(ctx, subheadFit.lines, safeMargin, currentY, {
                lineHeight: subheadFit.lineHeight,
                align: 'left',
                color: tokens.colors.text_secondary_on_bg,
                font: subheadFit.font
            });
            currentY += subheadFit.totalHeight + 16;
        } else {
            currentY += 10;
        }

        // 6. Structured Advisory Card Block
        const ctaHeight = 64;
        const disclaimerAllowance = brief.disclaimer ? 42 : 0;
        const bottomReserved = safeMargin + disclaimerAllowance + 12 + ctaHeight + 20;
        const availableCardHeight = height - bottomReserved - currentY;
        const cardHeight = Math.min(410, Math.max(310, availableCardHeight));

        const cardBg = tokens.colors.surface_card || '#111111';
        if (useRoughCards) {
            GraphicElementLibrary.drawRoughCard(ctx, {
                x: safeMargin,
                y: currentY,
                width: contentWidth,
                height: cardHeight,
                radius: tokens.radius.md,
                background: cardBg,
                accentColor: tokens.colors.primary,
                stripePosition: 'top'
            });
        } else {
            GraphicElementLibrary.drawCard(ctx, {
                x: safeMargin,
                y: currentY,
                width: contentWidth,
                height: cardHeight,
                radius: tokens.radius.md,
                background: cardBg,
                border: tokens.colors.surface_card_border,
                shadow: true
            });
        }

        // Card Header Title (Localized)
        ctx.save();
        ctx.font = `900 22px ${tokens.typography.accent_family}`;
        ctx.fillStyle = tokens.colors.primary;
        ctx.textBaseline = 'top';
        ctx.fillText(labels.guide.toUpperCase(), safeMargin + 24, currentY + 20);

        // Header divider
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(safeMargin + 24, currentY + 52);
        ctx.lineTo(safeMargin + contentWidth - 24, currentY + 52);
        ctx.stroke();
        ctx.restore();

        // Render Supporting Checklist Points (Max 3-4 points)
        const safePoints = (Array.isArray(brief.supporting_points) ? brief.supporting_points : []).slice(0, 4);
        let pointY = currentY + 68;
        const bulletMaxW = contentWidth - 48 - 42;

        for (const point of safePoints) {
            // Checkmark bullet marker
            GraphicElementLibrary.drawCheckMarker(ctx, {
                x: safeMargin + 24,
                y: pointY + 2,
                size: 26,
                color: tokens.colors.positive,
                bgColor: 'rgba(255, 255, 255, 0.08)'
            });

            // Point text fit (zero ellipsis)
            const pointFit = TextFittingEngine.fitTextToBox(ctx, point, {
                role: 'bullet',
                maxWidth: bulletMaxW,
                maxHeight: 70,
                maxLines: 2,
                initialFontSize: 26,
                minFontSize: 24,
                fontFamily: tokens.typography.body_family,
                fontWeight: '500',
                lineHeightMultiplier: 1.22
            });

            if (pointFit.warning) warnings.push(pointFit.warning);

            TextFittingEngine.renderLines(ctx, pointFit.lines, safeMargin + 66, pointY, {
                lineHeight: pointFit.lineHeight,
                align: 'left',
                color: tokens.colors.text_on_card,
                font: pointFit.font
            });

            pointY += Math.max(pointFit.totalHeight, 28) + 16;
        }

        // 7. Bottom CTA Button
        const ctaY = height - safeMargin - disclaimerAllowance - ctaHeight - 12;
        const ctaText = brief.cta || brand?.default_cta || 'Semak Pilihan Sesuai Profil Anda';
        GraphicElementLibrary.drawCTA(ctx, {
            text: ctaText,
            x: safeMargin,
            y: ctaY,
            width: contentWidth,
            height: ctaHeight,
            tokens
        });

        // 8. Legal Disclaimer in Safe Area
        if (brief.disclaimer) {
            const disclaimerY = ctaY + ctaHeight + 12;
            GraphicElementLibrary.drawDisclaimer(ctx, {
                text: brief.disclaimer,
                x: safeMargin,
                y: disclaimerY,
                width: contentWidth,
                tokens
            });
        }

        return {
            success: true,
            warnings,
            metrics
        };
    }
}
