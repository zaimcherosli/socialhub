/**
 * PosterPromptService.js
 * Converts Brand Profile + Creative Brief + Archetype into a pure visual asset prompt.
 * Strictly enforces NO-TEXT negative constraints and directs negative space for later Canvas typography.
 * Supports distinct Cutout Mode (isolated subject) and Environmental Mode (contextual scene).
 */

import { PosterArchetypeService } from './PosterArchetypeService.js';

export class PosterPromptService {
    /**
     * Strict negative constraints prohibiting any visible typography, text, or graphic UI in the generated image.
     * Note: "NO ICONS" and "PURE BACKGROUND PHOTOGRAPHY ONLY" were removed so that real props, equipment,
     * and human subjects are not prohibited.
     */
    static NEGATIVE_TEXT_CONSTRAINTS = 
        'NO TEXT, NO WORDS, NO LETTERING, NO TYPOGRAPHY, NO NUMBERS, NO WATERMARKS, NO LOGOS, NO BADGES, NO UI, NO POSTER COPY, NO SPEECH BUBBLES, NO LABELS, NO OVERLAY GRAPHICS.';

    /**
     * Generate pure visual asset prompt for image model generation
     * 
     * @param {object} brandProfile 
     * @param {object} brief 
     * @returns {string} Detailed visual prompt
     */
    static generateVisualPrompt(brandProfile = {}, brief = {}) {
        const archetype = (brief.archetype || 'PROBLEM_SOLUTION').toUpperCase();
        const art = brief.art_direction || {};
        const isCutout = Boolean(art.cutout_mode);

        const promptSegments = [];
        let subjectDesc = art.subject || brief.topic || 'A professional consultant at a modern desk';
        // Clean any leaked 2D graphic / typography terms from photographic subject description
        subjectDesc = subjectDesc
            .replace(/\b(tipografi\s+tebal|tipografi|typography|kad\s+solusi|callout\s+cards?|black\s+blocks?|yellow\s+bars?|torn[\s-]paper|badges?)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (isCutout) {
            // ── CUTOUT MODE TRUE: Isolated Subject Commercial Photography ──
            promptSegments.push(
                `Commercial studio portrait photography featuring isolated subject: ${subjectDesc}. The subject must be the prominent focal point, crisply separated from the background with sharp edge definition and natural studio rim lighting.`
            );
            promptSegments.push(
                'Background: Solid minimalist, clean studio backdrop with subtle neutral gradient. Simple, uncluttered studio separation designed for subject cutout and composite layering.'
            );

            // Archetype-aware negative space for cutout mode
            if (archetype === 'BEFORE_AFTER') {
                promptSegments.push(
                    'Composition: Subject positioned deliberately on one side of the frame with generous empty, clean space across the opposite half for dual-zone balanced composite layout.'
                );
            } else if (archetype === 'PROFESSION_SPECIFIC') {
                const audienceContext = brief.target_audience ? `targeted toward ${brief.target_audience}` : 'professional niche';
                promptSegments.push(
                    `Composition: Subject wearing authentic professional attire (${audienceContext}), positioned off-center leaving wide open negative space for uncluttered visual balance.`
                );
            } else {
                promptSegments.push(
                    'Composition: Subject placed with intentional negative space leaving the upper and lower canvas areas clean and clear for balanced graphic layout integration.'
                );
            }

            const mood = art.mood || 'Professional, crisp, trustworthy';
            promptSegments.push(
                `Lighting and mood: ${mood}. Clean studio lighting, sharp focus, natural skin textures, 8k resolution commercial masterwork.`
            );
        } else {
            // ── CUTOUT MODE FALSE: Full Environmental Commercial Photography ──
            promptSegments.push(
                `High-end contextual environmental commercial photography featuring: ${subjectDesc}. The subject is organically integrated into an authentic, realistic environment.`
            );

            const setting = art.setting || 'contemporary Southeast Asian corporate office with warm architectural ambient lighting';
            promptSegments.push(
                `Environment & Setting: ${setting}. Subtle cinematic depth of field with creamy bokeh in the background to preserve clean visual contrast.`
            );

            // Archetype-aware negative space for environmental mode
            if (archetype === 'BEFORE_AFTER') {
                promptSegments.push(
                    'Composition: Dual-zone split contrast composition: the left zone subtle and dim representing prior struggle, the right zone vibrant, bright, and orderly representing clarity and success. Clean demarcation with generous empty negative space across the upper half of the frame.'
                );
            } else if (archetype === 'PROBLEM_SOLUTION') {
                promptSegments.push(
                    'Composition: Asymmetric hero composition with strong emotional contrast of relief and accomplishment. Keep the top one-third and lower third of the canvas completely uncluttered with smooth, quiet negative space for clean composite balance.'
                );
            } else if (archetype === 'PROFESSION_SPECIFIC') {
                const audienceContext = brief.target_audience ? `targeted toward ${brief.target_audience}` : 'targeted professional';
                promptSegments.push(
                    `Composition: Subject positioned elegantly in authentic professional attire (${audienceContext}), looking confident toward the viewer. Off-center placement with wide usable negative space on one side for clean layout integration.`
                );
            }

            const mood = art.mood || 'Confident, prestigious, trustworthy, warm corporate';
            promptSegments.push(
                `Lighting and mood: ${mood}. Professional studio lighting, sharp focus, natural textures, 8k resolution commercial masterwork.`
            );
        }

        // ── Brand Visual Style & Cultural Context ──
        let visualStyleStr = '';
        if (typeof brandProfile.visual_style === 'object' && brandProfile.visual_style !== null) {
            visualStyleStr = brandProfile.visual_style.photography_style || brandProfile.visual_style.style || '';
        } else if (typeof brandProfile.visual_style === 'string') {
            visualStyleStr = brandProfile.visual_style;
        }

        const creativeNotes = brandProfile.creative_notes || '';
        const combinedNotes = `${visualStyleStr} ${creativeNotes}`.toLowerCase();

        if (combinedNotes.includes('malaysia') || brandProfile.preferred_language === 'ms' || (brandProfile.industry && brandProfile.industry.toLowerCase().includes('consult'))) {
            promptSegments.push('Authentic modern Malaysian context, local Southeast Asian professional attire, respectful cultural nuances.');
        }

        if (visualStyleStr) {
            // Filter out purely 2D graphic canvas terms (cards, blocks, bars) from aesthetic styling
            const cleanAesthetic = visualStyleStr
                .replace(/\b(infographic|editorial\s+cards?|black\s+blocks?|yellow\s+bars?|torn[\s-]paper|graphic\s+accents?|typography|tipografi)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleanAesthetic) {
                promptSegments.push(`Aesthetic styling: ${cleanAesthetic}.`);
            }
        }

        // ── Strict Mandatory Negative Constraints ──
        promptSegments.push(`CRITICAL ENFORCEMENT: ${this.NEGATIVE_TEXT_CONSTRAINTS}`);

        return promptSegments.join(' ');
    }
}
