/**
 * Plot Viewer - Vermont Property Search
 *
 * Static property visualization using:
 * - MapLibre GL JS for rendering (with 3D terrain)
 * - VCGI ArcGIS Feature Service for Vermont parcel data
 * - Turf.js for geospatial calculations
 * - LocalStorage for favorites persistence
 */

// Configuration
const CONFIG = {
    // VCGI Parcel Feature Service (Vermont standardized parcels)
    parcelServiceUrl: 'https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/FS_VCGI_OPENDATA_Cadastral_VTPARCELS_poly_standardized_parcels_SP_v1/FeatureServer/0',

    // MapLibre demo terrain tiles (free, no API key)
    terrainUrl: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',

    // Map settings
    defaultCenter: [-72.7, 44.0], // Vermont center
    defaultZoom: 8,

    // Query settings
    maxRecords: 1000,
    minZoomForParcels: 12,
};

// State
let map = null;
let selectedParcelId = null;
let highlightedFavoriteId = null;

// Default favorites (preset parcels of interest)
const DEFAULT_FAVORITES = [
    {
        id: '618-194-10882',
        name: 'STOCKBRIDGE',
        address: '0 Blackmer Blvd',
        acres: 74.4,
        value: 149999,
        span: '618-194-10882',
        geometry: {
            type: 'Polygon',
            coordinates: [[[-72.7418877770988,43.7846073465063],[-72.7438683570201,43.7816535542558],[-72.7398039564224,43.7802953235268],[-72.7392619110588,43.7801141690879],[-72.7395501693638,43.7797522929575],[-72.741446840199,43.7773711052132],[-72.7418031202869,43.7769237864111],[-72.7421806439915,43.7768526286393],[-72.7423413944675,43.7768223294702],[-72.7427044362636,43.7768179957839],[-72.7429039039667,43.7768156144063],[-72.7434961653171,43.7768390058395],[-72.7441824137984,43.7769492074546],[-72.7444286276782,43.7770233265751],[-72.7447572595474,43.7771222552067],[-72.7450398284402,43.7772160505213],[-72.7452230908932,43.7769851931063],[-72.7461976130613,43.7757575446746],[-72.7467164448722,43.7749383394915],[-72.7469415556415,43.7745828937094],[-72.7469591899604,43.7745550501024],[-72.7472643913597,43.7749022420975],[-72.7484022503073,43.7739036224716],[-72.748438297424,43.7738719853697],[-72.748596875671,43.7739400855089],[-72.7488570080375,43.7740489332153],[-72.7492042093668,43.7741861385701],[-72.7492119965492,43.7741918873653],[-72.7498352728084,43.7744435276631],[-72.7498982993739,43.7744779863205],[-72.7499375759943,43.7744950573502],[-72.7499136126355,43.7745785532671],[-72.750068887515,43.7747374861706],[-72.7505294115534,43.7752088525542],[-72.7508224711542,43.7749170841247],[-72.7508708169426,43.7748693145262],[-72.7508921293035,43.774878443839],[-72.7512708540125,43.7750330132207],[-72.7516575115268,43.7752275030635],[-72.7516730624514,43.7752332345948],[-72.7519019561613,43.7753877095777],[-72.7521306803535,43.775593796512],[-72.7521307039891,43.7755994218238],[-72.7522888769608,43.7758284472219],[-72.7523140578096,43.7758868720167],[-72.7522864659061,43.7758993519287],[-72.751923093567,43.7760637129226],[-72.7513025482891,43.7764723751503],[-72.7513989362719,43.7768065293523],[-72.7514557632101,43.7770035359531],[-72.7514996602275,43.7771557138813],[-72.7515646961854,43.7771731506844],[-72.7514612455769,43.7772082033827],[-72.751422062793,43.7772140553558],[-72.7513113822266,43.7772024855176],[-72.7511221442294,43.7771567734937],[-72.751019371586,43.7771796420175],[-72.750901214432,43.7772369984428],[-72.7508934507999,43.7772370154857],[-72.7508459678817,43.7772999833597],[-72.7508068036027,43.7774030134403],[-72.7508068512155,43.7774144044693],[-72.7507673356368,43.7777122132417],[-72.7507596195514,43.7777236222042],[-72.7507203718851,43.7779926006029],[-72.7507201887085,43.7782273189915],[-72.7507285209556,43.7784563933289],[-72.7507046923638,43.7785136838756],[-72.7507047158681,43.7785193091853],[-72.7506731234232,43.7785766167549],[-72.7504918019725,43.7787540718606],[-72.7504604529479,43.7787769237251],[-72.7500899229862,43.7791034434942],[-72.7496875323544,43.7794241245745],[-72.7494827943267,43.7795729407719],[-72.7494669016114,43.7795787412314],[-72.7493013309417,43.779624527513],[-72.7492381009289,43.7796359161372],[-72.7490803183938,43.7796875912923],[-72.7490174531609,43.7796932132303],[-72.748851857256,43.7797333735549],[-72.748662676086,43.7797963672136],[-72.7485992959339,43.7798651344819],[-72.7485916263569,43.7798879343214],[-72.7485599839821,43.7799338493737],[-72.748544139515,43.7799510416283],[-72.7484811854012,43.780122751985],[-72.7484653396159,43.7801399433309],[-72.7483787525626,43.7803230961279],[-72.748362906699,43.7803402883593],[-72.7482447081509,43.7804834292779],[-72.7482369918082,43.7804949775742],[-72.7480869116903,43.7806265156217],[-72.7479688409317,43.7807067923584],[-72.7479293382534,43.7807296603112],[-72.7478110670413,43.7808556440349],[-72.7474797525296,43.7810961426151],[-72.7473538094298,43.781244924722],[-72.747353833201,43.781250690438],[-72.7472670515486,43.7813881369675],[-72.7472512300896,43.7814110947561],[-72.7471961867087,43.7815255490031],[-72.7471962104687,43.781531315619],[-72.7471256048177,43.7817317310577],[-72.7471174761827,43.7817373739915],[-72.7470625503942,43.781880517239],[-72.7470310227767,43.7819548401116],[-72.7468889136037,43.7821381117155],[-72.7467628962915,43.7822697364146],[-72.7463843015899,43.7825332573893],[-72.7462346354146,43.782767875611],[-72.7462186829362,43.7828538375322],[-72.7461794011444,43.7830254955358],[-72.7461954108095,43.7832373965895],[-72.7462426547175,43.7835866294461],[-72.7462191251593,43.7837183134734],[-72.746250758922,43.7839529630748],[-72.7462508991922,43.7841762893974],[-72.7462826144546,43.7845254152277],[-72.7463142713372,43.7847658304923],[-72.7463143654615,43.7847887538364],[-72.7463381767384,43.7849147104694],[-72.746282857556,43.7852467256208],[-72.7462752204558,43.7857504921116],[-72.7462356072513,43.7858421303263],[-72.7462278892602,43.785853538071],[-72.74614120509,43.7859222136997],[-72.7461412287486,43.7859279794116],[-72.7461015928106,43.7860138518632],[-72.7439400364286,43.7852930959945],[-72.7418878467639,43.7846073697604],[-72.7418877770988,43.7846073465063]]]
        },
        note: '74.4 acre parent parcel (SPAN 618-194-10882) - 56.5 acres being sold @ $149,999',
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
                // OpenStreetMap raster tiles
                'osm': {
                    type: 'raster',
                    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                },
                // ESRI World Imagery (satellite)
                'satellite': {
                    type: 'raster',
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
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
        maxPitch: 85
    });

    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right');

    map.on('load', () => {
        // Add terrain DEM source
        map.addSource('terrain-dem', {
            type: 'raster-dem',
            url: CONFIG.terrainUrl,
            tileSize: 256
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

    // Calculate acreage
    let acres = props.ACRESGL || props.ACRES || props.GISAcres || props.Acreage;
    if (!acres && feature.geometry) {
        try {
            const area = turf.area(feature);
            acres = (area / 4046.86).toFixed(2);
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
            // Enable 3D terrain
            map.setTerrain({ source: 'terrain-dem', exaggeration: 1.5 });
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
}

async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;

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
            data.features.forEach((f, i) => f.id = i);

            const bbox = turf.bbox({ type: 'FeatureCollection', features: data.features });
            map.fitBounds(bbox, { padding: 50 });

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

    const filter = [
        'all',
        ['>=', ['to-number', ['get', 'ACRESGL'], 0], minAcres],
        ['<=', ['to-number', ['get', 'ACRESGL'], 999999], maxAcres],
        ['<=', ['to-number', ['get', 'REAL_FLV'], 0], maxPrice]
    ];

    map.setFilter('parcels-fill', filter);
    map.setFilter('parcels-outline', filter);
}

function saveFavorite() {
    if (selectedParcelId === null) return;

    // Get the selected feature from the source
    const source = map.getSource('parcels');
    const data = source._data;
    const feature = data.features.find(f => f.id === selectedParcelId);

    if (!feature) return;

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
                <div class="acres">${f.acres} acres</div>
                ${f.address ? `<div class="address">${f.address}</div>` : ''}
            </div>
            <span class="remove" onclick="event.stopPropagation(); removeFavorite('${f.id}')">✕</span>
        </div>
    `).join('');

    // Add click handlers to fly to and highlight favorite
    container.querySelectorAll('.favorite-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            if (e.target.classList.contains('remove')) return;

            const id = item.dataset.id;
            const fav = favorites.find(f => f.id === id);
            if (fav && fav.geometry) {
                // Highlight the favorite parcel immediately
                highlightFavorite(fav);

                // Fit bounds to the parcel
                const bbox = turf.bbox({ type: 'Feature', geometry: fav.geometry });
                map.fitBounds(bbox, { padding: 100, maxZoom: 16, duration: 1000 });
            }
        });
    });
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
    const center = turf.center(feature);

    // Remove existing popups
    document.querySelectorAll('.maplibregl-popup').forEach(p => p.remove());

    new maplibregl.Popup({ closeOnClick: false })
        .setLngLat(center.geometry.coordinates)
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

    // Clear highlight if removing the highlighted one
    if (highlightedFavoriteId === id) {
        map.getSource('highlighted-favorite').setData({ type: 'FeatureCollection', features: [] });
        highlightedFavoriteId = null;
    }
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
}

// Expose for onclick handlers
window.removeFavorite = removeFavorite;
