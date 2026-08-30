"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { categoryLabels, projects, type ProjectCategory } from "@/lib/data";
import PortfolioCard from "@/components/PortfolioCard";

const categories: ("all" | ProjectCategory)[] = ["all", ...(Object.keys(categoryLabels) as ProjectCategory[])];

export default function WorkGrid() {
  const [active, setActive] = useState<"all" | ProjectCategory>("all");
  const filtered = active === "all" ? projects : projects.filter((p) => p.category === active);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActive(cat)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              active === cat
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground/70 hover:border-foreground/40"
            }`}
          >
            {cat === "all" ? "All Work" : categoryLabels[cat]}
          </button>
        ))}
      </div>

      <motion.div layout className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((project) => (
          <motion.div key={project.slug} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <PortfolioCard project={project} />
          </motion.div>
        ))}
      </motion.div>

      {filtered.length === 0 && (
        <p className="mt-10 text-center text-muted">No projects in this category yet.</p>
      )}
    </div>
  );
}
