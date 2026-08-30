import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { categoryLabels, projects } from "@/lib/data";
import DriveVideo from "@/components/DriveVideo";

export function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = projects.find((p) => p.slug === slug);
  if (!project) return {};
  return { title: project.title, description: project.summary };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = projects.find((p) => p.slug === slug);
  if (!project) notFound();

  const hasDetails = project.role || project.timeline || (project.tools && project.tools.length > 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/work" className="text-sm font-medium text-coral hover:underline">
        ← All work
      </Link>

      <p className="mt-6 text-sm font-medium uppercase tracking-wide text-muted">
        {categoryLabels[project.category]}
        {project.year ? ` · ${project.year}` : ""}
      </p>
      <h1 className="font-display mt-2 text-3xl font-semibold sm:text-4xl">{project.title}</h1>
      {project.client && <p className="mt-3 text-lg text-muted">{project.client}</p>}

      <div className="mt-8">
        <DriveVideo driveId={project.driveId} title={project.title} />
      </div>

      {hasDetails && (
        <dl className="mt-8 grid grid-cols-2 gap-6 border-y border-border py-6 sm:grid-cols-3">
          {project.role && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Role</dt>
              <dd className="mt-1 text-sm">{project.role}</dd>
            </div>
          )}
          {project.timeline && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Timeline</dt>
              <dd className="mt-1 text-sm">{project.timeline}</dd>
            </div>
          )}
          {project.tools && project.tools.length > 0 && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted">Tools</dt>
              <dd className="mt-1 text-sm">{project.tools.join(", ")}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-8 space-y-6">
        {project.brief && (
          <section>
            <h2 className="font-display text-xl font-semibold">The brief</h2>
            <p className="mt-2 leading-relaxed text-foreground/90">{project.brief}</p>
          </section>
        )}

        {project.process && project.process.length > 0 && (
          <section>
            <h2 className="font-display text-xl font-semibold">Process</h2>
            <ul className="mt-2 space-y-2">
              {project.process.map((step) => (
                <li key={step} className="flex gap-3 text-foreground/90">
                  <span className="text-coral">→</span>
                  {step}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="mt-12 flex justify-between border-t border-border pt-6 text-sm">
        <Link href="/work" className="font-medium text-coral hover:underline">
          ← All work
        </Link>
        <Link href="/contact" className="font-medium text-coral hover:underline">
          Start a similar project →
        </Link>
      </div>
    </div>
  );
}
