-- Add trial copy tracking to orgs
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_copies_used integer NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_copies_limit integer NOT NULL DEFAULT 20;
