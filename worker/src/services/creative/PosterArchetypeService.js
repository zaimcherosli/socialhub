/**
 * PosterArchetypeService.js
 * Registry and structural definitions for Creative Studio Poster Archetypes.
 * Describes layout intent, visual intent, and structural density constraints.
 * Pure information architecture with zero hardcoded brand or industry values.
 */

export class PosterArchetypeService {
    /**
     * Complete MVP Archetype Registry
     */
    static ARCHETYPES = {
        BEFORE_AFTER: {
            id: 'BEFORE_AFTER',
            name: 'Before & After Transformation',
            description: 'Showcases clear transformation, contrast, or progression from an old/painful state to a new/desired state.',
            intended_use: 'Transformation campaigns, workflow comparisons, debt consolidation, renovation, process efficiency, before/after results.',
            required_fields: ['headline', 'before_points', 'after_points', 'cta'],
            optional_fields: ['badge', 'subheadline', 'disclaimer'],
            layout_intent: 'Dual-zone split contrast composition (Left/Right or Top/Bottom) separating Before state from After state with clear visual polarity.',
            visual_intent: 'Dual-contrast visual scene or metaphorical transition without any text or typography in the background image.',
            max_density: {
                headline_max_chars: 90,
                subheadline_max_chars: 160,
                badge_max_chars: 50,
                before_points_max: 4,
                after_points_max: 4,
                supporting_points_max: 0
            }
        },

        PROBLEM_SOLUTION: {
            id: 'PROBLEM_SOLUTION',
            name: 'Problem & Solution Spotlight',
            description: 'Directly addresses a customer pain point or friction, followed immediately by an authoritative, clear solution.',
            intended_use: 'Pain point marketing, urgency-driven offers, consulting solutions, service benefits, overcoming bottlenecks.',
            required_fields: ['headline', 'problem', 'solution', 'supporting_points', 'cta'],
            optional_fields: ['badge', 'subheadline', 'disclaimer'],
            layout_intent: 'Focal headline and pain-point statement at top/center, authoritative solution highlight with bullet points and strong bottom CTA.',
            visual_intent: 'Single powerful thematic visual setting the mood of relief, clarity, or professional resolution, keeping ample negative space.',
            max_density: {
                headline_max_chars: 90,
                subheadline_max_chars: 160,
                badge_max_chars: 50,
                supporting_points_max: 4,
                before_points_max: 0,
                after_points_max: 0
            }
        },

        PROFESSION_SPECIFIC: {
            id: 'PROFESSION_SPECIFIC',
            name: 'Profession / Audience Targeted',
            description: 'Specifically targets a defined profession, demographic niche, or industry group with bespoke benefits and relevant credentials.',
            intended_use: 'Targeting specific occupational niches (e.g. teachers, engineers, civil servants, nurses, business owners, accountants).',
            required_fields: ['headline', 'badge', 'supporting_points', 'cta'],
            optional_fields: ['subheadline', 'disclaimer', 'problem', 'solution'],
            layout_intent: 'Prominent target profession badge/pill at top, audience-tailored headline, structured benefit points with icons, prominent conversion CTA.',
            visual_intent: 'Authentic portrayal of the target professional or work environment with appropriate attire, setting, and cultural cues.',
            max_density: {
                headline_max_chars: 90,
                subheadline_max_chars: 160,
                badge_max_chars: 50,
                supporting_points_max: 4,
                before_points_max: 0,
                after_points_max: 0
            }
        }
    };

    /**
     * List all 3 MVP archetypes
     * @returns {Array<object>}
     */
    static getAllArchetypes() {
        return Object.values(this.ARCHETYPES);
    }

    /**
     * Get archetype by ID
     * @param {string} id 
     * @returns {object|null}
     */
    static getArchetype(id) {
        if (!id || typeof id !== 'string') return null;
        const normalized = id.trim().toUpperCase();
        return this.ARCHETYPES[normalized] || null;
    }

    /**
     * Check if archetype ID is valid
     * @param {string} id 
     * @returns {boolean}
     */
    static isValidArchetype(id) {
        if (!id || typeof id !== 'string') return false;
        const normalized = id.trim().toUpperCase();
        return Boolean(this.ARCHETYPES[normalized]);
    }

    /**
     * Get valid archetype IDs
     * @returns {string[]}
     */
    static getValidIds() {
        return Object.keys(this.ARCHETYPES);
    }
}
