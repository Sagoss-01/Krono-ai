import React, { useState } from "react";
import { Route, Loader, AlertTriangle, LocateFixed, Clock } from "lucide-react";
import { api } from "./api";

/**
 * Itinéraire complet d'une journée : tous les événements qui ont un lieu, dans l'ordre horaire,
 * reliés en un seul trajet. Le départ est votre position (si activée), sinon votre domicile.
 */

const MODES = [
  { value: "drive", label: "Voiture" },
  { value: "walk", label: "A pied" },
  { value: "bicycle", label: "Velo" },
];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const timeOf = (iso) => (iso ? iso.slice(11, 16) : "");

export default function GeoItineraryPanel({ position, onLocate, onResult, onError }) {
  const [date, setDate] = useState(todayIso());
  const [mode, setMode] = useState("drive");
  const [useMyPosition, setUseMyPosition] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const compute = async (e) => {
    e?.preventDefault();
    setError("");
    setLoading(true);
    try {
      let pos = null;
      if (useMyPosition) {
        pos = position || (await onLocate());
      }
      const res = await api.dayItinerary({
        date, mode,
        lat: pos?.lat, lon: pos?.lon,
      });
      setResult(res);
      onResult?.(res);
      if (res.stops.length === 0 && !res.origin) setError("Aucun événement avec un lieu ce jour-là.");
    } catch (err) {
      setResult(null);
      onResult?.(null);
      const msg = err.message || "Calcul impossible.";
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-outline mb-3 flex items-center gap-1">
        <Route className="w-3.5 h-3.5" /> Itinéraire de la journée
      </h3>

      <form onSubmit={compute} className="space-y-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-3 py-2 text-xs border border-outline-variant/60 rounded-lg outline-none"
        />
        <div className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`flex-1 py-1.5 text-[11px] font-semibold rounded ${mode === m.value ? "bg-blue-600 text-white" : "bg-outline-variant/10 hover:bg-outline-variant/20 text-slate-800"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-outline">
          <input type="checkbox" checked={useMyPosition} onChange={(e) => setUseMyPosition(e.target.checked)} />
          <LocateFixed className="w-3 h-3" /> Partir de ma position actuelle
          {position && <span className="text-[10px] text-emerald-700">(localisée)</span>}
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2"
        >
          {loading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Route className="w-3.5 h-3.5" />}
          Afficher l'itinéraire du jour
        </button>
      </form>

      {error && (
        <div className="mt-2 flex items-start gap-1 text-[11px] text-red-600">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {result && result.stops.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs space-y-1">
            <div className="font-bold text-blue-800">{result.stops.length} arrêt(s) · {result.total_distance_km} km · {Math.round(result.total_duration_min)} min</div>
            {result.origin && <div className="text-blue-700">Départ : {result.origin.label}</div>}
          </div>

          <ol className="space-y-1">
            {result.stops.map((s) => (
              <li key={s.event_id || s.order} className="text-[11px] bg-white border border-outline-variant/30 rounded px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 shrink-0 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">{s.order}</span>
                  <span className="font-semibold truncate flex-1">{s.label}</span>
                  <span className="text-outline flex items-center gap-0.5"><Clock className="w-3 h-3" />{timeOf(s.start)}</span>
                </div>
                {s.address && <div className="text-outline truncate pl-7">{s.address}</div>}
              </li>
            ))}
          </ol>

          {result.legs.length > 0 && (
            <details className="text-[11px] text-outline">
              <summary className="cursor-pointer">Détail des trajets ({result.legs.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {result.legs.map((leg, i) => (
                  <li key={i}>{leg.from} → {leg.to} : {leg.distance_km} km, {Math.round(leg.duration_min)} min</li>
                ))}
              </ul>
            </details>
          )}

          {result.events_without_location > 0 && (
            <p className="text-[10px] text-outline">{result.events_without_location} événement(s) sans lieu ne sont pas sur la carte.</p>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-[10px] text-amber-700 flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
