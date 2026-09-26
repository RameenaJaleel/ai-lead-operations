CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  vehicle_make TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  vehicle_year INTEGER NOT NULL,
  mileage INTEGER,
  location TEXT,
  message TEXT,
  score INTEGER NOT NULL,
  temperature TEXT NOT NULL CHECK (temperature IN ('HOT','WARM','COLD')),
  summary TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Not Contacted',
  first_reminder_due TEXT NOT NULL,
  first_reminder_sent INTEGER NOT NULL DEFAULT 0,
  second_reminder_due TEXT NOT NULL,
  second_reminder_sent INTEGER NOT NULL DEFAULT 0,
  escalation_due TEXT NOT NULL,
  escalation_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  audience TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS leads_followup_idx
ON leads(status, first_reminder_due, second_reminder_due, escalation_due);
