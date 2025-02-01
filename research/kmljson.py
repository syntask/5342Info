# Re-import necessary libraries since execution state was reset
import xml.etree.ElementTree as ET
import pytz
from datetime import datetime
import json
import os

basdir = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))

# Define KML namespace
ns = {"kml": "http://www.opengis.net/kml/2.2", "gx": "http://www.google.com/kml/ext/2.2"}

# Function to reformat the extracted data into LineString-based GeoJSON
def create_linestring_geojson(flight_id, tail_id, aircraft_type, timestamps, coordinates):
    """
    Converts timestamped flight track data into a GeoJSON LineString format.
    """
    if len(timestamps) != len(coordinates):
        return None  # Data mismatch

    # Convert timestamps and coordinates into the correct format
    utc = pytz.UTC
    unix_timestamps = [
        int(datetime.strptime(ts.text, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=utc).timestamp()) 
        for ts in timestamps
    ]
    formatted_coordinates = [list(map(float, coord.text.split())) for coord in coordinates]

    # Construct the new GeoJSON structure with LineString
    geojson_data = {
        "type": "FeatureCollection",
        "properties": {
            "flight": flight_id,
            "tail": tail_id,
            "type": aircraft_type
        },
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "timestamps": unix_timestamps
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": formatted_coordinates
                }
            }
        ]
    }
    return geojson_data

# Process the newly uploaded file in the same LineString format
new_file_info = {
    "kml_path": basdir + "/research/N941NN-track-press_alt_uncorrected.kml",
    "geojson_path": basdir + "/research/N941NN-track.geojson",
    "flight_id": "AAL3130",
    "tail_id": "N765US",
    "aircraft_type": "A330"
}

# Load and parse the KML file
tree = ET.parse(new_file_info["kml_path"])
root = tree.getroot()

# Extract timestamps and coordinates
timestamps = root.findall(".//kml:when", ns)
coordinates = root.findall(".//gx:coord", ns)

# Convert to the new GeoJSON format
geojson_data = create_linestring_geojson(
    new_file_info["flight_id"], new_file_info["tail_id"], new_file_info["aircraft_type"], timestamps, coordinates
)

if geojson_data:
    # Save to file
    with open(new_file_info["geojson_path"], "w") as geojson_file:
        json.dump(geojson_data, geojson_file, indent=4)

    geojson_file_path = new_file_info["geojson_path"]
else:
    geojson_file_path = None

geojson_file_path
