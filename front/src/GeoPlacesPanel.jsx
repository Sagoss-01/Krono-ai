import React, { useEffect, useState } from "react";
import { Home, Briefcase, GraduationCap, Flag, MapPin, Trash2, Pencil, Crosshair } from "lucide-react";
import { api } from "./api";

/**
 * Lieux fréquentés : Domicile, Bureau, École, QG ou lieu libre.
 * Un lieu se place de trois façons : clic sur la carte, coordonnées saisies, ou adresse (géocodée).
 */

export const KIND_PRESETS = [
  { kind: "home", label: "Domicile", Icon: Home },
  { kind: "office", label: "Bureau", Icon: Briefcase },
  { kind: "school", label: "École", Icon: GraduationCap },
  { kind: "hq", label: "QG", Icon: Flag },
  { kind: "other", label: "Autre", Icon: MapPin },
];

const EMPTY = { label: "", kind: "home", method: "map", lat: "", lon: "", address: "" };

export default function GeoPlacesPanel({ places, onChange, pickedPoint, pickMode, onTogglePick, onFocus, onError }) {
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Un point choisi sur la carte remplit les coordonnées du formulaire
  useEffect(() => {
    if (pickedPoint) {
      setForm((f) => ({ ...f, lat: pickedPoint.lat.toFixed(6), lon: pickedPoint.lon.toFixed(6), method: "map" }));
    }
  }, [pickedPoint]);

  const reset = () => { setForm(EMPTY); setEditingId(null); setMessage(""); };

  const startEdit = (p) => {
    setEditingId(p.id);
    setForm({ label: p.label, kind: p.kind, method: "coords", lat: String(p.latitude), lon: String(p.longitude), address: p.address || "" });
    onFocus?.(p);
  };

  const submit = async (e) => {
    e.preventDefault();
    setMessage("");
    const payload = { label: form.label.trim(), kind: form.kind };
    if (form.method === "address") {
      if (!form.address.trim()) return setMessage("Saisissez une adresse.");
      payload.address = form.address.trim();
    } else {
      const lat = Number(form.lat), lon = Number(form.lon);
      if (form.lat === "" || form.lon === "" || Number.isNaN(lat) || Number.isNaN(lon)) {
        return setMessage("Coordonnées incomplètes : placez le lieu sur la carte ou saisissez latitude et longitude.");
      }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return setMessage("Latitude entre -90 et 90, longitude entre -180 et 180.");
      payload.latitude = lat;
      payload.longitude = lon;
    }
    setBusy(true);
    try {
      if (editingId) await api.updateFrequentPlace(editingId, payload);
      else await api.createFrequentPlace(payload);
      reset();
      onChange?.();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Supprimer le lieu « ${p.label} » ?`)) return;
    try {
      await api.deleteFrequentPlace(p.id);
      onChange?.();
    } catch (err) {
      onError?.(err.message);
    }
  };

  const presetFor = (kind) => KIND_PRESETS.find((k) => k.kind === kind) || KIND_PRESETS[4];

  return (
    <div className="p-4 border-b border-outline-variant/20">
      <h3 className="text-xs font-bold uppercase tracking-wider text-outline mb-3 flex items-center gap-1">
        <MapPin className="w-3.5 h-3.5" /> Lieux fréquentés
      </h3>

      {places.length === 0 && <p className="text-[11px] text-outline mb-2">Aucun lieu enregistré.</p>}
      <ul className="space-y-1 mb-3">
        {places.map((p) => {
          const { Icon } = presetFor(p.kind);
          return (
            <li key={p.id} className="flex items-center gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
              <Icon className="w-3.5 h-3.5 text-blue-700 shrink-0" />
              <button type="button" onClick={() => onFocus?.(p)} className="flex-1 min-w-0 text-left">
                <span className="font-semibold block truncate">{p.label}</span>
                <span className="text-outline block truncate">{p.address || `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}</span>
              </button>
              <button type="button" onClick={() => startEdit(p)} className="p-1 text-outline hover:text-blue-700" title="Modifier"><Pencil className="w-3 h-3" /></button>
              <button type="button" onClick={() => remove(p)} className="p-1 text-outline hover:text-red-600" title="Supprimer"><Trash2 className="w-3 h-3" /></button>
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {KIND_PRESETS.map(({ kind, label, Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => setForm((f) => ({ ...f, kind, label: f.label || (kind === "other" ? "" : label) }))}
              className={`px-2 py-1 text-[10px] font-semibold rounded flex items-center gap-1 ${form.kind === kind ? "bg-blue-600 text-white" : "bg-outline-variant/10 text-slate-800 hover:bg-outline-variant/20"}`}
            >
              <Icon className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>

        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Nom du lieu (ex. Bureau, QG Lomé)"
          maxLength={80}
          className="w-full px-3 py-2 text-xs border border-outline-variant/60 rounded-lg outline-none focus:border-blue-500"
        />

        <div className="flex gap-1 text-[10px]">
          {[["map", "Sur la carte"], ["coords", "Coordonnées"], ["address", "Adresse"]].map(([m, l]) => (
            <button
              key={m}
              type="button"
              onClick={() => setForm({ ...form, method: m })}
              className={`flex-1 py-1 rounded font-semibold ${form.method === m ? "bg-blue-100 text-blue-800" : "bg-outline-variant/10 text-outline"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {form.method === "map" && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={onTogglePick}
              className={`w-full py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 ${pickMode ? "bg-amber-500 text-white" : "bg-outline-variant/10 hover:bg-outline-variant/20 text-slate-800"}`}
            >
              <Crosshair className="w-3.5 h-3.5" /> {pickMode ? "Cliquez sur la carte…" : "Choisir sur la carte"}
            </button>
            {form.lat && form.lon && (
              <p className="text-[10px] text-outline">Position : {form.lat}, {form.lon}</p>
            )}
          </div>
        )}

        {form.method === "coords" && (
          <div className="grid grid-cols-2 gap-2">
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="Latitude (6.13)" className="px-3 py-2 text-xs border border-outline-variant/60 rounded-lg outline-none" />
            <input value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} placeholder="Longitude (1.21)" className="px-3 py-2 text-xs border border-outline-variant/60 rounded-lg outline-none" />
          </div>
        )}

        {form.method === "address" && (
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Adresse complète"
            className="w-full px-3 py-2 text-xs border border-outline-variant/60 rounded-lg outline-none"
          />
        )}

        {message && <p className="text-[10px] text-red-600">{message}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">
            {editingId ? "Enregistrer" : "Ajouter le lieu"}
          </button>
          {(editingId || form.label || form.lat || form.address) && (
            <button type="button" onClick={reset} className="px-3 py-2 text-xs text-outline border border-outline-variant/40 rounded-lg">Annuler</button>
          )}
        </div>
      </form>
    </div>
  );
}
