import type { Metadata } from "next";
import RevealOnScroll from "@/components/RevealOnScroll";

export const metadata: Metadata = {
  title: "Process",
  description: "How a project runs, from brief to delivery.",
};

const steps = [
  {
    title: "1. Brief",
    description:
      "We talk through the goal, audience, tone, and constraints — budget, timeline, and any brand guidelines. I'll usually follow up with a short written recap so we're aligned before anything is drawn.",
  },
  {
    title: "2. Storyboard",
    description:
      "Rough panel-by-panel visuals mapped to a draft script or voiceover. This is the cheapest place to catch changes — nothing is animated yet, so revisions are fast.",
  },
  {
    title: "3. Animatic",
    description:
      "The storyboard gets timed out against real audio (or a placeholder track), so you can watch the pacing before full animation begins. One round of timing revisions happens here.",
  },
  {
    title: "4. Animation",
    description:
      "Full production pass — frame-by-frame or rigged, depending on the piece. I share progress checkpoints rather than disappearing until the end.",
  },
  {
    title: "5. Revisions",
    description:
      "Two rounds of revisions are built into every quote. Anything beyond that is scoped and quoted separately, so there are no surprise costs.",
  },
  {
    title: "6. Delivery",
    description:
      "Final exports in whatever formats you need — WebM/MP4 for web, ProRes for broadcast, Lottie/Rive for in-app use — plus source files if that's part of the agreement.",
  },
];

export default function ProcessPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Process</h1>
      <p className="mt-2 max-w-xl text-muted">
        Every project runs through the same six stages. It keeps scope honest and means you always know
        what&apos;s coming next.
      </p>

      <div className="mt-10 space-y-8">
        {steps.map((step, i) => (
          <RevealOnScroll key={step.title} delay={i * 0.05} className="border-t border-border pt-6">
            <h2 className="font-display text-xl font-semibold">{step.title}</h2>
            <p className="mt-2 leading-relaxed text-foreground/90">{step.description}</p>
          </RevealOnScroll>
        ))}
      </div>
    </div>
  );
}
