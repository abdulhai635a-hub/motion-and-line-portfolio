"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Phase = "hidden" | "shown" | "waving" | "idle";

const STROKE = "#1a1a1a";
const STROKE_WIDTH = 5;

export default function StickmanGreeter() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const triggeredRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) return;

    const trigger = () => {
      if (triggeredRef.current) return;
      triggeredRef.current = true;
      setPhase("shown");
    };

    const idleTimer = setTimeout(trigger, 4000);

    const onScroll = () => {
      const scrolled = window.scrollY / (document.body.scrollHeight - window.innerHeight || 1);
      if (scrolled > 0.25) trigger();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (phase !== "waving") return;
    const t = setTimeout(() => setPhase("idle"), 1600);
    return () => clearTimeout(t);
  }, [phase]);

  if (prefersReducedMotion || phase === "hidden") return null;

  const replayWave = () => setPhase("waving");

  return (
    <motion.div
      className="fixed bottom-5 right-5 z-30 cursor-pointer select-none"
      role="button"
      tabIndex={0}
      aria-label="Wave back at the stickman"
      onClick={replayWave}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && replayWave()}
      initial={{ x: 140, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 130, damping: 14 }}
      onAnimationComplete={() => setPhase((p) => (p === "shown" ? "waving" : p))}
    >
      <motion.div
        animate={{ y: phase === "idle" ? [0, -3, 0] : 0 }}
        transition={{ duration: 1.6, repeat: phase === "idle" ? Infinity : 0, ease: "easeInOut" }}
      >
        <svg width="72" height="96" viewBox="0 0 72 96" fill="none" aria-hidden="true">
          <circle cx="36" cy="16" r="12" stroke={STROKE} strokeWidth={STROKE_WIDTH} fill="white" />
          <circle cx="31" cy="14" r="1.6" fill={STROKE} />
          <circle cx="41" cy="14" r="1.6" fill={STROKE} />
          <path d="M31 20q5 3 10 0" stroke={STROKE} strokeWidth={2.5} strokeLinecap="round" fill="none" />

          <line x1="36" y1="28" x2="36" y2="62" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />

          <line x1="36" y1="62" x2="24" y2="90" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
          <line x1="36" y1="62" x2="48" y2="90" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />

          <line x1="36" y1="38" x2="20" y2="50" stroke={STROKE} strokeWidth={STROKE_WIDTH} strokeLinecap="round" />

          <g transform="translate(36,38)">
            <motion.line
              x1="0"
              y1="0"
              x2="16"
              y2="-20"
              stroke={STROKE}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              animate={{ rotate: phase === "waving" ? [0, -35, -5, -35, 0] : 0 }}
              transition={{ duration: 1.4, repeat: phase === "waving" ? 1 : 0, ease: "easeInOut" }}
              style={{ transformOrigin: "0px 0px" }}
            />
          </g>
        </svg>
      </motion.div>
    </motion.div>
  );
}
