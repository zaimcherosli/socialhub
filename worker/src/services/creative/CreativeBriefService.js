/**
 * CreativeBriefService.js
 * Intelligence layer for generating brand-aware Creative Briefs.
 * Resolves active brand profile, orchestrates archetype selection,
 * constructs structured JSON schemas, and applies deterministic claim guardrails.
 */

import { PosterArchetypeService } from './PosterArchetypeService.js';
import { AIFactory } from '../ai/AIFactory.js';

export class CreativeBriefService {
    /**
     * Normalize text for whitespace and clean tokens
     */
    static normalizeText(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/\s+/g, ' ').trim();
    }

    /**
     * Fallback heuristic classifier for auto archetype selection
     */
    static classifyArchetypeHeuristic(topic, objective = '', audience = '') {
        const combined = `${topic} ${objective} ${audience}`.toLowerCase();

        // 1. Transformation / Comparison cues
        const beforeAfterCues = [
            'before', 'after', 'sebelum', 'selepas', 'dulu', 'sekarang', 
            'transform', 'tukar', 'bandingan', 'beza', 'perubahan', 
            'lama vs baru', 'old vs new', 'debt consolidation', 'penyatuan hutang',
            'renovate', 'renovasi', 'makeover', 'turun berat', 'naik pangkat'
        ];
        if (beforeAfterCues.some(cue => combined.includes(cue))) {
            return 'BEFORE_AFTER';
        }

        // 2. Profession or demographic niche cues
        const professionCues = [
            'guru', 'cikgu', 'teacher', 'doktor', 'doctor', 'nurse', 'jururawat',
            'jurutera', 'engineer', 'akauntan', 'accountant', 'penjawat awam', 
            'kakitangan awam', 'civil servant', 'polis', 'tentera', 'swasta', 
            'pekerja swasta', 'peniaga', 'usahawan', 'sme', 'business owner',
            'freelancer', 'suri rumah', 'peguam', 'lawyer', 'arkitek', 'architect',
            'pemandu', 'rider', 'student', 'pelajar'
        ];
        if (professionCues.some(cue => combined.includes(cue))) {
            return 'PROFESSION_SPECIFIC';
        }

        // 3. Default to problem & solution spotlight
        return 'PROBLEM_SOLUTION';
    }

    /**
     * 1-Pass Safe JSON extractor and syntax repair helper
     */
    static safeParseAndRepairJson(rawText) {
        if (!rawText || typeof rawText !== 'string') {
            throw new Error('AI returned empty response for Creative Brief.');
        }

        // Strip markdown code fences if present
        let cleaned = rawText.trim();
        if (cleaned.includes('```json')) {
            cleaned = cleaned.replace(/^[\s\S]*?```json\s*/i, '').replace(/\s*```[\s\S]*$/, '');
        } else if (cleaned.includes('```')) {
            cleaned = cleaned.replace(/^[\s\S]*?```\s*/, '').replace(/\s*```[\s\S]*$/, '');
        }

        // Find outermost JSON object
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }

        // Attempt direct JSON parse
        try {
            return JSON.parse(cleaned);
        } catch (initialErr) {
            // Perform 1-pass common repairs: smart quotes, trailing commas, unescaped newlines
            let repaired = cleaned
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/,\s*([}\]])/g, '$1')
                .replace(/\r?\n/g, ' ');

            try {
                return JSON.parse(repaired);
            } catch (repairErr) {
                throw new Error(`Invalid AI JSON output: ${repairErr.message}. Raw output snippet: ${cleaned.slice(0, 150)}`);
            }
        }
    }

    /**
     * Deterministic scan for forbidden claims across all creative brief copy fields
     * Normalizes case and whitespace. Hard constraint.
     */
    static checkForbiddenClaims(brief, forbiddenClaims = []) {
        if (!Array.isArray(forbiddenClaims) || forbiddenClaims.length === 0) {
            return [];
        }

        // Aggregate all text surfaces from the brief
        const textSurfaces = [
            brief.headline || '',
            brief.subheadline || '',
            brief.badge || '',
            brief.problem || '',
            brief.solution || '',
            brief.cta || '',
            brief.disclaimer || '',
            ...(Array.isArray(brief.supporting_points) ? brief.supporting_points : []),
            ...(Array.isArray(brief.before_points) ? brief.before_points : []),
            ...(Array.isArray(brief.after_points) ? brief.after_points : [])
        ];

        const aggregatedText = textSurfaces.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
        const detected = [];

        for (const claim of forbiddenClaims) {
            if (!claim || typeof claim !== 'string') continue;
            const normalizedClaim = claim.toLowerCase().replace(/\s+/g, ' ').trim();
            if (normalizedClaim && aggregatedText.includes(normalizedClaim)) {
                detected.push(claim.trim());
            }
        }

        return detected;
    }

    /**
     * Check which allowed claims were successfully integrated into the brief
     */
    static checkAllowedClaims(brief, allowedClaims = []) {
        if (!Array.isArray(allowedClaims) || allowedClaims.length === 0) {
            return [];
        }

        const textSurfaces = [
            brief.headline || '',
            brief.subheadline || '',
            brief.badge || '',
            brief.problem || '',
            brief.solution || '',
            brief.cta || '',
            brief.disclaimer || '',
            ...(Array.isArray(brief.supporting_points) ? brief.supporting_points : []),
            ...(Array.isArray(brief.before_points) ? brief.before_points : []),
            ...(Array.isArray(brief.after_points) ? brief.after_points : [])
        ];

        const aggregatedText = textSurfaces.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
        const matched = [];

        for (const claim of allowedClaims) {
            if (!claim || typeof claim !== 'string') continue;
            const normalizedClaim = claim.toLowerCase().replace(/\s+/g, ' ').trim();
            if (normalizedClaim && aggregatedText.includes(normalizedClaim)) {
                matched.push(claim.trim());
            }
        }

        return matched;
    }

    /**
     * Validate and normalize brief object against archetype rules and brand constraints
     */
    static validateBrief(rawBrief, brandProfile, requestedArchetype = 'auto') {
        if (!rawBrief || typeof rawBrief !== 'object') {
            throw new Error('Creative brief must be a valid JSON object.');
        }

        if (!brandProfile || !brandProfile.id) {
            const err = new Error('Active Brand Profile required. Please configure and enable a Brand Profile for this workspace first.');
            err.statusCode = 400;
            throw err;
        }

        // Validate brand profile binding (reject foreign or mismatched brand profile IDs)
        if (rawBrief.brand_profile_id && Number(rawBrief.brand_profile_id) !== Number(brandProfile.id)) {
            const err = new Error(`Creative brief brand mismatch: brief belongs to brand_profile_id ${rawBrief.brand_profile_id}, but active workspace brand is ${brandProfile.id}`);
            err.statusCode = 400;
            throw err;
        }

        // 1. Resolve & validate archetype
        let archetype = null;

        // If caller explicitly requested a specific archetype (not 'auto'), it is strictly enforced
        if (requestedArchetype && requestedArchetype !== 'auto') {
            if (!PosterArchetypeService.isValidArchetype(requestedArchetype)) {
                throw new Error(`Invalid archetype '${requestedArchetype}'. Must be one of: ${PosterArchetypeService.getValidIds().join(', ')}`);
            }
            archetype = requestedArchetype.toUpperCase();
        } else {
            // Auto mode: Primary selection comes from the LLM's chosen archetype in rawBrief
            if (rawBrief.archetype && rawBrief.archetype !== 'auto' && PosterArchetypeService.isValidArchetype(rawBrief.archetype)) {
                archetype = rawBrief.archetype.toUpperCase();
            } else {
                // Lightweight fallback heuristic if AI returned invalid or omitted archetype
                archetype = this.classifyArchetypeHeuristic(
                    rawBrief.topic || '', 
                    rawBrief.campaign_objective || '', 
                    rawBrief.target_audience || ''
                );
            }
        }

        if (!PosterArchetypeService.isValidArchetype(archetype)) {
            throw new Error(`Invalid archetype '${archetype}'. Must be one of: ${PosterArchetypeService.getValidIds().join(', ')}`);
        }

        const archetypeDef = PosterArchetypeService.getArchetype(archetype);

        // 2. Validate mandatory headline
        let headline = typeof rawBrief.headline === 'string' ? rawBrief.headline.trim() : '';
        if (!headline) {
            throw new Error(`Creative brief missing mandatory field 'headline' for archetype ${archetype}.`);
        }
        if (headline.length > archetypeDef.max_density.headline_max_chars) {
            headline = headline.substring(0, archetypeDef.max_density.headline_max_chars).trim();
        }

        // 3. Normalize subheadline & badge lengths
        let subheadline = typeof rawBrief.subheadline === 'string' ? rawBrief.subheadline.trim() : '';
        if (subheadline.length > archetypeDef.max_density.subheadline_max_chars) {
            subheadline = subheadline.substring(0, archetypeDef.max_density.subheadline_max_chars).trim();
        }

        let badge = typeof rawBrief.badge === 'string' ? rawBrief.badge.trim() : '';
        if (badge.length > archetypeDef.max_density.badge_max_chars) {
            badge = badge.substring(0, archetypeDef.max_density.badge_max_chars).trim();
        }

        // 4. Validate CTA
        let cta = typeof rawBrief.cta === 'string' ? rawBrief.cta.trim() : '';
        if (!cta) {
            cta = (brandProfile && brandProfile.default_cta) ? brandProfile.default_cta : 'Hubungi Kami Sekarang';
        }

        // 5. Normalize array fields with maximum limits
        const normalizeArray = (val, maxItems) => {
            if (!Array.isArray(val)) return [];
            return val
                .filter(item => typeof item === 'string' && item.trim().length > 0)
                .map(item => item.trim())
                .slice(0, maxItems);
        };

        const supportingPoints = normalizeArray(rawBrief.supporting_points, 4);
        const beforePoints = normalizeArray(rawBrief.before_points, 4);
        const afterPoints = normalizeArray(rawBrief.after_points, 4);

        // 6. Enforce archetype-specific structural expectations
        if (archetype === 'BEFORE_AFTER') {
            if (beforePoints.length === 0 && afterPoints.length === 0) {
                // If AI omitted both arrays, synthesize minimal structural points
                beforePoints.push('Situasi Lama / Cabaran');
                afterPoints.push('Situasi Baharu / Selesai');
            }
        } else if (archetype === 'PROBLEM_SOLUTION') {
            if (!rawBrief.problem && !rawBrief.solution && supportingPoints.length === 0) {
                rawBrief.problem = 'Cabaran yang dihadapi pelanggan';
                rawBrief.solution = 'Penyelesaian pantas dan berkesan';
            }
        }

        // 7. Normalize Art Direction object
        const rawArt = rawBrief.art_direction || {};
        const artDirection = {
            subject: typeof rawArt.subject === 'string' ? rawArt.subject.trim() : '',
            setting: typeof rawArt.setting === 'string' ? rawArt.setting.trim() : '',
            mood: typeof rawArt.mood === 'string' ? rawArt.mood.trim() : 'Professional, Clean, Trustworthy',
            composition: typeof rawArt.composition === 'string' ? rawArt.composition.trim() : archetypeDef.layout_intent,
            cutout_mode: Boolean(rawArt.cutout_mode)
        };

        // 8. Assemble normalized Creative Brief
        const validatedBrief = {
            brand_profile_id: brandProfile ? brandProfile.id : null,
            archetype: archetype,
            campaign_objective: typeof rawBrief.campaign_objective === 'string' ? rawBrief.campaign_objective.trim() : '',
            topic: typeof rawBrief.topic === 'string' ? rawBrief.topic.trim() : '',
            target_audience: typeof rawBrief.target_audience === 'string' ? rawBrief.target_audience.trim() : (brandProfile?.target_audience || ''),

            headline: headline,
            subheadline: subheadline || null,
            badge: badge || null,

            problem: typeof rawBrief.problem === 'string' ? rawBrief.problem.trim() : null,
            solution: typeof rawBrief.solution === 'string' ? rawBrief.solution.trim() : null,

            supporting_points: supportingPoints,
            before_points: beforePoints,
            after_points: afterPoints,

            cta: cta,
            disclaimer: typeof rawBrief.disclaimer === 'string' ? rawBrief.disclaimer.trim() : null,

            visual_concept: typeof rawBrief.visual_concept === 'string' ? rawBrief.visual_concept.trim() : '',

            art_direction: artDirection,

            guardrails_applied: {
                forbidden_claims_blocked: [],
                allowed_claims_used: []
            }
        };

        // 9. Hard Claim Guardrails: Deterministic Forbidden Claims Scan
        const forbiddenClaims = (brandProfile && Array.isArray(brandProfile.forbidden_claims)) 
            ? brandProfile.forbidden_claims 
            : [];
        const detectedForbidden = this.checkForbiddenClaims(validatedBrief, forbiddenClaims);

        if (detectedForbidden.length > 0) {
            throw new Error(`Creative brief validation failed: Forbidden claim detected: "${detectedForbidden[0]}"`);
        }

        // 10. Check Allowed Claims
        const allowedClaims = (brandProfile && Array.isArray(brandProfile.allowed_claims)) 
            ? brandProfile.allowed_claims 
            : [];
        validatedBrief.guardrails_applied.allowed_claims_used = this.checkAllowedClaims(validatedBrief, allowedClaims);

        return validatedBrief;
    }

    /**
     * Build system and user prompt for LLM Creative Brief generation
     */
    static buildPrompt(brandProfile, input) {
        const { topic, archetype = 'auto', campaign_objective = '', target_audience = '', user_instructions = '' } = input;

        const allowedArchetypes = PosterArchetypeService.getValidIds();
        const forbiddenList = (Array.isArray(brandProfile.forbidden_claims) && brandProfile.forbidden_claims.length > 0)
            ? brandProfile.forbidden_claims.map(c => `- "${c}"`).join('\n')
            : 'None specified.';

        const allowedList = (Array.isArray(brandProfile.allowed_claims) && brandProfile.allowed_claims.length > 0)
            ? brandProfile.allowed_claims.map(c => `- "${c}"`).join('\n')
            : 'None specified.';

        const systemPrompt = `You are the Lead Creative Director and Advertising Strategist for SocialHub Creative Studio.
Your task is to generate a comprehensive, structured Creative Brief in strict JSON format based on the client's Brand Profile and marketing inputs.

=== ACTIVE BRAND PROFILE ===
Brand Name: ${brandProfile.name}
Industry: ${brandProfile.industry || 'General Business'}
Description: ${brandProfile.brand_description || 'N/A'}
Preferred Language: ${brandProfile.preferred_language || 'ms'} (Write all copy in this language)
Tone of Voice: ${brandProfile.tone_of_voice || 'Professional, Relatable'}
Target Audience: ${target_audience || brandProfile.target_audience || 'General Audience'}
Default CTA: ${brandProfile.default_cta || 'Hubungi Kami'}
Visual Style / Aesthetic: ${brandProfile.visual_style || 'Clean, Modern, High Contrast'}
Creative Notes: ${brandProfile.creative_notes || 'N/A'}

=== CLAIM GUARDRAILS (STRICT RULES) ===
ALLOWED CLAIMS TO HIGHLIGHT:
${allowedList}

FORBIDDEN CLAIMS (HARD PROHIBITION - NEVER INCLUDE ANY OF THESE WORDS OR PROMISES IN ANY FIELD):
${forbiddenList}

=== ARCHETYPE REQUIREMENTS ===
Allowed Archetypes: ${allowedArchetypes.join(', ')}
Requested Archetype Mode: "${archetype}"

Archetype Guidance:
1. BEFORE_AFTER:
   - Use for: Transformations, comparisons, old vs new, problem state to resolved state.
   - Required copy: headline, before_points (max 4), after_points (max 4), cta.
2. PROBLEM_SOLUTION:
   - Use for: Pain point callout followed immediately by clear authoritative solution.
   - Required copy: headline, problem, solution, supporting_points (max 4), cta.
3. PROFESSION_SPECIFIC:
   - Use for: Direct niche targeting (e.g. Guru, Penjawat Awam, Jurutera, Peniaga).
   - Required copy: headline, badge (profession/audience pill), supporting_points (max 4), cta.

If Requested Archetype Mode is "auto", select the single best archetype from [${allowedArchetypes.join(', ')}] that fits the topic and audience.

=== COPY DENSITY CONSTRAINTS ===
- headline: Max 90 characters. Punchy, high-impact, advertising-grade.
- subheadline: Max 160 characters. Clarifies the headline offer.
- badge: Max 50 characters (e.g. "Khas Untuk Penjawat Awam" or "Edisi Terhad").
- supporting_points: Array of max 4 brief benefit strings.
- before_points: Array of max 4 brief points (for BEFORE_AFTER).
- after_points: Array of max 4 brief points (for BEFORE_AFTER).
- cta: Action-oriented button label.

=== OUTPUT FORMAT ===
You MUST return ONLY valid JSON matching this exact structure with NO markdown wrapping and NO commentary:
{
  "archetype": "BEFORE_AFTER | PROBLEM_SOLUTION | PROFESSION_SPECIFIC",
  "campaign_objective": "string",
  "topic": "string",
  "target_audience": "string",
  "headline": "string",
  "subheadline": "string",
  "badge": "string or null",
  "problem": "string or null",
  "solution": "string or null",
  "supporting_points": ["point 1", "point 2"],
  "before_points": ["point 1", "point 2"],
  "after_points": ["point 1", "point 2"],
  "cta": "string",
  "disclaimer": "string or null",
  "visual_concept": "Description of overall visual poster idea",
  "art_direction": {
    "subject": "Primary subject of the background visual",
    "setting": "Environment / setting",
    "mood": "Emotional tone / lighting mood",
    "composition": "Visual framing and negative space direction",
    "cutout_mode": false
  }
}`;

        const userPrompt = `Campaign Topic: ${topic}
${campaign_objective ? `Campaign Objective: ${campaign_objective}\n` : ''}${target_audience ? `Target Audience Override: ${target_audience}\n` : ''}${user_instructions ? `Additional Instructions: ${user_instructions}\n` : ''}
Generate the complete Creative Brief JSON now:`;

        return { systemPrompt, userPrompt };
    }

    /**
     * Primary entry point: Generates a brand-aware Creative Brief
     */
    static async generateBrief({
        aiEnv,
        brandProfile,
        topic,
        archetype = 'auto',
        campaign_objective = '',
        target_audience = '',
        user_instructions = ''
    }) {
        if (!brandProfile || !brandProfile.id) {
            const err = new Error('Active Brand Profile required. Please configure and enable a Brand Profile for this workspace first.');
            err.statusCode = 400;
            throw err;
        }

        if (!topic || typeof topic !== 'string' || !topic.trim()) {
            const err = new Error('Topic is required for creative brief generation.');
            err.statusCode = 400;
            throw err;
        }

        const normalizedArchetype = archetype ? archetype.trim() : 'auto';
        if (normalizedArchetype !== 'auto' && !PosterArchetypeService.isValidArchetype(normalizedArchetype)) {
            const err = new Error(`Invalid archetype '${archetype}'. Allowed archetypes: ${PosterArchetypeService.getValidIds().join(', ')} or 'auto'.`);
            err.statusCode = 400;
            throw err;
        }

        const provider = AIFactory.getProvider(aiEnv);
        const { systemPrompt, userPrompt } = this.buildPrompt(brandProfile, {
            topic: topic.trim(),
            archetype: normalizedArchetype,
            campaign_objective: campaign_objective ? campaign_objective.trim() : '',
            target_audience: target_audience ? target_audience.trim() : '',
            user_instructions: user_instructions ? user_instructions.trim() : ''
        });

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        let rawResponse = '';
        try {
            rawResponse = await provider.generateChatResponse(messages, { temperature: 0.7 });
        } catch (aiErr) {
            const err = new Error(`AI generation service error: ${aiErr.message}`);
            err.statusCode = 502;
            throw err;
        }

        // Parse & repair JSON
        const parsedBrief = this.safeParseAndRepairJson(rawResponse);

        // Ensure topic is preserved
        if (!parsedBrief.topic) {
            parsedBrief.topic = topic.trim();
        }

        // Validate and apply guardrails
        const validatedBrief = this.validateBrief(parsedBrief, brandProfile, normalizedArchetype);

        return validatedBrief;
    }
}
