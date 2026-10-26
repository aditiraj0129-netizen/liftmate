"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconDumbbell, IconFood, IconHome, IconPeople, IconUser } from "./icons";

const ITEMS = [
  { href: "/", label: "Home", Icon: IconHome },
  { href: "/exercises", label: "Train", Icon: IconDumbbell },
  { href: "/nutrition", label: "Food", Icon: IconFood },
  { href: "/gym", label: "Gym", Icon: IconPeople },
  { href: "/profile", label: "Profile", Icon: IconUser },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-surface2 bg-[#0f1211]/95 backdrop-blur">
      <div className="mx-auto grid max-w-xl grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[64px] flex-col items-center justify-center gap-1 text-[11px] ${active ? "text-lime" : "text-muted"}`}
            >
              <Icon className="h-[22px] w-[22px]" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
