import fs from "fs";
import path from "path";
import { projects } from "@/lib/data";
import ThumbnailPicker from "@/components/ThumbnailPicker";

export const dynamic = "force-dynamic";

export default function ThumbnailAdminPage() {
  const candidatesRoot = path.join(process.cwd(), "public", "thumbnails", "candidates");
  const thumbnailsRoot = path.join(process.cwd(), "public", "thumbnails");

  const projectFrames = projects.map((p) => {
    const dir = path.join(candidatesRoot, p.slug);
    let frames: string[] = [];
    try {
      frames = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jpg"))
        .sort();
    } catch {
      frames = [];
    }

    const hasCustom = ["jpg", "jpeg", "png"].some((ext) =>
      fs.existsSync(path.join(thumbnailsRoot, `${p.slug}.${ext}`))
    );

    return { slug: p.slug, title: p.title, frames, hasCustom };
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Thumbnail Picker</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Click a frame to select it for each project. When you&apos;re happy with your picks, hit
        &ldquo;Copy my selections&rdquo; and paste the result back into chat — Claude will apply
        them permanently.
      </p>

      <div className="mt-10">
        <ThumbnailPicker projects={projectFrames} />
      </div>
    </div>
  );
}
