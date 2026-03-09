/**
 * Plot Viewer - Vermont Property Search
 *
 * Static property visualization using:
 * - MapLibre GL JS for rendering (with 3D terrain)
 * - VCGI ArcGIS Feature Service for Vermont parcel data
 * - Cloudflare KV for favorites persistence (via API)
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

    // Favorites API (legacy KV)
    favoritesApiUrl: PROXY_BASE ? `${PROXY_BASE}/favorites` : null,

    // Listings API (new D1-based)
    listingsApiUrl: 'https://plot-listings-api.nicklaudethorat.workers.dev',

    // VCGI Cache Proxy for parcel point queries (with caching)
    vcgiCacheProxyUrl: 'https://vcgi-cache-proxy.nicklaudethorat.workers.dev',
};

// Favorite status colors
const STATUS_COLORS = {
    'interested': '#3b82f6',  // Blue
    'visited': '#f59e0b',     // Amber
    'offer-made': '#8b5cf6',  // Purple
    'purchased': '#10b981',   // Green
    'rejected': '#6b7280',    // Gray
};

// State
let map = null;
let selectedParcelId = null;
let highlightedListingId = null;
let loadParcelsTimeout = null;
let currentFetchController = null;
let listingMarkers = []; // Map markers for listings
let favoriteMarkers = []; // Map markers for legacy favorites

// Listings from D1 API
let listings = [];

// Legacy favorites (kept for backwards compatibility with parcel selection)
let favorites = [];

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    initMap();
    initEventListeners();
    // Initialize listings UI and load listings after map is ready
    map.on('load', () => {
        initListingsUI();
        loadListings();
    });
}

// Simple debounce helper
function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// Validate coordinates are valid numbers in reasonable ranges
function isValidCoord(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' &&
           !isNaN(lat) && !isNaN(lng) &&
           lat >= -90 && lat <= 90 &&
           lng >= -180 && lng <= 180;
}

// Initialize listings UI event listeners
function initListingsUI() {
    document.getElementById('refresh-listings')?.addEventListener('click', loadListings);
    // Debounce state changes to avoid rapid API calls
    document.getElementById('listings-state')?.addEventListener('change', debounce(loadListings, 300));
}

// Load listings from D1 API
async function loadListings() {
    const state = document.getElementById('listings-state')?.value || 'VT';
    const container = document.getElementById('listings-list');
    const refreshBtn = document.getElementById('refresh-listings');

    // Show loading state
    container.innerHTML = '<p class="empty">Loading...</p>';
    if (refreshBtn) refreshBtn.disabled = true;

    try {
        const response = await fetch(`${CONFIG.listingsApiUrl}/listings?state=${state}&status=active&limit=100`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        listings = data.listings || [];

        document.getElementById('listings-count').textContent = `(${listings.length})`;
        renderListings();
        updateListingMarkers();

    } catch (e) {
        console.error('Failed to load listings:', e);
        container.innerHTML = '<p class="empty">Failed to load listings</p>';
    } finally {
        if (refreshBtn) refreshBtn.disabled = false;
    }
}

async function loadDefaultFavorites() {
    // Try to load from API first (production)
    if (CONFIG.favoritesApiUrl) {
        try {
            const response = await fetch(CONFIG.favoritesApiUrl);
            if (response.ok) {
                favorites = await response.json();
                console.log(`Loaded ${favorites.length} favorites from API`);
                return;
            }
        } catch (e) {
            console.warn('Could not load favorites from API, falling back to local:', e);
        }
    }

    // Fallback to local storage + defaults
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

    // Clear listing parcel highlight when manually selecting
    clearListingParcelHighlight();

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

    // Save favorite (keep for parcel selection)
    document.getElementById('save-favorite')?.addEventListener('click', saveFavorite);

    // Event delegation for legacy favorites (if element exists)
    document.getElementById('favorites-list')?.addEventListener('click', (e) => {
        const item = e.target.closest('.favorite-item');
        if (!item) return;

        if (e.target.classList.contains('remove')) {
            e.stopPropagation();
            removeFavorite(item.dataset.id);
            return;
        }

        const fav = favorites.find(f => f.id === item.dataset.id);
        if (fav) {
            flyToFavorite(fav);
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

async function saveFavorite() {
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
    const center = getCenter(feature.geometry);

    const favorite = {
        id: props.SPAN || props.ParcelID || Date.now().toString(),
        name: props.TNAME || props.TOWNNAME || props.Town || 'Unknown',
        address: props.E911ADDR || '',
        acres: parseFloat(props.ACRESGL || props.ACRES) || 0,
        center: center,
        polygon: feature.geometry.coordinates,
        price: props.REAL_FLV || props.TOTALVALUE || null,
        listingStatus: 'off-market',
        notes: '',
        tags: [],
        status: 'interested',
        // Legacy fields for compatibility
        value: props.REAL_FLV || props.TOTALVALUE,
        span: props.SPAN,
        geometry: feature.geometry,
    };

    if (favorites.find(f => f.id === favorite.id)) {
        showToast('This parcel is already in your favorites.', 'warning');
        return;
    }

    // Save to backend
    const saved = await saveFavoriteToBackend(favorite);
    favorites.push(saved);
    renderFavorites();
    updateFavoriteMarkers();
    showToast('Parcel saved to favorites', 'success');
}

// Render favorites in sidebar (legacy - kept for parcel favorites)
function renderFavorites() {
    const container = document.getElementById('favorites-list');
    if (!container) return; // Favorites list removed from UI, using listings now

    if (favorites.length === 0) {
        container.innerHTML = '<p class="empty">No favorites yet</p>';
        return;
    }

    container.innerHTML = favorites.map(fav => `
        <div class="favorite-item" data-id="${fav.id}">
            <div class="favorite-info">
                <div class="favorite-name">${fav.name || 'Unnamed'}</div>
                <div class="favorite-details">${fav.acres ? fav.acres + ' acres' : ''}</div>
            </div>
            <button class="remove" title="Remove">×</button>
        </div>
    `).join('');
}

// Render listings in sidebar
function renderListings() {
    const container = document.getElementById('listings-list');

    if (listings.length === 0) {
        container.innerHTML = '<p class="empty">No listings found</p>';
        return;
    }

    container.innerHTML = listings.map(l => {
        const priceStr = l.price ? `$${l.price.toLocaleString()}` : 'Price N/A';
        const bedsStr = l.beds ? `${l.beds}bd` : '';
        const bathsStr = l.baths ? `${l.baths}ba` : '';
        const sqftStr = l.sqft ? `${l.sqft.toLocaleString()}sf` : '';
        // Prefer VCGI acres (official) over listing acres
        const acres = l.vcgi_acres || l.lot_acres;
        const acresStr = acres ? `${parseFloat(acres).toFixed(1)}ac${l.vcgi_acres ? '*' : ''}` : '';
        const details = [bedsStr, bathsStr, sqftStr, acresStr].filter(Boolean).join(' · ');

        // Days on market (prefer stored value over calculated)
        const daysOnMarket = l.days_on_market ?? getDaysOnMarket(l.first_seen);
        const daysStr = daysOnMarket !== null ? (daysOnMarket === 0 ? 'New' : `${daysOnMarket}d`) : '';

        // Utility info (water/septic/heating)
        const utilityParts = [];
        if (l.water_source) utilityParts.push(`💧${l.water_source}`);
        if (l.sewer) utilityParts.push(`🚽${l.sewer}`);
        const utilityStr = utilityParts.length > 0 ? utilityParts.join(' ') : '';

        // Image thumbnail
        const imageUrl = l.primary_image_url || (l.image_urls && l.image_urls[0]);

        return `
        <div class="listing-item" data-id="${l.id}">
            <div style="display: flex; gap: 10px;">
                ${imageUrl ? `<div style="width: 60px; height: 60px; flex-shrink: 0; border-radius: 6px; overflow: hidden; background: #333;">
                    <img src="${imageUrl}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.style.display='none'">
                </div>` : ''}
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div class="price">${priceStr}</div>
                        ${daysStr ? `<span style="font-size: 0.75em; color: #888;">📅 ${daysStr}</span>` : ''}
                    </div>
                    <div class="details">${details || '—'}</div>
                    ${utilityStr ? `<div style="font-size: 0.75em; color: #888;">${utilityStr}</div>` : ''}
                    <div class="address">${l.address || 'Address N/A'}</div>
                </div>
                ${l.is_favorite ? '<span class="favorite-star">⭐</span>' : ''}
            </div>
        </div>
    `}).join('');

    // Add click handlers
    container.querySelectorAll('.listing-item').forEach(el => {
        el.addEventListener('click', () => {
            // Remove active class from all items
            container.querySelectorAll('.listing-item').forEach(item => item.classList.remove('active'));
            // Add active class to clicked item
            el.classList.add('active');

            const id = el.dataset.id;
            const listing = listings.find(l => l.id === id);
            if (listing) {
                flyToListing(listing);
            }
        });
    });
}

// Update listing markers on map
function updateListingMarkers() {
    // Remove existing markers
    listingMarkers.forEach(m => m.remove());
    listingMarkers = [];

    let skippedCount = 0;

    // Add new markers
    listings.forEach(l => {
        // Validate coordinates are valid numbers
        if (!isValidCoord(l.lat, l.lng)) {
            skippedCount++;
            return;
        }

        const el = document.createElement('div');
        el.className = 'listing-marker';
        el.style.cssText = `
            width: 24px; height: 24px;
            background: #10b981;
            border: 2px solid white;
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        `;

        const marker = new maplibregl.Marker({ element: el })
            .setLngLat([l.lng, l.lat])
            .addTo(map);

        // Click to show popup
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            showListingPopup(l);
        });

        listingMarkers.push(marker);
    });

    if (skippedCount > 0) {
        console.warn(`Skipped ${skippedCount} listings with invalid coordinates`);
    }
}

// Calculate days on market from first_seen date
function getDaysOnMarket(firstSeen) {
    if (!firstSeen) return null;
    const first = new Date(firstSeen);
    const now = new Date();
    const diffMs = now - first;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Simple markdown to HTML converter for preview_md/details_md
function renderMarkdown(md) {
    if (!md) return '';
    return md
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
        .replace(/\n/g, '<br>');
}

// Show popup for a listing
function showListingPopup(l) {
    // Remove existing popups
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());

    const priceStr = l.price ? `$${l.price.toLocaleString()}` : 'Price N/A';
    const daysOnMarket = l.days_on_market ?? getDaysOnMarket(l.first_seen);
    const daysStr = daysOnMarket !== null ? (daysOnMarket === 0 ? 'New today' : `${daysOnMarket} day${daysOnMarket === 1 ? '' : 's'} on market`) : '';

    // Build image HTML if available
    const imageUrl = l.primary_image_url || (l.image_urls && l.image_urls[0]);
    const imageHtml = imageUrl ? `
        <div style="margin: -12px -12px 8px -12px; border-radius: 8px 8px 0 0; overflow: hidden;">
            <img src="${imageUrl}" alt="Property" style="width: 100%; height: 120px; object-fit: cover;" onerror="this.parentElement.style.display='none'">
        </div>
    ` : '';

    // Google Maps link
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.address || `${l.lat},${l.lng}`)}`;

    // Use preview_md if available, otherwise build from fields
    let contentHtml;
    if (l.preview_md) {
        contentHtml = `
            <div class="listing-preview-md">${renderMarkdown(l.preview_md)}</div>
        `;
    } else {
        // Build utility info line
        const utilityParts = [];
        if (l.water_source) utilityParts.push(`💧 ${l.water_source}`);
        if (l.sewer) utilityParts.push(`🚽 ${l.sewer}`);
        if (l.heating) utilityParts.push(`🔥 ${l.heating}`);
        const utilityStr = utilityParts.join(' · ');

        // Prefer VCGI acres (official) over listing acres
        const acres = l.vcgi_acres || l.lot_acres;
        const acresLabel = l.vcgi_acres ? 'acres (VCGI)' : 'acres';

        // VCGI parcel info
        const vcgiParts = [];
        if (l.vcgi_owner) vcgiParts.push(`Owner: ${l.vcgi_owner}`);
        if (l.vcgi_land_value) vcgiParts.push(`Land: $${l.vcgi_land_value.toLocaleString()}`);
        if (l.vcgi_total_value) vcgiParts.push(`Assessed: $${l.vcgi_total_value.toLocaleString()}`);
        const vcgiStr = vcgiParts.length > 0 ? vcgiParts.join(' · ') : '';

        // Valuation info (Zestimate, tax assessment)
        const valuationParts = [];
        if (l.zestimate) valuationParts.push(`Zestimate: $${l.zestimate.toLocaleString()}`);
        if (l.tax_assessed_value) valuationParts.push(`Tax: $${l.tax_assessed_value.toLocaleString()}`);
        const valuationStr = valuationParts.length > 0 ? valuationParts.join(' · ') : '';

        contentHtml = `
            <div style="font-weight: 600; color: #10b981; font-size: 1.1em;">${priceStr}</div>
            <div style="margin: 4px 0;">${l.address || 'Address N/A'}</div>
            <div style="font-size: 0.9em; color: #666;">
                ${l.beds ? `${l.beds} beds` : ''} ${l.baths ? `· ${l.baths} baths` : ''} ${l.sqft ? `· ${l.sqft.toLocaleString()} sqft` : ''}
            </div>
            ${acres ? `<div style="font-size: 0.9em; color: #666;">${parseFloat(acres).toFixed(2)} ${acresLabel}</div>` : ''}
            ${valuationStr ? `<div style="font-size: 0.85em; color: #888; margin-top: 4px;">💰 ${valuationStr}</div>` : ''}
            ${vcgiStr ? `<div style="font-size: 0.85em; color: #888; margin-top: 4px;">📋 ${vcgiStr}</div>` : ''}
            ${utilityStr ? `<div style="font-size: 0.85em; color: #888; margin-top: 4px;">${utilityStr}</div>` : ''}
            ${daysStr ? `<div style="font-size: 0.85em; color: #888; margin-top: 4px;">📅 ${daysStr}</div>` : ''}
        `;
    }

    new maplibregl.Popup({ closeOnClick: true, maxWidth: '300px' })
        .setLngLat([l.lng, l.lat])
        .setHTML(`
            ${imageHtml}
            ${contentHtml}
            <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
                ${l.source_url ? `<a href="${l.source_url}" target="_blank" style="font-size: 0.85em; color: #3b82f6;">View on ${l.source || 'source'} →</a>` : ''}
                <a href="${googleMapsUrl}" target="_blank" style="font-size: 0.85em; color: #3b82f6;">📍 Google Maps</a>
            </div>
        `)
        .addTo(map);

    highlightedListingId = l.id;
}

// Fly to listing location
const FLY_DURATION = 1500;

function flyToListing(l) {
    // Validate coordinates
    if (!isValidCoord(l.lat, l.lng)) {
        showToast('No location data for this listing', 'warning');
        return;
    }

    map.flyTo({
        center: [l.lng, l.lat],
        zoom: 15,  // Zoom in closer to see parcel
        duration: FLY_DURATION
    });

    // After fly, load parcels and find the one at this point
    setTimeout(async () => {
        showListingPopup(l);
        // Query for parcel at this point, highlight it, and save VCGI data
        await highlightParcelAtPoint(l.lng, l.lat, l.id);
    }, FLY_DURATION + 100);
}

// Clear listing parcel highlight
function clearListingParcelHighlight() {
    if (map.getSource('listing-parcel')) {
        map.getSource('listing-parcel').setData({
            type: 'FeatureCollection',
            features: []
        });
    }
}

// Query VCGI for parcel containing a point and highlight it
// If listingId is provided, save VCGI data to the listings API
// Uses the VCGI cache proxy for caching and resilience
async function highlightParcelAtPoint(lng, lat, listingId = null) {
    try {
        // Use the cache proxy for parcel queries
        const proxyUrl = `${CONFIG.vcgiCacheProxyUrl}/parcel?lat=${lat}&lng=${lng}`;
        const response = await fetch(proxyUrl);
        const data = await response.json();

        if (data.features && data.features.length > 0) {
            const feature = data.features[0];
            const props = feature.properties || {};
            feature.id = props.SPAN || 'listing-parcel';

            // Add to highlighted source (separate from main parcels)
            if (!map.getSource('listing-parcel')) {
                map.addSource('listing-parcel', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [feature] }
                });

                // Add highlight layer
                map.addLayer({
                    id: 'listing-parcel-fill',
                    type: 'fill',
                    source: 'listing-parcel',
                    paint: {
                        'fill-color': '#10b981',
                        'fill-opacity': 0.3
                    }
                }, 'parcels-fill');

                map.addLayer({
                    id: 'listing-parcel-outline',
                    type: 'line',
                    source: 'listing-parcel',
                    paint: {
                        'line-color': '#10b981',
                        'line-width': 3
                    }
                });
            } else {
                map.getSource('listing-parcel').setData({
                    type: 'FeatureCollection',
                    features: [feature]
                });
            }

            console.log(`Highlighted parcel: ${props.SPAN || 'unknown'}, ${props.ACRESGL || '?'} acres`);

            // If we have a listing ID, save VCGI data to the API
            if (listingId && props.SPAN) {
                await saveVcgiDataToListing(listingId, props, feature.geometry);
            }
        }
    } catch (error) {
        console.warn('Could not highlight parcel:', error);
    }
}

// Save VCGI parcel data to a listing via PATCH API
async function saveVcgiDataToListing(listingId, props, geometry) {
    try {
        const vcgiData = {
            vcgi_span: props.SPAN || null,
            vcgi_owner: props.OWNER1 || null,
            vcgi_acres: props.ACRESGL ? parseFloat(props.ACRESGL) : null,
            vcgi_land_value: props.LAND_LV ? parseInt(props.LAND_LV) : null,
            vcgi_improvement_value: props.IMPRV_LV ? parseInt(props.IMPRV_LV) : null,
            vcgi_total_value: props.REAL_FLV ? parseInt(props.REAL_FLV) : null,
            vcgi_town: props.TNAME || props.TOWNNAME || null,
            vcgi_property_type: props.PROPTYPE || null,
            vcgi_geometry: geometry ? JSON.stringify(geometry) : null
        };

        // Only PATCH if we have meaningful data
        if (!vcgiData.vcgi_span) return;

        const response = await fetch(`${CONFIG.listingsApiUrl}/listings/${listingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vcgiData)
        });

        if (response.ok) {
            console.log(`Saved VCGI data for listing ${listingId}: ${vcgiData.vcgi_span}, ${vcgiData.vcgi_acres} acres`);

            // Update local listing data
            const listing = listings.find(l => l.id === listingId);
            if (listing) {
                Object.assign(listing, vcgiData);
                // Re-render the listings to show updated data
                renderListings();
            }
        } else {
            console.warn('Failed to save VCGI data:', await response.text());
        }
    } catch (error) {
        console.warn('Could not save VCGI data:', error);
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

// Update favorite markers on the map
function updateFavoriteMarkers() {
    // Remove existing markers
    favoriteMarkers.forEach(m => m.remove());
    favoriteMarkers = [];

    // Add markers for each favorite
    favorites.forEach(fav => {
        const center = fav.center || (fav.geometry ? getCenter(fav.geometry) : null);
        if (!center || !isValidCoord(center[1], center[0])) return; // center is [lng, lat]

        const status = fav.status || 'interested';
        const color = STATUS_COLORS[status] || STATUS_COLORS.interested;

        // Create marker element
        const el = document.createElement('div');
        el.className = 'favorite-marker';
        el.style.cssText = `
            width: 24px;
            height: 24px;
            background: ${color};
            border: 2px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        el.innerHTML = `<span style="font-size: 12px; color: white;">★</span>`;

        const marker = new maplibregl.Marker({ element: el })
            .setLngLat(center)
            .addTo(map);

        // Click handler - fly to and show popup
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            flyToFavorite(fav);
        });

        favoriteMarkers.push(marker);
    });

    console.log(`Added ${favoriteMarkers.length} favorite markers to map`);
}

// Fly to a favorite and show its popup
function flyToFavorite(fav) {
    const center = fav.center || (fav.geometry ? getCenter(fav.geometry) : null);
    if (!center) return;

    // Fly to location
    map.flyTo({
        center: center,
        zoom: 15,
        duration: 1000
    });

    // If has geometry, highlight it
    if (fav.geometry) {
        highlightFavorite(fav);
    }

    // Show popup
    showFavoritePopup(fav, center);
}

// Highlight a favorite parcel on the map
function highlightFavorite(fav) {
    if (!fav.geometry) return;

    // Add or update highlight source
    if (map.getSource('favorite-highlight')) {
        map.getSource('favorite-highlight').setData({
            type: 'Feature',
            geometry: fav.geometry,
            properties: {}
        });
    } else {
        map.addSource('favorite-highlight', {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: fav.geometry,
                properties: {}
            }
        });

        map.addLayer({
            id: 'favorite-highlight-layer',
            type: 'line',
            source: 'favorite-highlight',
            paint: {
                'line-color': '#fbbf24',
                'line-width': 3
            }
        });
    }
}

// Show detailed popup for a favorite
function showFavoritePopup(fav, center) {
    // Remove existing popups
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());

    const status = fav.status || 'interested';
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ');
    const color = STATUS_COLORS[status] || STATUS_COLORS.interested;

    let html = `
        <div class="popup-title">${fav.name || 'Unnamed'}</div>
        <div class="popup-field">
            <span class="popup-label">Status:</span>
            <span class="popup-value" style="color: ${color}; font-weight: 600;">${statusLabel}</span>
        </div>
    `;

    if (fav.acres) {
        html += `
        <div class="popup-field">
            <span class="popup-label">Acres:</span>
            <span class="popup-value">${fav.acres}</span>
        </div>`;
    }

    if (fav.address) {
        html += `
        <div class="popup-field">
            <span class="popup-label">Address:</span>
            <span class="popup-value">${fav.address}</span>
        </div>`;
    }

    if (fav.price) {
        html += `
        <div class="popup-field">
            <span class="popup-label">Price:</span>
            <span class="popup-value">$${Number(fav.price).toLocaleString()}</span>
        </div>`;
    }

    if (fav.listingUrl) {
        html += `
        <div class="popup-field">
            <a href="${fav.listingUrl}" target="_blank" style="color: #3b82f6;">View Listing →</a>
        </div>`;
    }

    if (fav.notes) {
        html += `
        <div class="popup-field" style="flex-direction: column; gap: 4px;">
            <span class="popup-label">Notes:</span>
            <span class="popup-value" style="text-align: left;">${fav.notes}</span>
        </div>`;
    }

    if (fav.tags && fav.tags.length > 0) {
        html += `
        <div class="popup-field" style="flex-direction: column; gap: 4px;">
            <span class="popup-label">Tags:</span>
            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                ${fav.tags.map(t => `<span style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 11px;">${t}</span>`).join('')}
            </div>
        </div>`;
    }

    new maplibregl.Popup({ closeOnClick: false, maxWidth: '300px' })
        .setLngLat(center)
        .setHTML(html)
        .addTo(map);
}

// Save favorite to API (if available) or localStorage
async function saveFavoriteToBackend(favorite) {
    if (CONFIG.favoritesApiUrl) {
        try {
            const response = await fetch(CONFIG.favoritesApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(favorite)
            });
            if (response.ok) {
                const saved = await response.json();
                return saved;
            }
        } catch (e) {
            console.warn('Failed to save to API, using localStorage:', e);
        }
    }
    // Fallback to localStorage - save updated array including the new favorite
    const updatedFavorites = [...favorites, favorite];
    localStorage.setItem('plotViewer_favorites', JSON.stringify(updatedFavorites));
    return favorite;
}

// Delete favorite from API (if available) or localStorage
async function deleteFavoriteFromBackend(id) {
    if (CONFIG.favoritesApiUrl) {
        try {
            await fetch(`${CONFIG.favoritesApiUrl}/${id}`, { method: 'DELETE' });
        } catch (e) {
            console.warn('Failed to delete from API:', e);
        }
    }
    localStorage.setItem('plotViewer_favorites', JSON.stringify(favorites));
}
