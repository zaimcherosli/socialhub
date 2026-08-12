-- SocialHub SaaS Multi-Tenant Migration Script

-- 1. Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    subscription_plan TEXT CHECK(subscription_plan IN ('free', 'starter', 'pro', 'agency', 'enterprise')) DEFAULT 'free',
    subscription_status TEXT CHECK(subscription_status IN ('active', 'past_due', 'canceled', 'unpaid')) DEFAULT 'active',
    billplz_sub_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Create workspace_members table
CREATE TABLE IF NOT EXISTS workspace_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT CHECK(role IN ('owner', 'admin', 'editor', 'viewer')) DEFAULT 'editor',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, user_id)
);

-- 3. Create clients table
CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Create SaaS audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Add workspace_id columns to existing tables for SaaS scoping
ALTER TABLE social_accounts ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE scheduled_posts ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE posts ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE media ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;

-- 5b. Create workspace_usage table for AI Quota & Developer Cost Control
-- This table tracks monthly AI usage (captions + image credits) per workspace.
-- It is reset every month (by year_month key) to enforce subscription plan limits.
CREATE TABLE IF NOT EXISTS workspace_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    year_month TEXT NOT NULL,                   -- e.g. '2026-08' (reset monthly)
    ai_text_count INTEGER DEFAULT 0,            -- AI caption generations used
    ai_image_credits INTEGER DEFAULT 0,         -- Total image credits consumed
    ai_image_low_count INTEGER DEFAULT 0,       -- Low quality (Cloudflare SDXL) count
    ai_image_medium_count INTEGER DEFAULT 0,    -- Medium quality (OpenAI Standard) count
    ai_image_high_count INTEGER DEFAULT 0,      -- High quality (OpenAI HD) count
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, year_month)
);

-- 5c. Plan limits reference (for reference — enforced in backend worker)
-- | Plan       | ai_text_limit | image_credit_limit | medium_limit | high_limit |
-- | free       | 20            | 10                 | 2            | 0          |
-- | starter    | 100           | 50                 | 30           | 10         |
-- | pro        | 300           | 200                | 80           | 30         |
-- | agency     | 1000          | 600                | 250          | 100        |
-- | enterprise | unlimited     | unlimited          | unlimited    | unlimited  |

-- 6. Indexes for optimized SaaS multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_social_accounts_workspace ON social_accounts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_workspace ON scheduled_posts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_posts_workspace ON posts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_media_workspace ON media(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_workspace ON clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
