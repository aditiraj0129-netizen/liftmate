"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/components/AuthGate";
import { GymPicker } from "@/components/GymPicker";
import { ProfileForm } from "@/components/ProfileForm";
import { PrimaryButton, SectionLabel } from "@/components/ui";

export default function OnboardingPage() {
  const router = useRouter();
  const { profile, refresh } = useProfile();
  const [step, setStep] = useState<"profile" | "gym">("profile");
  const [gymName, setGymName] = useState<string | null>(profile?.gyms?.name ?? null);

  return (
    <div className="mx-auto max-w-xl px-5 pb-16">
      <div className="pb-4 pt-8">
        <div className="font-display text-4xl font-extrabold text-lime">WELCOME TO LIFTMATE</div>
        <p className="mt-2 text-soft">
          {step === "profile" ? "Tell your coach about you. This makes every plan and diet tip personal." : "Pick your gym to find people who train there and share machine guides."}
        </p>
        <SectionLabel className="mt-4">Step {step === "profile" ? 1 : 2} of 2</SectionLabel>
      </div>

      {step === "profile" ? (
        <ProfileForm initial={profile} submitLabel="Next: choose my gym" onSaved={() => setStep("gym")} />
      ) : (
        <div className="flex flex-col gap-6">
          <GymPicker current={gymName} onSaved={setGymName} />
          <PrimaryButton
            onClick={async () => {
              await refresh();
              router.replace("/");
            }}
          >
            {gymName ? "Start training" : "Skip for now"}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
