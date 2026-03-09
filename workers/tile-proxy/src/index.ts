/**
 * Plot Viewer API & Tile Proxy - Cloudflare Worker
 *
 * Features:
 * 1. Tile proxying with caching (VCGI, terrain, satellite, OSM)
 * 2. Favorites API backed by KV storage
 *
 * Endpoints:
 * - /vcgi/* - Vermont VCGI parcel data (ArcGIS Feature Service)
 * - /terrain/* - AWS Terrarium terrain tiles (proxied for CORS)
 * - /satellite/* - ESRI World Imagery
 * - /osm/* - OpenStreetMap tiles
 * - /favorites - GET all, POST new
 * - /favorites/:id - GET, PUT, DELETE individual
 */

interface Env {
  ALLOWED_ORIGINS: string;
  FAVORITES: KVNamespace;
}

// Favorite metadata schema
interface Favorite {
  id: string;
  name: string;
  acres: number;
  address: string;
  center: [number, number]; // [lng, lat]
  polygon?: number[][][];   // GeoJSON polygon coordinates
  price?: number;
  listingStatus?: 'available' | 'pending' | 'sold' | 'off-market';
  listingUrl?: string;
  photos?: string[];
  notes?: string;
  tags?: string[];
  status: 'interested' | 'visited' | 'offer-made' | 'purchased' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

// Upstream base URLs for tile proxying
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
        new Response(JSON.stringify({ status: "ok", upstreams: Object.keys(UPSTREAMS), features: ["favorites"] }), {
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    // Favorites API
    if (path === "/favorites" || path.startsWith("/favorites/")) {
      return handleFavorites(request, env, path);
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
        new Response(`Unknown provider: ${provider}. Valid: ${Object.keys(UPSTREAMS).join(", ")}, favorites`, {
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

// Handle Favorites API
async function handleFavorites(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;

  // GET /favorites - list all
  if (path === "/favorites" && method === "GET") {
    const list = await env.FAVORITES.list();
    const favorites: Favorite[] = [];
    for (const key of list.keys) {
      const data = await env.FAVORITES.get(key.name, "json");
      if (data) favorites.push(data as Favorite);
    }
    return handleCors(
      request,
      env,
      new Response(JSON.stringify(favorites), {
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  // POST /favorites - create new
  if (path === "/favorites" && method === "POST") {
    try {
      const body = await request.json() as Partial<Favorite>;
      const id = body.id || crypto.randomUUID();
      const now = new Date().toISOString();
      const favorite: Favorite = {
        id,
        name: body.name || "Unnamed",
        acres: body.acres || 0,
        address: body.address || "",
        center: body.center || [0, 0],
        polygon: body.polygon,
        price: body.price,
        listingStatus: body.listingStatus,
        listingUrl: body.listingUrl,
        photos: body.photos || [],
        notes: body.notes || "",
        tags: body.tags || [],
        status: body.status || "interested",
        createdAt: now,
        updatedAt: now,
      };
      await env.FAVORITES.put(id, JSON.stringify(favorite));
      return handleCors(
        request,
        env,
        new Response(JSON.stringify(favorite), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        })
      );
    } catch (e) {
      return handleCors(
        request,
        env,
        new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  }

  // Extract ID from /favorites/:id
  const idMatch = path.match(/^\/favorites\/([^\/]+)$/);
  if (!idMatch) {
    return handleCors(
      request,
      env,
      new Response("Invalid favorites path", { status: 400 })
    );
  }
  const id = idMatch[1];

  // GET /favorites/:id
  if (method === "GET") {
    const data = await env.FAVORITES.get(id, "json");
    if (!data) {
      return handleCors(
        request,
        env,
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    return handleCors(
      request,
      env,
      new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  // PUT /favorites/:id - update
  if (method === "PUT") {
    const existing = await env.FAVORITES.get(id, "json") as Favorite | null;
    if (!existing) {
      return handleCors(
        request,
        env,
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    try {
      const body = await request.json() as Partial<Favorite>;
      const updated: Favorite = {
        ...existing,
        ...body,
        id, // Don't allow changing ID
        createdAt: existing.createdAt, // Preserve original
        updatedAt: new Date().toISOString(),
      };
      await env.FAVORITES.put(id, JSON.stringify(updated));
      return handleCors(
        request,
        env,
        new Response(JSON.stringify(updated), {
          headers: { "Content-Type": "application/json" },
        })
      );
    } catch (e) {
      return handleCors(
        request,
        env,
        new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  }

  // DELETE /favorites/:id
  if (method === "DELETE") {
    const existing = await env.FAVORITES.get(id);
    if (!existing) {
      return handleCors(
        request,
        env,
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    await env.FAVORITES.delete(id);
    return handleCors(
      request,
      env,
      new Response(JSON.stringify({ deleted: true }), {
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  return handleCors(
    request,
    env,
    new Response("Method not allowed", { status: 405 })
  );
}

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

  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
