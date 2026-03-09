/**
 * Plot Viewer Tile Proxy - Cloudflare Worker
 *
 * Proxies map tile and data requests with caching to avoid:
 * - CORS issues (all requests go through our domain)
 * - Rate limiting (Cloudflare edge caches tiles)
 * - Overloading public servers
 *
 * Supported endpoints:
 * - /vcgi/* - Vermont VCGI parcel data (ArcGIS Feature Service)
 * - /terrain/* - MapLibre demo terrain tiles
 * - /satellite/* - ESRI World Imagery
 * - /osm/* - OpenStreetMap tiles
 */

interface Env {
  ALLOWED_ORIGINS: string;
}

// Upstream base URLs
const UPSTREAMS: Record<string, string> = {
  vcgi: "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services",
  terrain: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
  osm: "https://tile.openstreetmap.org",
};

// Cache TTLs in seconds
const CACHE_TTLS: Record<string, number> = {
  vcgi: 3600,      // 1 hour - parcel data doesn't change often
  terrain: 86400,  // 24 hours - DEM tiles are static
  satellite: 86400, // 24 hours - satellite imagery is static
  osm: 3600,       // 1 hour - OSM tiles
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleCors(request, env, new Response(null, { status: 204 }));
    }

    // Health check
    if (path === "/" || path === "/health") {
      return handleCors(
        request,
        env,
        new Response(JSON.stringify({ status: "ok", upstreams: Object.keys(UPSTREAMS) }), {
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    // Parse provider from path: /vcgi/... -> vcgi
    const match = path.match(/^\/([^\/]+)(\/.*)?$/);
    if (!match) {
      return handleCors(
        request,
        env,
        new Response("Invalid path", { status: 400 })
      );
    }

    const provider = match[1];
    const upstreamPath = match[2] || "";

    if (!UPSTREAMS[provider]) {
      return handleCors(
        request,
        env,
        new Response(`Unknown provider: ${provider}. Valid: ${Object.keys(UPSTREAMS).join(", ")}`, {
          status: 400,
        })
      );
    }

    // Build upstream URL
    const upstreamUrl = UPSTREAMS[provider] + upstreamPath + url.search;

    // Check Cloudflare cache first
    const cacheKey = new Request(upstreamUrl, request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (response) {
      // Cache hit - add header to indicate
      response = new Response(response.body, response);
      response.headers.set("X-Cache", "HIT");
      return handleCors(request, env, response);
    }

    // Cache miss - fetch from upstream
    try {
      const upstreamResponse = await fetch(upstreamUrl, {
        headers: {
          "User-Agent": "PlotViewer/1.0 (https://svenflow.github.io/plot-viewer)",
          Accept: request.headers.get("Accept") || "*/*",
        },
      });

      if (!upstreamResponse.ok) {
        // Don't cache errors, but pass them through
        return handleCors(
          request,
          env,
          new Response(`Upstream error: ${upstreamResponse.status}`, {
            status: upstreamResponse.status,
          })
        );
      }

      // Clone for caching
      response = new Response(upstreamResponse.body, upstreamResponse);

      // Set cache headers
      const ttl = CACHE_TTLS[provider] || 300;
      response.headers.set("Cache-Control", `public, max-age=${ttl}`);
      response.headers.set("X-Cache", "MISS");

      // Store in cache (async, don't await)
      const responseToCache = response.clone();
      const modifiedResponse = new Response(responseToCache.body, responseToCache);
      modifiedResponse.headers.set("Cache-Control", `public, max-age=${ttl}`);
      cache.put(cacheKey, modifiedResponse);

      return handleCors(request, env, response);
    } catch (error) {
      return handleCors(
        request,
        env,
        new Response(`Fetch error: ${error}`, { status: 502 })
      );
    }
  },
};

function handleCors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(",") || [];

  // Check if origin is allowed (also allow no origin for direct requests)
  const isAllowed = !origin || allowedOrigins.some((allowed) => origin.startsWith(allowed.trim()));

  const headers = new Headers(response.headers);

  if (isAllowed && origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    headers.set("Access-Control-Allow-Origin", "*");
  }

  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
