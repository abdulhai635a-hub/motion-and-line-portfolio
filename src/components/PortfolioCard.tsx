"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { Project } from "@/lib/data";
import { categoryLabels } from "@/lib/data";
import Thumbnail from "@/components/Thumbnail";

const accentClasses: Record<Project["accent"], string> = {
  coral: "from-coral/70 to-coral/30",
  teal: "from-teal/70 to-teal/30",
  yellow: "from-yellow/70 to-yellow/30",
};

const stickmanIcon = (
  <motion.svg
    width="56"
    height="56"
    viewBox="0 0 56 56"
    fill="none"
    className="drop-shadow-sm"
    initial={{ y: 0, rotate: 0 }}
    whileHover={{ y: [-2, -10, -2], rotate: [0, -6, 6, 0] }}
    transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
  >
    <circle cx="28" cy="14" r="9" stroke="#1a1a1a" strokeWidth={4} fill="white" />
    <line x1="28" y1="23" x2="28" y2="42" stroke="#1a1a1a" strokeWidth={4} strokeLinecap="round" />
    <line x1="28" y1="42" x2="18" y2="54" stroke="#1a1a1a" strokeWidth={4} strokeLinecap="round" />
    <line x1="28" y1="42" x2="38" y2="54" stroke="#1a1a1a" strokeWidth={4} strokeLinecap="round" />
    <line x1="28" y1="28" x2="16" y2="24" stroke="#1a1a1a" strokeWidth={4} strokeLinecap="round" />
    <line x1="28" y1="28" x2="40" y2="24" stroke="#1a1a1a" strokeWidth={4} strokeLinecap="round" />
  </motion.svg>
);

export default function PortfolioCard({ project }: { project: Project }) {
  return (
    <Link href={`/work/${project.slug}`} className="group block">
      <motion.div
        className="overflow-hidden rounded-2xl border border-border bg-surface"
        whileHover={{ y: -6 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <div
          className={`relative flex h-44 items-center justify-center overflow-hidden bg-gradient-to-br ${accentClasses[project.accent]}`}
        >
          <Thumbnail
            slug={project.slug}
            driveId={project.driveId}
            className="h-full w-full object-cover"
            fallback={stickmanIcon}
          />

          <span className="absolute left-3 top-3 rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-foreground">
            {categoryLabels[project.category]}
          </span>
        </div>

        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">{project.title}</h3>
            {project.year && <span className="text-xs text-muted">{project.year}</span>}
          </div>
          {project.client && <p className="mt-1 text-sm text-muted">{project.client}</p>}
          {project.summary && (
            <p className="mt-3 text-sm leading-relaxed text-foreground/80">{project.summary}</p>
          )}
          <span className="mt-4 inline-block text-sm font-medium text-coral opacity-0 transition-opacity group-hover:opacity-100">
            Watch →
          </span>
        </div>
      </motion.div>
    </Link>
  );
}
