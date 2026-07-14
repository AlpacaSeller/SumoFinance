import type { NextConfig } from "next";

// CSP: 'unsafe-inline' negli script serve per lo script inline anti-flash del
// tema e per i chunk inline di Next; connect-src elenca SOLO i provider dati
// pubblici usati dall'app (prezzi, cambi, chain, ricerca).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // gli endpoint AI (Gemini/Anthropic) sono BYOK: chiamati dal browser solo se
  // l'utente ha configurato la SUA chiave in Impostazioni → Consigli AI
  "connect-src 'self' https://api.coingecko.com https://api.frankfurter.dev https://api.frankfurter.app https://mempool.space https://cloudflare-eth.com https://eth.llamarpc.com https://api.mainnet-beta.solana.com https://generativelanguage.googleapis.com https://api.anthropic.com",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
