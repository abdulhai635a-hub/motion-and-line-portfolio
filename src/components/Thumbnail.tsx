"use client";

import { useState } from "react";

/**
 * Tries a custom thumbnail (public/thumbnails/<slug>.jpg) first, falls back to
 * Google Drive's auto-generated thumbnail, then to the provided fallback element.
 */
export default function Thumbnail({
  slug,
  driveId,
  alt = "",
  className,
  fallback,
}: {
  slug: string;
  driveId: string;
  alt?: string;
  className?: string;
  fallback: React.ReactNode;
}) {
  const [stage, setStage] = useState<"custom" | "drive" | "fallback">("custom");

  if (stage === "fallback") return <>{fallback}</>;

  const src =
    stage === "custom"
      ? `/thumbnails/${slug}.jpg`
      : `https://drive.google.com/thumbnail?id=${driveId}&sz=w800`;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setStage(stage === "custom" ? "drive" : "fallback")}
    />
  );
}
