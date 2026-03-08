/**
 * Plot Viewer - Vermont Property Search
 *
 * Static property visualization using:
 * - MapLibre GL JS for rendering
 * - VCGI ArcGIS Feature Service for Vermont parcel data
 * - Turf.js for geospatial calculations
 * - LocalStorage for favorites persistence
 */

// Configuration
const CONFIG = {
    // VCGI Parcel Feature Service (Vermont standardized parcels)
    parcelServiceUrl: 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0',

    // Map settings
    defaultCenter: [-72.7, 44.0], // Vermont center
    defaultZoom: 8,

    // Query settings
    maxRecords: 1000, // Max parcels to load per request
    minZoomForParcels: 12, // Only load parcels at this zoom or higher
};

// State
let map = null;
let selectedParcel = null;

// Default favorites (preset parcels of interest)
const DEFAULT_FAVORITES = [
    {
        id: 'blackmer-56',
        name: 'STOCKBRIDGE',
        address: '0 Blackmer Blvd',
        acres: 56.5,
        value: 149999,
        geometry: {
            type: 'Point',
            coordinates: [-72.749851923370358, 43.777188827995168]
        },
        note: '56.5 acre parcel - Stockbridge VT',
        savedAt: '2026-03-08T00:00:00.000Z'
    }
];

// Merge defaults with localStorage (don't duplicate)
let storedFavorites = JSON.parse(localStorage.getItem('plotViewer_favorites') || '[]');
let favorites = [...DEFAULT_FAVORITES];
storedFavorites.forEach(f => {
    if (!favorites.find(df => df.id === f.id)) {
        favorites.push(f);
    }
});
localStorage.setItem('plotViewer_favorites', JSON.stringify(favorites));

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
    initMap();
    initEventListeners();
    renderFavorites();
}

function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                // OpenStreetMap raster tiles (free, no API key)
                'osm': {
                    type: 'raster',
                    tiles: [
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                },
                // Stadia terrain tiles (free tier available)
                'stadia-terrain': {
                    type: 'raster',
                    tiles: [
                        'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '© Stadia Maps, © Stamen Design'
                }
            },
            layers: [
                {
                    id: 'osm-layer',
                    type: 'raster',
                    source: 'osm',
                    minzoom: 0,
                    maxzoom: 19
                }
            ]
        },
        center: CONFIG.defaultCenter,
        zoom: CONFIG.defaultZoom
    });

    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    // Add parcel source and layer when map loads
    map.on('load', () => {
        // Add empty parcel source
        map.addSource('parcels', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
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
                    '#e94560',
                    '#4a90d9'
                ],
                'fill-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    0.5,
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
                    '#e94560',
                    '#4a90d9'
                ],
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'selected'], false],
                    3,
                    1
                ]
            }
        });

        // Load parcels on move end
        map.on('moveend', loadParcelsInView);

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

async function loadParcelsInView() {
    const zoom = map.getZoom();

    // Only load parcels at sufficient zoom
    if (zoom < CONFIG.minZoomForParcels) {
        map.getSource('parcels')?.setData({ type: 'FeatureCollection', features: [] });
        return;
    }

    showLoading(true);

    try {
        const bounds = map.getBounds();
        const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

        // Build query URL
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

        const response = await fetch(`${CONFIG.parcelServiceUrl}/query?${params}`);
        const data = await response.json();

        if (data.features) {
            // Add unique IDs for feature state
            data.features.forEach((f, i) => {
                f.id = i;
            });

            map.getSource('parcels').setData(data);
            console.log(`Loaded ${data.features.length} parcels`);
        }
    } catch (error) {
        console.error('Error loading parcels:', error);
    } finally {
        showLoading(false);
    }
}

function selectParcel(feature) {
    selectedParcel = feature;

    // Update sidebar
    const infoSection = document.getElementById('parcel-info');
    const detailsDiv = document.getElementById('parcel-details');

    const props = feature.properties;

    // Calculate acreage if geometry available (VCGI uses ACRESGL)
    let acres = props.ACRESGL || props.ACRES || props.GISAcres || props.Acreage;
    if (!acres && feature.geometry) {
        try {
            const area = turf.area(feature);
            acres = (area / 4046.86).toFixed(2); // sq meters to acres
        } catch (e) {
            acres = 'N/A';
        }
    }

    // Build details HTML (VCGI field names: TNAME, SPAN, OWNER1, ACRESGL, E911ADDR, LAND_LV, REAL_FLV)
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
            <span class="value">${props.LAND_LV ? '$' + Number(props.LAND_LV).toLocaleString() : (props.LANDVALUE ? '$' + Number(props.LANDVALUE).toLocaleString() : 'N/A')}</span>
        </div>
        <div class="field">
            <span class="label">Total Value</span>
            <span class="value">${props.REAL_FLV ? '$' + Number(props.REAL_FLV).toLocaleString() : (props.TOTALVALUE ? '$' + Number(props.TOTALVALUE).toLocaleString() : 'N/A')}</span>
        </div>
    `;

    infoSection.style.display = 'block';

    // Show popup on map
    const center = turf.center(feature);
    const coords = center.geometry.coordinates;

    new maplibregl.Popup()
        .setLngLat(coords)
        .setHTML(`
            <div class="popup-title">${props.TNAME || props.TOWNNAME || props.Town || 'Parcel'}</div>
            <div class="popup-field">
                <span class="popup-label">Acres:</span>
                <span class="popup-value">${acres}</span>
            </div>
            <div class="popup-field">
                <span class="popup-label">Value:</span>
                <span class="popup-value">${props.TOTALVALUE ? '$' + Number(props.TOTALVALUE).toLocaleString() : 'N/A'}</span>
            </div>
        `)
        .addTo(map);
}

function initEventListeners() {
    // Search
    document.getElementById('search-btn').addEventListener('click', performSearch);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Filters
    document.getElementById('apply-filters').addEventListener('click', applyFilters);

    // Layers
    document.getElementById('layer-parcels').addEventListener('change', (e) => {
        const visibility = e.target.checked ? 'visible' : 'none';
        map.setLayoutProperty('parcels-fill', 'visibility', visibility);
        map.setLayoutProperty('parcels-outline', 'visibility', visibility);
    });

    document.getElementById('layer-terrain').addEventListener('change', (e) => {
        if (e.target.checked) {
            // Switch to terrain style
            if (!map.getSource('stadia-terrain')) {
                map.addSource('stadia-terrain', {
                    type: 'raster',
                    tiles: ['https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png'],
                    tileSize: 256
                });
            }
            if (!map.getLayer('terrain-layer')) {
                map.addLayer({
                    id: 'terrain-layer',
                    type: 'raster',
                    source: 'stadia-terrain'
                }, 'parcels-fill'); // Insert below parcels
            }
            map.setLayoutProperty('osm-layer', 'visibility', 'none');
        } else {
            if (map.getLayer('terrain-layer')) {
                map.setLayoutProperty('terrain-layer', 'visibility', 'none');
            }
            map.setLayoutProperty('osm-layer', 'visibility', 'visible');
        }
    });

    // Save favorite
    document.getElementById('save-favorite').addEventListener('click', saveFavorite);
}

async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

    showLoading(true);

    try {
        // Search by town name (TNAME), SPAN, or address (E911ADDR) - VCGI field names
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
            // Add IDs
            data.features.forEach((f, i) => f.id = i);

            // Fit to results
            const bbox = turf.bbox({ type: 'FeatureCollection', features: data.features });
            map.fitBounds(bbox, { padding: 50 });

            // Update source
            map.getSource('parcels').setData(data);

            console.log(`Found ${data.features.length} results`);
        } else {
            alert('No parcels found matching your search.');
        }
    } catch (error) {
        console.error('Search error:', error);
        alert('Search failed. Please try again.');
    } finally {
        showLoading(false);
    }
}

function applyFilters() {
    const minAcres = parseFloat(document.getElementById('min-acres').value) || 0;
    const maxAcres = parseFloat(document.getElementById('max-acres').value) || 999999;
    const maxPrice = parseFloat(document.getElementById('max-price').value) || 999999999;

    // Update layer filter (VCGI uses ACRESGL and REAL_FLV)
    map.setFilter('parcels-fill', [
        'all',
        ['>=', ['to-number', ['get', 'ACRESGL'], 0], minAcres],
        ['<=', ['to-number', ['get', 'ACRESGL'], 999999], maxAcres],
        ['<=', ['to-number', ['get', 'REAL_FLV'], 0], maxPrice]
    ]);

    map.setFilter('parcels-outline', [
        'all',
        ['>=', ['to-number', ['get', 'ACRESGL'], 0], minAcres],
        ['<=', ['to-number', ['get', 'ACRESGL'], 999999], maxAcres],
        ['<=', ['to-number', ['get', 'REAL_FLV'], 0], maxPrice]
    ]);
}

function saveFavorite() {
    if (!selectedParcel) return;

    const props = selectedParcel.properties;
    const favorite = {
        id: props.SPAN || props.ParcelID || Date.now().toString(),
        name: props.TNAME || props.TOWNNAME || props.Town || 'Unknown',
        address: props.E911ADDR || '',
        acres: props.ACRESGL || props.ACRES || 'N/A',
        value: props.REAL_FLV || props.TOTALVALUE,
        geometry: selectedParcel.geometry,
        savedAt: new Date().toISOString()
    };

    // Check if already saved
    if (favorites.find(f => f.id === favorite.id)) {
        alert('This parcel is already in your favorites.');
        return;
    }

    favorites.push(favorite);
    localStorage.setItem('plotViewer_favorites', JSON.stringify(favorites));
    renderFavorites();
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
                <div class="acres">${f.acres} acres${f.note ? ' - ' + f.note : ''}</div>
                ${f.address ? `<div class="address">${f.address}</div>` : ''}
            </div>
            <span class="remove" onclick="removeFavorite('${f.id}')">✕</span>
        </div>
    `).join('');

    // Add click handlers to fly to favorite
    container.querySelectorAll('.favorite-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            if (e.target.classList.contains('remove')) return;

            const id = item.dataset.id;
            const fav = favorites.find(f => f.id === id);
            if (fav && fav.geometry) {
                const center = turf.center({ type: 'Feature', geometry: fav.geometry });
                map.flyTo({ center: center.geometry.coordinates, zoom: 15 });

                // After flying, query VCGI for actual parcel at this location
                await queryParcelAtLocation(center.geometry.coordinates, fav);
            }
        });
    });
}

// Query VCGI for parcel at a specific location and highlight it
async function queryParcelAtLocation(coords, favData) {
    showLoading(true);

    try {
        // Create a small buffer around the point to query
        const [lng, lat] = coords;
        const buffer = 0.001; // ~100m buffer
        const bbox = `${lng - buffer},${lat - buffer},${lng + buffer},${lat + buffer}`;

        const params = new URLSearchParams({
            where: '1=1',
            geometry: bbox,
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            outFields: '*',
            returnGeometry: 'true',
            f: 'geojson',
            resultRecordCount: 50
        });

        const response = await fetch(`${CONFIG.parcelServiceUrl}/query?${params}`);
        const data = await response.json();

        if (data.features && data.features.length > 0) {
            // Find the parcel that matches our favorite (by address or acreage)
            let targetParcel = data.features[0];

            // Try to match by address if available
            if (favData.address) {
                const addrMatch = data.features.find(f =>
                    f.properties.E911ADDR?.toUpperCase().includes(favData.address.toUpperCase().replace('0 ', ''))
                );
                if (addrMatch) targetParcel = addrMatch;
            }

            // Or match by closest acreage (VCGI uses ACRESGL)
            if (favData.acres && typeof favData.acres === 'number') {
                const acreMatch = data.features.reduce((closest, f) => {
                    const fAcres = f.properties.ACRESGL || f.properties.ACRES || 0;
                    const closestAcres = closest.properties.ACRESGL || closest.properties.ACRES || 0;
                    return Math.abs(fAcres - favData.acres) < Math.abs(closestAcres - favData.acres) ? f : closest;
                }, data.features[0]);
                if (acreMatch) targetParcel = acreMatch;
            }

            // Add IDs and update source
            data.features.forEach((f, i) => f.id = i);
            map.getSource('parcels').setData(data);

            // Select and show popup for the target parcel
            selectParcel(targetParcel);

            // Fit bounds to the target parcel
            const bbox = turf.bbox(targetParcel);
            map.fitBounds(bbox, { padding: 100, maxZoom: 16 });

            console.log(`Found parcel: ${targetParcel.properties.E911ADDR}, ${targetParcel.properties.ACRES} acres`);
        } else {
            console.log('No parcels found at location, zooming out to load from view');
            // Trigger a reload at current zoom
            loadParcelsInView();
        }
    } catch (error) {
        console.error('Error querying parcel at location:', error);
        loadParcelsInView();
    } finally {
        showLoading(false);
    }
}

function removeFavorite(id) {
    favorites = favorites.filter(f => f.id !== id);
    localStorage.setItem('plotViewer_favorites', JSON.stringify(favorites));
    renderFavorites();
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
}

// Expose for onclick handlers
window.removeFavorite = removeFavorite;
