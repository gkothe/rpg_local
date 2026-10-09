ALTER TABLE dice_sessions ADD COLUMN frozen_continuity jsonb;
ALTER TABLE dice_sessions ADD CONSTRAINT dice_frozen_continuity_object CHECK (frozen_continuity IS NULL OR jsonb_typeof(frozen_continuity) = 'object');
