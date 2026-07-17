import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/shell/AppShell";
import { Providers } from "@/components/providers";
import { THEME_INIT_SCRIPT } from "@/components/theme";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Sumo Finance — il tuo OS finanziario",
  description:
    "Il tuo sistema operativo finanziario personale. Local-first: tutti i dati restano sul tuo dispositivo.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sumo Finance",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
  metadataBase: new URL("https://sumo-finance.vercel.app"),
  openGraph: {
    title: "Sumo Finance — il tuo OS finanziario",
    description:
      "Patrimonio, budget, investimenti, tasse e obiettivi in un'unica app local-first: i dati restano sul tuo dispositivo.",
    url: "https://sumo-finance.vercel.app",
    siteName: "Sumo Finance",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
    locale: "it_IT",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sumo Finance — il tuo OS finanziario",
    description: "Finanza personale local-first: solida e ben piantata, come un sumo.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#17444a",
  width: "device-width",
  initialScale: 1,
  // iOS: senza maximum-scale Safari zooma da solo sugli input e la pagina
  // resta "scentrata". Il pinch-zoom dell'utente resta possibile (iOS lo
  // ignora per i gesti di accessibilità): blocca solo lo zoom automatico.
  maximumScale: 1,
  viewportFit: "cover", // safe area su iPhone (notch e home indicator)
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${inter.variable} ${fraunces.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* splash screen iOS (installata da Home): niente flash bianco all'avvio */}
        {[
          { w: 390, h: 844, r: 3, img: "1170-2532" },
          { w: 393, h: 852, r: 3, img: "1179-2556" },
          { w: 430, h: 932, r: 3, img: "1290-2796" },
          { w: 375, h: 812, r: 3, img: "1125-2436" },
          { w: 414, h: 896, r: 2, img: "828-1792" },
          { w: 375, h: 667, r: 2, img: "750-1334" },
        ].map((s) => (
          <link
            key={s.img}
            rel="apple-touch-startup-image"
            media={`(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.r}) and (orientation: portrait)`}
            href={`/splash/splash-${s.img}.png`}
          />
        ))}
      </head>
      <body className="min-h-full">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
