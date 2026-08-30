import type { Metadata } from "next";
import RevealOnScroll from "@/components/RevealOnScroll";
import { testimonials } from "@/lib/data";

export const metadata: Metadata = {
  title: "Testimonials",
  description: "What clients and studios say about working together.",
};

export default function TestimonialsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Testimonials</h1>
      <p className="mt-2 max-w-xl text-muted">A few words from people I&apos;ve made things with.</p>

      {testimonials.length > 0 ? (
        <div className="mt-10 space-y-6">
          {testimonials.map((t, i) => (
            <RevealOnScroll key={t.name} delay={i * 0.05}>
              <blockquote className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
                <p className="text-lg leading-relaxed text-foreground/90">&ldquo;{t.quote}&rdquo;</p>
                <footer className="mt-4 text-sm text-muted">
                  <span className="font-medium text-foreground">{t.name}</span> — {t.role}
                </footer>
              </blockquote>
            </RevealOnScroll>
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-muted">
          Testimonials coming soon — check back after a few client projects wrap up.
        </div>
      )}
    </div>
  );
}
