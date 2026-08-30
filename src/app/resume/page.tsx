import type { Metadata } from "next";
import { skillGroups, timeline } from "@/lib/data";
import ResumePrintButton from "./ResumePrintButton";

export const metadata: Metadata = {
  title: "Resume",
  description: "Experience, skills, and education summary.",
};

export default function ResumePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">Resume</h1>
        <ResumePrintButton />
      </div>
      <p className="mt-2 max-w-xl text-muted print:hidden">
        On-page summary below — use the print button for a clean PDF copy.
      </p>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Experience</h2>
        <div className="mt-4 space-y-5">
          {timeline.map((entry) => (
            <div key={entry.title} className="border-b border-border pb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{entry.title} · {entry.place}</p>
                <p className="text-sm text-muted">{entry.year}</p>
              </div>
              <p className="mt-1 text-sm text-foreground/80">{entry.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Skills</h2>
        <div className="mt-4 space-y-3">
          {skillGroups.map((group) => (
            <p key={group.label} className="text-sm">
              <span className="font-medium">{group.label}:</span>{" "}
              <span className="text-foreground/80">{group.skills.join(", ")}</span>
            </p>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Education</h2>
        <p className="mt-3 text-sm text-foreground/80">
          Self-taught, 2020–present — supplemented with targeted courses in character rigging and
          motion graphics.
        </p>
      </section>
    </div>
  );
}
