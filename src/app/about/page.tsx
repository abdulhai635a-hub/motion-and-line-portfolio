import type { Metadata } from "next";
import RevealOnScroll from "@/components/RevealOnScroll";
import { skillGroups, timeline } from "@/lib/data";

export const metadata: Metadata = {
  title: "About",
  description: "Animation journey, skills, and career timeline.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">About</h1>

      <RevealOnScroll className="mt-6">
        <div className="h-40 w-40 rounded-full border border-border bg-gradient-to-br from-coral/60 to-yellow/50" />
        <p className="mt-6 max-w-xl leading-relaxed text-muted">
          [Add your bio here — how you got into animation, what you work on now, what makes your stickman
          style yours. Edit this paragraph directly in{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-sm">src/app/about/page.tsx</code>.]
        </p>
      </RevealOnScroll>

      <RevealOnScroll className="mt-14">
        <h2 className="font-display text-xl font-semibold">Skills &amp; tools</h2>
        <p className="mt-1 text-sm text-muted">
          Starter list — edit <code className="rounded bg-surface px-1.5 py-0.5">skillGroups</code> in{" "}
          <code className="rounded bg-surface px-1.5 py-0.5">src/lib/data.ts</code> to match what you actually use.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {skillGroups.map((group) => (
            <div key={group.label}>
              <p className="text-sm font-medium text-muted">{group.label}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-full border border-border px-3 py-1 text-sm"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </RevealOnScroll>

      <RevealOnScroll className="mt-14">
        <h2 className="font-display text-xl font-semibold">Experience</h2>
        <p className="mt-1 text-sm text-muted">
          Edit <code className="rounded bg-surface px-1.5 py-0.5">timeline</code> in{" "}
          <code className="rounded bg-surface px-1.5 py-0.5">src/lib/data.ts</code> with your real history.
        </p>
        <ol className="mt-4 space-y-6 border-l border-border pl-6">
          {timeline.map((entry) => (
            <li key={entry.title} className="relative">
              <span className="absolute -left-[29px] top-1 h-3 w-3 rounded-full bg-coral" />
              <p className="text-sm font-medium text-muted">{entry.year}</p>
              <p className="font-display mt-0.5 text-lg font-semibold">{entry.title}</p>
              <p className="text-sm text-muted">{entry.place}</p>
              <p className="mt-1 text-foreground/90">{entry.description}</p>
            </li>
          ))}
        </ol>
      </RevealOnScroll>
    </div>
  );
}
