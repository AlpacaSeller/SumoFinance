"use client";

// ── Il sumo, mascotte dell'app ──────────────────────────────────────────────
// Mark del logo + pose generate nello stesso stile line-art (benvenuto,
// festeggiamento, scivolone), variante chiara nel tema scuro. Decorativo:
// aria-hidden, alt vuoto.

import Image from "next/image";

export type SumoPose = "default" | "welcome" | "celebrate" | "oops";

const POSES: Record<SumoPose, { src: string; ratio: number }> = {
  default: { src: "/brand/sumo-mark", ratio: 229 / 235 },
  welcome: { src: "/brand/sumo-welcome", ratio: 476 / 480 },
  celebrate: { src: "/brand/sumo-celebrate", ratio: 265 / 480 },
  oops: { src: "/brand/sumo-oops", ratio: 480 / 448 },
};

export function SumoMascot({
  size = 96,
  className = "",
  pose = "default",
}: {
  /** altezza in px (la larghezza segue le proporzioni della posa) */
  size?: number;
  className?: string;
  pose?: SumoPose;
}) {
  const { src, ratio } = POSES[pose];
  const w = Math.round(ratio * size);
  return (
    <span className={`inline-block ${className}`} aria-hidden>
      <Image
        src={`${src}.png`}
        alt=""
        width={w}
        height={size}
        className="theme-light-only"
      />
      <Image
        src={`${src}-dark.png`}
        alt=""
        width={w}
        height={size}
        className="theme-dark-only"
      />
    </span>
  );
}
