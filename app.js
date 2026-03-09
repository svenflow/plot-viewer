/**
 * Plot Viewer - Vermont Property Search
 *
 * Static property visualization using:
 * - MapLibre GL JS for rendering (with 3D terrain)
 * - VCGI ArcGIS Feature Service for Vermont parcel data
 * - LocalStorage for favorites persistence
 */

// Proxy configuration - use Cloudflare Worker in production for caching
const PROXY_BASE = window.location.hostname === 'localhost'
    ? '' // Direct access in dev
    : 'https://sven-plot-proxy.nicklaudethorat.workers.dev';

// Configuration
const CONFIG = {
    // VCGI Parcel Feature Service (Vermont standardized parcels)
    // In production, proxied through Cloudflare for caching
    parcelServiceUrl: PROXY_BASE
        ? `${PROXY_BASE}/vcgi/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0`
        : 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0',

    // AWS Terrain Tiles - free, global coverage
    // Uses "terrarium" encoding format (different from Mapbox RGB)
    // TileJSON file for proper source configuration
    terrainUrl: 'terrain-tiles.json',

    // Map settings
    defaultCenter: [-72.7, 44.0], // Vermont center
    defaultZoom: 8,

    // Query settings
    maxRecords: 1000,
    minZoomForParcels: 12,
    debounceMs: 300,
};

// State
let map = null;
let selectedParcelId = null;
let highlightedFavoriteId = null;
let loadParcelsTimeout = null;
let currentFetchController = null;

// Load default favorites from JSON
let favorites = [];

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    await loadDefaultFavorites();
    initMap();
    initEventListeners();
    renderFavorites();
}

async function loadDefaultFavorites() {
    try {
        const response = await fetch('default-favorites.json');
        const defaultFavorites = await response.json();

        // Merge with localStorage
        const storedFavorites = JSON.parse(localStorage.getItem('plotViewer_favorites') || '[]');
        favorites = [...defaultFavorites];
        storedFavorites.forEach(f => {
            if (!favorites.find(df => df.id === f.id)) {
                favorites.push(f);
            }
        });
        localStorage.setItem('plotViewer_favorites', JSON.stringify(favorites));
    } catch (e) {
        console.warn('Could not load default favorites:', e);
        favorites = JSON.parse(localStorage.getItem('plotViewer_favorites') || '[]');
    }
}

// Toast notification system
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Sanitize user input for SQL queries
function sanitizeForSQL(input) {
    // Escape single quotes by doubling them
    return input.replace(/'/g, "''").replace(/[%_]/g, '');
}

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                // OpenStreetMap raster tiles (proxied in production)
                'osm': {
                    type: 'raster',
                    tiles: [PROXY_BASE ? `${PROXY_BASE}/osm/{z}/{x}/{y}.png` : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                },
                // ESRI World Imagery (satellite) - proxied in production
                'satellite': {
                    type: 'raster',
                    tiles: [PROXY_BASE ? `${PROXY_BASE}/satellite/tile/{z}/{y}/{x}` : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    tileSize: 256,
                    attribution: '© Esri, Maxar, Earthstar Geographics'
                }
            },
            layers: [
                {
                    id: 'osm-layer',
                    type: 'raster',
                    source: 'osm',
                    minzoom: 0,
                    maxzoom: 19
                },
                {
                    id: 'satellite-layer',
                    type: 'raster',
                    source: 'satellite',
                    minzoom: 0,
                    maxzoom: 19,
                    layout: { visibility: 'none' }
                }
            ]
        },
        center: CONFIG.defaultCenter,
        zoom: CONFIG.defaultZoom,
        maxPitch: 85,
        hash: true // Enable hash routing for shareable URLs
    });

    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    map.on('load', () => {
        // Add terrain DEM source using TileJSON
        // The TileJSON file specifies AWS terrarium tiles via CORS proxy
        map.addSource('terrain-dem', {
            type: 'raster-dem',
            url: CONFIG.terrainUrl,
            tileSize: 256,
            encoding: 'terrarium'
        });

        // Add hillshade layer (hidden by default)
        map.addLayer({
            id: 'hillshade-layer',
            type: 'hillshade',
            source: 'terrain-dem',
            paint: {
                'hillshade-illumination-direction': 315,
                'hillshade-exaggeration': 0.5,
                'hillshade-shadow-color': '#473B24',
                'hillshade-highlight-color': '#FDFCFA'
            },
            layout: { visibility: 'none' }
        }, 'osm-layer');

        // Add empty parcel source
        map.addSource('parcels', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // Add highlighted favorite source (for auto-highlight)
        map.addSource('highlighted-favorite', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // Highlighted favorite fill (behind regular parcels)
        map.addLayer({
            id: 'highlighted-favorite-fill',
            type: 'fill',
            source: 'highlighted-favorite',
            paint: {
                'fill-color': '#e11d48',
                'fill-opacity': 0.4
            }
        });

        // Highlighted favorite outline
        map.addLayer({
            id: 'highlighted-favorite-outline',
            type: 'line',
            source: 'highlighted-favorite',
            paint: {
                'line-color': '#e11d48',
                'line-width': 4
            }
        });

        // Parcel fill layer
        map.addLayer({
            id: 'parcels-fill',
            type: 'fill',
            source: 'parcels',
            paint: {
                'fill-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    '#e11d48',
                    '#3b82f6'
                ],
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.5,
                    ['boolean', ['feature-state', 'selected'], false],
                    0.4,
                    0.2
                ]
            }
        });

        // Parcel outline layer
        map.addLayer({
            id: 'parcels-outline',
            type: 'line',
            source: 'parcels',
            paint: {
                'line-color': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    '#e11d48',
                    '#3b82f6'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    3,
                    1.5
                ]
            }
        });

        // Load parcels on move end with debouncing
        map.on('moveend', debouncedLoadParcels);

        // Initial load
        loadParcelsInView();
    });

    // Hover effect
    let hoveredId = null;

    map.on('mousemove', 'parcels-fill', (e) => {
        if (e.features.length > 0) {
            if (hoveredId !== null) {
                map.setFeatureState({ source: 'parcels', id: hoveredId }, { hover: false });
            }
            hoveredId = e.features[0].id;
            map.setFeatureState({ source: 'parcels', id: hoveredId }, { hover: true });
            map.getCanvas().style.cursor = 'pointer';
        }
    });

    map.on('mouseleave', 'parcels-fill', () => {
        if (hoveredId !== null) {
            map.setFeatureState({ source: 'parcels', id: hoveredId }, { hover: false });
        }
        hoveredId = null;
        map.getCanvas().style.cursor = '';
    });

    // Click to select
    map.on('click', 'parcels-fill', (e) => {
        if (e.features.length > 0) {
            selectParcel(e.features[0]);
        }
    });
}

function debouncedLoadParcels() {
    if (loadParcelsTimeout) {
        clearTimeout(loadParcelsTimeout);
    }
    loadParcelsTimeout = setTimeout(loadParcelsInView, CONFIG.debounceMs);
}

async function loadParcelsInView() {
    const zoom = map.getZoom();

    // Only load parcels at sufficient zoom
    if (zoom < CONFIG.minZoomForParcels) {
        map.getSource('parcels')?.setData({ type: 'FeatureCollection', features: [] });
        return;
    }

    // Cancel any in-flight request
    if (currentFetchController) {
        currentFetchController.abort();
    }
    currentFetchController = new AbortController();

    // Show subtle loading indicator
    document.getElementById('loading-indicator')?.classList.add('active');

    try {
        const bounds = map.getBounds();
        const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

        const params = new URLSearchParams({
            where: '1=1',
            geometry: bbox,
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            outFields: '*',
            returnGeometry: 'true',
            f: 'geojson',
            resultRecordCount: CONFIG.maxRecords
        });

        const response = await fetch(`${CONFIG.parcelServiceUrl}/query?${params}`, {
            signal: currentFetchController.signal
        });
        const data = await response.json();

        if (data.features) {
            // Add unique IDs for feature state using SPAN if available
            data.features.forEach((f, i) => {
                f.id = f.properties?.SPAN || i;
            });

            map.getSource('parcels').setData(data);
            console.log(`Loaded ${data.features.length} parcels`);
        }
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Error loading parcels:', error);
        }
    } finally {
        document.getElementById('loading-indicator')?.classList.remove('active');
        currentFetchController = null;
    }
}

function selectParcel(feature) {
    // Clear previous selection
    if (selectedParcelId !== null) {
        map.setFeatureState({ source: 'parcels', id: selectedParcelId }, { selected: false });
    }

    selectedParcelId = feature.id;
    map.setFeatureState({ source: 'parcels', id: selectedParcelId }, { selected: true });

    // Update sidebar
    const infoSection = document.getElementById('parcel-info');
    const detailsDiv = document.getElementById('parcel-details');

    const props = feature.properties;

    // Calculate acreage using built-in if needed
    let acres = props.ACRESGL || props.ACRES || props.GISAcres || props.Acreage;
    if (!acres && feature.geometry) {
        try {
            // Simple polygon area calculation (rough estimate)
            const coords = feature.geometry.coordinates[0];
            let area = 0;
            for (let i = 0; i < coords.length - 1; i++) {
                area += coords[i][0] * coords[i + 1][1];
                area -= coords[i + 1][0] * coords[i][1];
            }
            area = Math.abs(area) / 2;
            // Convert from degrees^2 to acres (rough estimate at VT latitude)
            const metersPerDegree = 111320 * Math.cos(43.8 * Math.PI / 180);
            const sqMeters = area * metersPerDegree * metersPerDegree;
            acres = (sqMeters / 4046.86).toFixed(2);
        } catch (e) {
            acres = 'N/A';
        }
    }

    // Build details HTML
    detailsDiv.innerHTML = `
        <div class="field">
            <span class="label">Town</span>
            <span class="value">${props.TNAME || props.TOWNNAME || props.Town || 'N/A'}</span>
        </div>
        <div class="field">
            <span class="label">SPAN</span>
            <span class="value">${props.SPAN || props.ParcelID || 'N/A'}</span>
        </div>
        <div class="field">
            <span class="label">Owner</span>
            <span class="value">${props.OWNER1 || props.Owner || 'N/A'}</span>
        </div>
        <div class="field">
            <span class="label">Acres</span>
            <span class="value">${acres}</span>
        </div>
        <div class="field">
            <span class="label">Address</span>
            <span class="value">${props.E911ADDR || props.Address || 'N/A'}</span>
        </div>
        <div class="field">
            <span class="label">Land Value</span>
            <span class="value">${props.LAND_LV ? '$' + Number(props.LAND_LV).toLocaleString() : 'N/A'}</span>
        </div>
        <div class="field">
            <span class="label">Total Value</span>
            <span class="value">${props.REAL_FLV ? '$' + Number(props.REAL_FLV).toLocaleString() : 'N/A'}</span>
        </div>
    `;

    infoSection.style.display = 'block';
}

function initEventListeners() {
    // Search
    document.getElementById('search-btn').addEventListener('click', performSearch);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Filters
    document.getElementById('apply-filters').addEventListener('click', applyFilters);

    // Layer toggles
    document.getElementById('layer-parcels').addEventListener('change', (e) => {
        const visibility = e.target.checked ? 'visible' : 'none';
        map.setLayoutProperty('parcels-fill', 'visibility', visibility);
        map.setLayoutProperty('parcels-outline', 'visibility', visibility);
        map.setLayoutProperty('highlighted-favorite-fill', 'visibility', visibility);
        map.setLayoutProperty('highlighted-favorite-outline', 'visibility', visibility);
    });

    document.getElementById('layer-terrain').addEventListener('change', (e) => {
        if (e.target.checked) {
            // Enable 3D terrain with higher exaggeration for visible hills
            map.setTerrain({ source: 'terrain-dem', exaggeration: 2.5 });
            map.setLayoutProperty('hillshade-layer', 'visibility', 'visible');
            // Tilt the map for 3D effect
            map.easeTo({ pitch: 60, duration: 500 });
        } else {
            // Disable terrain
            map.setTerrain(null);
            map.setLayoutProperty('hillshade-layer', 'visibility', 'none');
            map.easeTo({ pitch: 0, duration: 500 });
        }
    });

    document.getElementById('layer-satellite').addEventListener('change', (e) => {
        if (e.target.checked) {
            map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
            map.setLayoutProperty('osm-layer', 'visibility', 'none');
        } else {
            map.setLayoutProperty('satellite-layer', 'visibility', 'none');
            map.setLayoutProperty('osm-layer', 'visibility', 'visible');
        }
    });

    // Save favorite
    document.getElementById('save-favorite').addEventListener('click', saveFavorite);

    // Event delegation for favorites
    document.getElementById('favorites-list').addEventListener('click', (e) => {
        const item = e.target.closest('.favorite-item');
        if (!item) return;

        if (e.target.classList.contains('remove')) {
            e.stopPropagation();
            removeFavorite(item.dataset.id);
            return;
        }

        const fav = favorites.find(f => f.id === item.dataset.id);
        if (fav && fav.geometry) {
            highlightFavorite(fav);
            const bbox = getBbox(fav.geometry);
            map.fitBounds(bbox, { padding: 100, maxZoom: 16, duration: 1000 });
        }
    });
}

async function performSearch() {
    const rawQuery = document.getElementById('search-input').value.trim();
    if (!rawQuery) return;

    // Sanitize input to prevent SQL injection
    const query = sanitizeForSQL(rawQuery);

    showLoading(true);

    try {
        const params = new URLSearchParams({
            where: `TNAME LIKE '%${query.toUpperCase()}%' OR SPAN LIKE '%${query}%' OR E911ADDR LIKE '%${query.toUpperCase()}%'`,
            outFields: '*',
            returnGeometry: 'true',
            outSR: '4326',
            f: 'geojson',
            resultRecordCount: 100
        });

        const response = await fetch(`${CONFIG.parcelServiceUrl}/query?${params}`);
        const data = await response.json();

        if (data.features && data.features.length > 0) {
            data.features.forEach((f, i) => f.id = f.properties?.SPAN || i);

            const bbox = getFeatureCollectionBbox(data.features);
            map.fitBounds(bbox, { padding: 50 });

            map.getSource('parcels').setData(data);
            showToast(`Found ${data.features.length} parcels`, 'success');
        } else {
            showToast('No parcels found matching your search.', 'warning');
        }
    } catch (error) {
        console.error('Search error:', error);
        showToast('Search failed. Please try again.', 'error');
    } finally {
        showLoading(false);
    }
}

function applyFilters() {
    const minAcres = parseFloat(document.getElementById('min-acres').value) || 0;
    const maxAcres = parseFloat(document.getElementById('max-acres').value) || 999999;
    const maxPrice = parseFloat(document.getElementById('max-price').value) || 999999999;

    const filter = [
        'all',
        ['>=', ['to-number', ['get', 'ACRESGL'], 0], minAcres],
        ['<=', ['to-number', ['get', 'ACRESGL'], 999999], maxAcres],
        ['<=', ['to-number', ['get', 'REAL_FLV'], 0], maxPrice]
    ];

    map.setFilter('parcels-fill', filter);
    map.setFilter('parcels-outline', filter);
    showToast('Filters applied', 'success');
}

function saveFavorite() {
    if (selectedParcelId === null) {
        showToast('Select a parcel first', 'warning');
        return;
    }

    // Query rendered features to get the selected parcel
    const features = map.querySourceFeatures('parcels', {
        filter: ['==', ['id'], selectedParcelId]
    });

    if (features.length === 0) {
        showToast('Could not find parcel data', 'error');
        return;
    }

    const feature = features[0];
    const props = feature.properties;
    const favorite = {
        id: props.SPAN || props.ParcelID || Date.now().toString(),
        name: props.TNAME || props.TOWNNAME || props.Town || 'Unknown',
        address: props.E911ADDR || '',
        acres: props.ACRESGL || props.ACRES || 'N/A',
        value: props.REAL_FLV || props.TOTALVALUE,
        span: props.SPAN,
        geometry: feature.geometry,
        savedAt: new Date().toISOString()
    };

    if (favorites.find(f => f.id === favorite.id)) {
        showToast('This parcel is already in your favorites.', 'warning');
        return;
    }

    favorites.push(favorite);
    localStorage.setItem('plotViewer_favorites', JSON.stringify(favorites));
    renderFavorites();
    showToast('Parcel saved to favorites', 'success');
}

function renderFavorites() {
    const container = document.getElementById('favorites-list');

    if (favorites.length === 0) {
        container.innerHTML = '<p class="empty">No favorites yet</p>';
        return;
    }

    container.innerHTML = favorites.map(f => `
        <div class="favorite-item" data-id="${f.id}">
            <div>
                <div class="name">${f.name}</div>
                <div class="acres">${f.acres} acres</div>
                ${f.address ? `<div class="address">${f.address}</div>` : ''}
            </div>
            <span class="remove">✕</span>
        </div>
    `).join('');
}

function highlightFavorite(fav) {
    // Update the highlighted favorite source
    const feature = {
        type: 'Feature',
        geometry: fav.geometry,
        properties: {
            id: fav.id,
            name: fav.name,
            acres: fav.acres,
            address: fav.address
        }
    };

    map.getSource('highlighted-favorite').setData({
        type: 'FeatureCollection',
        features: [feature]
    });

    highlightedFavoriteId = fav.id;

    // Show popup at center
    const center = getCenter(fav.geometry);

    // Remove existing popups
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());

    new maplibregl.Popup({ closeOnClick: false })
        .setLngLat(center)
        .setHTML(`
            <div class="popup-title">${fav.name}</div>
            <div class="popup-field">
                <span class="popup-label">Acres:</span>
                <span class="popup-value">${fav.acres}</span>
            </div>
            ${fav.address ? `
            <div class="popup-field">
                <span class="popup-label">Address:</span>
                <span class="popup-value">${fav.address}</span>
            </div>
            ` : ''}
            ${fav.note ? `
            <div class="popup-field" style="flex-direction: column; gap: 4px;">
                <span class="popup-label">Note:</span>
                <span class="popup-value" style="text-align: left;">${fav.note}</span>
            </div>
            ` : ''}
        `)
        .addTo(map);
}

function removeFavorite(id) {
    favorites = favorites.filter(f => f.id !== id);
    localStorage.setItem('plotViewer_favorites', JSON.stringify(favorites));
    renderFavorites();
    showToast('Removed from favorites', 'info');

    // Clear highlight if removing the highlighted one
    if (highlightedFavoriteId === id) {
        map.getSource('highlighted-favorite').setData({ type: 'FeatureCollection', features: [] });
        highlightedFavoriteId = null;
    }
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
}

// Simple geometry utilities (no external dependencies)
function getBbox(geometry) {
    const coords = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    coords.forEach(c => {
        minX = Math.min(minX, c[0]);
        minY = Math.min(minY, c[1]);
        maxX = Math.max(maxX, c[0]);
        maxY = Math.max(maxY, c[1]);
    });
    return [[minX, minY], [maxX, maxY]];
}

function getFeatureCollectionBbox(features) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    features.forEach(f => {
        const bbox = getBbox(f.geometry);
        minX = Math.min(minX, bbox[0][0]);
        minY = Math.min(minY, bbox[0][1]);
        maxX = Math.max(maxX, bbox[1][0]);
        maxY = Math.max(maxY, bbox[1][1]);
    });
    return [[minX, minY], [maxX, maxY]];
}

function getCenter(geometry) {
    const coords = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates;
    let sumX = 0, sumY = 0;
    coords.forEach(c => {
        sumX += c[0];
        sumY += c[1];
    });
    return [sumX / coords.length, sumY / coords.length];
}
