"use client";

import { useState } from "react";

export default function DriveVideo({ driveId, title }: { driveId: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  const thumbnail = `https://drive.google.com/thumbnail?id=${driveId}&sz=w800`;

  if (playing) {
    return (
      <div className="aspect-video w-full overflow-hidden rounded-2xl border border-border bg-foreground">
        <iframe
          src={`https://drive.google.com/file/d/${driveId}/preview`}
          className="h-full w-full"
          allow="autoplay; fullscreen"
          allowFullScreen
          title={title}
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => setPlaying(true)}
      className="group relative block aspect-video w-full overflow-hidden rounded-2xl border border-border bg-foreground"
      aria-label={`Play ${title}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnail}
        alt=""
        className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-60"
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-coral transition-transform group-hover:scale-110">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="white">
            <path d="M5 3.5v15l14-7.5-14-7.5z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
