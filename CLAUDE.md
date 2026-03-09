# Plot Viewer - Developer Notes

## Package Manager

**ALWAYS use `bun`** for all JS/TS operations in this project:
- `bun install` - Install dependencies
- `bun run dev` - Run dev server
- `bunx wrangler deploy` - Deploy workers

## Architecture

### Cloudflare Worker Proxy

All external API requests are proxied through a Cloudflare Worker for:
- **Edge caching** - Reduces load on public servers (VCGI, MapLibre, ESRI)
- **CORS handling** - Browser can access cross-origin resources
- **Rate limit protection** - Cached responses avoid 429 errors

**Worker:** `sven-plot-proxy.nicklaudethorat.workers.dev`

**Routes:**
| Route | Upstream | Cache TTL |
|-------|----------|-----------|
| `/vcgi/*` | VCGI ArcGIS services | 1 hour |
| `/terrain/*` | MapLibre demo DEM tiles | 24 hours |
| `/satellite/*` | ESRI World Imagery | 24 hours |
| `/osm/*` | OpenStreetMap tiles | 1 hour |

**Deployment:**
```bash
cd workers/tile-proxy
bun run deploy
```

### Map Layers

- **OSM base map** - Street/terrain labels
- **Satellite imagery** - ESRI World Imagery (toggle)
- **3D Terrain** - MapLibre demo DEM with hillshade (toggle)
- **Parcel boundaries** - VCGI Vermont parcels (toggle)
- **Highlighted favorites** - Saved parcels (auto-highlight on click)

### Favorites System

Favorites are stored in Cloudflare KV (via API) with full polygon geometry. When clicked:
1. Parcel is highlighted immediately (no API call needed)
2. Map fits bounds to parcel
3. Popup shows details

**API Endpoints:**
- `GET /favorites` - List all favorites
- `POST /favorites` - Create new favorite
- `GET /favorites/:id` - Get single favorite
- `PUT /favorites/:id` - Update favorite
- `DELETE /favorites/:id` - Delete favorite

**Note:** KV list() has eventual consistency - newly added favorites may not appear in list for ~60 seconds, but GET by ID works immediately.

## CLI

The `plot` CLI manages favorites from the command line:

```bash
# Location
~/code/plot-viewer/scripts/plot

# Commands
plot list                           # List all favorites
plot list --status interested       # Filter by status
plot get <id>                       # Get single favorite details
plot add --name X --acres Y         # Add manually
plot import <span>                  # Import from VCGI by SPAN
plot update <id> --status visited   # Update status/fields
plot delete <id>                    # Remove favorite
plot search --town STOCKBRIDGE      # Search VCGI parcels
plot search --min-acres 50          # Filter by acreage

# Options
--json                              # JSON output for scripting
--version                           # Show version
```

**Favorite Schema:**
```typescript
{
  id: string;           // SPAN or UUID
  name: string;         // Town name
  acres: number;
  address: string;
  center: [lng, lat];
  polygon?: coords;     // Full GeoJSON polygon
  price?: number;
  listingStatus?: 'available' | 'pending' | 'sold' | 'off-market';
  listingUrl?: string;
  notes?: string;
  tags?: string[];
  status: 'interested' | 'visited' | 'offer-made' | 'purchased' | 'rejected';
  createdAt: string;
  updatedAt: string;
}
```

## Vermont Parcel Data Sources

### 1. VCGI Statewide Parcel Service (Primary)

**Best for:** Programmatic access to parcel polygons and attributes

```
Base URL: https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0
```

**Key fields:**
- `SPAN` - State Parcel Annotation Number (unique ID)
- `TNAME` - Town name (proper case)
- `OWNER1` - Primary owner
- `ACRESGL` - Acreage from grand list
- `E911ADDR` - Street address
- `LAND_LV` - Land value
- `REAL_FLV` - Total assessed value

**Example queries:**

```bash
# Query by SPAN
curl "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0/query?where=SPAN%3D%27618-194-10882%27&outFields=*&returnGeometry=true&outSR=4326&f=geojson"

# Query by town and acreage
curl "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0/query?where=TNAME%3D%27STOCKBRIDGE%27%20AND%20ACRESGL%20%3E%2050&outFields=*&returnGeometry=true&outSR=4326&f=geojson"

# Query by address pattern
curl "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0/query?where=E911ADDR%20LIKE%20%27%25BLACKMER%25%27&outFields=*&returnGeometry=true&outSR=4326&f=geojson"
```

**Limitations:**
- Data updated annually - new subdivisions won't appear immediately
- Owner info may be stale (lister cards are more current)

### 2. Town Lister Cards (NEMRC)

**Best for:** Current ownership, sales history, detailed property info

Many Vermont towns use NEMRC for property records. URL pattern:
```
https://www.nemrc.info/web_data/vt{town_code}/searchT.php
```

Example for Stockbridge: `https://www.nemrc.info/web_data/vtstoc/searchT.php`

**Key fields:**
- Parcel ID (e.g., `06-006002`)
- SPAN
- Current owner
- Sale date/price (most recent transfer)
- Land value, building value
- Acreage

**When to use:**
- Verify current ownership (VCGI may be stale)
- Find recent sales not in VCGI
- Get parcel ID when you don't have SPAN

### 3. VT Parcel Viewer (Visual Exploration)

**Best for:** Interactive browsing, identifying parcels visually

```
https://maps.vcgi.vermont.gov/parcelviewer
```

### 4. Town Land Records

**Best for:** Deeds, historical records, legal documents

Each town maintains land records. Example for Stockbridge:
```
https://stockbridge.lr-1.com/
```

## Workflow: Finding Parcel When Address Isn't in VCGI

1. **Search town lister cards** for the address/owner
2. **Get the Parcel ID and SPAN** from lister card results
3. **Query VCGI with SPAN** to get polygon geometry
4. **If VCGI returns no results:** The parcel may be:
   - A new subdivision (not yet in annual update)
   - Recently split from a parent parcel
   - Municipal land being sold off

In these cases, query the **parent parcel** (often has same street name but different number or owner like "TOWN OF [NAME]").

## Known Issues

- **VCGI service URL matters:** There are multiple ArcGIS services. The wrong one (e.g., `services2.arcgis.com`) may return no Vermont data. Always use `services1.arcgis.com/BkFxaEFNwHqX3tAw/...`

- **Geometry queries with bbox:** The ArcGIS envelope query may not filter by location as expected. Use attribute queries (TNAME, SPAN) when possible.

- **New listings not in state data:** Properties being subdivided from municipal land often appear on listing sites (Redfin, LandWatch) before they're added to VCGI.

## Listings API (Cloudflare D1)

**Worker:** `plot-listings-api.nicklaudethorat.workers.dev`

**Database:** D1 `plot-listings` (SQLite at edge)

**Schema:**
- `listings` - Current listing state
- `price_history` - Normalized price tracking (indexed)
- `status_history` - Status changes over time

**API Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/listings?state=VT&min_beds=3` | Search with filters |
| POST | `/listings` | Upsert single listing |
| POST | `/listings/bulk` | Bulk upsert (for scrapers) |
| GET | `/listings/:id` | Get single listing |
| GET | `/listings/:id/price-history` | Price history |
| POST | `/listings/:id/favorite` | Toggle favorite |
| GET | `/feed` | New listings + price drops |
| GET | `/stats` | Aggregate stats |

**Sync Command:**
```bash
# Run scrapers and push to D1
./scripts/sync-to-cloudflare

# Preview without pushing
./scripts/sync-to-cloudflare --dry-run

# Single source
./scripts/sync-to-cloudflare --source zillow
```

**Deployment:**
```bash
cd workers/listings-api
bun install
bunx wrangler d1 migrations apply plot-listings --remote
bunx wrangler deploy
```

## Property Scrapers

All scrapers use **scrapling** (headless scraping library) and output JSON.

| Script | Source | Status |
|--------|--------|--------|
| `zillow` | Zillow | ✅ Works (Tier 1 fetcher) |
| `redfin` | Redfin | ✅ Works (scrapes HTML) |
| `realtor` | Realtor.com | ❌ Blocked (429) |
| `cblife` | Coldwell Banker | ✅ Updated |
| `hickok` | Hickok & Boardman | ✅ Updated |
| `lakehomes` | LakeHomes.com | ✅ Updated |
| `mahoosuc` | Mahoosuc Realty | ✅ Updated |
| `vtrec` | VT Real Estate Co | ✅ Updated |

**Usage:**
```bash
./scripts/zillow search VT --max-price 1000000 --json
./scripts/redfin search VT --beds 3 --json
```
