/**
 * GeoMapTab.jsx
 * -------------
 * Onglet Carte interactive Leaflet + Geoapify.
 * Fonctionnalites :
 *   - Geocodage (recherche par nom de lieu) et autocomplete
 *   - Recherche de lieux par categorie, calcul d'itineraire entre deux points
 *   - Lieux fréquentés (Domicile, Bureau, École, QG...) placés sur la carte, par coordonnées ou par adresse
 *   - Itinéraire complet de la journée (tous les événements avec lieu), depuis la position de l'utilisateur
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./api";
import GeoPlacesPanel from "./GeoPlacesPanel";
import GeoItineraryPanel from "./GeoItineraryPanel";
import { MapPin, Search, Navigation, Loader, AlertTriangle, LocateFixed } from "lucide-react";

// Fix icones Leaflet par defaut (probleme webpack/vite)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1/dist/images/marker-shadow.png",
});

// Icone rouge pour destination
const destIcon = new L.Icon({
  iconUrl:       "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  shadowUrl:     "https://unpkg.com/leaflet@1/dist/images/marker-shadow.png",
  iconSize:      [25, 41],
  iconAnchor:    [12, 41],
  popupAnchor:   [1, -34],
  shadowSize:    [41, 41],
});

// Icone verte pour lieux secondaires
const placeIcon = new L.Icon({
  iconUrl:       "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl:     "https://unpkg.com/leaflet@1/dist/images/marker-shadow.png",
  iconSize:      [25, 41],
  iconAnchor:    [12, 41],
  popupAnchor:   [1, -34],
  shadowSize:    [41, 41],
});

// Pastille lettrée ou numérotée (lieux fréquents, arrêts de l'itinéraire)
const badgeIcon = (text, background) => L.divIcon({
  className: "",
  html: `<div style="width:26px;height:26px;border-radius:50%;background:${background};color:#fff;font:700 12px/26px sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${text}</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -13],
});

const KIND_BADGE = { home: "D", office: "B", school: "É", hq: "Q", other: "L" };
const userIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Composant interne pour recentrer la carte
function FlyToPoint({ lat, lon, zoom = 14 }) {
  const map = useMap();
  useEffect(() => {
    if (lat && lon) map.flyTo([lat, lon], zoom, { duration: 1.2 });
  }, [lat, lon, zoom, map]);
  return null;
}

// Cadre la carte sur un tracé
function FitToPath({ positions }) {
  const map = useMap();
  useEffect(() => {
    if (positions && positions.length > 1) {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] });
    }
  }, [positions, map]);
  return null;
}

// Capte les clics sur la carte quand on choisit un lieu fréquent
function MapPicker({ active, onPick }) {
  useMapEvents({
    click(e) {
      if (active) onPick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
}

const CATEGORIES = [
  { value: "healthcare.hospital",     label: "Hopitaux" },
  { value: "healthcare.pharmacy",     label: "Pharmacies" },
  { value: "education.university",    label: "Universites" },
  { value: "education.school",        label: "Ecoles" },
  { value: "catering.restaurant",     label: "Restaurants" },
  { value: "catering.cafe",           label: "Cafes" },
  { value: "commercial.supermarket",  label: "Supermarchés" },
  { value: "service.financial.bank",  label: "Banques" },
  { value: "accommodation.hotel",     label: "Hotels" },
  { value: "sport",                   label: "Sport" },
  { value: "public_transport",        label: "Transport public" },
];

const MODES = [
  { value: "drive",   label: "Voiture" },
  { value: "walk",    label: "A pied" },
  { value: "bicycle", label: "Velo" },
];

// Tile URL Geoapify
const TILES_KEY = "8f08bdc2ee6c489e9fe0c093c4911af9";
const TILE_URL  = `https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${TILES_KEY}`;
const ATTRIBUTION = `&copy; <a href="https://www.geoapify.com">Geoapify</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>`;

export default function GeoMapTab({ token }) {
  // Recherche principale
  const [searchQuery, setSearchQuery]     = useState("");
  const [suggestions, setSuggestions]     = useState([]);
  const [showSuggest, setShowSuggest]     = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const suggestTimer = useRef(null);

  // Point principal geocode
  const [mainPoint, setMainPoint] = useState(null); // { lat, lon, formatted }

  // Recherche de lieux
  const [category, setCategory]         = useState("healthcare.hospital");
  const [placesRadius, setPlacesRadius] = useState(2000);
  const [places, setPlaces]             = useState([]);
  const [placesLoading, setPlacesLoading] = useState(false);
  const [placesError, setPlacesError]   = useState("");

  // Itineraire entre deux points
  const [destQuery, setDestQuery]       = useState("");
  const [destPoint, setDestPoint]       = useState(null);
  const [routeMode, setRouteMode]       = useState("drive");
  const [routeResult, setRouteResult]   = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError]     = useState("");
  const [routeCoords, setRouteCoords]   = useState([]); // [[lat, lon], ...]

  // Lieux fréquentés
  const [savedPlaces, setSavedPlaces]   = useState([]);
  const [pickMode, setPickMode]         = useState(false);
  const [pickedPoint, setPickedPoint]   = useState(null);
  const [focus, setFocus]               = useState(null);   // { lat, lon } vers lequel recentrer

  // Position de l'utilisateur et itinéraire de la journée
  const [userPos, setUserPos]           = useState(null);   // { lat, lon }
  const [locating, setLocating]         = useState(false);
  const [dayRoute, setDayRoute]         = useState(null);   // résultat de /geo/day-itinerary
  const [mapNotice, setMapNotice]       = useState("");

  const loadSavedPlaces = useCallback(async () => {
    try {
      const res = await api.frequentPlacesList();
      setSavedPlaces(res.places || []);
    } catch (err) {
      setMapNotice(err.message);
    }
  }, []);

  useEffect(() => { loadSavedPlaces(); }, [loadSavedPlaces, token]);

  // Position : demandée au navigateur, renvoyée pour l'appelant
  const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("La géolocalisation n'est pas disponible sur cet appareil."));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUserPos(p);
        setLocating(false);
        resolve(p);
      },
      () => {
        setLocating(false);
        reject(new Error("Position refusée ou indisponible. Autorisez la localisation ou décochez « Partir de ma position »."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  const handleLocateClick = async () => {
    try {
      const p = await locate();
      setFocus(p);
    } catch (err) {
      setMapNotice(err.message);
    }
  };

  // --- Autocompletion ---
  const handleSearchInput = (val) => {
    setSearchQuery(val);
    clearTimeout(suggestTimer.current);
    if (val.length < 2) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await api.autocomplete(val, 6);
        setSuggestions(res.suggestions || []);
        setShowSuggest(true);
      } catch (_) { setSuggestions([]); }
    }, 300);
  };

  const selectSuggestion = (s) => {
    setSearchQuery(s.label);
    setMainPoint({ lat: s.lat, lon: s.lon, formatted: s.label });
    setSuggestions([]);
    setShowSuggest(false);
    setPlaces([]);
    setRouteResult(null);
    setRouteCoords([]);
  };

  // --- Geocodage par touche Entree ---
  const handleGeocode = async (e) => {
    e && e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSuggestions([]);
    setShowSuggest(false);
    try {
      const res = await api.geocode(searchQuery);
      setMainPoint(res);
      setPlaces([]);
      setRouteResult(null);
      setRouteCoords([]);
    } catch (err) {
      setMapNotice("Lieu introuvable : " + err.message);
    } finally {
      setSearchLoading(false);
    }
  };

  // --- Recherche de lieux autour du point principal ---
  const handleSearchPlaces = async () => {
    if (!mainPoint) { setPlacesError("Geocodez d abord un lieu."); return; }
    setPlacesError("");
    setPlacesLoading(true);
    try {
      const res = await api.searchPlaces(mainPoint.lat, mainPoint.lon, category, placesRadius);
      setPlaces(res.places || []);
      if ((res.places || []).length === 0) setPlacesError("Aucun lieu trouve dans ce rayon.");
    } catch (err) {
      setPlacesError(err.message);
    } finally {
      setPlacesLoading(false);
    }
  };

  // --- Calcul d itineraire entre deux points ---
  const handleRoute = async (e) => {
    e && e.preventDefault();
    if (!mainPoint) { setRouteError("Geocodez d abord un point de depart."); return; }
    if (!destQuery.trim()) { setRouteError("Entrez une destination."); return; }
    setRouteError("");
    setRouteLoading(true);
    setRouteResult(null);
    setRouteCoords([]);
    try {
      const dest = await api.geocode(destQuery);
      setDestPoint(dest);
      const route = await api.calculateRoute(
        mainPoint.lat, mainPoint.lon, dest.lat, dest.lon, routeMode
      );
      setRouteResult(route);
      // Convertir [lon, lat] -> [lat, lon] pour Leaflet
      const coords = (route.geojson_coords || []).map(([lon, lat]) => [lat, lon]);
      setRouteCoords(coords);
    } catch (err) {
      setRouteError(err.message);
    } finally {
      setRouteLoading(false);
    }
  };

  const handlePick = (point) => {
    setPickedPoint(point);
    setPickMode(false);
  };

  const handleDayResult = (res) => {
    setDayRoute(res);
  };

  const dayPath = dayRoute?.geometry?.length > 1 ? dayRoute.geometry : null;
  const CENTER = mainPoint ? [mainPoint.lat, mainPoint.lon] : [6.1375, 1.2123]; // Lome par defaut

  return (
    <div className="h-full flex flex-col md:flex-row gap-0 overflow-hidden">

      {/* PANNEAU GAUCHE : controles */}
      <div className="w-full md:w-80 shrink-0 bg-white text-slate-800 border-r border-outline-variant/30 flex flex-col overflow-y-auto">

        {/* === Recherche principale avec autocomplete === */}
        <div className="p-4 border-b border-outline-variant/20">
          <h3 className="text-xs font-bold uppercase tracking-wider text-outline mb-3 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> Geocodage
          </h3>
          <form onSubmit={handleGeocode} className="relative">
            <div className="flex gap-2">
              <input
                id="geo-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
                placeholder="Ex : Universite de Lome"
                className="flex-1 px-3 py-2 text-sm border border-outline-variant/60 rounded-lg focus:border-blue-500 outline-none"
              />
              <button
                type="submit"
                disabled={searchLoading}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 text-sm transition-all active:scale-95"
              >
                {searchLoading
                  ? <Loader className="w-4 h-4 animate-spin" />
                  : <Search className="w-4 h-4" />}
              </button>
            </div>

            {/* Dropdown suggestions */}
            {showSuggest && suggestions.length > 0 && (
              <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-outline-variant/40 rounded-lg shadow-lg overflow-hidden">
                {suggestions.map((s, i) => (
                  <li
                    key={i}
                    onClick={() => selectSuggestion(s)}
                    className="px-3 py-2 text-xs hover:bg-blue-50 cursor-pointer border-b border-outline-variant/10 last:border-none truncate"
                  >
                    {s.label}
                  </li>
                ))}
              </ul>
            )}
          </form>

          {mainPoint && (
            <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
              <span className="font-semibold">Localise :</span> {mainPoint.formatted}<br />
              <span className="text-blue-500">{mainPoint.lat.toFixed(5)}, {mainPoint.lon.toFixed(5)}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleLocateClick}
            disabled={locating}
            className="mt-2 w-full py-2 bg-outline-variant/10 hover:bg-outline-variant/20 text-slate-800 text-xs font-semibold rounded-lg flex items-center justify-center gap-2"
          >
            {locating ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <LocateFixed className="w-3.5 h-3.5" />}
            {userPos ? "Actualiser ma position" : "Me localiser"}
          </button>
          {mapNotice && <p className="mt-2 text-[11px] text-red-600">{mapNotice}</p>}
        </div>

        {/* === Lieux fréquentés === */}
        <GeoPlacesPanel
          places={savedPlaces}
          onChange={loadSavedPlaces}
          onError={setMapNotice}
          pickedPoint={pickedPoint}
          pickMode={pickMode}
          onTogglePick={() => setPickMode((v) => !v)}
          onFocus={(p) => setFocus({ lat: p.latitude, lon: p.longitude })}
        />

        {/* === Itinéraire de la journée === */}
        <GeoItineraryPanel
          position={userPos}
          onLocate={locate}
          onResult={handleDayResult}
          onError={setMapNotice}
        />

        {/* === Recherche de lieux === */}
        <div className="p-4 border-b border-outline-variant/20">
          <h3 className="text-xs font-bold uppercase tracking-wider text-outline mb-3">
            Lieux a proximite
          </h3>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full mb-2 px-3 py-2 text-xs border border-outline-variant/60 rounded-lg outline-none"
          >
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 mb-2">
            <label className="text-[10px] text-outline whitespace-nowrap">Rayon :</label>
            <input
              type="range" min={500} max={10000} step={500}
              value={placesRadius}
              onChange={(e) => setPlacesRadius(Number(e.target.value))}
              className="flex-1 accent-blue-600"
            />
            <span className="text-[10px] font-bold text-blue-600 whitespace-nowrap">{(placesRadius/1000).toFixed(1)} km</span>
          </div>
          <button
            onClick={handleSearchPlaces}
            disabled={placesLoading || !mainPoint}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {placesLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : null}
            Rechercher
          </button>
          {placesError && <p className="mt-1 text-[10px] text-red-500">{placesError}</p>}

          {places.length > 0 && (
            <ul className="mt-2 space-y-1 max-h-36 overflow-y-auto">
              {places.map((p, i) => (
                <li key={i} className="text-[11px] bg-emerald-50 border border-emerald-100 rounded px-2 py-1 truncate">
                  <span className="font-semibold">{p.name}</span>
                  <br /><span className="text-outline">{p.address}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* === Calcul d itineraire entre deux points === */}
        <div className="p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-outline mb-3 flex items-center gap-1">
            <Navigation className="w-3.5 h-3.5" /> Trajet entre deux points
          </h3>
          <div className="text-[10px] text-outline mb-1">Depart : {mainPoint ? mainPoint.formatted : "— geocodez un lieu d abord"}</div>
          <form onSubmit={handleRoute} className="space-y-2">
            <input
              id="geo-dest-input"
              type="text"
              value={destQuery}
              onChange={(e) => setDestQuery(e.target.value)}
              placeholder="Destination..."
              className="w-full px-3 py-2 text-xs border border-outline-variant/60 rounded-lg focus:border-blue-500 outline-none"
            />
            <div className="flex gap-1">
              {MODES.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setRouteMode(m.value)}
                  className={`flex-1 py-1.5 text-[11px] font-semibold rounded transition-all ${
                    routeMode === m.value
                      ? "bg-blue-600 text-white"
                      : "bg-outline-variant/10 hover:bg-outline-variant/20 text-slate-800"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={routeLoading || !mainPoint}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              {routeLoading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Navigation className="w-3.5 h-3.5" />}
              Calculer le trajet
            </button>
          </form>

          {routeError && (
            <div className="mt-2 flex items-center gap-1 text-[10px] text-red-500">
              <AlertTriangle className="w-3 h-3" /> {routeError}
            </div>
          )}

          {routeResult && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs space-y-1">
              <div className="font-bold text-blue-800">Resultat du trajet</div>
              <div>Distance : <span className="font-semibold">{routeResult.distance_km} km</span></div>
              <div>Duree : <span className="font-semibold">{routeResult.duration_min} min</span></div>
              <div>Mode : <span className="font-semibold capitalize">{routeResult.mode}</span></div>
            </div>
          )}
        </div>
      </div>

      {/* CARTE LEAFLET */}
      <div className="flex-1 relative min-h-[400px]">
        <MapContainer
          center={CENTER}
          zoom={12}
          style={{ height: "100%", width: "100%" }}
          className="z-0"
        >
          <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />

          {/* Recentrage automatique */}
          {mainPoint && <FlyToPoint lat={mainPoint.lat} lon={mainPoint.lon} />}
          {focus && <FlyToPoint lat={focus.lat} lon={focus.lon} zoom={15} />}
          <FitToPath positions={dayPath} />

          {/* Clic sur la carte : placement d'un lieu fréquent */}
          <MapPicker active={pickMode} onPick={handlePick} />

          {/* Position de l'utilisateur */}
          {userPos && (
            <Marker position={[userPos.lat, userPos.lon]} icon={userIcon}>
              <Popup>Vous êtes ici</Popup>
            </Marker>
          )}

          {/* Marqueur principal (depart) */}
          {mainPoint && (
            <Marker position={[mainPoint.lat, mainPoint.lon]}>
              <Popup>{mainPoint.formatted}</Popup>
            </Marker>
          )}

          {/* Marqueur destination */}
          {destPoint && (
            <Marker position={[destPoint.lat, destPoint.lon]} icon={destIcon}>
              <Popup>Destination : {destPoint.formatted}</Popup>
            </Marker>
          )}

          {/* Lieux fréquentés */}
          {savedPlaces.map((p) => (
            <Marker key={p.id} position={[p.latitude, p.longitude]} icon={badgeIcon(KIND_BADGE[p.kind] || "L", "#0f766e")}>
              <Popup><strong>{p.label}</strong><br />{p.address || ""}</Popup>
            </Marker>
          ))}

          {/* Marqueurs des lieux trouves */}
          {places.map((p, i) => (
            <Marker key={i} position={[p.lat, p.lon]} icon={placeIcon}>
              <Popup>
                <strong>{p.name}</strong><br />{p.address}
              </Popup>
            </Marker>
          ))}

          {/* Tracé du trajet entre deux points */}
          {routeCoords.length > 0 && (
            <Polyline
              positions={routeCoords}
              color="#2563eb"
              weight={5}
              opacity={0.8}
            />
          )}

          {/* Itinéraire de la journée : tracé + arrêts numérotés */}
          {dayPath && (
            <Polyline positions={dayPath} color="#7c3aed" weight={5} opacity={0.85} />
          )}
          {dayRoute?.stops?.map((s) => (
            <Marker key={s.event_id || s.order} position={[s.lat, s.lon]} icon={badgeIcon(s.order, "#7c3aed")}>
              <Popup><strong>{s.order}. {s.label}</strong><br />{s.address || ""}</Popup>
            </Marker>
          ))}
          {dayRoute?.origin && (
            <Marker position={[dayRoute.origin.lat, dayRoute.origin.lon]} icon={badgeIcon("P", "#1d4ed8")}>
              <Popup>Départ : {dayRoute.origin.label}</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
