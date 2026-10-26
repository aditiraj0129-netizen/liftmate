"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ErrorNote, GhostButton, inputClass } from "./ui";

type Place = { osm_id: string; name: string; address: string; lat: number; lng: number };

/** Search a gym on OpenStreetMap (free) and save it to the profile. */
export function GymPicker({ current, onSaved }: { current?: string | null; onSaved: (name: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const found = await api<Place[]>(`/gyms/search?q=${encodeURIComponent(query)}`);
      setResults(found);
      if (!found.length) setError("No match on the map. Try 'gym name + area + city', or add it with your location.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function choose(place: Place) {
    setBusy(true);
    try {
      await api("/gyms", { body: place });
      setResults([]);
      onSaved(place.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addHere() {
    if (!query.trim()) {
      setError("Type your gym's name first.");
      return;
    }
    setManual(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setManual(false);
        choose({ osm_id: "", name: query.trim(), address: "Added by a member", lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setManual(false);
        setError("Location permission is needed to add a new gym. You can still search the map.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {current && <p className="text-sm text-soft">Current gym: <span className="font-semibold text-ink">{current}</span></p>}
      <form onSubmit={search} className="flex gap-2">
        <label className="sr-only" htmlFor="gym-q">Gym name and area</label>
        <input id="gym-q" className={inputClass} placeholder="e.g. Gold's Gym Vijay Nagar Indore" value={query} onChange={(e) => setQuery(e.target.value)} />
        <GhostButton type="submit" disabled={busy || query.trim().length < 3} className="shrink-0">Search</GhostButton>
      </form>
      <ErrorNote message={error} />
      {results.map((place) => (
        <button
          key={place.osm_id + place.address}
          type="button"
          onClick={() => choose(place)}
          className="rounded-2xl border border-line bg-surface p-3 text-left hover:border-lime"
        >
          <div className="font-semibold">{place.name}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted">{place.address}</div>
        </button>
      ))}
      <button type="button" onClick={addHere} disabled={manual || busy} className="self-start text-sm text-lime underline-offset-4 hover:underline">
        {manual ? "Getting your location..." : "Not listed? Add it at my current location"}
      </button>
    </div>
  );
}
