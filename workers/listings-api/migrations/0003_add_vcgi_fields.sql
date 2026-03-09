-- Add VCGI parcel fields
-- These get populated when user clicks a listing and we query VCGI

ALTER TABLE listings ADD COLUMN vcgi_span TEXT;  -- Vermont parcel ID
ALTER TABLE listings ADD COLUMN vcgi_owner TEXT;  -- Owner name from VCGI
ALTER TABLE listings ADD COLUMN vcgi_acres REAL;  -- Acreage from VCGI (more accurate than listing)
ALTER TABLE listings ADD COLUMN vcgi_land_value INTEGER;  -- Land assessed value
ALTER TABLE listings ADD COLUMN vcgi_improvement_value INTEGER;  -- Improvement assessed value
ALTER TABLE listings ADD COLUMN vcgi_total_value INTEGER;  -- Total assessed value
ALTER TABLE listings ADD COLUMN vcgi_town TEXT;  -- Town name
ALTER TABLE listings ADD COLUMN vcgi_property_type TEXT;  -- Property type code
ALTER TABLE listings ADD COLUMN vcgi_geometry TEXT;  -- GeoJSON polygon for parcel boundary
