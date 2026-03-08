# Plot Viewer

Static property parcel visualization for land purchasing research. Runs entirely on GitHub Pages - no backend required.

## Tech Stack

### Mapping Libraries (by GitHub stars)

| Library | Stars | Use Case |
|---------|-------|----------|
| [Leaflet](https://leafletjs.com/) | 44K ⭐ | Lightweight, easiest to start |
| [deck.gl](https://deck.gl/) | 13K ⭐ | High-performance visualization |
| [Turf.js](https://turfjs.org/) | 10K ⭐ | Geospatial analysis (area, distance, etc.) |
| [MapLibre GL JS](https://maplibre.org/) | 9.6K ⭐ | Vector tiles, WebGL rendering |

### Static Hosting Solution

**[PMTiles](https://github.com/protomaps/PMTiles)** - Single-file map tile archives that work from static storage (S3, GitHub Pages). Uses HTTP range requests - no tile server needed. Actively maintained (updated March 2026).

**Recommended combo:** MapLibre + PMTiles = fully static, no backend

## Parcel Data Sources

### Free

| Source | Coverage | Notes |
|--------|----------|-------|
| [VCGI](https://geodata.vermont.gov/pages/parcels) | Vermont | FREE statewide parcel GeoJSON with grand list (tax) data |
| County GIS portals | Varies | Many counties publish free parcel data |
| [Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html) | USA | Administrative boundaries (not parcels) |

### Paid

| Source | Pricing | Notes |
|--------|---------|-------|
| [Regrid](https://regrid.com/) | $80K/yr enterprise | Nationwide parcels |
| [ATTOM](https://www.attomdata.com/) | Contact for pricing | Property data API, free trial |
| [RentCast](https://www.rentcast.io/api) | 50 free calls/month | Property data |

## Features

- [x] Parcel boundaries overlay (VCGI live data)
- [x] Click parcel → popup with metadata
- [x] Filter by acreage and price
- [x] Save favorites to localStorage
- [x] Terrain/hillshade toggle
- [x] Search by town, address, or SPAN
- [ ] Price per acre heatmap
- [ ] Days on market visualization
- [ ] Road frontage highlighting
- [ ] Slope/terrain analysis
- [ ] Side-by-side compare mode

## Architecture

```
GitHub Pages (static hosting)
├── index.html
├── style.css
├── app.js
├── data/
│   ├── parcels.pmtiles (or .geojson)
│   └── metadata.json
└── tiles/
    └── basemap.pmtiles (optional - can use free tile services)
```

## Getting Started

```bash
# Clone
git clone https://github.com/nsthorat/plot-viewer.git
cd plot-viewer

# Serve locally
npx serve .

# Open http://localhost:3000
```

## License

MIT
