import type { Metadata } from "next";
import WorkGrid from "@/components/WorkGrid";

export const metadata: Metadata = {
  title: "Work",
  description: "Character animation, explainers, motion graphics, and game animation projects.",
};

export default function WorkPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Work</h1>
      <p className="mt-2 max-w-xl text-muted">
        A mix of client work and personal projects — character rigs, explainers, motion graphics, and one
        very enthusiastic stickman fight.
      </p>
      <div className="mt-10">
        <WorkGrid />
      </div>
    </div>
  );
}
