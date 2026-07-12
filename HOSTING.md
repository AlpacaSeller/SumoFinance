# HOSTING — pubblicare PFOS gratis

PFOS non ha database né segreti lato server: servono solo le due API route proxy. Qualsiasi
hosting che esegue Next.js va bene.

## Opzione 1 — Vercel (consigliata)

1. Pubblica il progetto su GitHub (repo anche privato).
2. Su [vercel.com](https://vercel.com) → **Add New → Project** → importa il repo.
3. Framework rilevato automaticamente (Next.js): nessuna variabile d'ambiente richiesta.
4. **Deploy**. URL tipo `https://pfos-tuonome.vercel.app`; ogni push su `main` rideploya.

In alternativa da terminale: `npm i -g vercel && vercel` nella cartella del progetto.

Nota: la cache in-memory delle API route su serverless non persiste tra invocazioni fredde —
non è un problema, i provider a monte reggono e il client ha le sue cache (IndexedDB).

## Opzione 2 — Cloudflare Pages

1. Repo su GitHub, poi su [pages.cloudflare.com](https://pages.cloudflare.com) →
   **Create a project** → collega il repo.
2. Preset **Next.js**. Cloudflare usa l'adapter `@opennextjs/cloudflare` (o
   `@cloudflare/next-on-pages`); segui il prompt della dashboard che aggiunge la dipendenza.
3. Le due API route girano come Workers: nessuna configurazione aggiuntiva.

## Proteggere l'app se messa online

I dati restano comunque **solo nel browser di chi la usa** — l'URL pubblico non espone i tuoi
dati. Ma per evitare che estranei usino la tua istanza (e i tuoi limiti API):

- **Vercel**: *Settings → Deployment Protection* → "Vercel Authentication" (gratis) richiede
  login Vercel per accedere; oppure "Password Protection" (piano Pro).
- **Cloudflare**: **Cloudflare Access** (Zero Trust, gratis fino a 50 utenti) davanti al
  dominio: accesso solo con la tua email.
- In ogni caso: attiva il **PIN** in-app e fai backup regolari.

## Promemoria importante

I dati NON viaggiano con il deploy: ogni browser/dispositivo ha i suoi. Per passare i dati dal
desktop al telefono usa **Impostazioni → Esporta backup** e importalo sull'altro dispositivo.
