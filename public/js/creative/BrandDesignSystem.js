/**
 * BrandDesignSystem.js
 * Normalizes Brand Profile inputs into deterministic rendering tokens for the 1080x1080 Canvas Engine.
 *
 * Core Principles:
 * 1. Authoritative Brand Fidelity: Explicit brand profile colors (primary, secondary, background,
 *    surface, warning, positive) are preserved EXACTLY. No reinterpretation.
 * 2. Zero Generic Dark-SaaS Bias: Canvas base, card surfaces, and contrast tokens naturally reflect
 *    the Brand Profile palette (e.g. JomConsult: #FFD400, #111111, #FFFFFF, #E53935, #169B62).
 * 3. Browser-Safe Font Stacks: Zero external font downloads.
 * 4. Structural Label Localization: Safe dictionary mapping for ms and en system labels.
 */

export class BrandDesignSystem {
    /**
     * Compute relative luminance of a hex color to determine contrast
     */
    static getLuminance(hex) {
        if (!hex || typeof hex !== 'string') return 0;
        const clean = hex.replace('#', '');
        if (clean.length !== 6 && clean.length !== 3) return 0;
        const r = parseInt(clean.length === 3 ? clean[0] + clean[0] : clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.length === 3 ? clean[1] + clean[1] : clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.length === 3 ? clean[2] + clean[2] : clean.slice(4, 6), 16) / 255;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    /**
     * Parse color input safely supporting both JSON Object and Array formats
     */
    static parseColorConfig(primaryColorsInput, secondaryColorsInput) {
        let colorObj = {};
        let arrayList = [];

        // Check primary_colors
        if (primaryColorsInput) {
            if (typeof primaryColorsInput === 'object' && !Array.isArray(primaryColorsInput)) {
                colorObj = { ...primaryColorsInput };
            } else if (typeof primaryColorsInput === 'string') {
                try {
                    const parsed = JSON.parse(primaryColorsInput);
                    if (typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null) {
                        colorObj = { ...parsed };
                    } else if (Array.isArray(parsed)) {
                        arrayList = parsed;
                    }
                } catch (_) {
                    arrayList = primaryColorsInput.split(',').map(s => s.trim()).filter(Boolean);
                }
            } else if (Array.isArray(primaryColorsInput)) {
                arrayList = primaryColorsInput;
            }
        }

        // Secondary colors
        let secList = [];
        if (secondaryColorsInput) {
            if (typeof secondaryColorsInput === 'string') {
                try {
                    const parsed = JSON.parse(secondaryColorsInput);
                    if (Array.isArray(parsed)) secList = parsed;
                } catch (_) {
                    secList = secondaryColorsInput.split(',').map(s => s.trim()).filter(Boolean);
                }
            } else if (Array.isArray(secondaryColorsInput)) {
                secList = secondaryColorsInput;
            }
        }

        return { colorObj, arrayList, secList };
    }

    /**
     * Normalize Brand Profile into comprehensive tokens
     */
    static normalizeTokens(brandProfile = {}) {
        const { colorObj, arrayList, secList } = this.parseColorConfig(
            brandProfile.primary_colors,
            brandProfile.secondary_colors
        );

        // 1. Authoritative Colors: Preserve explicit brand profile colors character-for-character
        const brandPrimary = colorObj.primary || arrayList[0] || '#FFD400';
        const brandSecondary = colorObj.secondary || arrayList[1] || '#111111';
        const background = colorObj.background || '#FFFFFF';
        const surface = colorObj.surface || '#111111';
        const surfaceCard = colorObj.surface || '#111111';

        // 2. Semantic Colors: Preserve explicit warning & positive tokens
        const warning = colorObj.warning || secList[0] || '#E53935';
        const positive = colorObj.positive || secList[1] || '#169B62';

        // 3. Dynamic Contrast Tokens based on Background and Surface Luminance
        const bgLuminance = this.getLuminance(background);
        const isLightBg = bgLuminance > 0.45;

        const surfaceLuminance = this.getLuminance(surfaceCard);
        const isLightCard = surfaceLuminance > 0.45;

        const textPrimary = colorObj.text_primary || (isLightBg ? '#111111' : '#FFFFFF');
        const textInverse = colorObj.text_inverse || (isLightBg ? '#FFFFFF' : '#111111');

        // On-canvas text colors (outside cards)
        const textOnBg = isLightBg ? (colorObj.text_primary || '#111111') : '#FFFFFF';
        const textSecondaryOnBg = isLightBg ? '#334155' : '#CBD5E1';
        const textMutedOnBg = isLightBg ? '#64748B' : '#94A3B8';

        // Inside-card text colors
        const textOnCard = isLightCard ? '#111111' : (colorObj.text_inverse || '#FFFFFF');
        const textSecondaryOnCard = isLightCard ? '#334155' : '#E2E8F0';
        const surfaceCardBorder = isLightCard ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)';

        // 4. Typography Stack Resolution (Safe browser stacks, zero downloaded files)
        const typoDesc = (typeof brandProfile.typography_style === 'object'
            ? JSON.stringify(brandProfile.typography_style)
            : (brandProfile.typography_style || '')).toLowerCase();

        let headingFamily = `'Impact', 'Arial Black', 'Haettenschweiler', 'Franklin Gothic Bold', 'Arial Narrow', sans-serif`;
        let headingWeight = '900';
        let bodyFamily = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
        let bodyWeight = '500';

        if (typoDesc.includes('serif') && !typoDesc.includes('sans')) {
            headingFamily = `'Georgia', 'Cambria', 'Times New Roman', serif`;
            headingWeight = '700';
        }

        return {
            brandName: brandProfile.name || 'Brand',
            logoUrl: (brandProfile.logo_url || '').trim() || null,
            logoMediaId: brandProfile.logo_media_id || null,
            preferredLanguage: brandProfile.preferred_language || 'ms',
            colors: {
                primary: brandPrimary,
                secondary: brandSecondary,
                accent: brandPrimary,
                background: background,
                surface: surface,
                surface_card: surfaceCard,
                surface_card_border: surfaceCardBorder,
                text_primary: textPrimary,
                text_inverse: textInverse,
                text_on_bg: textOnBg,
                text_secondary_on_bg: textSecondaryOnBg,
                text_muted_on_bg: textMutedOnBg,
                text_on_card: textOnCard,
                text_secondary_on_card: textSecondaryOnCard,
                warning: warning,
                positive: positive,
                highlight_bg: 'rgba(255, 212, 0, 0.40)'
            },
            typography: {
                heading_family: headingFamily,
                heading_weight: headingWeight,
                body_family: bodyFamily,
                body_weight: bodyWeight,
                accent_family: `'Arial Black', 'Impact', sans-serif`
            },
            spacing: {
                xs: 8,
                sm: 16,
                md: 24,
                lg: 32,
                xl: 48,
                safe_margin: 56
            },
            radius: {
                sm: 8,
                md: 14,
                lg: 20,
                pill: 999
            },
            shadows: {
                card: 'rgba(0, 0, 0, 0.45)',
                glow: 'rgba(0, 0, 0, 0.25)'
            }
        };
    }

    /**
     * Structural system label localization (Issue 4)
     * Maps concise neutral poster labels based on preferred language
     */
    static getLabels(preferredLanguage = 'ms') {
        const lang = (preferredLanguage || 'ms').toLowerCase();
        if (lang.startsWith('en')) {
            return {
                before: 'BEFORE',
                after: 'AFTER',
                problem: 'PROBLEM',
                solution: 'SOLUTION',
                guide: 'GUIDE & OPTIONS',
                checklist: 'KEY ADVISORY STEPS'
            };
        }
        return {
            before: 'SEBELUM',
            after: 'SELEPAS',
            problem: 'MASALAH / CABARAN',
            solution: 'LANGKAH PENYELESAIAN',
            guide: 'PANDUAN & PILIHAN PENSTRUKTURAN',
            checklist: 'LANGKAH UTAMA'
        };
    }
}
