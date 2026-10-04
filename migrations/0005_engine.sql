-- 0005: track which engine produced each diagnosis (cnn vs llm).
-- Safe additive change: new column with a default, no backfill needed.
ALTER TABLE diagnoses ADD COLUMN engine TEXT NOT NULL DEFAULT 'llm';
