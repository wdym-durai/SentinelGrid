/**
 * MapView — renders a Leaflet map with a pin at the incident's coordinates.
 *
 * Uses react-leaflet (a real open-source mapping library).
 * No API key required.
 *
 * IMPORTANT: Leaflet requires its CSS to be loaded in index.html (already done).
 */

import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// Fix a known Leaflet + bundler issue where marker icons don't load correctly.
// This replaces the default icon with one that works in Vite/webpack builds.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

export default function MapView({ location }) {
  if (!location?.lat || !location?.lng) {
    return (
      <div className="map-container flex items-center justify-center bg-sg-panel border border-sg-border text-gray-500 text-sm">
        No location data available
      </div>
    );
  }

  const position = [location.lat, location.lng];

  return (
    <MapContainer
      center={position}
      zoom={15}
      className="map-container"
      // Prevent the map from re-rendering on every parent update
      key={`${location.lat}-${location.lng}`}
    >
      {/* OpenStreetMap tiles — free, no API key needed */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={position}>
        <Popup>
          <strong>{location.label || 'Incident Location'}</strong>
          <br />
          {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
        </Popup>
      </Marker>
    </MapContainer>
  );
}
