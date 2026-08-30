"use client";

import { useState } from "react";

type ProjectFrames = {
  slug: string;
  title: string;
  frames: string[];
  hasCustom: boolean;
};

const STORAGE_KEY = "thumbnail-picks";

export default function ThumbnailPicker({ projects }: { projects: ProjectFrames[] }) {
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [copied, setCopied] = useState(false);

  const choose = (slug: string, frame: string) => {
    const next = { ...picks, [slug]: frame };
    setPicks(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const pickedCount = Object.keys(picks).length;

  const copySummary = async () => {
    const lines = Object.entries(picks).map(([slug, frame]) => `${slug}: ${frame}`);
    const text = lines.length > 0 ? lines.join("\n") : "No selections yet.";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div>
      <div className="sticky top-16 z-10 -mx-6 mb-8 flex items-center justify-between gap-4 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <p className="text-sm text-muted">
          {pickedCount} of {projects.length} selected
        </p>
        <button
          onClick={copySummary}
          disabled={pickedCount === 0}
          className="rounded-full bg-coral px-5 py-2 text-sm font-medium text-white transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
        >
          {copied ? "Copied!" : "Copy my selections"}
        </button>
      </div>

      <div className="space-y-10">
        {projects.map((project) => (
          <div key={project.slug} className="border-b border-border pb-8">
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold">{project.title}</h2>
              <span className="text-xs text-muted">({project.slug})</span>
              {project.hasCustom && (
                <span className="rounded-full bg-teal/15 px-2 py-0.5 text-xs font-medium text-teal">
                  has custom thumbnail
                </span>
              )}
              {picks[project.slug] && (
                <span className="rounded-full bg-coral/15 px-2 py-0.5 text-xs font-medium text-coral">
                  selected: {picks[project.slug]}
                </span>
              )}
            </div>

            {project.frames.length === 0 ? (
              <p className="text-sm text-muted">Frames not extracted yet — check back shortly.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {project.frames.map((frame) => (
                  <button
                    key={frame}
                    onClick={() => choose(project.slug, frame)}
                    className={`overflow-hidden rounded-lg border-2 transition-colors ${
                      picks[project.slug] === frame
                        ? "border-coral"
                        : "border-transparent hover:border-border"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/thumbnails/candidates/${project.slug}/${frame}`}
                      alt={`${project.title} candidate frame`}
                      className="h-24 w-40 object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
