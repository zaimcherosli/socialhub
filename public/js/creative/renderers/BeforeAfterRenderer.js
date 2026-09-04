/**
 * BeforeAfterRenderer.js
 * Deterministic Canvas 2D renderer for the BEFORE_AFTER poster archetype.
 *
 * Visual Strategy:
 * - Clear transformation / comparison duality
 * - Left: BEFORE zone (warning token accent, cross markers)
 * - Right: AFTER zone (positive token accent, check markers)
 * - Hero photo blended into background with dynamic brand contrast overlay
 * - Dominant headline + optional subheadline
 * - Prominent bottom CTA and legal disclaimer in safe area
 * - Structural label localization (Issue 4)
 * - Exact copy integrity with zero ellipsis (Issue 3)
 */

import { BrandDesignSystem } from '../BrandDesignSystem.js';
import { TextFittingEngine } from '../TextFittingEngine.js';
import { CanvasImageHelper } from '../CanvasImageHelper.js';
import { GraphicElementLibrary } from '../GraphicElementLibrary.js';

export class BeforeAfterRenderer {
    static render({ ctx, width, height, brief, brand, tokens, imageAsset, logoAsset }) {
        const warnings = [];
        const metrics = {};
        const safeMargin = tokens.spacing.safe_margin || 56;
        const contentWidth = width - safeMargin * 2;

        // Resolve localized structural labels
        const lang = brand?.preferred_language || brief?.preferred_language || 'ms';
        const labels = BrandDesignSystem.getLabels(lang);

        // 1. Render Background & Photographic Hero Asset
        ctx.fillStyle = tokens.colors.background || '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        if (imageAsset) {
            const focal = CanvasImageHelper.parseFocal(brief.art_direction?.composition);
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

        // 2. Parse canvas_direction creative hints safely (bounded vocabulary)
        const canvasDir = brief.canvas_direction || {};
        const hints = Array.isArray(canvasDir.graphic_elements) ? canvasDir.graphic_elements.join(' ').toLowerCase() : '';
        const useRoughCards = hints.includes('torn') || hints.includes('rough') || hints.includes('editorial');
        const useHighlight = hints.includes('highlight') || hints.includes('bar') || hints.includes('marker') || true;

        let currentY = safeMargin;

        // 3. Top Header: Company Logo and/or Badge Pill
        const badgeText = brief.badge || labels.before + ' & ' + labels.after;
        currentY = GraphicElementLibrary.drawHeader(ctx, {
            logoAsset,
            badgeText,
            safeMargin,
            contentWidth,
            tokens,
            width,
            currentY
        });

        // 4. Dominant Headline (Zero ellipsis - generous multi-line bounds)
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
                maxHeight: 80,
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
            currentY += subheadFit.totalHeight + 18;
        } else {
            currentY += 12;
        }

        // 6. Dual Comparison Cards (BEFORE vs AFTER)
        const cardGap = 20;
        const cardWidth = (contentWidth - cardGap) / 2;
        const ctaHeight = 64;
        const disclaimerAllowance = brief.disclaimer ? 42 : 0;
        const bottomReserved = safeMargin + disclaimerAllowance + 12 + ctaHeight + 20;
        const availableCardHeight = height - bottomReserved - currentY;
        const cardHeight = Math.min(420, Math.max(340, availableCardHeight));

        const beforeCardX = safeMargin;
        const afterCardX = safeMargin + cardWidth + cardGap;
        const cardY = currentY;

        // Card Drawing Helper
        const drawColumn = (isAfter, x, points, headerLabel, accentColor) => {
            const cardBg = tokens.colors.surface_card || '#111111';

            if (useRoughCards) {
                GraphicElementLibrary.drawRoughCard(ctx, {
                    x,
                    y: cardY,
                    width: cardWidth,
                    height: cardHeight,
                    radius: tokens.radius.md || 14,
                    background: cardBg,
                    accentColor,
                    stripePosition: 'top'
                });
            } else {
                GraphicElementLibrary.drawCard(ctx, {
                    x,
                    y: cardY,
                    width: cardWidth,
                    height: cardHeight,
                    radius: tokens.radius.md || 14,
                    background: cardBg,
                    border: tokens.colors.surface_card_border,
                    shadow: true
                });
            }

            // Card Header Label
            ctx.save();
            ctx.font = `900 24px ${tokens.typography.accent_family}`;
            ctx.fillStyle = accentColor;
            ctx.textBaseline = 'top';
            ctx.fillText(headerLabel.toUpperCase(), x + 24, cardY + 22);

            // Subtle divider line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 24, cardY + 54);
            ctx.lineTo(x + cardWidth - 24, cardY + 54);
            ctx.stroke();
            ctx.restore();

            // Render Bullet Points (Max 3-4 points)
            const safePoints = (Array.isArray(points) ? points : []).slice(0, 4);
            let bulletY = cardY + 70;
            const bulletMaxW = cardWidth - 48 - 36;

            for (const point of safePoints) {
                if (isAfter) {
                    GraphicElementLibrary.drawCheckMarker(ctx, {
                        x: x + 24,
                        y: bulletY + 2,
                        size: 24,
                        color: accentColor,
                        bgColor: 'rgba(255, 255, 255, 0.08)'
                    });
                } else {
                    GraphicElementLibrary.drawCrossMarker(ctx, {
                        x: x + 24,
                        y: bulletY + 2,
                        size: 24,
                        color: accentColor,
                        bgColor: 'rgba(255, 255, 255, 0.08)'
                    });
                }

                // Point text fit (zero ellipsis)
                const textFit = TextFittingEngine.fitTextToBox(ctx, point, {
                    role: 'bullet',
                    maxWidth: bulletMaxW,
                    maxHeight: 75,
                    maxLines: 2,
                    initialFontSize: 26,
                    minFontSize: 24,
                    fontFamily: tokens.typography.body_family,
                    fontWeight: '500',
                    lineHeightMultiplier: 1.22
                });

                if (textFit.warning) warnings.push(textFit.warning);

                TextFittingEngine.renderLines(ctx, textFit.lines, x + 68, bulletY, {
                    lineHeight: textFit.lineHeight,
                    align: 'left',
                    color: tokens.colors.text_on_card,
                    font: textFit.font
                });

                bulletY += Math.max(textFit.totalHeight, 28) + 16;
            }
        };

        // Render Left (BEFORE) Card with warning token & localized label
        drawColumn(false, beforeCardX, brief.before_points || [], labels.before, tokens.colors.warning);

        // Render Right (AFTER) Card with positive token & localized label
        drawColumn(true, afterCardX, brief.after_points || [], labels.after, tokens.colors.positive);

        // Center Transformation Arrow
        const arrowCenterX = beforeCardX + cardWidth + cardGap / 2;
        const arrowCenterY = cardY + cardHeight / 2;
        GraphicElementLibrary.drawArrow(ctx, {
            fromX: arrowCenterX - 14,
            fromY: arrowCenterY,
            toX: arrowCenterX + 14,
            toY: arrowCenterY,
            color: tokens.colors.primary,
            width: 3
        });

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
