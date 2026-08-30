"use client";

import { useEffect, useRef, useState } from "react";

type ProjectFrames = {
  slug: string;
  title: string;
  frames: string[];
  hasCustom: boolean;
};

const STORAGE_KEY = "thumbnail-picks";

export default function ThumbnailPicker({ projects }: { projects: ProjectFrames[] }) {
  // Starts empty to match the server-rendered HTML exactly, then loads the
  // real picks from localStorage after mount — reading localStorage during
  // the initial render would mismatch SSR output and break hydration.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with localStorage, a client-only external store, is only possible after mount
      if (saved) setPicks(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

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
  const summaryText = Object.entries(picks)
    .map(([slug, frame]) => `${slug}: ${frame}`)
    .join("\n");

  const copySummary = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(summaryText);
        setCopyStatus("copied");
        setTimeout(() => setCopyStatus("idle"), 2500);
        return;
      }
      throw new Error("Clipboard API unavailable");
    } catch {
      // Fallback: select the visible textarea text so the user can copy manually (Ctrl/Cmd+C).
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus("idle"), 4000);
    }
  };

  return (
    <div>
      <div className="sticky top-16 z-10 -mx-6 mb-8 flex flex-col gap-3 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted">
            {pickedCount} of {projects.length} selected
          </p>
          <button
            onClick={copySummary}
            disabled={pickedCount === 0}
            className="rounded-full bg-coral px-5 py-2 text-sm font-medium text-white transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
          >
            {copyStatus === "copied"
              ? "Copied!"
              : copyStatus === "failed"
                ? "Couldn't auto-copy — text selected below"
                : "Copy my selections"}
          </button>
        </div>

        {pickedCount > 0 && (
          <div>
            <p className="text-xs text-muted">
              If the button doesn&apos;t copy for you, click inside this box, select all
              (Ctrl/Cmd+A), and copy (Ctrl/Cmd+C) manually:
            </p>
            <textarea
              ref={textareaRef}
              readOnly
              value={summaryText}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs"
            />
          </div>
        )}
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
