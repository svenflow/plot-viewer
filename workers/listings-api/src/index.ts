/**
 * Plot Listings API - Cloudflare Worker
 *
 * Provides CRUD operations for property listings stored in D1.
 * Supports search, filtering, price history tracking, and image storage.
 */

import { Listing, SearchFilters, PriceHistoryEntry, Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle OPTIONS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route handlers
      if (path === '/listings' && method === 'GET') {
        return await handleSearch(url, env, corsHeaders);
      }

      if (path === '/listings' && method === 'POST') {
        return await handleUpsertListing(request, env, corsHeaders);
      }

      if (path.match(/^\/listings\/[^/]+$/) && method === 'GET') {
        const id = path.split('/')[2];
        return await handleGetListing(id, env, corsHeaders);
      }

      if (path.match(/^\/listings\/[^/]+$/) && method === 'PATCH') {
        const id = path.split('/')[2];
        return await handlePatchListing(id, request, env, corsHeaders);
      }

      if (path.match(/^\/listings\/[^/]+$/) && method === 'DELETE') {
        const id = path.split('/')[2];
        return await handleDeleteListing(id, env, corsHeaders);
      }

      if (path.match(/^\/listings\/[^/]+\/price-history$/) && method === 'GET') {
        const id = path.split('/')[2];
        return await handleGetPriceHistory(id, env, corsHeaders);
      }

      if (path.match(/^\/listings\/[^/]+\/favorite$/) && method === 'POST') {
        const id = path.split('/')[2];
        return await handleToggleFavorite(id, request, env, corsHeaders);
      }

      if (path === '/listings/bulk' && method === 'POST') {
        return await handleBulkUpsert(request, env, corsHeaders);
      }

      if (path === '/stats' && method === 'GET') {
        return await handleStats(env, corsHeaders);
      }

      if (path === '/feed' && method === 'GET') {
        return await handleFeed(url, env, corsHeaders);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

// Search listings with filters
async function handleSearch(url: URL, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const filters: SearchFilters = {
    state: url.searchParams.get('state') || undefined,
    min_price: url.searchParams.get('min_price') ? parseInt(url.searchParams.get('min_price')!) : undefined,
    max_price: url.searchParams.get('max_price') ? parseInt(url.searchParams.get('max_price')!) : undefined,
    min_beds: url.searchParams.get('min_beds') ? parseInt(url.searchParams.get('min_beds')!) : undefined,
    min_baths: url.searchParams.get('min_baths') ? parseFloat(url.searchParams.get('min_baths')!) : undefined,
    min_acres: url.searchParams.get('min_acres') ? parseFloat(url.searchParams.get('min_acres')!) : undefined,
    max_acres: url.searchParams.get('max_acres') ? parseFloat(url.searchParams.get('max_acres')!) : undefined,
    property_type: url.searchParams.get('property_type') || undefined,
    status: url.searchParams.get('status') || 'active',
    favorites_only: url.searchParams.get('favorites_only') === 'true',
    new_today: url.searchParams.get('new_today') === 'true',
    limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 100,
    offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : 0,
  };

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.state) {
    conditions.push('state = ?');
    params.push(filters.state);
  }
  if (filters.min_price !== undefined) {
    conditions.push('price >= ?');
    params.push(filters.min_price);
  }
  if (filters.max_price !== undefined) {
    conditions.push('price <= ?');
    params.push(filters.max_price);
  }
  if (filters.min_beds !== undefined) {
    conditions.push('beds >= ?');
    params.push(filters.min_beds);
  }
  if (filters.min_baths !== undefined) {
    conditions.push('baths >= ?');
    params.push(filters.min_baths);
  }
  if (filters.min_acres !== undefined) {
    conditions.push('lot_acres >= ?');
    params.push(filters.min_acres);
  }
  if (filters.max_acres !== undefined) {
    conditions.push('lot_acres <= ?');
    params.push(filters.max_acres);
  }
  if (filters.property_type) {
    conditions.push('property_type = ?');
    params.push(filters.property_type);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters.favorites_only) {
    conditions.push('is_favorite = 1');
  }
  if (filters.new_today) {
    const today = new Date().toISOString().split('T')[0];
    conditions.push("DATE(first_seen) = ?");
    params.push(today);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT * FROM listings
    ${whereClause}
    ORDER BY first_seen DESC
    LIMIT ? OFFSET ?
  `;

  params.push(filters.limit!, filters.offset!);

  const result = await env.DB.prepare(query).bind(...params).all();

  // Parse JSON fields
  const listings = result.results.map(row => ({
    ...row,
    image_urls: row.image_urls ? JSON.parse(row.image_urls as string) : [],
    enrichment: row.enrichment ? JSON.parse(row.enrichment as string) : null,
    extra_data: row.extra_data ? JSON.parse(row.extra_data as string) : null,
    is_favorite: Boolean(row.is_favorite),
  }));

  // Get total count
  const countQuery = `SELECT COUNT(*) as count FROM listings ${whereClause}`;
  const countParams = params.slice(0, -2); // Remove limit and offset
  const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();

  return new Response(JSON.stringify({
    listings,
    total: countResult?.count || 0,
    limit: filters.limit,
    offset: filters.offset,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Get a single listing by ID
async function handleGetListing(id: string, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const result = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();

  if (!result) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const listing = {
    ...result,
    image_urls: result.image_urls ? JSON.parse(result.image_urls as string) : [],
    enrichment: result.enrichment ? JSON.parse(result.enrichment as string) : null,
    extra_data: result.extra_data ? JSON.parse(result.extra_data as string) : null,
    is_favorite: Boolean(result.is_favorite),
  };

  return new Response(JSON.stringify(listing), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Upsert a listing (insert or update)
async function handleUpsertListing(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const data = await request.json() as Partial<Listing>;

  const now = new Date().toISOString();
  const id = data.id || crypto.randomUUID();

  // Check if listing exists (by our ID or external IDs)
  let existing = null;
  if (data.id) {
    existing = await env.DB.prepare('SELECT id, price FROM listings WHERE id = ?').bind(data.id).first();
  } else if (data.zillow_id) {
    existing = await env.DB.prepare('SELECT id, price FROM listings WHERE zillow_id = ?').bind(data.zillow_id).first();
  } else if (data.redfin_id) {
    existing = await env.DB.prepare('SELECT id, price FROM listings WHERE redfin_id = ?').bind(data.redfin_id).first();
  }

  if (existing) {
    // Update existing listing
    const existingId = existing.id as string;
    const oldPrice = existing.price as number;

    // Track price change
    if (data.price && data.price !== oldPrice) {
      await env.DB.prepare(`
        INSERT INTO price_history (listing_id, price, recorded_at, source)
        VALUES (?, ?, ?, ?)
      `).bind(existingId, data.price, now, data.source || null).run();
    }

    await env.DB.prepare(`
      UPDATE listings SET
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        zip = COALESCE(?, zip),
        lat = COALESCE(?, lat),
        lng = COALESCE(?, lng),
        price = COALESCE(?, price),
        beds = COALESCE(?, beds),
        baths = COALESCE(?, baths),
        sqft = COALESCE(?, sqft),
        lot_acres = COALESCE(?, lot_acres),
        year_built = COALESCE(?, year_built),
        property_type = COALESCE(?, property_type),
        status = COALESCE(?, status),
        primary_image_url = COALESCE(?, primary_image_url),
        image_urls = COALESCE(?, image_urls),
        last_seen = ?,
        last_updated = ?,
        enrichment = COALESCE(?, enrichment),
        extra_data = COALESCE(?, extra_data),
        source = COALESCE(?, source),
        source_url = COALESCE(?, source_url)
      WHERE id = ?
    `).bind(
      data.address || null,
      data.city || null,
      data.state || null,
      data.zip || null,
      data.lat || null,
      data.lng || null,
      data.price || null,
      data.beds || null,
      data.baths || null,
      data.sqft || null,
      data.lot_acres || null,
      data.year_built || null,
      data.property_type || null,
      data.status || null,
      data.primary_image_url || null,
      data.image_urls ? JSON.stringify(data.image_urls) : null,
      now,
      now,
      data.enrichment ? JSON.stringify(data.enrichment) : null,
      data.extra_data ? JSON.stringify(data.extra_data) : null,
      data.source || null,
      data.source_url || null,
      existingId
    ).run();

    return new Response(JSON.stringify({ id: existingId, updated: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } else {
    // Insert new listing
    await env.DB.prepare(`
      INSERT INTO listings (
        id, zillow_id, redfin_id, address, city, state, zip, lat, lng,
        price, beds, baths, sqft, lot_acres, year_built, property_type, status,
        primary_image_url, image_urls, first_seen, last_seen, last_updated,
        enrichment, extra_data, source, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      data.zillow_id || null,
      data.redfin_id || null,
      data.address || '',
      data.city || null,
      data.state || null,
      data.zip || null,
      data.lat || null,
      data.lng || null,
      data.price || null,
      data.beds || null,
      data.baths || null,
      data.sqft || null,
      data.lot_acres || null,
      data.year_built || null,
      data.property_type || null,
      data.status || 'active',
      data.primary_image_url || null,
      data.image_urls ? JSON.stringify(data.image_urls) : null,
      now,
      now,
      now,
      data.enrichment ? JSON.stringify(data.enrichment) : null,
      data.extra_data ? JSON.stringify(data.extra_data) : null,
      data.source || null,
      data.source_url || null
    ).run();

    // Record initial price
    if (data.price) {
      await env.DB.prepare(`
        INSERT INTO price_history (listing_id, price, recorded_at, source)
        VALUES (?, ?, ?, ?)
      `).bind(id, data.price, now, data.source || null).run();
    }

    return new Response(JSON.stringify({ id, created: true }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

// Bulk upsert listings (for scraper)
async function handleBulkUpsert(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const { listings } = await request.json() as { listings: Partial<Listing>[] };

  const results = {
    created: 0,
    updated: 0,
    errors: [] as string[],
  };

  for (const listing of listings) {
    try {
      const response = await handleUpsertListing(
        new Request('http://localhost/listings', {
          method: 'POST',
          body: JSON.stringify(listing),
        }),
        env,
        {}
      );
      const result = await response.json() as { created?: boolean; updated?: boolean };
      if (result.created) results.created++;
      if (result.updated) results.updated++;
    } catch (error) {
      results.errors.push(`${listing.address}: ${String(error)}`);
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Get price history for a listing
async function handleGetPriceHistory(id: string, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT * FROM price_history
    WHERE listing_id = ?
    ORDER BY recorded_at DESC
  `).bind(id).all();

  return new Response(JSON.stringify(result.results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Toggle favorite status
async function handleToggleFavorite(id: string, request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const { is_favorite, notes } = await request.json() as { is_favorite?: boolean; notes?: string };

  await env.DB.prepare(`
    UPDATE listings SET
      is_favorite = COALESCE(?, is_favorite),
      notes = COALESCE(?, notes),
      viewed_at = ?
    WHERE id = ?
  `).bind(
    is_favorite !== undefined ? (is_favorite ? 1 : 0) : null,
    notes || null,
    new Date().toISOString(),
    id
  ).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Patch a listing (partial update for enrichment)
async function handlePatchListing(id: string, request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const data = await request.json() as Partial<Listing>;
  const now = new Date().toISOString();

  // Build dynamic UPDATE query for provided fields only
  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  // Markdown fields
  if (data.preview_md !== undefined) {
    updates.push('preview_md = ?');
    params.push(data.preview_md);
  }
  if (data.details_md !== undefined) {
    updates.push('details_md = ?');
    params.push(data.details_md);
  }

  // Utility fields
  if (data.water_source !== undefined) {
    updates.push('water_source = ?');
    params.push(data.water_source);
  }
  if (data.sewer !== undefined) {
    updates.push('sewer = ?');
    params.push(data.sewer);
  }
  if (data.heating !== undefined) {
    updates.push('heating = ?');
    params.push(data.heating);
  }
  if (data.days_on_market !== undefined) {
    updates.push('days_on_market = ?');
    params.push(data.days_on_market);
  }

  // Allow updating other common fields
  if (data.year_built !== undefined) {
    updates.push('year_built = ?');
    params.push(data.year_built);
  }
  if (data.sqft !== undefined) {
    updates.push('sqft = ?');
    params.push(data.sqft);
  }
  if (data.lot_acres !== undefined) {
    updates.push('lot_acres = ?');
    params.push(data.lot_acres);
  }
  if (data.primary_image_url !== undefined) {
    updates.push('primary_image_url = ?');
    params.push(data.primary_image_url);
  }
  if (data.image_urls !== undefined) {
    updates.push('image_urls = ?');
    params.push(JSON.stringify(data.image_urls));
  }
  if (data.enrichment !== undefined) {
    updates.push('enrichment = ?');
    params.push(JSON.stringify(data.enrichment));
  }

  // VCGI fields
  if ((data as any).vcgi_span !== undefined) {
    updates.push('vcgi_span = ?');
    params.push((data as any).vcgi_span);
  }
  if ((data as any).vcgi_owner !== undefined) {
    updates.push('vcgi_owner = ?');
    params.push((data as any).vcgi_owner);
  }
  if ((data as any).vcgi_acres !== undefined) {
    updates.push('vcgi_acres = ?');
    params.push((data as any).vcgi_acres);
  }
  if ((data as any).vcgi_land_value !== undefined) {
    updates.push('vcgi_land_value = ?');
    params.push((data as any).vcgi_land_value);
  }
  if ((data as any).vcgi_improvement_value !== undefined) {
    updates.push('vcgi_improvement_value = ?');
    params.push((data as any).vcgi_improvement_value);
  }
  if ((data as any).vcgi_total_value !== undefined) {
    updates.push('vcgi_total_value = ?');
    params.push((data as any).vcgi_total_value);
  }
  if ((data as any).vcgi_town !== undefined) {
    updates.push('vcgi_town = ?');
    params.push((data as any).vcgi_town);
  }
  if ((data as any).vcgi_property_type !== undefined) {
    updates.push('vcgi_property_type = ?');
    params.push((data as any).vcgi_property_type);
  }
  if ((data as any).vcgi_geometry !== undefined) {
    updates.push('vcgi_geometry = ?');
    params.push((data as any).vcgi_geometry);
  }

  if (updates.length === 0) {
    return new Response(JSON.stringify({ error: 'No fields to update' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Always update last_updated
  updates.push('last_updated = ?');
  params.push(now);

  // Add id for WHERE clause
  params.push(id);

  const query = `UPDATE listings SET ${updates.join(', ')} WHERE id = ?`;
  await env.DB.prepare(query).bind(...params).run();

  return new Response(JSON.stringify({ id, patched: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delete a listing
async function handleDeleteListing(id: string, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  await env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Get stats
async function handleStats(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const total = await env.DB.prepare('SELECT COUNT(*) as count FROM listings').first();
  const active = await env.DB.prepare("SELECT COUNT(*) as count FROM listings WHERE status = 'active'").first();
  const favorites = await env.DB.prepare('SELECT COUNT(*) as count FROM listings WHERE is_favorite = 1').first();

  const today = new Date().toISOString().split('T')[0];
  const newToday = await env.DB.prepare("SELECT COUNT(*) as count FROM listings WHERE DATE(first_seen) = ?").bind(today).first();

  const priceDrops = await env.DB.prepare(`
    SELECT COUNT(DISTINCT listing_id) as count FROM price_history
    WHERE recorded_at > datetime('now', '-7 days')
  `).first();

  return new Response(JSON.stringify({
    total: total?.count || 0,
    active: active?.count || 0,
    favorites: favorites?.count || 0,
    new_today: newToday?.count || 0,
    price_changes_7d: priceDrops?.count || 0,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Get feed (new listings, price drops)
async function handleFeed(url: URL, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const days = parseInt(url.searchParams.get('days') || '7');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  // New listings
  const newListings = await env.DB.prepare(`
    SELECT * FROM listings
    WHERE first_seen > datetime('now', '-' || ? || ' days')
    ORDER BY first_seen DESC
    LIMIT ?
  `).bind(days, limit).all();

  // Price drops
  const priceDrops = await env.DB.prepare(`
    SELECT
      l.*,
      ph.price as new_price,
      (SELECT price FROM price_history WHERE listing_id = l.id ORDER BY recorded_at ASC LIMIT 1) as original_price
    FROM listings l
    JOIN price_history ph ON l.id = ph.listing_id
    WHERE ph.recorded_at > datetime('now', '-' || ? || ' days')
    AND ph.price < (SELECT price FROM price_history WHERE listing_id = l.id ORDER BY recorded_at ASC LIMIT 1)
    ORDER BY ph.recorded_at DESC
    LIMIT ?
  `).bind(days, limit).all();

  return new Response(JSON.stringify({
    new_listings: newListings.results,
    price_drops: priceDrops.results,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
