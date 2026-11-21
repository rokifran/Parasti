-- Plan 06: prioritas tugas + label per-user (page, task, event).
-- 0011 dipesan plan-04b, jadi file ini memakai 0012.

ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('high', 'normal', 'low'));

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_user_id, name),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_labels_owner ON labels(owner_user_id);

CREATE TABLE IF NOT EXISTS page_labels (
  page_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (page_id, label_id),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_page_labels_label ON page_labels(label_id);

CREATE TABLE IF NOT EXISTS task_labels (
  task_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (task_id, label_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id);

CREATE TABLE IF NOT EXISTS event_labels (
  event_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  PRIMARY KEY (event_id, label_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_labels_label ON event_labels(label_id);
