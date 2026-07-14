-- Creator Field Assistant D1 Schema
-- Run: wrangler d1 execute creator-field-assistant --file=worker/schema.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Days
CREATE TABLE IF NOT EXISTS days (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  location_name TEXT NOT NULL,
  date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  "order" INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Shots
CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL,
  type TEXT DEFAULT 'vlog',
  description TEXT DEFAULT '',
  lens TEXT DEFAULT '35mm',
  format TEXT DEFAULT '16:9',
  status TEXT DEFAULT 'planned',
  notes TEXT DEFAULT '',
  completed INTEGER DEFAULT 0,
  "order" INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
);

-- Gear items
CREATE TABLE IF NOT EXISTS gear (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'accessory',
  weight INTEGER DEFAULT 0,
  weight_unit TEXT DEFAULT 'g',
  is_packed INTEGER DEFAULT 0,
  is_owned INTEGER DEFAULT 1,
  notes TEXT DEFAULT '',
  image_data_url TEXT DEFAULT '',
  "order" INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Kit presets
CREATE TABLE IF NOT EXISTS kits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  item_ids TEXT DEFAULT '[]',
  is_default INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Checklists
CREATE TABLE IF NOT EXISTS checklists (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  project_id TEXT DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Checklist items
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL,
  text TEXT NOT NULL,
  checked INTEGER DEFAULT 0,
  "order" INTEGER DEFAULT 0,
  is_custom INTEGER DEFAULT 0,
  FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE
);

-- Map pins
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  type TEXT DEFAULT 'photo_spot',
  description TEXT DEFAULT '',
  photo_data_url TEXT DEFAULT '',
  project_id TEXT DEFAULT '',
  day_id TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_days_project ON days(project_id);
CREATE INDEX IF NOT EXISTS idx_shots_day ON shots(day_id);
CREATE INDEX IF NOT EXISTS idx_gear_user ON gear(user_id);
CREATE INDEX IF NOT EXISTS idx_checklists_user ON checklists(user_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS idx_locations_user ON locations(user_id);
