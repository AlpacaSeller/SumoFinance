"use client";

// ── Shell dell'app: sidebar (desktop), drawer (mobile), header ─────────────

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  CalendarDays,
  Coins,
  Globe2,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Lock,
  Menu,
  Moon,
  Receipt,
  Search,
  Sun,
  Repeat,
  Settings,
  ShieldCheck,
  Target,
  TrendingDown,
  Wallet,
  X,
} from "lucide-react";
import { useLock } from "../lock";
import { useTheme } from "../theme";
import { useCommandPalette } from "../CommandPalette";
import { SumoMascot } from "../Mascot";
import { storage, useTable } from "@/lib/storage";
import type { Settings as SettingsType } from "@/lib/types";

const NAV_GROUPS: {
  label: string;
  items: { href: string; label: string; icon: ReactNode }[];
}[] = [
  {
    label: "Panoramica",
    items: [
      { href: "/", label: "Dashboard", icon: <LayoutDashboard /> },
      { href: "/consigli", label: "Consigli", icon: <Lightbulb /> },
    ],
  },
  {
    label: "Patrimonio",
    items: [
      { href: "/conti", label: "Conti & liquidità", icon: <Wallet /> },
      { href: "/investimenti", label: "Investimenti", icon: <LineChart /> },
      { href: "/debiti", label: "Debiti", icon: <Landmark /> },
    ],
  },
  {
    label: "Flussi",
    items: [
      { href: "/entrate", label: "Entrate", icon: <Coins /> },
      { href: "/uscite", label: "Uscite & budget", icon: <TrendingDown /> },
      { href: "/abbonamenti", label: "Abbonamenti", icon: <Repeat /> },
    ],
  },
  {
    label: "Futuro",
    items: [
      { href: "/simulazioni", label: "Simulazioni & FIRE", icon: <BarChart3 /> },
      { href: "/obiettivi", label: "Obiettivi", icon: <Target /> },
      { href: "/tasse", label: "Tasse", icon: <Receipt /> },
      { href: "/calendario", label: "Calendario finanziario", icon: <CalendarDays /> },
      { href: "/calendario-economico", label: "Calendario economico", icon: <Globe2 /> },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/impostazioni", label: "Impostazioni", icon: <Settings /> },
      { href: "/privacy", label: "Privacy e termini", icon: <ShieldCheck /> },
    ],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
            {group.label}
          </div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors [&>svg]:size-[18px] ${
                      active
                        ? "bg-brand-soft font-semibold text-brand-ink"
                        : "text-soft hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-1.5">
      <SumoMascot size={34} />
      <span className="font-display text-lg font-semibold tracking-tight text-ink">
        Sumo Finance
      </span>
    </Link>
  );
}

function PrivacyBadge() {
  return (
    <span
      title="Local-first: tutti i tuoi dati vivono solo in questo browser. Verso internet transitano soltanto ticker e richieste generiche di mercato."
      className="inline-flex items-center gap-1.5 rounded-full border border-pos/20 bg-pos-soft px-2.5 py-1 text-[11px] font-medium text-pos"
    >
      <ShieldCheck className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">Dati sul dispositivo</span>
      <span className="sm:hidden">Locale</span>
    </span>
  );
}

function SearchTrigger() {
  const { open } = useCommandPalette();
  return (
    <>
      {/* desktop: pill con scorciatoia */}
      <button
        onClick={open}
        className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-faint hover:text-ink md:flex"
      >
        <Search className="size-4" />
        Cerca…
        <kbd className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
      </button>
      {/* mobile: solo icona */}
      <button
        aria-label="Cerca"
        onClick={open}
        className="flex size-11 items-center justify-center rounded-xl text-soft hover:bg-surface-2 hover:text-ink md:hidden"
      >
        <Search className="size-[18px]" />
      </button>
    </>
  );
}

function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  return (
    <button
      aria-label={resolved === "dark" ? "Passa al tema chiaro" : "Passa al tema scuro"}
      title={resolved === "dark" ? "Tema chiaro" : "Tema scuro"}
      onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
      className="flex size-11 items-center justify-center rounded-xl text-soft hover:bg-surface-2 hover:text-ink"
    >
      {resolved === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

function DemoBanner() {
  async function reset() {
    await storage.wipeAll();
    window.location.href = "/onboarding";
  }
  return (
    <div className="flex items-center justify-center gap-3 border-t border-brand/15 bg-brand-soft px-4 py-1.5 text-xs text-brand-ink">
      <span>
        Stai guardando <strong>dati d&apos;esempio</strong>: niente di tutto questo è reale.
      </span>
      <button
        onClick={() => void reset()}
        className="shrink-0 rounded-lg px-2 py-1 font-semibold underline underline-offset-2 hover:opacity-80"
      >
        Azzera e ricomincia
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { pinEnabled, lock } = useLock();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const settingsRows = useTable<SettingsType>("settings");
  const settings = settingsRows?.find((s) => s.id === "main");

  const isOnboarding = pathname === "/onboarding";

  // Primo avvio: porta all'onboarding finché non è completato o saltato
  useEffect(() => {
    if (settingsRows !== undefined && settings && !settings.onboardingDone && !isOnboarding) {
      router.replace("/onboarding");
    }
  }, [settingsRows, settings, isOnboarding, router]);

  if (isOnboarding) {
    return <>{children}</>;
  }

  if (settingsRows === undefined || (settings && !settings.onboardingDone)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex flex-col items-center gap-3">
          <SumoMascot size={72} />
          <div className="font-display text-2xl font-semibold text-brand-ink">Sumo Finance</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-6 overflow-y-auto border-r border-line bg-surface px-3 py-5 lg:flex">
        <div className="px-3">
          <Logo />
        </div>
        <NavLinks />
      </aside>

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur lg:pl-64">
        <div className="flex h-14 items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex items-center gap-3 lg:hidden">
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SearchTrigger />
            <PrivacyBadge />
            <ThemeToggle />
            {pinEnabled && (
              <button
                aria-label="Blocca l'app"
                title="Blocca subito l'app"
                onClick={lock}
                className="flex size-11 items-center justify-center rounded-xl text-soft hover:bg-surface-2 hover:text-ink"
              >
                <Lock className="size-[18px]" />
              </button>
            )}
          </div>
        </div>
        {settings?.demoMode && <DemoBanner />}
      </header>

      {/* Drawer mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 overflow-y-auto bg-surface px-3 py-5 shadow-2xl">
            <div className="flex items-center justify-between px-3" onClick={() => setDrawerOpen(false)}>
              <Logo />
              <button
                aria-label="Chiudi menu"
                onClick={() => setDrawerOpen(false)}
                className="flex size-11 items-center justify-center rounded-xl text-soft hover:bg-surface-2"
              >
                <X className="size-5" />
              </button>
            </div>
            <NavLinks onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* Contenuto */}
      <main className="px-4 pb-32 pt-6 md:px-6 lg:pb-16 lg:pl-[280px] lg:pr-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {/* Bottom bar mobile (iOS-style, a portata di pollice) */}
      <nav
        aria-label="Navigazione principale"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="grid grid-cols-5">
          {[
            { href: "/", label: "Home", icon: <LayoutDashboard /> },
            { href: "/investimenti", label: "Invest.", icon: <LineChart /> },
            { href: "/uscite", label: "Uscite", icon: <TrendingDown /> },
            { href: "/conti", label: "Conti", icon: <Wallet /> },
          ].map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium [&>svg]:size-5 ${
                  active ? "text-brand-ink" : "text-faint"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
          <button
            aria-label="Apri menu completo"
            onClick={() => setDrawerOpen(true)}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-faint [&>svg]:size-5"
          >
            <Menu />
            Menu
          </button>
        </div>
      </nav>
    </div>
  );
}
