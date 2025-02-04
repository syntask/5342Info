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


// If the user seeks via the slider while audio is playing, pause the audio, then play again when the mouse button is released.
var seekingWhilePlaying = false;
seekSlider.addEventListener('mousedown', () => {
  if (!audioPlayer.paused){
    audioPlayer.pause();
    seekingWhilePlaying = true;
  }
});
seekSlider.addEventListener('mouseup', () => {
  if (seekingWhilePlaying){
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
  // convert from unix epoch to human-readable time

  const date = new Date(time * 1000);

  const timeStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York' // Set timezone to Eastern Time
  }).format(date);

  return timeStr;
}

// === Flight Simulation Code (unchanged) ===
const flightsData = {};
var flightFollowing = null;

// Define the audio time segment (simulation time offset)
const audioStart = 1738201500; // simulation time corresponding to audio time 0
var simTime = audioStart;

const MAPTILER_API_KEY = 'g9TJmRrNpggoZS9Br475';
const basemapDark = 'https://api.maptiler.com/maps/7048f857-1a55-41fd-af70-6719704981e9/style.json';

var mapStyle = basemapDark;

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

// Collapse the attribution control on load
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
 * Interpolates flight track position given a track array and timestamp.
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
    // Update 3D model transformation.
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

// Instead of using the original 'atcAudio', we now use our custom-controlled audioPlayer.
audioPlayer.addEventListener('timeupdate', () => {
  const simTime = audioPlayer.currentTime + audioStart;
  updateFlightPositions(simTime);
  updateSubtitles(simTime);
});

const subtitlesObj = document.getElementById('subtitles');
var subtitles = [];

// Load the subtitles from atc-transcript.json

fetch('assets/atc-transcript.json')
  .then(response => response.json())
  .then(data => {
    data.forEach(subtitle => {
      subtitle.time += audioStart;
      subtitles.push(subtitle);
    });
  });

function updateSubtitles(timestamp){
  const subtitle = subtitles.reduce((prev, curr) => (curr.time <= timestamp && curr.time > prev.time ? curr : prev), { time: 0 });
  if (subtitle.time > 0) {

    var subtitleBodyFormatted = subtitle.body;

    // See if the subtitle body contains any of the flightNames in the flightsData object.
    for (const flightId in flightsData) {
      const flightObj = flightsData[flightId];
      const flightNameFormatted = flightObj.flightName.replace('AAL', 'American ').replace('JIA', 'Bluestreak ');
      if (subtitle.body.includes(flightNameFormatted)) {
        subtitleBodyFormatted = subtitle.body.replace(flightNameFormatted, `<span class="${flightObj.flightName}">${flightNameFormatted}</span>`);
      }
    }

    const headingHTML = '<span class="'+subtitle.heading+'">'+subtitle.heading+'</span>';

    if (subtitlesObj.querySelector('#subtitle-body').innerHTML === subtitleBodyFormatted) {
      return;
    }

    subtitlesObj.querySelector('#subtitle-heading').innerHTML = headingHTML;
    subtitlesObj.querySelector('#subtitle-body').innerHTML = subtitleBodyFormatted

    // Set the length of time to show the subtitles based on the length of the subtitle text.
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
}

document.querySelector('#toggle2d').addEventListener('change', (e) => {
  toggle2d(e.target.checked);
});
document.querySelector('#toggle3d').addEventListener('change', (e) => {
  toggle3d(e.target.checked);
});
document.querySelector('#toggleTracks').addEventListener('change', (e) => {
  toggleTracks(e.target.checked);
});

document.querySelector('#toggle-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar-container').classList.toggle('collapsed');
});

function toggle2d(visible) {
  for (const flightId in flightsData) {
    const flightObj = flightsData[flightId];
    if (flightObj.iconMarker) {
      flightObj.iconMarker.getElement().style.display = visible ? 'block' : 'none';
    }
    if (flightObj.labelMarker) {
      flightObj.labelMarker.getElement().style.display = visible ? 'block' : 'none';
    }
  }
}

function toggle3d(visible) {
  for (const flightId in flightsData) {
    const flightObj = flightsData[flightId];
    if (flightObj.layerId) {
      map.setLayoutProperty(flightObj.layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

function toggleTracks(visible) {
  for (const flightId in flightsData) {
    map.setLayoutProperty(flightId + '-layer', 'visibility', visible ? 'visible' : 'none');
  }
}


map.addControl(new maplibregl.NavigationControl(), 'top-right');

const cameraPosition = document.getElementById('cameraPosition');
cameraPosition.addEventListener('change', (e) => {
  // Check if the selected value is a valid flight ID.
  const flightId = e.target.value;
  if (flightsData[flightId]) {
    flightFollowing = flightId;
    updateFlightPositions(simTime);
  } else {
    flightFollowing = null;
    if (e.target.value ==='tower') {
      flightFollowing = null;
      map.flyTo({
        center: [-77.0395745296994,38.8520164066407],
        zoom: 16.747139236424818,
        pitch: 82.4710661910424,
        bearing: 128.7129888402858
      });
    }
    if (e.target.value === 'collision') {
      map.flyTo({
        center: [-77.02300585244876,38.8420350717096],
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

const chartOverlay = document.getElementById('chartOverlay');
chartOverlay.addEventListener('change', (e) => {
  const chartId = e.target.value;
  if (e.target.value === 'tac-chart') {
    map.setLayoutProperty('tac-chart-layer', 'visibility', 'visible');
    map.setLayoutProperty('heli-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('rnav-33-layer', 'visibility', 'none');
    map.setLayoutProperty('ils-01-layer', 'visibility', 'none');
  }
  if (e.target.value === 'heli-chart') {
    map.setLayoutProperty('tac-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('heli-chart-layer', 'visibility', 'visible');
    map.setLayoutProperty('rnav-33-layer', 'visibility', 'none');
    map.setLayoutProperty('ils-01-layer', 'visibility', 'none');
  }
  if (e.target.value === 'rnav-33') {
    map.setLayoutProperty('tac-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('heli-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('rnav-33-layer', 'visibility', 'visible');
    map.setLayoutProperty('ils-01-layer', 'visibility', 'none');
  }
  if (e.target.value === 'ils-01') {
    map.setLayoutProperty('tac-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('heli-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('rnav-33-layer', 'visibility', 'none');
    map.setLayoutProperty('ils-01-layer', 'visibility', 'visible');
  }
  if (e.target.value === 'none') {
    map.setLayoutProperty('tac-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('heli-chart-layer', 'visibility', 'none');
    map.setLayoutProperty('rnav-33-layer', 'visibility', 'none');
    map.setLayoutProperty('ils-01-layer', 'visibility', 'none');
  }
});

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
      0,
      1,
      10,
      1,
      12,
      0
    ]
  });

  // Add a raster source for satellite imagery
map.addSource('satellite-source', {
  type: 'raster',
  tiles: [
    `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg?key=${MAPTILER_API_KEY}`
  ],
  tileSize: 256,
});

// Add the satellite layer BELOW the "Road labels" layer
map.addLayer({
  id: 'satellite-layer',
  type: 'raster',
  source: 'satellite-source',
  layout: {
    visibility: 'none' // Start hidden, will be toggled on selection
  },
  paint: {
    'raster-opacity': 1
  }
}, "Road labels"); // <-- This ensures it's inserted below road labels

const basemapSelector = document.getElementById('basemap');
basemapSelector.addEventListener('change', (e) => {
  if (e.target.value === 'satellite') {
    // Show the satellite layer
    map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
  } else if (e.target.value === 'dark') {
    // Hide the satellite layer
    map.setLayoutProperty('satellite-layer', 'visibility', 'none');
  }
});


  function addFlight(id, dataUrl, color, modelUrl, modelScale) {
    map.addSource(id + '-source', { type: 'geojson', data: dataUrl });
    map.on('data', function (e) {
      if (e.sourceId === id + '-source' && e.sourceDataType === 'metadata') {
        // Add the track log.
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
            // Add a CSS class for this flightName to the stylesheet
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
              scale: modelScale
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

            addStlModel(id, modelUrl, color);

            const cameraPosition = document.getElementById('cameraPosition');
            const option = document.createElement('option');
            option.value = id;
            option.innerText = `Follow ${flightName} (experimental)`;
            cameraPosition.appendChild(option);

            // Set initial flight locations
            updateFlightPositions(audioStart);
          });
      }
    });
  }

  // Add your flights.
  addFlight('AE313D', './assets/AE313D-track.geojson', '#ff453a', './assets/UH-60.stl', 1 / 1200);
  addFlight('N709PS', './assets/N709PS-track.geojson', '#0a84ff', './assets/CRJ7.stl', 1 / 300);
  addFlight('N765US', './assets/N765US-track.geojson', '#30d158', './assets/CRJ7.stl', 1 / 300);
  addFlight('N941NN', './assets/N941NN-track.geojson', '#bf5af2', './assets/CRJ7.stl', 1 / 300);

  /*
  const interval = setInterval(() => {
    // Console.log the current camera position, bearing, pitch, and zoom.
    console.log(map.getCenter(), map.getBearing(), map.getPitch(), map.getZoom());
  }, 5000);
  */

  // Add an image to the map

  var coords = [
    [-77.47, 39.271],
    [-76.67, 39.271],
    [-76.67, 38.301],
    [-77.47, 38.301]
  ];


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
    paint: {
      'raster-opacity': 1
    }
  });

  map.setLayoutProperty('tac-chart-layer', 'visibility', 'none');

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
    paint: {
      'raster-opacity': 1
    }
  });

  map.setLayoutProperty('heli-chart-layer', 'visibility', 'none');

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
    paint: {
      'raster-opacity': 1
    }
  });

  map.setLayoutProperty('rnav-33-layer', 'visibility', 'none');

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
    paint: {
      'raster-opacity': 1
    }
  });

  map.setLayoutProperty('ils-01-layer', 'visibility', 'none');

  
});