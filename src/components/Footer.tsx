import Link from "next/link";

const socials = [
  { label: "LinkedIn", href: "https://linkedin.com" },
  { label: "Instagram", href: "https://instagram.com" },
  { label: "ArtStation", href: "https://artstation.com" },
  { label: "YouTube", href: "https://youtube.com" },
];

export default function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display text-lg font-semibold">Motion &amp; Line</p>
          <p className="mt-1 text-sm text-muted">
            2D animation &amp; motion design. Based anywhere, working everywhere.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/80 transition-colors hover:text-coral"
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
      <div className="border-t border-border px-6 py-4 text-center text-xs text-muted">
        <Link href="/contact" className="hover:text-coral">
          hello@motionandline.com
        </Link>
        <span className="mx-2">·</span>
        &copy; {new Date().getFullYear()} Motion &amp; Line. All rights reserved.
      </div>
    </footer>
  );
}
