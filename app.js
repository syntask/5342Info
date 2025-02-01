// Initialize MapLibre GL JS

// On DOM load, initialize the map

document.addEventListener('DOMContentLoaded', function () {
    const MAPTILER_API_KEY = "BkQkq2NwcJAaCLNx663p";

    const map = new maplibregl.Map({
        container: 'map',
        style: 'https://api.maptiler.com/maps/streets-v2/style.json?key=' + MAPTILER_API_KEY,
        center: [-77.05065648172516, 38.88664428814337],
        zoom: 14.5,
        TerrainControl: true
    });

    map.on('load', function () {

        //Geocoder initializer
        const gc = new maplibreglMaptilerGeocoder.GeocodingControl({
            apiKey: MAPTILER_API_KEY,
            maplibregl,
            country: 'us',
            noResultsMessage: 'No results found.',
            placeholder: `Search`,
            zoom: 9.5,
        });

        map.addControl(gc, 'top-right');

        // Add navigation control (zoom buttons)
        map.addControl(new maplibregl.NavigationControl());

        // Add geolocate control
        map.addControl(new maplibregl.GeolocateControl({
            positionOptions: {
                enableHighAccuracy: true
            },
            trackUserLocation: true
        }));

        // TERRAIN 
        map.addSource("terrain", {
            type: "raster-dem",
            url: "https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key=" + MAPTILER_API_KEY
        });

        map.setTerrain({
            source: "terrain",
            exaggeration: 2
        });

        map.addControl(new maplibregl.TerrainControl({
            source: "terrain"
        }));

        // Helper function to create a polygon from a path, so the path can be rendered with the specified thickness
        function pathToPolygon(path) {
            // Convert input path to a LineString GeoJSON feature
            const line = turf.lineString(path);
        
            // Buffer the line by 0.5 miles (approximately 805 meters)
            const buffered = turf.buffer(line, 0.5, { units: 'miles' });
            console.log(buffered);
            // Return the resulting GeoJSON polygon
            return buffered
        }

        const polygon = pathToPolygon([
            [
                -77.05065648172516,
                38.88664428814337
              ],
              [
                -77.0404415890932,
                38.879167425933645
              ],
              [
                -77.03327591814208,
                38.87406371899874
              ],
              [
                -77.02870208562047,
                38.86848482938123
              ],
              [
                -77.02443317526638,
                38.860649904813556
              ],
              [
                -77.02214625900518,
                38.85518868923202
              ],
              [
                -77.02168887575309,
                38.852339192876684
              ],
              [
                -77.02153641466933,
                38.849608318412606
              ],
              [
                -77.02199379792143,
                38.845214952547394
              ],
              [
                -77.02412825309804,
                38.83725870768302
              ],
              [
                -77.02687255261134,
                38.82775754857954
              ],
              [
                -77.02793978020009,
                38.81920542107591
              ],
              [
                -77.02656763044301,
                38.81219666197873
              ],
              [
                -77.02550040285509,
                38.80245452936583
              ]
        ]);

        // Create a polygon and extrude it to 3D

        map.addSource('polygon', {
            'type': 'geojson',
            'data': polygon
        });

        map.addLayer({
            'id': 'polygon',
            'type': 'fill-extrusion',
            'source': 'polygon',
            'paint': {
                'fill-extrusion-color': '#0092ff',
                'fill-extrusion-height': 200,
                'fill-extrusion-base': 0,
                'fill-extrusion-opacity': 0.6
            }
        });

        // Add a three.js model to the map. 
    const modelOrigin = [-77.05065648172516, 38.88664428814337];
    const modelAltitude = 0;
    const modelRotate = [Math.PI / 2, 0, 0];

    const modelAsMercatorCoordinate = maplibregl.MercatorCoordinate.fromLngLat(
        modelOrigin,
        modelAltitude
    );

    // transformation parameters to position, rotate and scale the 3D model onto the map
    const modelTransform = {
        translateX: modelAsMercatorCoordinate.x,
        translateY: modelAsMercatorCoordinate.y,
        translateZ: modelAsMercatorCoordinate.z,
        rotateX: modelRotate[0],
        rotateY: modelRotate[1],
        rotateZ: modelRotate[2],
        /* Since our 3D model is in real world meters, a scale transform needs to be
        * applied since the CustomLayerInterface expects units in MercatorCoordinates.
        */
        scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits()
    };


    // configuration of the custom layer for a 3D model per the CustomLayerInterface
    const customLayer = {
        id: '3d-model',
        type: 'custom',
        renderingMode: '3d',
        onAdd (map, gl) {
            this.camera = new THREE.Camera();
            this.scene = new THREE.Scene();

            // create two three.js lights to illuminate the model
            const directionalLight = new THREE.DirectionalLight(0xffffff);
            directionalLight.position.set(0, -70, 100).normalize();
            this.scene.add(directionalLight);

            const directionalLight2 = new THREE.DirectionalLight(0xffffff);
            directionalLight2.position.set(0, 70, 100).normalize();
            this.scene.add(directionalLight2);

            // use the three.js GLTF loader to add the 3D model to the three.js scene
            const loader = new GLTFLoader();
            loader.load(
                'https://maplibre.org/maplibre-gl-js/docs/assets/34M_17/34M_17.gltf',
                (gltf) => {
                    this.scene.add(gltf.scene);
                }
            );
            this.map = map;

            // use the MapLibre GL JS map canvas for three.js
            this.renderer = new THREE.WebGLRenderer({
                canvas: map.getCanvas(),
                context: gl,
                antialias: true
            });

            this.renderer.autoClear = false;
        },
        render (gl, args) {
            const rotationX = new THREE.Matrix4().makeRotationAxis(
                new THREE.Vector3(1, 0, 0),
                modelTransform.rotateX
            );
            const rotationY = new THREE.Matrix4().makeRotationAxis(
                new THREE.Vector3(0, 1, 0),
                modelTransform.rotateY
            );
            const rotationZ = new THREE.Matrix4().makeRotationAxis(
                new THREE.Vector3(0, 0, 1),
                modelTransform.rotateZ
            );

            const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
            const l = new THREE.Matrix4()
                .makeTranslation(
                    modelTransform.translateX,
                    modelTransform.translateY,
                    modelTransform.translateZ
                )
                .scale(
                    new THREE.Vector3(
                        modelTransform.scale,
                        -modelTransform.scale,
                        modelTransform.scale
                    )
                )
                .multiply(rotationX)
                .multiply(rotationY)
                .multiply(rotationZ);

            // Alternatively, you can use this API to get the correct model matrix.
            // It will work regardless of current projection.
            // Also see the example "globe-3d-model.html".
            //
            // const modelMatrix = args.getMatrixForModel(modelOrigin, modelAltitude);
            // const m = new THREE.Matrix4().fromArray(matrix);
            // const l = new THREE.Matrix4().fromArray(modelMatrix);

            this.camera.projectionMatrix = m.multiply(l);
            this.renderer.resetState();
            this.renderer.render(this.scene, this.camera);
            this.map.triggerRepaint();
        }
    };

    map.on('style.load', () => {
        map.addLayer(customLayer);
    });

        
    });

});