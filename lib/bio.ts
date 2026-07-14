// ── Sblocco biometrico (Face ID / Touch ID / Windows Hello) ─────────────────
// WebAuthn con authenticator di piattaforma, TUTTO on-device: nessun server,
// nessuna passkey sincronizzata altrove. Stesso modello di minaccia del PIN
// (barriera da occhi indiscreti, non crittografia): il sistema operativo fa
// da guardiano con la verifica dell'utente. Il PIN resta come fallback.
// L'id della credenziale vive in localStorage: la biometria è per-dispositivo.

const CRED_KEY = "pfos-bio-cred";

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function bioSupported(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function bioEnrolled(): boolean {
  try {
    return Boolean(localStorage.getItem(CRED_KEY));
  } catch {
    return false;
  }
}

/** Registra la biometria di questo dispositivo (richiede il gesto). */
export async function enrollBiometric(): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as BufferSource,
      rp: { name: "Sumo Finance", id: window.location.hostname },
      user: { id: userId as BufferSource, name: "sumo", displayName: "Sumo Finance" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      attestation: "none",
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Registrazione biometrica annullata");
  localStorage.setItem(CRED_KEY, toB64(cred.rawId));
}

/** true se il sistema ha verificato l'utente (Face ID/Touch ID/Hello). */
export async function verifyBiometric(): Promise<boolean> {
  const stored = localStorage.getItem(CRED_KEY);
  if (!stored) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge as BufferSource,
        allowCredentials: [
          { type: "public-key", id: fromB64(stored) as BufferSource, transports: ["internal"] },
        ],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return assertion != null;
  } catch {
    return false;
  }
}

export function disableBiometric(): void {
  try {
    localStorage.removeItem(CRED_KEY);
  } catch {
    /* niente */
  }
}
