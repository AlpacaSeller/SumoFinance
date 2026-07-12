"use client";

// ── Il sumo, mascotte dell'app ──────────────────────────────────────────────
// Mark del logo (moneta con grafico in crescita), variante chiara nel tema
// scuro. Decorativo: aria-hidden, alt vuoto.

import Image from "next/image";

export function SumoMascot({
  size = 96,
  className = "",
}: {
  /** altezza in px (la larghezza segue le proporzioni del mark) */
  size?: number;
  className?: string;
}) {
  const w = Math.round((229 / 235) * size);
  return (
    <span className={`inline-block ${className}`} aria-hidden>
      <Image
        src="/brand/sumo-mark.png"
        alt=""
        width={w}
        height={size}
        className="theme-light-only"
      />
      <Image
        src="/brand/sumo-mark-dark.png"
        alt=""
        width={w}
        height={size}
        className="theme-dark-only"
      />
    </span>
  );
}
