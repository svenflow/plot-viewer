// Types for plot-listings-api

export interface Listing {
  id: string;
  zillow_id?: string;
  redfin_id?: string;

  // Location
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;

  // Property details
  price?: number;
  beds?: number;
  baths?: number;
  sqft?: number;
  lot_acres?: number;
  year_built?: number;
  property_type?: string;
  status: 'active' | 'pending' | 'sold' | 'off_market';

  // Images
  primary_image_url?: string;
  image_urls?: string[];

  // Temporal
  first_seen: string;
  last_seen: string;
  last_updated: string;

  // Enrichment
  enrichment?: EnrichmentData;

  // Markdown previews (agent-generated)
  preview_md?: string;  // Quick glance: price, beds, water/septic
  details_md?: string;  // Full details from enrichment

  // Utility fields (extracted from enrichment for filtering)
  water_source?: string;  // 'well', 'city', 'spring'
  sewer?: string;  // 'septic', 'city'
  heating?: string;  // 'oil', 'propane', 'electric', 'wood'
  days_on_market?: number;

  // User data
  is_favorite: boolean;
  notes?: string;
  viewed_at?: string;

  // Extra data for schema flexibility
  extra_data?: Record<string, unknown>;

  // Source
  source?: string;
  source_url?: string;
}

export interface EnrichmentData {
  parcel_id?: string;
  terrain_data?: unknown;
  distance_to_ski?: number;
  solar_potential?: number;
  flood_zone?: string;
}

export interface PriceHistoryEntry {
  id: number;
  listing_id: string;
  price: number;
  recorded_at: string;
  source?: string;
}

export interface StatusHistoryEntry {
  id: number;
  listing_id: string;
  status: string;
  recorded_at: string;
}

export interface SearchFilters {
  state?: string;
  min_price?: number;
  max_price?: number;
  min_beds?: number;
  min_baths?: number;
  min_acres?: number;
  max_acres?: number;
  property_type?: string;
  status?: string;
  favorites_only?: boolean;
  new_today?: boolean;
  limit?: number;
  offset?: number;
}

export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ENVIRONMENT: string;
}
