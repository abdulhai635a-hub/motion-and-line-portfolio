"use client";

import { motion, useReducedMotion } from "framer-motion";

const STROKE = "#1a1a1a";
const STROKE_WIDTH = 5;

function Fighter({ mirror = false }: { mirror?: boolean }) {
  return (
    <g transform={mirror ? "scale(-1,1) translate(-72,0)" : undefined}>
      <circle cx="36" cy="16" r="12" stroke={STROKE} strokeWidth={STROKE_WIDTH} fill="white" />
      <line x1="36" y1="28" x2="36" y2="60" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <line x1="36" y1="60" x2="22" y2="94" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <line x1="36" y1="60" x2="50" y2="90" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <line x1="36" y1="36" x2="18" y2="46" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </g>
  );
}

export default function StickmanFightTeaser() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="relative mx-auto flex h-40 max-w-xs items-end justify-center gap-6 sm:h-48">
      <motion.svg
        width="72"
        height="120"
        viewBox="0 0 72 120"
        fill="none"
        aria-hidden="true"
        animate={prefersReducedMotion ? undefined : { x: [0, 14, 0], rotate: [0, 3, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Fighter />
        <g transform="translate(36,36)">
          <motion.line
            x1="0"
            y1="0"
            x2="26"
            y2="-4"
            stroke={STROKE}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={prefersReducedMotion ? undefined : { rotate: [-10, 20, -10] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "0px 0px" }}
          />
        </g>
      </motion.svg>

      <motion.svg
        width="72"
        height="120"
        viewBox="0 0 72 120"
        fill="none"
        aria-hidden="true"
        animate={prefersReducedMotion ? undefined : { x: [0, -10, 0], rotate: [0, -4, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
      >
        <Fighter mirror />
        <g transform="translate(36,36)">
          <motion.line
            x1="0"
            y1="0"
            x2="-22"
            y2="-10"
            stroke={STROKE}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            animate={prefersReducedMotion ? undefined : { rotate: [8, -18, 8] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
            style={{ transformOrigin: "0px 0px" }}
          />
        </g>
      </motion.svg>
    </div>
  );
}
