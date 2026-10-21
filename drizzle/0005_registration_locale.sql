ALTER TABLE registrations ADD COLUMN locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('ja', 'en'));
