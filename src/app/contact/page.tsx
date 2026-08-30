import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import AvailabilityBadge from "@/components/AvailabilityBadge";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch about a project, collaboration, or opportunity.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <AvailabilityBadge />
      <h1 className="font-display mt-4 text-3xl font-semibold sm:text-4xl">Let&apos;s talk</h1>
      <p className="mt-2 text-muted">
        Send over a brief, a budget range, and a timeline — I&apos;ll reply within a couple of days.
      </p>

      <div className="mt-10">
        <ContactForm />
      </div>

      <div className="mt-12 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-6 text-sm">
        <a href="mailto:hello@motionandline.com" className="font-medium text-coral hover:underline">
          hello@motionandline.com
        </a>
        <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" className="hover:text-coral">
          LinkedIn
        </a>
        <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" className="hover:text-coral">
          Instagram
        </a>
        <a href="https://artstation.com" target="_blank" rel="noopener noreferrer" className="hover:text-coral">
          ArtStation
        </a>
      </div>
    </div>
  );
}
