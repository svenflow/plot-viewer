-- Add markdown preview and details fields
-- preview_md: quick glance info (price, beds, sqft, water/septic)
-- details_md: full property details from enrichment

ALTER TABLE listings ADD COLUMN preview_md TEXT;
ALTER TABLE listings ADD COLUMN details_md TEXT;

-- Also add specific utility fields for filtering/display
ALTER TABLE listings ADD COLUMN water_source TEXT;  -- 'well', 'city', 'spring', etc.
ALTER TABLE listings ADD COLUMN sewer TEXT;  -- 'septic', 'city', etc.
ALTER TABLE listings ADD COLUMN heating TEXT;  -- 'oil', 'propane', 'electric', 'wood', etc.
ALTER TABLE listings ADD COLUMN days_on_market INTEGER;
