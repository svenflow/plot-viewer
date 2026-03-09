-- Add additional listing fields: zestimate, tax_assessed_value
-- year_built and days_on_market already exist in schema

ALTER TABLE listings ADD COLUMN zestimate INTEGER;
ALTER TABLE listings ADD COLUMN tax_assessed_value INTEGER;
