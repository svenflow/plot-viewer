-- Initial schema for plot-listings database
-- Follows Option B: Snapshots + History Table pattern

-- Main listings table (current state)
CREATE TABLE IF NOT EXISTS listings (
    -- Primary key
    id TEXT PRIMARY KEY,  -- UUID, our internal ID

    -- External IDs for deduplication
    zillow_id TEXT UNIQUE,
    redfin_id TEXT UNIQUE,

    -- Location
    address TEXT NOT NULL,
    city TEXT,
    state TEXT,
    zip TEXT,
    lat REAL,
    lng REAL,

    -- Property details
    price INTEGER,
    beds INTEGER,
    baths REAL,
    sqft INTEGER,
    lot_acres REAL,
    year_built INTEGER,
    property_type TEXT,  -- 'single_family', 'land', 'condo', etc.
    status TEXT DEFAULT 'active',  -- 'active', 'pending', 'sold', 'off_market'

    -- Images
    primary_image_url TEXT,
    image_urls TEXT,  -- JSON array of image URLs

    -- Temporal
    first_seen TEXT NOT NULL,  -- ISO timestamp
    last_seen TEXT NOT NULL,
    last_updated TEXT NOT NULL,

    -- Enrichment data (JSON for flexibility)
    enrichment TEXT,  -- JSON: {parcel_id, terrain_data, distance_to_ski, etc.}

    -- User data
    is_favorite INTEGER DEFAULT 0,
    notes TEXT,
    viewed_at TEXT,

    -- Catch-all for new fields
    extra_data TEXT,  -- JSON for schema flexibility

    -- Source tracking
    source TEXT,  -- 'zillow', 'redfin', etc.
    source_url TEXT
);

-- Price history table (normalized, not JSON)
CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    price INTEGER NOT NULL,
    recorded_at TEXT NOT NULL,  -- ISO timestamp
    source TEXT,  -- Which scraper recorded this

    -- Composite index for efficient queries
    UNIQUE(listing_id, recorded_at)
);

-- Status history table
CREATE TABLE IF NOT EXISTS status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    recorded_at TEXT NOT NULL,

    UNIQUE(listing_id, recorded_at)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_listings_state ON listings(state);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_beds ON listings(beds);
CREATE INDEX IF NOT EXISTS idx_listings_lot_acres ON listings(lot_acres);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen);
CREATE INDEX IF NOT EXISTS idx_listings_location ON listings(lat, lng);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at);

CREATE INDEX IF NOT EXISTS idx_status_history_listing ON status_history(listing_id);
