import Link from "next/link";
import RevealOnScroll from "@/components/RevealOnScroll";
import DriveVideo from "@/components/DriveVideo";
import StickmanFightTeaser from "@/components/StickmanFightTeaser";
import PortfolioCard from "@/components/PortfolioCard";
import AvailabilityBadge from "@/components/AvailabilityBadge";
import { projects, testimonials } from "@/lib/data";

const processSteps = [
  { label: "Brief", detail: "Understand the goal, audience, and constraints." },
  { label: "Storyboard", detail: "Rough visual beats, signed off before animation starts." },
  { label: "Animatic", detail: "Timed, sound-synced draft of the whole piece." },
  { label: "Animation", detail: "Full frame-by-frame or rigged production pass." },
  { label: "Delivery", detail: "Revisions, export, and final handoff." },
];

const featuredSlugs = ["goska", "axolotl", "nike"];

export default function Home() {
  const featured = featuredSlugs
    .map((slug) => projects.find((p) => p.slug === slug))
    .filter((p): p is (typeof projects)[number] => Boolean(p));
  const heroProject = projects.find((p) => p.slug === "serious-history-scene-1")!;

  return (
    <div>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-24">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <AvailabilityBadge />
            <h1 className="font-display mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              A portfolio that <span className="text-coral">performs</span> — not just displays.
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
              I&apos;m a 2D animator and motion designer. I build character animation, explainers,
              and motion graphics for studios, startups, and the occasional stickman fight.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/work"
                className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-transform hover:scale-105"
              >
                See the work
              </Link>
              <Link
                href="/contact"
                className="rounded-full border border-border px-6 py-3 text-sm font-medium transition-colors hover:border-foreground"
              >
                Start a project
              </Link>
            </div>
          </div>

          <DriveVideo driveId={heroProject.driveId} title={heroProject.title} slug={heroProject.slug} />
        </div>
      </section>

      <RevealOnScroll className="border-y border-border bg-surface/60 py-14">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-muted">Signature piece</p>
          <h2 className="font-display mt-2 text-2xl font-semibold sm:text-3xl">
            An Alan Becker–style stickman fight, in full
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-muted">
            The full frame-by-frame fight sequence lives in the Character Gallery. Here&apos;s a taste.
          </p>
          <div className="mt-8">
            <StickmanFightTeaser />
          </div>
          <Link
            href="/work/goska"
            className="mt-6 inline-block text-sm font-medium text-coral hover:underline"
          >
            Watch the full fight →
          </Link>
        </div>
      </RevealOnScroll>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <RevealOnScroll className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold sm:text-3xl">Selected work</h2>
            <p className="mt-1 text-muted">A few recent favorites.</p>
          </div>
          <Link href="/work" className="hidden shrink-0 text-sm font-medium text-coral hover:underline sm:block">
            View all →
          </Link>
        </RevealOnScroll>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((project, i) => (
            <RevealOnScroll key={project.slug} delay={i * 0.1}>
              <PortfolioCard project={project} />
            </RevealOnScroll>
          ))}
        </div>

        <Link href="/work" className="mt-8 block text-center text-sm font-medium text-coral hover:underline sm:hidden">
          View all work →
        </Link>
      </section>

      <RevealOnScroll className="border-t border-border bg-surface/60 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-display text-2xl font-semibold sm:text-3xl">How a project runs</h2>
          <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-5">
            {processSteps.map((step, i) => (
              <div key={step.label}>
                <span className="font-display text-2xl font-semibold text-coral">{i + 1}</span>
                <p className="mt-1 font-medium">{step.label}</p>
                <p className="mt-1 text-sm text-muted">{step.detail}</p>
              </div>
            ))}
          </div>
          <Link href="/process" className="mt-8 inline-block text-sm font-medium text-coral hover:underline">
            See the full process →
          </Link>
        </div>
      </RevealOnScroll>

      {testimonials.length > 0 && (
        <RevealOnScroll className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display text-2xl font-semibold sm:text-3xl">What clients say</h2>
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {testimonials.map((t) => (
              <blockquote key={t.name} className="rounded-2xl border border-border bg-surface p-6">
                <p className="text-sm leading-relaxed text-foreground/90">&ldquo;{t.quote}&rdquo;</p>
                <footer className="mt-4 text-sm text-muted">
                  <span className="font-medium text-foreground">{t.name}</span> — {t.role}
                </footer>
              </blockquote>
            ))}
          </div>
        </RevealOnScroll>
      )}

      <RevealOnScroll className="border-t border-border py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-3xl font-semibold sm:text-4xl">
            Let&apos;s make something people remember.
          </h2>
          <p className="mt-3 text-muted">Booking new freelance projects — reach out with a brief and timeline.</p>
          <Link
            href="/contact"
            className="mt-6 inline-block rounded-full bg-coral px-7 py-3 text-sm font-medium text-white transition-transform hover:scale-105"
          >
            Get in touch
          </Link>
        </div>
      </RevealOnScroll>
    </div>
  );
}
