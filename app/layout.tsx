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
  title: "PFOS — Personal Financial OS",
  description:
    "Il tuo sistema operativo finanziario personale. Local-first: tutti i dati restano sul tuo dispositivo.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PFOS",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#12382b",
  width: "device-width",
  initialScale: 1,
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
