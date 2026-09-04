-- Migration: Brand Profiles Infrastructure
-- Safe & idempotent schema creation for multi-tenant brand-aware creative studio.

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
    
    -- Design System (Stored as JSON text)
    primary_colors TEXT NOT NULL,       -- JSON: {"primary":"#...","secondary":"#...","accent":"#...","background":"#...","surface":"#..."}
    typography_style TEXT NOT NULL,     -- JSON: {"headingFont":"Montserrat","bodyFont":"Inter","headingWeight":"900"}
    visual_style TEXT,                  -- JSON: {"style":"...","photographyStyle":"...","elements":["..."]}
    default_cta TEXT,
    
    -- Content & Compliance Guardrails (Stored as JSON string arrays)
    allowed_claims TEXT,                -- JSON array: ["Semakan kelayakan percuma", "..."]
    forbidden_claims TEXT,              -- JSON array: ["100% gerenti lulus", "..."]
    creative_notes TEXT,
    
    -- Assets & Contact (Stored as JSON or ID/URL)
    logo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
    logo_url TEXT,
    contact_info TEXT,                  -- JSON: {"phone":"...","whatsapp":"...","tagline":"..."}
    reference_images TEXT,              -- JSON array: ["url1", "url2"]
    
    is_enabled INTEGER DEFAULT 1,       -- 1 = feature active for this profile, 0 = disabled
    is_default INTEGER DEFAULT 0,       -- 1 = default brand for this workspace
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_brand_profiles_workspace ON brand_profiles(workspace_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_client ON brand_profiles(client_id);

-- D1 SQLite Partial Unique Index:
-- Strictly guarantees at the database level that only ONE brand profile per workspace can have is_default = 1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_profiles_single_default 
ON brand_profiles(workspace_id) 
WHERE is_default = 1;
