/**
 * BrandProfileService.js
 * Multi-tenant Brand Profile Service with strict workspace isolation.
 * Handles CRUD operations, client association validation, single-default guarantees,
 * and safe JSON parsing/formatting for SocialHub Creative Studio.
 */

export class BrandProfileService {
    /**
     * Helper to safely parse JSON text with fallback
     */
    static safeJsonParse(val, fallback = null) {
        if (val === null || val === undefined) return fallback;
        if (typeof val === 'object') return val;
        try {
            return JSON.parse(val);
        } catch (_) {
            return fallback;
        }
    }

    /**
     * Strict JSON validator & serializer by expected field type.
     * Rejects malformed JSON strings, type mismatches (e.g. array where object expected),
     * and ensures no silent coercion of invalid types.
     * 
     * @param {string} fieldName - Field name for clear error messaging
     * @param {any} val - Input value (JS object/array, JSON string, or undefined/null)
     * @param {'object' | 'array'} expectedType - 'object' (non-null, non-array) or 'array'
     * @param {boolean} required - Whether the field is mandatory
     * @param {any} defaultValue - Fallback default value if val is null/undefined
     * @returns {string} Clean JSON string for database storage
     */
    static validateAndSerializeJson(fieldName, val, expectedType, required = false, defaultValue = null) {
        if (val === null || val === undefined) {
            if (required) {
                throw new Error(`Field '${fieldName}' is required and cannot be empty.`);
            }
            if (defaultValue !== null && defaultValue !== undefined) {
                return JSON.stringify(defaultValue);
            }
            return expectedType === 'array' ? '[]' : '{}';
        }

        let parsed = val;
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed) {
                if (required) {
                    throw new Error(`Field '${fieldName}' is required and cannot be empty.`);
                }
                if (defaultValue !== null && defaultValue !== undefined) {
                    return JSON.stringify(defaultValue);
                }
                return expectedType === 'array' ? '[]' : '{}';
            }
            try {
                parsed = JSON.parse(trimmed);
            } catch (e) {
                throw new Error(`Field '${fieldName}' contains invalid JSON: ${e.message}`);
            }
        }

        if (expectedType === 'array') {
            if (!Array.isArray(parsed)) {
                const actualType = (typeof parsed === 'object' && parsed !== null) ? 'object' : typeof parsed;
                throw new Error(`Field '${fieldName}' must be a JSON array, received ${actualType}.`);
            }
            return JSON.stringify(parsed);
        }

        if (expectedType === 'object') {
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                const actualType = Array.isArray(parsed) ? 'array' : (parsed === null ? 'null' : typeof parsed);
                throw new Error(`Field '${fieldName}' must be a JSON object, received ${actualType}.`);
            }
            return JSON.stringify(parsed);
        }

        throw new Error(`Unsupported expectedType '${expectedType}' for field '${fieldName}'.`);
    }

    /**
     * Formats raw D1 database row into clean API response object with parsed JSON fields
     */
    static formatRecord(row) {
        if (!row) return null;
        return {
            id: row.id,
            workspace_id: row.workspace_id,
            client_id: row.client_id || null,
            name: row.name,
            website: row.website || '',
            industry: row.industry || '',
            brand_description: row.brand_description || '',
            preferred_language: row.preferred_language || 'ms',
            tone_of_voice: row.tone_of_voice || 'Professional, Relatable',
            target_audience: row.target_audience || '',
            primary_colors: this.safeJsonParse(row.primary_colors, {
                primary: '#FBBF24',
                secondary: '#111827',
                accent: '#F59E0B',
                background: '#FFFFFF',
                surface: '#0B0F19'
            }),
            typography_style: this.safeJsonParse(row.typography_style, {
                headingFont: 'Montserrat',
                bodyFont: 'Inter',
                headingWeight: '900'
            }),
            visual_style: this.safeJsonParse(row.visual_style, {
                style: 'Corporate Infographic',
                photographyStyle: 'Authentic Malaysian professional'
            }),
            default_cta: row.default_cta || '',
            allowed_claims: this.safeJsonParse(row.allowed_claims, []),
            forbidden_claims: this.safeJsonParse(row.forbidden_claims, []),
            creative_notes: row.creative_notes || '',
            logo_media_id: row.logo_media_id || null,
            logo_url: row.logo_url || null,
            contact_info: this.safeJsonParse(row.contact_info, {}),
            reference_images: this.safeJsonParse(row.reference_images, []),
            is_enabled: Boolean(row.is_enabled),
            is_default: Boolean(row.is_default),
            created_at: row.created_at,
            updated_at: row.updated_at
        };
    }

    /**
     * Idempotent table & index initialization in D1 SQLite
     */
    static async ensureTable(db) {
        if (!db) return;
        try {
            await db.prepare(`
                CREATE TABLE IF NOT EXISTS brand_profiles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
                    name TEXT NOT NULL,
                    website TEXT,
                    industry TEXT,
                    brand_description TEXT,
                    preferred_language TEXT DEFAULT 'ms',
                    tone_of_voice TEXT DEFAULT 'Professional, Relatable',
                    target_audience TEXT,
                    primary_colors TEXT NOT NULL,
                    typography_style TEXT NOT NULL,
                    visual_style TEXT,
                    default_cta TEXT,
                    allowed_claims TEXT,
                    forbidden_claims TEXT,
                    creative_notes TEXT,
                    logo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
                    logo_url TEXT,
                    contact_info TEXT,
                    reference_images TEXT,
                    is_enabled INTEGER DEFAULT 1,
                    is_default INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            `).run();

            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_brand_profiles_workspace ON brand_profiles(workspace_id, is_enabled)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_brand_profiles_client ON brand_profiles(client_id)`).run();

            // Safe partial unique index: ensures only one default profile per workspace
            try {
                await db.prepare(`
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_profiles_single_default 
                    ON brand_profiles(workspace_id) 
                    WHERE is_default = 1
                `).run();
            } catch (_) {}
        } catch (err) {
            console.warn('[BrandProfileService.ensureTable] Notice:', err.message);
        }
    }

    /**
     * Lightweight active brand resolver for UI navigation guard
     * Resolves: enabled profiles only -> default enabled profile first -> otherwise first enabled profile -> otherwise null
     */
    static async getActiveBrandSummary(db, workspaceId) {
        if (!db || !workspaceId) return { has_active_brand: false, brand: null };

        const row = await db.prepare(
            `SELECT id, name, industry, logo_url, is_default, is_enabled 
             FROM brand_profiles 
             WHERE workspace_id = ? AND is_enabled = 1 
             ORDER BY is_default DESC, id ASC 
             LIMIT 1`
        ).bind(workspaceId).first();

        if (!row) {
            return {
                has_active_brand: false,
                brand: null
            };
        }

        return {
            has_active_brand: true,
            brand: {
                id: row.id,
                name: row.name,
                industry: row.industry || null,
                logo_url: row.logo_url || null,
                is_default: Boolean(row.is_default)
            }
        };
    }

    /**
     * Retrieve the active brand profile with full details for Creative Studio operations.
     * Resolves: enabled profiles only -> default enabled profile first -> otherwise first enabled profile -> otherwise null
     */
    static async getActiveProfile(db, workspaceId) {
        if (!db || !workspaceId) return null;

        const row = await db.prepare(
            `SELECT * FROM brand_profiles 
             WHERE workspace_id = ? AND is_enabled = 1 
             ORDER BY is_default DESC, id ASC 
             LIMIT 1`
        ).bind(workspaceId).first();

        return this.formatRecord(row);
    }

    /**
     * List all brand profiles strictly within the active workspace
     */
    static async listProfiles(db, workspaceId) {
        if (!db || !workspaceId) return [];
        const { results } = await db.prepare(
            `SELECT * FROM brand_profiles 
             WHERE workspace_id = ? 
             ORDER BY is_default DESC, created_at DESC`
        ).bind(workspaceId).all();

        return (results || []).map(row => this.formatRecord(row));
    }

    /**
     * Retrieve single brand profile with strict workspace ownership check
     */
    static async getProfileById(db, workspaceId, profileId) {
        if (!db || !workspaceId || !profileId) return null;
        const row = await db.prepare(
            `SELECT * FROM brand_profiles WHERE id = ? AND workspace_id = ?`
        ).bind(profileId, workspaceId).first();

        return this.formatRecord(row);
    }

    /**
     * Validate client ownership: ensures client belongs to the active workspace
     */
    static async validateClientOwnership(db, workspaceId, clientId) {
        if (!clientId) return true;
        const client = await db.prepare(
            `SELECT id FROM clients WHERE id = ? AND workspace_id = ?`
        ).bind(clientId, workspaceId).first();

        if (!client) {
            throw new Error('Client tidak wujud atau bukan milik workspace aktif ini.');
        }
        return true;
    }

    /**
     * Create brand profile with client validation and atomic default handling
     */
    static async createProfile(db, workspaceId, data) {
        if (!db || !workspaceId) throw new Error('Database atau workspace tidak sah.');

        const name = (data.name || '').trim();
        if (!name) throw new Error('Nama jenama (brand name) adalah wajib.');

        // Validate client relationship if provided
        const clientId = data.client_id ? parseInt(data.client_id, 10) : null;
        if (clientId) {
            await this.validateClientOwnership(db, workspaceId, clientId);
        }

        const isDefault = (data.is_default === 1 || data.is_default === true) ? 1 : 0;
        const isEnabled = (data.is_enabled === 0 || data.is_enabled === false) ? 0 : 1;

        if (isDefault === 1 && isEnabled === 0) {
            throw new Error('Profil jenama yang tidak aktif (disabled) tidak boleh dijadikan default.');
        }

        // Strict JSON validation by expected field type
        const primaryColors = this.validateAndSerializeJson(
            'primary_colors',
            data.primary_colors,
            'object',
            false,
            {
                primary: '#FBBF24',
                secondary: '#111827',
                accent: '#F59E0B',
                background: '#FFFFFF',
                surface: '#0B0F19'
            }
        );

        const typographyStyle = this.validateAndSerializeJson(
            'typography_style',
            data.typography_style,
            'object',
            false,
            {
                headingFont: 'Montserrat',
                bodyFont: 'Inter',
                headingWeight: '900'
            }
        );

        const visualStyle = this.validateAndSerializeJson(
            'visual_style',
            data.visual_style,
            'object',
            false,
            {
                style: 'Corporate Infographic',
                photographyStyle: 'Authentic Malaysian professional'
            }
        );

        const contactInfo = this.validateAndSerializeJson(
            'contact_info',
            data.contact_info,
            'object',
            false,
            {}
        );

        const allowedClaims = this.validateAndSerializeJson(
            'allowed_claims',
            data.allowed_claims,
            'array',
            false,
            []
        );

        const forbiddenClaims = this.validateAndSerializeJson(
            'forbidden_claims',
            data.forbidden_claims,
            'array',
            false,
            []
        );

        const referenceImages = this.validateAndSerializeJson(
            'reference_images',
            data.reference_images,
            'array',
            false,
            []
        );

        const insertStmt = db.prepare(`
            INSERT INTO brand_profiles (
                workspace_id, client_id, name, website, industry, brand_description,
                preferred_language, tone_of_voice, target_audience, primary_colors,
                typography_style, visual_style, default_cta, allowed_claims,
                forbidden_claims, creative_notes, logo_media_id, logo_url,
                contact_info, reference_images, is_enabled, is_default
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?
            )
        `).bind(
            workspaceId,
            clientId,
            name,
            (data.website || '').trim() || null,
            (data.industry || '').trim() || null,
            (data.brand_description || '').trim() || null,
            (data.preferred_language || 'ms').trim(),
            (data.tone_of_voice || 'Professional, Relatable').trim(),
            (data.target_audience || '').trim() || null,
            primaryColors,
            typographyStyle,
            visualStyle,
            (data.default_cta || '').trim() || null,
            allowedClaims,
            forbiddenClaims,
            (data.creative_notes || '').trim() || null,
            data.logo_media_id ? parseInt(data.logo_media_id, 10) : null,
            (data.logo_url || '').trim() || null,
            contactInfo,
            referenceImages,
            isEnabled,
            isDefault
        );

        let newId;
        if (isDefault === 1) {
            const unsetStmt = db.prepare(
                `UPDATE brand_profiles SET is_default = 0 WHERE workspace_id = ?`
            ).bind(workspaceId);

            if (typeof db.batch === 'function') {
                const batchResults = await db.batch([unsetStmt, insertStmt]);
                const insertRes = batchResults[1];
                newId = insertRes.meta.last_row_id;
            } else {
                await unsetStmt.run();
                const res = await insertStmt.run();
                newId = res.meta.last_row_id;
            }
        } else {
            const result = await insertStmt.run();
            newId = result.meta.last_row_id;
        }

        return await this.getProfileById(db, workspaceId, newId);
    }

    /**
     * Update brand profile with strict workspace scoping and atomic default handling
     */
    static async updateProfile(db, workspaceId, profileId, data) {
        if (!db || !workspaceId || !profileId) throw new Error('Parameter tidak sah.');

        // Verify existing profile belongs to this workspace
        const existing = await this.getProfileById(db, workspaceId, profileId);
        if (!existing) return null;

        // Validate client if changed/provided
        let clientId = existing.client_id;
        if (data.client_id !== undefined) {
            clientId = data.client_id ? parseInt(data.client_id, 10) : null;
            if (clientId) {
                await this.validateClientOwnership(db, workspaceId, clientId);
            }
        }

        const isDefault = data.is_default !== undefined
            ? ((data.is_default === 1 || data.is_default === true) ? 1 : 0)
            : (existing.is_default ? 1 : 0);

        const isEnabled = data.is_enabled !== undefined
            ? ((data.is_enabled === 1 || data.is_enabled === true) ? 1 : 0)
            : (existing.is_enabled ? 1 : 0);

        const explicitlySettingDefault = (data.is_default === 1 || data.is_default === true);
        if (explicitlySettingDefault && isEnabled === 0) {
            throw new Error('Profil jenama yang tidak aktif (disabled) tidak boleh dijadikan default.');
        }

        const name = data.name !== undefined ? (data.name || '').trim() : existing.name;
        if (!name) throw new Error('Nama jenama (brand name) tidak boleh kosong.');

        // Strict JSON validation by expected field type on update
        const primaryColors = data.primary_colors !== undefined
            ? this.validateAndSerializeJson('primary_colors', data.primary_colors, 'object', false, existing.primary_colors)
            : JSON.stringify(existing.primary_colors);

        const typographyStyle = data.typography_style !== undefined
            ? this.validateAndSerializeJson('typography_style', data.typography_style, 'object', false, existing.typography_style)
            : JSON.stringify(existing.typography_style);

        const visualStyle = data.visual_style !== undefined
            ? this.validateAndSerializeJson('visual_style', data.visual_style, 'object', false, existing.visual_style)
            : JSON.stringify(existing.visual_style);

        const allowedClaims = data.allowed_claims !== undefined
            ? this.validateAndSerializeJson('allowed_claims', data.allowed_claims, 'array', false, existing.allowed_claims)
            : JSON.stringify(existing.allowed_claims);

        const forbiddenClaims = data.forbidden_claims !== undefined
            ? this.validateAndSerializeJson('forbidden_claims', data.forbidden_claims, 'array', false, existing.forbidden_claims)
            : JSON.stringify(existing.forbidden_claims);

        const contactInfo = data.contact_info !== undefined
            ? this.validateAndSerializeJson('contact_info', data.contact_info, 'object', false, existing.contact_info)
            : JSON.stringify(existing.contact_info);

        const referenceImages = data.reference_images !== undefined
            ? this.validateAndSerializeJson('reference_images', data.reference_images, 'array', false, existing.reference_images)
            : JSON.stringify(existing.reference_images);

        const updateStmt = db.prepare(`
            UPDATE brand_profiles SET
                client_id = ?,
                name = ?,
                website = ?,
                industry = ?,
                brand_description = ?,
                preferred_language = ?,
                tone_of_voice = ?,
                target_audience = ?,
                primary_colors = ?,
                typography_style = ?,
                visual_style = ?,
                default_cta = ?,
                allowed_claims = ?,
                forbidden_claims = ?,
                creative_notes = ?,
                logo_media_id = ?,
                logo_url = ?,
                contact_info = ?,
                reference_images = ?,
                is_enabled = ?,
                is_default = ?,
                updated_at = (datetime('now'))
            WHERE id = ? AND workspace_id = ?
        `).bind(
            clientId,
            name,
            data.website !== undefined ? (data.website || '').trim() || null : existing.website,
            data.industry !== undefined ? (data.industry || '').trim() || null : existing.industry,
            data.brand_description !== undefined ? (data.brand_description || '').trim() || null : existing.brand_description,
            data.preferred_language !== undefined ? (data.preferred_language || 'ms').trim() : existing.preferred_language,
            data.tone_of_voice !== undefined ? (data.tone_of_voice || 'Professional, Relatable').trim() : existing.tone_of_voice,
            data.target_audience !== undefined ? (data.target_audience || '').trim() || null : existing.target_audience,
            primaryColors,
            typographyStyle,
            visualStyle,
            data.default_cta !== undefined ? (data.default_cta || '').trim() || null : existing.default_cta,
            allowedClaims,
            forbiddenClaims,
            data.creative_notes !== undefined ? (data.creative_notes || '').trim() || null : existing.creative_notes,
            data.logo_media_id !== undefined ? (data.logo_media_id ? parseInt(data.logo_media_id, 10) : null) : existing.logo_media_id,
            data.logo_url !== undefined ? (data.logo_url || '').trim() || null : existing.logo_url,
            contactInfo,
            referenceImages,
            isEnabled,
            isDefault,
            profileId,
            workspaceId
        );

        if (isDefault === 1 && !existing.is_default) {
            const unsetStmt = db.prepare(
                `UPDATE brand_profiles SET is_default = 0 WHERE workspace_id = ? AND id != ?`
            ).bind(workspaceId, profileId);

            if (typeof db.batch === 'function') {
                await db.batch([unsetStmt, updateStmt]);
            } else {
                await unsetStmt.run();
                await updateStmt.run();
            }
        } else {
            await updateStmt.run();
        }

        return await this.getProfileById(db, workspaceId, profileId);
    }

    /**
     * Safely set a profile as the default for the active workspace using atomic db.batch
     */
    static async setDefault(db, workspaceId, profileId) {
        if (!db || !workspaceId || !profileId) return false;

        const existing = await this.getProfileById(db, workspaceId, profileId);
        if (!existing) return null;

        if (!existing.is_enabled) {
            throw new Error('Profil jenama yang tidak aktif (disabled) tidak boleh dijadikan default.');
        }

        const unsetStmt = db.prepare(
            `UPDATE brand_profiles SET is_default = 0 WHERE workspace_id = ?`
        ).bind(workspaceId);

        const setStmt = db.prepare(
            `UPDATE brand_profiles SET is_default = 1, updated_at = (datetime('now')) WHERE id = ? AND workspace_id = ?`
        ).bind(profileId, workspaceId);

        if (typeof db.batch === 'function') {
            await db.batch([unsetStmt, setStmt]);
        } else {
            await unsetStmt.run();
            await setStmt.run();
        }

        return true;
    }

    /**
     * Delete brand profile strictly within active workspace
     */
    static async deleteProfile(db, workspaceId, profileId) {
        if (!db || !workspaceId || !profileId) return false;

        const result = await db.prepare(
            `DELETE FROM brand_profiles WHERE id = ? AND workspace_id = ?`
        ).bind(profileId, workspaceId).run();

        return result.meta.changes > 0;
    }
}
