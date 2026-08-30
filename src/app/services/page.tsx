import type { Metadata } from "next";
import Link from "next/link";
import RevealOnScroll from "@/components/RevealOnScroll";

export const metadata: Metadata = {
  title: "Services & Pricing",
  description: "Animation services and starting rates for logo animation, explainers, and character rigs.",
};

const tiers = [
  {
    name: "Logo / Brand Animation",
    price: "From $600",
    description: "A short looping animation of your existing logo or brand mark — great for site headers and social profiles.",
    includes: ["3–6 second loop", "1 revision round", "MP4 + WebM export"],
  },
  {
    name: "Explainer Video",
    price: "From $2,500",
    description: "A scripted, storyboarded explainer for onboarding, product launches, or crowdfunding campaigns.",
    includes: ["Up to 90 seconds", "Storyboard + animatic", "2 revision rounds", "Voiceover coordination"],
  },
  {
    name: "Character Design + Rig",
    price: "From $1,800",
    description: "A custom character, designed and rigged for reuse across animation, game, or app states.",
    includes: ["Character sheet", "Spine or Rive rig", "Up to 6 animation states"],
  },
  {
    name: "Full Episode / Series",
    price: "Custom quote",
    description: "Multi-part animated series work — episodic explainers, brand content, or narrative shorts.",
    includes: ["Scoped per episode", "Dedicated production schedule", "Ongoing revision structure"],
  },
];

export default function ServicesPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Services &amp; Pricing</h1>
      <p className="mt-2 max-w-xl text-muted">
        Starting rates below — every quote is scoped to the actual brief. Reach out with your project and
        timeline for an exact number.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {tiers.map((tier, i) => (
          <RevealOnScroll key={tier.name} delay={i * 0.05}>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-surface p-6">
              <h2 className="font-display text-lg font-semibold">{tier.name}</h2>
              <p className="mt-1 text-sm font-medium text-coral">{tier.price}</p>
              <p className="mt-3 text-sm leading-relaxed text-foreground/80">{tier.description}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-foreground/90">
                {tier.includes.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-teal">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </RevealOnScroll>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-border bg-surface p-8 text-center">
        <h2 className="font-display text-xl font-semibold">Not sure which fits?</h2>
        <p className="mt-2 text-muted">Send over your brief and I&apos;ll recommend the right scope.</p>
        <Link
          href="/contact"
          className="mt-5 inline-block rounded-full bg-coral px-6 py-3 text-sm font-medium text-white transition-transform hover:scale-105"
        >
          Get a quote
        </Link>
      </div>
    </div>
  );
}
