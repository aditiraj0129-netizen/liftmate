"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useProfile } from "@/components/AuthGate";
import { Card, ErrorNote, GhostButton, inputClass, PageHeader, SectionLabel, Segmented, Spinner } from "@/components/ui";

type Person = { id: string; name: string | null; experience: string | null; goal: string | null; gyms: { name: string } | null; connection: string };
type Link_ = { user_id: string; profile: { id: string; name: string | null; gyms: { name: string } | null } | null };
type Connections = { accepted: Link_[]; incoming: Link_[]; outgoing: Link_[] };

export default function GymPage() {
  const { profile } = useProfile();
  const [scope, setScope] = useState<"gym" | "all">("gym");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [links, setLinks] = useState<Connections | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLinks = useCallback(() => api<Connections>("/connections").then(setLinks).catch((e) => setError(e.message)), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      api<Person[]>(`/people?scope=${scope}&q=${encodeURIComponent(query)}`).then(setPeople).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(timer);
  }, [scope, query, links]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  async function connect(id: string) {
    await api("/connections", { body: { receiver_id: id } });
    loadLinks();
  }
  async function answer(id: string, status: "accepted" | "blocked") {
    await api("/connections", { method: "PATCH", body: { requester_id: id, status } });
    loadLinks();
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Gym" subtitle={profile?.gyms?.name ?? "Find people who train at your gym"} />

      {!profile?.gym_id && (
        <Card className="text-sm text-soft">You haven&apos;t picked a gym yet. <Link href="/profile" className="text-lime">Choose your gym</Link> to see people who train there.</Card>
      )}

      {links && links.incoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Requests for you</SectionLabel>
          {links.incoming.map((l) => (
            <div key={l.user_id} className="flex items-center justify-between gap-2 rounded-2xl bg-surface p-3">
              <span className="font-semibold">{l.profile?.name ?? "Someone"}</span>
              <span className="flex gap-2">
                <button onClick={() => answer(l.user_id, "accepted")} className="min-h-[40px] rounded-xl bg-lime px-3 text-sm font-semibold text-ground">Accept</button>
                <button onClick={() => answer(l.user_id, "blocked")} className="min-h-[40px] rounded-xl border border-line px-3 text-sm text-muted">Decline</button>
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>Find people</SectionLabel>
        <Segmented label="Search scope" value={scope} onChange={setScope} options={[{ value: "gym", label: "My gym" }, { value: "all", label: "All gyms" }]} />
        <label className="sr-only" htmlFor="people-q">Search by name</label>
        <input id="people-q" className={inputClass} placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ErrorNote message={error} />
        {people === null ? <Spinner /> : people.length === 0 ? (
          <p className="text-sm text-muted">{scope === "gym" ? "No one from your gym yet. Invite your gym friends to Liftmate!" : "No one found."}</p>
        ) : people.map((person) => (
          <div key={person.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface p-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{person.name ?? "Lifter"}</p>
              <p className="truncate text-xs capitalize text-muted">{[person.gyms?.name, person.experience, person.goal?.replace("_", " ")].filter(Boolean).join(" · ")}</p>
            </div>
            {person.connection === "accepted" ? <span className="text-xs text-lime">Connected</span>
              : person.connection === "pending_sent" ? <span className="text-xs text-muted">Requested</span>
              : person.connection === "pending_received" ? <button onClick={() => answer(person.id, "accepted")} className="min-h-[40px] rounded-xl bg-lime px-3 text-sm font-semibold text-ground">Accept</button>
              : <GhostButton onClick={() => connect(person.id)} className="!min-h-[40px] shrink-0 text-sm">Connect</GhostButton>}
          </div>
        ))}
      </section>

      {links && links.accepted.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Your connections ({links.accepted.length})</SectionLabel>
          {links.accepted.map((l) => (
            <div key={l.user_id} className="rounded-2xl border border-line p-3">
              <p className="font-semibold">{l.profile?.name ?? "Lifter"}</p>
              <p className="text-xs text-muted">{l.profile?.gyms?.name}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
