-- SocialHub D1 SQLite Database Schema
-- Production-ready foundation schema for user management, accounts, posts, schedule matrix, and logs.

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'user')) DEFAULT 'user',
    status TEXT CHECK(status IN ('active', 'suspended', 'inactive')) DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
);

-- Social Accounts (Third-party platforms connected via OAuth)
CREATE TABLE IF NOT EXISTS social_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK(platform IN ('threads', 'facebook', 'instagram', 'linkedin', 'tiktok', 'twitter')),
    account_name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TEXT,
    status TEXT CHECK(status IN ('active', 'expired', 'disconnected')) DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, platform, account_id)
);

-- Posts (Main content table)
CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,
    caption TEXT,
    status TEXT CHECK(status IN ('draft', 'scheduled', 'published', 'failed')) DEFAULT 'draft',
    visibility TEXT CHECK(visibility IN ('public', 'private', 'limited')) DEFAULT 'public',
    scheduled_at TEXT, -- ISO8601 string
    published_at TEXT, -- ISO8601 string
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Media Assets (Stored in library)
CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,
    storage_provider TEXT CHECK(storage_provider IN ('local', 'r2', 's3', 'gcs')) DEFAULT 'local',
    storage_key TEXT NOT NULL,
    thumbnail TEXT,
    is_favorite INTEGER DEFAULT 0, -- 0 = false, 1 = true
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Post Media Junction (Mapping media attachments to posts)
CREATE TABLE IF NOT EXISTS post_media (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, media_id)
);

-- Schedules (Junction table mapping post to social account and exact dispatch time)
CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    social_account_id INTEGER NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    scheduled_time TEXT NOT NULL, -- ISO8601 string
    status TEXT CHECK(status IN ('pending', 'processing', 'success', 'failed')) DEFAULT 'pending',
    publish_log_id INTEGER, -- Set after publication attempt
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Publish Logs (Audit trail for api responses and errors)
CREATE TABLE IF NOT EXISTS publish_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER REFERENCES publish_queue(id) ON DELETE SET NULL,
    social_account_id INTEGER NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    status TEXT CHECK(status IN ('success', 'failed')) NOT NULL,
    error_message TEXT,
    external_post_id TEXT, -- ID returned by the external network API
    response_payload TEXT, -- JSON response from API for troubleshooting
    published_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User Settings (Key-Value settings per user)
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    setting_key TEXT NOT NULL,
    setting_value TEXT, -- JSON or string
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, setting_key)
);

-- Publish Queue (Core queue engine mapping post dispatch pipelines)
CREATE TABLE IF NOT EXISTS publish_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK(platform IN ('threads', 'facebook', 'instagram', 'linkedin', 'tiktok', 'twitter')),
    scheduled_at TEXT NOT NULL, -- UTC ISO8601 string
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT CHECK(status IN ('queued', 'publishing', 'published', 'failed', 'cancelled', 'retrying')) DEFAULT 'queued',
    attempt_count INTEGER DEFAULT 0,
    last_attempt TEXT, -- UTC ISO8601 string
    next_retry TEXT, -- UTC ISO8601 string
    worker_id TEXT, -- Lock UUID
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indices for performance optimization
CREATE INDEX IF NOT EXISTS idx_social_accounts_user ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_status ON posts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_media_user ON media(user_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_schedules_time_status ON schedules(scheduled_time, status);
CREATE INDEX IF NOT EXISTS idx_publish_logs_account ON publish_logs(social_account_id);
CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
CREATE INDEX IF NOT EXISTS idx_publish_queue_scheduled ON publish_queue(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_publish_queue_user ON publish_queue(user_id);
