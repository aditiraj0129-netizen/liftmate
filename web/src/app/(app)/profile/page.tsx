"use client";

import { useState } from "react";
import { useProfile } from "@/components/AuthGate";
import { GymPicker } from "@/components/GymPicker";
import { ProfileForm } from "@/components/ProfileForm";
import { Card, GhostButton, PageHeader, SectionLabel } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function ProfilePage() {
  const { profile, refresh } = useProfile();
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Profile" subtitle="Your coach uses this to personalise everything" />

      {profile && (
        <Card className="grid grid-cols-4 gap-2 text-center">
          {([["kcal", profile.targets.kcal], ["protein g", profile.targets.protein_g], ["carbs g", profile.targets.carbs_g], ["fat g", profile.targets.fat_g]] as const).map(([label, value]) => (
            <div key={label}><p className="font-display text-2xl font-bold">{value}</p><p className="text-[11px] text-muted">{label}</p></div>
          ))}
          <p className="col-span-4 text-xs text-muted">Daily targets on training days, from your body stats and goal.</p>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>My gym</SectionLabel>
        <GymPicker current={profile?.gyms?.name} onSaved={() => refresh()} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>About me</SectionLabel>
        <ProfileForm initial={profile} submitLabel="Save changes" onSaved={async () => { await refresh(); setSaved(true); setTimeout(() => setSaved(false), 2500); }} />
        {saved && <p role="status" className="text-center text-sm text-lime">Saved</p>}
      </section>

      <GhostButton onClick={() => supabase.auth.signOut()}>Log out</GhostButton>
    </div>
  );
}
