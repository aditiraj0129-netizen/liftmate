"use client";

import { usePathname } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { BottomNav } from "@/components/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullScreen = pathname.startsWith("/coach") || pathname.startsWith("/onboarding");
  return (
    <AuthGate>
      <main className={fullScreen ? "" : "mx-auto max-w-xl px-5 pb-28"}>{children}</main>
      {!fullScreen && <BottomNav />}
    </AuthGate>
  );
}
