-- Migration: Add Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT CHECK(type IN ('success', 'error', 'info', 'warning')) NOT NULL DEFAULT 'info',
    is_read INTEGER DEFAULT 0, -- 0 = unread, 1 = read
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    link TEXT
);

-- Index for fast lookup by workspace
CREATE INDEX IF NOT EXISTS idx_notifications_workspace_id ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
