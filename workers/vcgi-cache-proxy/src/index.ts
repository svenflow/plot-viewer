/**
 * VCGI Cache Proxy Worker
 *
 * Proxies requests to Vermont's VCGI parcel API with Cloudflare caching.
 * Caches responses for 24 hours to handle VCGI downtime and reduce load.
 *
 * Usage:
 *   GET /parcel?lat=44.123&lng=-72.456
 *   → Returns parcel GeoJSON at that point (cached)
 *
 *   GET /query?geometry=-72.456,44.123&outFields=SPAN,ACRESGL
 *   → Proxies raw VCGI query (cached)
 */

interface Env {
  VCGI_BASE_URL: string;
  CACHE_TTL_SECONDS: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const cache = caches.default;
    const cacheTtl = parseInt(env.CACHE_TTL_SECONDS) || 86400;

    // Create a cache key based on the request URL
    const cacheKey = new Request(url.toString(), request);

    // Check cache first
    let response = await cache.match(cacheKey);
    if (response) {
      // Add cache hit header
      const headers = new Headers(response.headers);
      headers.set('X-Cache', 'HIT');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    // Route handling
    if (url.pathname === '/parcel') {
      response = await handleParcelQuery(url, env);
    } else if (url.pathname === '/query') {
      response = await handleRawQuery(url, env);
    } else if (url.pathname === '/health') {
      response = new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } else {
      response = new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Cache successful responses
    if (response.status === 200) {
      const responseToCache = response.clone();
      const headers = new Headers(responseToCache.headers);
      headers.set('Cache-Control', `public, max-age=${cacheTtl}`);

      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        headers,
      });

      // Store in cache (non-blocking)
      await cache.put(cacheKey, cachedResponse);
    }

    // Add cache miss header
    const headers = new Headers(response.headers);
    headers.set('X-Cache', 'MISS');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
};

async function handleParcelQuery(url: URL, env: Env): Promise<Response> {
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  if (!lat || !lng) {
    return new Response(
      JSON.stringify({ error: 'Missing lat or lng parameter' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Build VCGI query URL
  const vcgiUrl = new URL(`${env.VCGI_BASE_URL}/1/query`);
  vcgiUrl.searchParams.set('geometry', `${lng},${lat}`);
  vcgiUrl.searchParams.set('geometryType', 'esriGeometryPoint');
  vcgiUrl.searchParams.set('inSR', '4326');
  vcgiUrl.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  vcgiUrl.searchParams.set('outFields', '*');
  vcgiUrl.searchParams.set('returnGeometry', 'true');
  vcgiUrl.searchParams.set('outSR', '4326');
  vcgiUrl.searchParams.set('f', 'geojson');

  try {
    const response = await fetch(vcgiUrl.toString(), {
      cf: {
        // Cloudflare cache settings
        cacheTtl: parseInt(env.CACHE_TTL_SECONDS) || 86400,
        cacheEverything: true,
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: 'VCGI request failed', status: response.status }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch from VCGI', message: String(error) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function handleRawQuery(url: URL, env: Env): Promise<Response> {
  // Forward all query params to VCGI
  const vcgiUrl = new URL(`${env.VCGI_BASE_URL}/1/query`);

  // Copy all search params
  url.searchParams.forEach((value, key) => {
    vcgiUrl.searchParams.set(key, value);
  });

  // Ensure GeoJSON format
  if (!vcgiUrl.searchParams.has('f')) {
    vcgiUrl.searchParams.set('f', 'geojson');
  }

  try {
    const response = await fetch(vcgiUrl.toString(), {
      cf: {
        cacheTtl: parseInt(env.CACHE_TTL_SECONDS) || 86400,
        cacheEverything: true,
      },
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: 'VCGI request failed', status: response.status }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch from VCGI', message: String(error) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
