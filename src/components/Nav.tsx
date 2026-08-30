"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import AvailabilityBadge from "@/components/AvailabilityBadge";

const links = [
  { href: "/work", label: "Work" },
  { href: "/about", label: "About" },
  { href: "/process", label: "Process" },
  { href: "/services", label: "Services" },
  { href: "/testimonials", label: "Testimonials" },
  { href: "/resume", label: "Resume" },
  { href: "/contact", label: "Contact" },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-display text-xl font-semibold tracking-tight">
          Motion&nbsp;<span className="text-coral">&amp;</span>&nbsp;Line
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium transition-colors hover:text-coral ${
                pathname === link.href ? "text-coral" : "text-foreground/80"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <AvailabilityBadge compact />
        </nav>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border md:hidden"
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <span className="sr-only">Menu</span>
          <div className="flex flex-col gap-1">
            <span className="h-0.5 w-4 bg-foreground" />
            <span className="h-0.5 w-4 bg-foreground" />
          </div>
        </button>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-border px-6 pb-4 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`rounded-lg px-2 py-2 text-sm font-medium ${
                pathname === link.href ? "bg-coral/10 text-coral" : "text-foreground/80"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="px-2 py-2">
            <AvailabilityBadge compact />
          </div>
        </nav>
      )}
    </header>
  );
}
