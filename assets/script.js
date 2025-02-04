import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// If on mobile, collapse the sidebar by default
if (window.innerWidth < 1000) {
  document.getElementById('sidebar-container').classList.add('collapsed');
} else {
  document.getElementById('sidebar-container').classList.remove('collapsed');
}

const toggleAbout = document.getElementById('about-section-collapse');
toggleAbout.addEventListener('click', () => {
  const aboutSection = document.getElementById('about-section');
  aboutSection.classList.toggle('collapsed');
  toggleAbout.innerText = aboutSection.classList.contains('collapsed') ? 'Show More' : 'Show Less';
});

// === Custom Audio Controls Setup ===
const audioPlayer = document.getElementById('audioPlayer');
const playPauseButton = document.getElementById('play-pause');
const seekSlider = document.getElementById('seek-slider');
const currentTimeSpan = document.getElementById('current-time');
const durationSpan = document.getElementById('duration');

// When metadata is loaded, update the duration display and slider max.
audioPlayer.addEventListener('loadedmetadata', () => {
  seekSlider.max = audioPlayer.duration;
  durationSpan.textContent = formatTime(audioPlayer.duration);
  currentTimeSpan.textContent = formatTime(audioPlayer.currentTime);
});

// Update the slider and current time display as the audio plays.
audioPlayer.addEventListener('timeupdate', () => {
  seekSlider.value = audioPlayer.currentTime;
  currentTimeSpan.textContent = formatTime(audioPlayer.currentTime);
});

// If the user seeks via the slider while audio is playing, pause the audio,
// then resume playback when the mouse button is released.
let seekingWhilePlaying = false;
seekSlider.addEventListener('mousedown', () => {
  if (!audioPlayer.paused) {
    audioPlayer.pause();
    seekingWhilePlaying = true;
  }
});
seekSlider.addEventListener('mouseup', () => {
  if (seekingWhilePlaying) {
    audioPlayer.play();
    seekingWhilePlaying = false;
  }
});

// Allow seeking via the slider.
seekSlider.addEventListener('input', () => {
  audioPlayer.currentTime = seekSlider.value;
});

// Toggle play/pause and update button class.
playPauseButton.addEventListener('click', () => {
  if (audioPlayer.paused) {
    audioPlayer.play();
    playPauseButton.classList.remove('paused');
  } else {
    audioPlayer.pause();
    playPauseButton.classList.add('paused');
  }
});

function formatTime(time) {
  time = time + audioStart;
  // Convert from unix epoch to human-readable time.
  const date = new Date(time * 1000);
  const timeStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York'
  }).format(date);
  return timeStr;
}

// === Flight Simulation Code ===
const flightsData = {};
let flightFollowing = null;

// Define the audio time segment (simulation time offset)
const audioStart = 1738201500; // simulation time corresponding to audio time 0
let simTime = audioStart;

const MAPTILER_API_KEY = 'g9TJmRrNpggoZS9Br475';
const basemapDark = 'https://api.maptiler.com/maps/7048f857-1a55-41fd-af70-6719704981e9/style.json';
const mapStyle = basemapDark;

// Initialize MapLibre map.
const map = new maplibregl.Map({
  container: 'map',
  style: mapStyle + '?key=' + MAPTILER_API_KEY,
  zoom: 11,
  center: [-77.05, 38.84],
  pitch: 0,
  maxPitch: 88,
  canvasContextAttributes: { antialias: true }
});

// Collapse the attribution control on load.
document.querySelector('.maplibregl-ctrl-attrib').classList.remove('maplibregl-compact-show');

function bearingBetweenCoords([lng1, lat1], [lng2, lat2]) {
  const toRad = deg => deg * Math.PI / 180;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lng1), λ2 = toRad(lng2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Interpolates flight track position given a track array and a timestamp.
 */
function getInterpolatedTrack(trackArray, timestamp) {
  if (!trackArray || !trackArray.length) return null;
  if (timestamp <= trackArray[0].timestamp) {
    const heading = bearingBetweenCoords(trackArray[0].coord, trackArray[1].coord);
    return { ...trackArray[0], timestamp, heading };
  }
  if (timestamp >= trackArray[trackArray.length - 1].timestamp) {
    const n = trackArray.length;
    const heading = bearingBetweenCoords(trackArray[n - 2].coord, trackArray[n - 1].coord);
    return { ...trackArray[n - 1], timestamp, heading };
  }
  const exact = trackArray.find(t => t.timestamp === timestamp);
  if (exact) {
    const index = trackArray.indexOf(exact);
    let heading = 0;
    if (index > 0 && index < trackArray.length - 1) {
      heading = bearingBetweenCoords(trackArray[index - 1].coord, trackArray[index].coord);
    }
    return { ...exact, heading };
  }
  let i = 0;
  while (i < trackArray.length - 1 && trackArray[i + 1].timestamp < timestamp) i++;
  const prev = trackArray[i], next = trackArray[i + 1];
  const dt = next.timestamp - prev.timestamp;
  const ratio = (timestamp - prev.timestamp) / dt;
  const [lng1, lat1] = prev.coord;
  const [lng2, lat2] = next.coord;
  const lng = lng1 + ratio * (lng2 - lng1);
  const lat = lat1 + ratio * (lat2 - lat1);
  let alt;
  if (prev.alt != null && next.alt != null) {
    alt = prev.alt + ratio * (next.alt - prev.alt);
  }
  const heading = bearingBetweenCoords(prev.coord, next.coord);
  return { timestamp, coord: [lng, lat], alt, heading };
}

function parseGeojsonToTrack(geojson) {
  if (!geojson.features || !geojson.features.length) {
    console.warn("No features found in GeoJSON");
    return [];
  }
  const feature = geojson.features[0];
  if (!feature.properties || !feature.properties.timestamps) {
    console.warn("No timestamps found in feature properties.");
    return [];
  }
  const coords = feature.geometry.coordinates;
  const timestamps = feature.properties.timestamps;
  if (coords.length !== timestamps.length) {
    console.warn("Coordinates and timestamps mismatch!");
  }
  const trackArray = coords.map((pt, i) => {
    const [lng, lat, alt = 0] = pt;
    return { timestamp: timestamps[i], coord: [lng, lat], alt };
  });
  trackArray.sort((a, b) => a.timestamp - b.timestamp);
  return trackArray;
}

/**
 * Generates a data URL for an inline SVG flight marker.
 */
function createFlightMarkerSVG(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">
    <polygon points="15,0 30,30 15,25 0,30" fill="${color}" />
  </svg>`;
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// Update both the 3D model and the 2D markers based on simulation time.
function updateFlightPositions(simulationTime) {
  for (const flightId in flightsData) {
    const flightObj = flightsData[flightId];
    const trackArray = flightObj.track;
    if (!trackArray || !trackArray.length) continue;
    const interpolated = getInterpolatedTrack(trackArray, simulationTime);
    if (!interpolated) {
      console.log(`Flight ${flightId} has no valid interpolation at time ${simulationTime}.`);
      continue;
    }
    // Update 3D model transformation if it exists.
    if (flightObj.modelTransform) {
      if (flightFollowing === flightId) {
        const lookbeyond = interpolated.alt * 5.67;
        const bearing = interpolated.heading;
        const pitch = 80;
        const zoom = 23.4 - Math.log2(interpolated.alt);
        const lookAheadPoint = turf.destination(
          turf.point(interpolated.coord),
          lookbeyond,
          bearing,
          { units: 'meters' }
        );
        map.jumpTo({
          center: lookAheadPoint.geometry.coordinates,
          bearing: bearing,
          pitch: pitch,
          zoom: zoom
        });
      }
      const headingDeg = interpolated.heading || 0;
      const headingRad = (180 - headingDeg) * Math.PI / 180;
      const merc = maplibregl.MercatorCoordinate.fromLngLat(
        interpolated.coord,
        interpolated.alt
      );
      const scale = merc.meterInMercatorCoordinateUnits() * flightObj.scale * 100;
      flightObj.modelTransform.translateX = merc.x;
      flightObj.modelTransform.translateY = merc.y;
      flightObj.modelTransform.translateZ = merc.z;
      flightObj.modelTransform.rotateX = Math.PI / 2;
      flightObj.modelTransform.rotateY = headingRad;
      flightObj.modelTransform.rotateZ = 0;
      flightObj.modelTransform.scale = scale;
    }
    // Update the icon marker position and rotation.
    if (flightObj.iconMarker) {
      flightObj.iconMarker.setLngLat(interpolated.coord);
      flightObj.iconElement.style.transform = `rotate(${interpolated.heading}deg)`;
    }
    // Update the label marker position and text.
    if (flightObj.labelMarker) {
      flightObj.labelMarker.setLngLat(interpolated.coord);
      flightObj.labelMarker.getElement().innerText =
        `${flightObj.flightName} / ${flightObj.tail} @ ${Math.round(interpolated.alt * 3.28)} ft`;
    }
  }
  map.triggerRepaint();
}

// Instead of using the original audio playback to update positions,
// we update positions during audio playback.
audioPlayer.addEventListener('timeupdate', () => {
  const simTime = audioPlayer.currentTime + audioStart;
  updateFlightPositions(simTime);
  updateSubtitles(simTime);
});

const subtitlesObj = document.getElementById('subtitles');
let subtitles = [];

// Load the subtitles from atc-transcript.json
fetch('assets/atc-transcript.json')
  .then(response => response.json())
  .then(data => {
    data.forEach(subtitle => {
      subtitle.time += audioStart;
      subtitles.push(subtitle);
    });
  });

function updateSubtitles(timestamp) {
  const subtitle = subtitles.reduce((prev, curr) => 
    (curr.time <= timestamp && curr.time > prev.time ? curr : prev), { time: 0 });
  if (subtitle.time > 0) {
    let subtitleBodyFormatted = subtitle.body;
    // Highlight flight names that appear in the subtitle.
    for (const flightId in flightsData) {
      const flightObj = flightsData[flightId];
      const flightNameFormatted = flightObj.flightName.replace('AAL', 'American ').replace('JIA', 'Bluestreak ');
      if (subtitle.body.includes(flightNameFormatted)) {
        subtitleBodyFormatted = subtitle.body.replace(flightNameFormatted,
          `<span class="${flightObj.flightName}">${flightNameFormatted}</span>`);
      }
    }
    const headingHTML = `<span class="${subtitle.heading}">${subtitle.heading}</span>`;
    if (subtitlesObj.querySelector('#subtitle-body').innerHTML === subtitleBodyFormatted) {
      return;
    }
    subtitlesObj.querySelector('#subtitle-heading').innerHTML = headingHTML;
    subtitlesObj.querySelector('#subtitle-body').innerHTML = subtitleBodyFormatted;
    const duration = Math.max(1000, subtitlesObj.querySelector('#subtitle-body').innerText.length * 100);
    subtitlesObj.classList.add('visible');
    clearTimeout(subtitlesObj.timer);
    subtitlesObj.timer = setTimeout(() => {
      subtitlesObj.classList.remove('visible');
    }, duration);
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!audioPlayer.paused) {
    const simTime = audioPlayer.currentTime + audioStart;
    updateFlightPositions(simTime);
    updateSubtitles(simTime);
  }
}
animate();

// ----- Flight Rendering Code for 3D Models -----
// This function creates a custom 3D layer using Three.js.
function addStlModel(flightId, modelUrl, color) {
  const customLayer = {
    id: flightsData[flightId].layerId,
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
      this.map = map;
      this.flightId = flightId;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      const ambientLight = new THREE.AmbientLight(0xffffff);
      this.scene.add(ambientLight);
      const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x000000, 2);
      this.scene.add(hemisphereLight);
      const loader = new STLLoader();
      loader.load(
        modelUrl,
        stl => {
          const material = new THREE.MeshPhongMaterial({
            color: color,
            specular: 0x111111,
            shininess: 0
          });
          const mesh = new THREE.Mesh(stl, material);
          mesh.scale.set(1, 1, 1);
          mesh.rotation.x = -Math.PI / 2;
          this.scene.add(mesh);
        },
        undefined,
        err => {
          console.error("STL load error:", err);
        }
      );
      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true
      });
      this.renderer.autoClear = false;
    },
    render(gl, matrix) {
      const flightObj = flightsData[this.flightId];
      const mt = flightObj.modelTransform;
      const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), mt.rotateX);
      const rotationY = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), mt.rotateY);
      const rotationZ = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 0, 1), mt.rotateZ);
      const m = new THREE.Matrix4().fromArray(matrix.defaultProjectionData.mainMatrix);
      const l = new THREE.Matrix4()
        .makeTranslation(mt.translateX, mt.translateY, mt.translateZ)
        .scale(new THREE.Vector3(mt.scale, -mt.scale, mt.scale))
        .multiply(rotationX)
        .multiply(rotationY)
        .multiply(rotationZ);
      this.camera.projectionMatrix = m.multiply(l);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
      this.map.triggerRepaint();
    }
  };
  map.addLayer(customLayer);
  // No need to force visibility here—3D layers are added/removed by the toggle.
}

// ----- Overlay Charts Conditional Loading -----
const chartsData = {
  "tac-chart": { loaded: false },
  "heli-chart": { loaded: false },
  "rnav-33": { loaded: false },
  "ils-01": { loaded: false }
};

function loadChartOverlay(chartId) {
  if (chartId === "tac-chart") {
    map.addSource('tac-chart', {
      type: 'image',
      url: 'assets/tac-chart.jpg',
      coordinates: [
        [-78.742661, 39.82934],
        [-75.746974, 39.83134],
        [-75.751074, 38.165825],
        [-78.735661, 38.137825]
      ]
    });
    map.addLayer({
      id: 'tac-chart-layer',
      type: 'raster',
      source: 'tac-chart',
      paint: { 'raster-opacity': 1 }
    });
    chartsData["tac-chart"].loaded = true;
  } else if (chartId === "heli-chart") {
    map.addSource('heli-chart', {
      type: 'image',
      url: 'assets/heli-chart.jpg',
      coordinates: [
        [-77.121504, 38.960631],
        [-76.937853, 38.960631],
        [-76.937853, 38.774585],
        [-77.121504, 38.774585]
      ]
    });
    map.addLayer({
      id: 'heli-chart-layer',
      type: 'raster',
      source: 'heli-chart',
      paint: { 'raster-opacity': 1 }
    });
    chartsData["heli-chart"].loaded = true;
  } else if (chartId === "rnav-33") {
    map.addSource('rnav-33', {
      type: 'image',
      url: 'assets/rnav-33-dark.png',
      coordinates: [
        [-77.47, 39.271],
        [-76.67, 39.271],
        [-76.67, 38.301],
        [-77.47, 38.301]
      ]
    });
    map.addLayer({
      id: 'rnav-33-layer',
      type: 'raster',
      source: 'rnav-33',
      paint: { 'raster-opacity': 1 }
    });
    chartsData["rnav-33"].loaded = true;
  } else if (chartId === "ils-01") {
    map.addSource('ils-01', {
      type: 'image',
      url: 'assets/ils-01-dark.png',
      coordinates: [
        [-77.428, 39.2201],
        [-76.609, 39.2201],
        [-76.609, 38.2551],
        [-77.428, 38.2551]
      ]
    });
    map.addLayer({
      id: 'ils-01-layer',
      type: 'raster',
      source: 'ils-01',
      paint: { 'raster-opacity': 1 }
    });
    chartsData["ils-01"].loaded = true;
  }
  // Reorder flight track layers to the top so that overlays appear underneath.
  for (const flightId in flightsData) {
    const flightTrackId = flightId + '-layer';
    if (map.getLayer(flightTrackId)) {
      map.moveLayer(flightTrackId);
    }
  }
  // Also, reorder flight 3D model layers (if present) to the top.
  for (const flightId in flightsData) {
    if (flightsData[flightId].modelLoaded) {
      const flightModelId = flightsData[flightId].layerId;
      if (map.getLayer(flightModelId)) {
        map.moveLayer(flightModelId);
      }
    }
  }
}

function removeChartOverlay(chartId) {
  if (chartId === "tac-chart") {
    if (map.getLayer('tac-chart-layer')) map.removeLayer('tac-chart-layer');
    if (map.getSource('tac-chart')) map.removeSource('tac-chart');
    chartsData["tac-chart"].loaded = false;
  } else if (chartId === "heli-chart") {
    if (map.getLayer('heli-chart-layer')) map.removeLayer('heli-chart-layer');
    if (map.getSource('heli-chart')) map.removeSource('heli-chart');
    chartsData["heli-chart"].loaded = false;
  } else if (chartId === "rnav-33") {
    if (map.getLayer('rnav-33-layer')) map.removeLayer('rnav-33-layer');
    if (map.getSource('rnav-33')) map.removeSource('rnav-33');
    chartsData["rnav-33"].loaded = false;
  } else if (chartId === "ils-01") {
    if (map.getLayer('ils-01-layer')) map.removeLayer('ils-01-layer');
    if (map.getSource('ils-01')) map.removeSource('ils-01');
    chartsData["ils-01"].loaded = false;
  }
}

document.getElementById('chartOverlay').addEventListener('change', (e) => {
  const selectedChart = e.target.value; // Possible values: 'none', 'tac-chart', 'heli-chart', 'rnav-33', 'ils-01'
  // Remove any loaded chart overlays.
  Object.keys(chartsData).forEach(chartId => {
    if (chartsData[chartId].loaded) {
      removeChartOverlay(chartId);
    }
  });
  // If a chart is selected (not "none"), load it.
  if (selectedChart !== 'none') {
    loadChartOverlay(selectedChart);
  }
});

// ----- Event Listeners for Other Toggles -----
document.querySelector('#toggle2d').addEventListener('change', (e) => {
  // Toggle the 2D icon and label markers.
  for (const flightId in flightsData) {
    const flightObj = flightsData[flightId];
    if (flightObj.iconMarker) {
      flightObj.iconMarker.getElement().style.display = e.target.checked ? 'block' : 'none';
    }
    if (flightObj.labelMarker) {
      flightObj.labelMarker.getElement().style.display = e.target.checked ? 'block' : 'none';
    }
  }
});

// New toggle3d handler: conditionally load or unload 3D models.
document.querySelector('#toggle3d').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  if (enabled) {
    // For any flight that hasn't loaded its 3D model, load it now.
    for (const flightId in flightsData) {
      if (!flightsData[flightId].modelLoaded) {
        addStlModel(flightId, flightsData[flightId].modelUrl, flightsData[flightId].color);
        flightsData[flightId].modelLoaded = true;
      }
    }
  } else {
    // Remove 3D layers to free up resources.
    for (const flightId in flightsData) {
      if (flightsData[flightId].modelLoaded && map.getLayer(flightsData[flightId].layerId)) {
        map.removeLayer(flightsData[flightId].layerId);
        flightsData[flightId].modelLoaded = false;
      }
    }
  }
});

document.querySelector('#toggleTracks').addEventListener('change', (e) => {
  for (const flightId in flightsData) {
    map.setLayoutProperty(flightId + '-layer', 'visibility', e.target.checked ? 'visible' : 'none');
  }
});

document.querySelector('#toggle-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar-container').classList.toggle('collapsed');
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');

const cameraPosition = document.getElementById('cameraPosition');
cameraPosition.addEventListener('change', (e) => {
  const flightId = e.target.value;
  if (flightsData[flightId]) {
    flightFollowing = flightId;
    updateFlightPositions(simTime);
  } else {
    flightFollowing = null;
    if (e.target.value === 'tower') {
      map.flyTo({
        center: [-77.0395745296994, 38.8520164066407],
        zoom: 16.747139236424818,
        pitch: 82.4710661910424,
        bearing: 128.7129888402858
      });
    }
    if (e.target.value === 'collision') {
      map.flyTo({
        center: [-77.02300585244876, 38.8420350717096],
        zoom: 16.487554696848527,
        pitch: 83.4795460372746,
        bearing: 108.73769153646504
      });
    }
    if (e.target.value === 'default') {
      map.flyTo({
        zoom: 11,
        center: [-77.05, 38.84],
        pitch: 0,
        bearing: 0
      });
    }
  }
});

// ----- Map Load and Flight Addition -----
map.on('load', () => {
  map.setSky({
    "sky-color": "#000000",
    "sky-horizon-blend": 0.5,
    "horizon-color": "#222222",
    "horizon-fog-blend": 0.5,
    "fog-color": "#444444",
    "fog-ground-blend": 0.5,
    "atmosphere-blend": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0, 1,
      10, 1,
      12, 0
    ]
  });

  // Add a raster source for satellite imagery.
  map.addSource('satellite-source', {
    type: 'raster',
    tiles: [`https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_API_KEY}`],
    tileSize: 256,
  });

  // Add the satellite layer below the "Road labels" layer.
  map.addLayer({
    id: 'satellite-layer',
    type: 'raster',
    source: 'satellite-source',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 1 }
  }, "Road labels");

  const basemapSelector = document.getElementById('basemap');
  basemapSelector.addEventListener('change', (e) => {
    if (e.target.value === 'satellite') {
      map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
    } else if (e.target.value === 'dark') {
      map.setLayoutProperty('satellite-layer', 'visibility', 'none');
    }
  });

  function addFlight(id, dataUrl, color, modelUrl, modelScale) {
    map.addSource(id + '-source', { type: 'geojson', data: dataUrl });
    map.on('data', function (e) {
      if (e.sourceId === id + '-source' && e.sourceDataType === 'metadata') {
        // Add the flight's track log.
        map.addLayer({
          id: id + '-layer',
          type: 'line',
          source: id + '-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': color, 'line-width': 2 }
        });
        fetch(dataUrl)
          .then(response => response.json())
          .then(geojson => {
            const flightType = geojson.properties.type;
            const tail = geojson.properties.tail;
            const flightName = geojson.properties.flight;
            // Add a CSS rule for this flight name.
            document.styleSheets[0].insertRule(`.${flightName} { color: ${color}; font-weight: bold; }`);
            console.log(`Flight ${flightName} (${flightType}) with tail #${tail} loaded.`);
            const trackArray = parseGeojsonToTrack(geojson);
            const modelTransform = {
              translateX: 0, translateY: 0, translateZ: 0,
              rotateX: 0, rotateY: 0, rotateZ: 0,
              scale: 1
            };
            flightsData[id] = {
              track: trackArray,
              color: color,
              flightType: flightType,
              flightName: flightName,
              tail: tail,
              modelTransform: modelTransform,
              layerId: id + '-model',
              scale: modelScale,
              modelLoaded: false,  // Flag for 3D model load status.
              modelUrl: modelUrl   // Save the model URL for on-demand loading.
            };
            const initialCoord = trackArray.length ? trackArray[0].coord : [0, 0];

            // Create the icon marker.
            const iconContainer = document.createElement('div');
            iconContainer.className = 'flight-marker-container';
            const iconElement = document.createElement('div');
            iconElement.className = 'flight-marker-icon';
            iconElement.style.backgroundImage = `url("${createFlightMarkerSVG(color)}")`;
            iconContainer.appendChild(iconElement);
            const iconMarker = new maplibregl.Marker({
              element: iconContainer,
              rotationAlignment: 'map'
            })
              .setLngLat(initialCoord)
              .addTo(map);
            flightsData[id].iconMarker = iconMarker;
            flightsData[id].iconElement = iconElement;

            // Create the label marker.
            const labelElement = document.createElement('div');
            labelElement.className = 'flight-marker-label';
            labelElement.innerText = `${flightName} / ${tail} @ 0 m`;
            const labelMarker = new maplibregl.Marker({
              element: labelElement,
              rotationAlignment: 'viewport',
              anchor: 'top-left',
              offset: [20, 0]
            })
              .setLngLat(initialCoord)
              .addTo(map);
            flightsData[id].labelMarker = labelMarker;
            flightsData[id].labelElement = labelElement;

            // Conditionally add the 3D model if 3D is enabled.
            if (document.querySelector('#toggle3d').checked) {
              addStlModel(id, modelUrl, color);
              flightsData[id].modelLoaded = true;
            }

            const cameraPosition = document.getElementById('cameraPosition');
            const option = document.createElement('option');
            option.value = id;
            option.innerText = `Follow ${flightName} (experimental)`;
            cameraPosition.appendChild(option);

            // Set initial flight positions.
            updateFlightPositions(audioStart);
          });
      }
    });
  }

  addFlight('AE313D', './assets/AE313D-track.geojson', '#ff453a', './assets/UH-60.stl', 1 / 1200);
  addFlight('N709PS', './assets/N709PS-track.geojson', '#0a84ff', './assets/CRJ7.stl', 1 / 300);
  addFlight('N765US', './assets/N765US-track.geojson', '#30d158', './assets/CRJ7.stl', 1 / 300);
  addFlight('N941NN', './assets/N941NN-track.geojson', '#bf5af2', './assets/CRJ7.stl', 1 / 300);

  // (Optional) Log the camera position periodically.
  /*
  setInterval(() => {
    console.log(map.getCenter(), map.getBearing(), map.getPitch(), map.getZoom());
  }, 5000);
  */

});
