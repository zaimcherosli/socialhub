/**
 * ProblemSolutionRenderer.js
 * Deterministic Canvas 2D renderer for the PROBLEM_SOLUTION poster archetype.
 *
 * Visual Strategy:
 * - Asymmetric 2-tier flow: PROBLEM (warning accent) -> SOLUTION (brand primary/positive accent)
 * - Highlights the user's friction point then presents structured advisory steps
 * - Hero photo blended into background preserving high card contrast
 * - Dominant headline, clear problem/solution cards, and prominent CTA
 * - Structural label localization (Issue 4)
 * - Exact copy integrity with zero ellipsis (Issue 3)
 */

import { BrandDesignSystem } from '../BrandDesignSystem.js';
import { TextFittingEngine } from '../TextFittingEngine.js';
import { CanvasImageHelper } from '../CanvasImageHelper.js';
import { GraphicElementLibrary } from '../GraphicElementLibrary.js';

export class ProblemSolutionRenderer {
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

        // 2. Parse canvas_direction creative hints safely
        const canvasDir = brief.canvas_direction || {};
        const hints = Array.isArray(canvasDir.graphic_elements) ? canvasDir.graphic_elements.join(' ').toLowerCase() : '';
        const useRoughCards = hints.includes('torn') || hints.includes('rough') || hints.includes('editorial');
        const useHighlight = hints.includes('highlight') || hints.includes('bar') || hints.includes('marker') || true;

        let currentY = safeMargin;

        // 3. Top Header: Company Logo and/or Topic Badge
        const badgeText = brief.badge || labels.problem + ' → ' + labels.solution;
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

        // 6. Geometry Calculation for Problem and Solution Blocks
        const ctaHeight = 64;
        const disclaimerAllowance = brief.disclaimer ? 42 : 0;
        const bottomReserved = safeMargin + disclaimerAllowance + 12 + ctaHeight + 20;
        const totalContentHeightAvailable = height - bottomReserved - currentY;

        const problemBlockHeight = Math.max(110, Math.min(135, Math.floor(totalContentHeightAvailable * 0.28)));
        const solutionBlockHeight = Math.max(260, totalContentHeightAvailable - problemBlockHeight - 16);

        // 7. Problem Block (Warning accent)
        const problemY = currentY;
        const problemText = brief.problem || 'Banyak komitmen berasingan merumitkan pengurusan kewangan bulanan.';

        if (useRoughCards) {
            GraphicElementLibrary.drawRoughCard(ctx, {
                x: safeMargin,
                y: problemY,
                width: contentWidth,
                height: problemBlockHeight,
                radius: tokens.radius.md,
                background: tokens.colors.surface_card,
                accentColor: tokens.colors.warning,
                stripePosition: 'left'
            });
        } else {
            GraphicElementLibrary.drawCard(ctx, {
                x: safeMargin,
                y: problemY,
                width: contentWidth,
                height: problemBlockHeight,
                radius: tokens.radius.md,
                background: tokens.colors.surface_card,
                border: tokens.colors.surface_card_border
            });
            ctx.save();
            ctx.fillStyle = tokens.colors.warning;
            ctx.fillRect(safeMargin, problemY, 6, problemBlockHeight);
            ctx.restore();
        }

        // Problem Header & Text
        ctx.save();
        ctx.font = `900 20px ${tokens.typography.accent_family}`;
        ctx.fillStyle = tokens.colors.warning;
        ctx.textBaseline = 'top';
        ctx.fillText(labels.problem.toUpperCase(), safeMargin + 24, problemY + 16);
        ctx.restore();

        const problemTextFit = TextFittingEngine.fitTextToBox(ctx, problemText, {
            role: 'body',
            maxWidth: contentWidth - 48,
            maxHeight: problemBlockHeight - 50,
            maxLines: 2,
            initialFontSize: 26,
            minFontSize: 24,
            fontFamily: tokens.typography.body_family,
            fontWeight: '500',
            lineHeightMultiplier: 1.25
        });

        if (problemTextFit.error) {
            return { success: false, code: 'COPY_DOES_NOT_FIT', field: 'problem', warnings: [problemTextFit.warning] };
        }

        TextFittingEngine.renderLines(ctx, problemTextFit.lines, safeMargin + 24, problemY + 46, {
            lineHeight: problemTextFit.lineHeight,
            align: 'left',
            color: tokens.colors.text_on_card,
            font: problemTextFit.font
        });

        // 8. Solution Block (Brand primary / positive accent)
        const solutionY = problemY + problemBlockHeight + 16;
        const solutionText = brief.solution || 'Nilai dan susun semula pembiayaan mengikut profil semasa anda.';

        if (useRoughCards) {
            GraphicElementLibrary.drawRoughCard(ctx, {
                x: safeMargin,
                y: solutionY,
                width: contentWidth,
                height: solutionBlockHeight,
                radius: tokens.radius.md,
                background: tokens.colors.surface_card,
                accentColor: tokens.colors.primary,
                stripePosition: 'left'
            });
        } else {
            GraphicElementLibrary.drawCard(ctx, {
                x: safeMargin,
                y: solutionY,
                width: contentWidth,
                height: solutionBlockHeight,
                radius: tokens.radius.md,
                background: tokens.colors.surface_card,
                border: tokens.colors.surface_card_border
            });
            ctx.save();
            ctx.fillStyle = tokens.colors.primary;
            ctx.fillRect(safeMargin, solutionY, 6, solutionBlockHeight);
            ctx.restore();
        }

        // Solution Header & Text
        ctx.save();
        ctx.font = `900 20px ${tokens.typography.accent_family}`;
        ctx.fillStyle = tokens.colors.primary;
        ctx.textBaseline = 'top';
        ctx.fillText(labels.solution.toUpperCase(), safeMargin + 24, solutionY + 18);
        ctx.restore();

        const solutionTextFit = TextFittingEngine.fitTextToBox(ctx, solutionText, {
            role: 'body',
            maxWidth: contentWidth - 48,
            maxHeight: 70,
            maxLines: 2,
            initialFontSize: 26,
            minFontSize: 24,
            fontFamily: tokens.typography.body_family,
            fontWeight: '600',
            lineHeightMultiplier: 1.25
        });

        if (solutionTextFit.error) {
            return { success: false, code: 'COPY_DOES_NOT_FIT', field: 'solution', warnings: [solutionTextFit.warning] };
        }

        TextFittingEngine.renderLines(ctx, solutionTextFit.lines, safeMargin + 24, solutionY + 48, {
            lineHeight: solutionTextFit.lineHeight,
            align: 'left',
            color: tokens.colors.text_on_card,
            font: solutionTextFit.font
        });

        // Supporting Points in Solution Card
        const safePoints = (Array.isArray(brief.supporting_points) ? brief.supporting_points : []).slice(0, 3);
        let pointY = solutionY + 48 + solutionTextFit.totalHeight + 16;

        for (const point of safePoints) {
            GraphicElementLibrary.drawCheckMarker(ctx, {
                x: safeMargin + 24,
                y: pointY + 2,
                size: 24,
                color: tokens.colors.positive,
                bgColor: 'rgba(255, 255, 255, 0.08)'
            });

            const pointFit = TextFittingEngine.fitTextToBox(ctx, point, {
                role: 'bullet',
                maxWidth: contentWidth - 84,
                maxHeight: 60,
                maxLines: 2,
                initialFontSize: 26,
                minFontSize: 24,
                fontFamily: tokens.typography.body_family,
                fontWeight: '500',
                lineHeightMultiplier: 1.22
            });

            if (pointFit.warning) warnings.push(pointFit.warning);

            TextFittingEngine.renderLines(ctx, pointFit.lines, safeMargin + 64, pointY, {
                lineHeight: pointFit.lineHeight,
                align: 'left',
                color: tokens.colors.text_secondary_on_card,
                font: pointFit.font
            });

            pointY += Math.max(pointFit.totalHeight, 28) + 12;
        }

        // 9. Bottom CTA Button
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

        // 10. Legal Disclaimer in Safe Area
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
