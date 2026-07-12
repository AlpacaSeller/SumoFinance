# DECISIONS — scelte fatte dove la specifica lasciava margine

## Architettura

- **`StorageAdapter` e reattività.** L'interfaccia (`lib/storage/StorageAdapter.ts`) copre CRUD
  generico per tabella + `exportAll/importAll/wipeAll` + `findBy`. La reattività della UI passa
  dall'unico hook `useTable` esportato da `lib/storage`, che oggi usa `dexie-react-hooks`
  internamente: è l'unico punto che "sa" di Dexie oltre a `DexieAdapter`. Un futuro
  **CloudAdapter** implementa `StorageAdapter` e sostituisce l'hook con una sottoscrizione
  propria (o polling): nessuna pagina va toccata, perché tutte parlano solo con
  `storage`/`useTable`.
- **`AdvisorProvider`.** Interfaccia `{ analyze(state: FinancialState): Advice[] }` in
  `lib/engine/advisor.ts`. `FinancialState = { data (grezzi), derived (metriche) }` è già il
  payload perfetto per un futuro **LlmAdvisor**: si serializza `state`, si invia a un LLM con
  uno schema di output `Advice[]`, si mostrano le card con la stessa UI. Punto di aggancio:
  sostituire l'export `advisor` con una factory che sceglie il provider dalle impostazioni.
- **Voci automatiche del calendario** (rate, cedole): derivate al volo a ogni render
  (`lib/engine/calendar.ts`) invece che persistite. Zero rischio di duplicati o disallineamenti;
  la tabella `calendarItems` contiene solo le scadenze manuali.
- **Rate dei debiti**: generano l'uscita mensile automaticamente (categoria "Casa" per i mutui,
  "Altro" per il resto) dal mese in cui il debito è presente in app. Il **residuo non si
  auto-ammortizza**: va aggiornato dall'utente (o si collega un piano futuro), scelta dichiarata
  per evitare stime sbagliate di quota capitale/interessi.
- **Snapshot solo con dati**: nessuno snapshot finché l'app è completamente vuota, per non
  sporcare il grafico con una riga di zeri.
- **Monte Carlo senza Web Worker**: 400 run × 480 mesi ≈ 200k passi, ben sotto i 50 ms su
  hardware modesto; misura empirica < 1 s garantita. `useDeferredValue` mantiene fluidi slider
  e input. RNG con seme fisso (mulberry32 + Box-Muller): risultati riproducibili.
- **Probabilità obiettivi**: stesso motore Monte Carlo (400 run, seme dedicato) su
  `{start: versato, monthly: pianificato, target}` con μ/σ del portafoglio reale.

## Operazioni di acquisto/vendita (feature aggiunta)

- **Le operazioni sono la fonte di verità.** Ogni asset ha una *posizione iniziale*
  (`baseQuantity`/`baseAvgCost`, ciò che l'utente inserisce a mano) e le operazioni
  (`assetTransactions`) vi si applicano in ordine (data, poi `createdAt` per lo stesso
  giorno). Quantità e PMC correnti sono un valore ricalcolato e salvato a ogni modifica
  (`lib/positionSync.ts`): aggiungere, modificare o eliminare un'operazione riapplica
  l'intera storia — niente stati incoerenti, undo compreso.
- **Metodo del costo medio ponderato**: acquisti aggiornano il PMC (commissioni incluse nel
  costo), vendite lo lasciano invariato e realizzano `q·(prezzo − PMC) − commissioni`.
- **Fisco derivato, non mutato**: plusvalenze/minusvalenze realizzate e zainetto "da
  operazioni" si ricalcolano dall'intera storia a ogni render (`lib/engine/transactions.ts`).
  Le minusvalenze creano zainetto nell'anno di formazione; le plusvalenze successive lo
  consumano cronologicamente (prima le più vecchie), con scadenza al 31/12 del 4° anno.
  L'imposta stimata dell'anno è la parte non compensata × aliquota dell'asset venduto.
- **Rettifiche manuali**: i campi di `taxState` restano per ciò che avviene fuori dall'app
  (altri broker) e si *sommano* ai valori derivati; le vendite in app non li consumano
  (per evitare doppi conteggi con l'estratto della banca). Semplificazioni dichiarate:
  compensazione al valore nominale, nessuna distinzione redditi diversi/da capitale.
- Le vendite oltre la quantità posseduta sono bloccate in UI e comunque clampate nel motore
  (con warning). Le operazioni di un asset eliminato restano orfane nel DB ma sono ignorate
  da ogni calcolo (e tornano vive se l'eliminazione viene annullata).

## Ammortamento debiti (feature aggiunta)

- **Piano francese a rata costante**, opt-in per debito (`amortize`, default attivo nel
  form, disattivo per i mutui creati nell'onboarding dove il TAN non è noto): alla
  registrazione automatica di ogni rata, interessi = residuo × TAN/12, quota capitale =
  rata − interessi, e il residuo scende della quota capitale. L'ultima rata è ridotta a
  residuo + interessi. Con TAN 0 tutta la rata è capitale.
- **Idempotente per costruzione**: la riduzione del residuo avviene solo per le rate nuove
  (quelle il cui `sourceRef` non esiste ancora), nello stesso passaggio che genera l'uscita.
  Riaprire l'app non tocca il residuo.
- La descrizione dell'uscita generata esplicita lo split ("Rata Mutuo (300,00 € capitale +
  300,00 € interessi)"); la pagina Debiti mostra lo split della prossima rata e il mese di
  estinzione stimato (formula chiusa in `lib/engine/amortization.ts`). Se la rata non copre
  gli interessi, l'app lo segnala e non riduce il residuo.

## XIRR e previsione liquidità (feature aggiunte)

- **XIRR (money-weighted)**: bisezione robusta su NPV(r)=0 in [−99,99%, +1000%]
  (`lib/engine/xirr.ts`). Flussi = posizione iniziale (esborso alla **data di carico**
  `baseDate`, campo opzionale dell'asset) + acquisti/vendite + valore attuale come incasso
  virtuale. Sotto 1 mese di orizzonte il tasso annualizzato non è significativo → null.
  Gli asset con posizione iniziale senza data sono esclusi dal calcolo (contati e mostrati);
  dividendi/cedole non registrati come operazioni sono fuori dal perimetro, dichiarato nel
  tooltip. Il KPI di portafoglio unisce i flussi degli asset calcolabili.
- **Previsione liquidità 12 mesi** (`lib/engine/forecast.ts`): proiezione deterministica dei
  soli flussi strutturati — ricorrenti attivi, abbonamenti, rate dei debiti (con residuo
  simulato mese per mese per gli ammortamenti, che si fermano all'estinzione), scadenze del
  calendario — più una stima delle **spese variabili** = media delle uscite non automatiche
  degli ultimi 3 mesi (fallback: mese corrente). Ipotesi esplicitate sotto il grafico;
  badge sul primo mese con saldo sotto zero. Non è una previsione, è aritmetica sui flussi
  noti: dichiarato in UI.

## Auto-backup su cartella e report fiscale (feature aggiunte)

- **Auto-backup (File System Access API)**: il handle della cartella scelta vive in una
  tabella Dexie dedicata (`fsHandles`, v3) **esclusa da TABLE_NAMES**: non è serializzabile
  in JSON e non deve finire nei backup; "Cancella tutto" la azzera comunque, così un backup
  vuoto post-cancellazione non sovrascrive nulla. A ogni apertura si scrive
  `pfos-auto-YYYY-MM-DD.json` (max 1/giorno, ultimi 14 conservati, pruning best-effort).
  Se il browser revoca il permesso, un toast con azione "Riattiva" usa il click come gesto
  utente per `requestPermission`. Solo Chromium desktop: altrove la sezione spiega
  l'alternativa manuale.
- **Report fiscale**: CSV con BOM e separatore ";" (Excel it-IT) di tutte le vendite
  realizzate; report HTML autonomo aperto in nuova scheda con `window.print()` automatico
  (→ PDF dal browser), con KPI, dettaglio vendite dell'anno, zainetto per origine e **stima
  del bollo 0,20%** sul valore dei prodotti finanziari (immobili esclusi). IVAFE e regimi
  esteri esplicitamente fuori perimetro, dichiarato nelle note del documento.

## Crypto 33%, benchmark VWCE, what-if (feature aggiunte)

- **Aliquota crypto**: 33% per i realizzi dal 1/1/2026, 26% fino al 31/12/2025 (legge di
  bilancio 2025). L'aliquota è funzione di (asset, anno di realizzo): gli eventi storici
  restano al 26%, i nuovi al 33%; le tasse latenti usano l'anno corrente. La franchigia
  abrogata e i regimi particolari non sono modellati (dichiarato nei disclaimer).
- **Benchmark VWCE**: replay dei flussi reali datati (immobili esclusi: confrontare la casa
  con un ETF non ha senso) sui prezzi storici mensili di VWCE.MI (`range=max` via proxy,
  cache 24h in IndexedDB). Ogni esborso compra quote al prezzo dell'epoca, ogni incasso ne
  vende; valore finale = quote × ultimo prezzo, XIRR sui flussi sintetici. I flussi
  precedenti allo storico disponibile usano il primo prezzo noto e sono conteggiati come
  "clampati". Limiti dichiarati: niente dividendi del benchmark (VWCE è accumulazione, ok),
  niente tasse/commissioni sulla strategia alternativa.
- **What-if**: `simulate()` accetta spese una tantum (mese, importo) sottratte dopo
  crescita+versamento; lo scenario B (versamento alternativo e/o spesa) usa lo stesso seme
  → la differenza tra scenari è tutta nei parametri, non nel rumore. Mediana B tratteggiata
  sul fan chart.

## Wallet on-chain, mobile, report mensile, ricerca (feature aggiunte)

- **Wallet auto-tracciati**: campi opzionali dell'asset (`walletChain`, `walletAddress`,
  `tokenContract`/`tokenDecimals` per ERC-20). Alla sync la **quantità** si legge on-chain
  (mempool.space per BTC, RPC pubblici Cloudflare/LlamaNodes per ETH+ERC-20, RPC ufficiale
  Solana) e il prezzo resta al provider: valore sempre derivato. La chain è fonte di verità
  della posizione (`quantity` e `baseQuantity` = saldo on-chain); le operazioni restano il
  registro fiscale. Solo chiamate dirette dal browser, solo indirizzi pubblici; nota privacy
  in UI (il provider può associare indirizzo↔IP). Gli xpub (derivazione HD) sono rimandati:
  si usano indirizzi singoli.
- **Mobile iPhone-first**: bottom bar fissa (Home, Investimenti, Uscite, Conti, Menu→drawer)
  con `env(safe-area-inset-bottom)` e `viewport-fit=cover`; hamburger rimosso dal header;
  skeleton loader al posto del testo "Caricamento…".
- **Report mensile**: card in dashboard per l'ultimo mese concluso (entrate/uscite/risparmio,
  delta patrimonio dagli snapshot, top categoria, spesa più grande, categorie oltre la media
  dei 3 mesi precedenti con soglia +10% e +20 €). Nessun report se il mese non ha movimenti.
- **Ricerca movimenti**: full-text su descrizione+categoria di tutti i mesi (da 2 caratteri,
  primi 100 risultati); export CSV it-IT (BOM + ";") di tutte le entrate/uscite.

## Export cifrato (feature aggiunta)

- **AES-GCM 256 + PBKDF2** (SHA-256, 310k iterazioni, salt e IV casuali): il file cifrato è
  autenticato — passphrase sbagliata o file manomesso falliscono in modo pulito, mai dati
  corrotti importati. L'import riconosce da solo il formato (`format: "encrypted-backup"`)
  e chiede la passphrase, poi prosegue col normale flusso di conferma/sostituzione.
- Scelta deliberata: si cifra **l'export**, non il database locale. È l'80% del beneficio
  (il file che viaggia su Drive/mail è illeggibile) senza il rischio di lockout totale dei
  dati quotidiani. Il backup automatico su cartella resta in chiaro (documentato in UI:
  per quello cifrato si usa l'export manuale). Avvertenza esplicita: senza passphrase il
  backup è irrecuperabile, non esiste recupero.

## Batch miglioramenti (wallet xpub, mobile, UX)

- **xpub/ypub/zpub HD wallet** (`lib/prices/wallet.ts`): derivazione indirizzi via
  `@scure/bip32` + `@scure/base` + `@noble/hashes`, script type dedotto dal prefisso
  (xpub→P2PKH, ypub→P2SH-P2WPKH, zpub→P2WPKH). Le version bytes ypub/zpub, non standard per
  la libreria, sono passate esplicitamente a `HDKey.fromExtendedKey`. Scansione external(0) +
  change(1) con gap limit 20 e tetto di 60 indirizzi (limiti mempool.space). Verificato coi
  vettori ufficiali BIP84. Solo chiavi pubbliche, solo lettura.
- **Command palette** (Ctrl/Cmd+K, icona nell'header): pagine + asset + azioni rapide; le
  azioni "nuovo" passano un flag effimero in sessionStorage consumato da `useOpenNew`.
- **Aggiornamento PWA**: il service worker non fa più `skipWaiting` automatico; resta in
  attesa e l'app mostra un toast "Aggiorna" che invia `SKIP_WAITING`, poi ricarica su
  `controllerchange`. Cache bumpata a v2.
- **Multi-valuta conti**: `Account.currency` + `eurRate` (cache); `accountEurBalance` converte
  e `refreshAccountRates` aggiorna i cambi BCE a ogni apertura. Retrocompatibile: conti senza
  currency restano in EUR.
- **Report mensile**: `lib/engine/monthlyReport.ts` (già introdotto) — card in dashboard.
- **Ricostruzione valore investimenti** (12 mesi, accurata): `lib/engine/portfolioHistory.ts`
  usa quantità-a-data (operazioni datate) × prezzo storico reale (solo asset con storico
  Yahoo); gli altri sono esclusi e dichiarati. Nessun valore inventato.
- **Aliquota crypto 33%** applicata anche alle tasse latenti e per anno di realizzo.
- Altri: auto-categoria da regole sull'inserimento manuale, rilevamento ricorrenti negli
  storici (≥3 mesi, importo coerente ±20%), budget rollover opzionale, "Versa" sugli
  obiettivi, ricerca+export CSV movimenti, import CSV a card su mobile, bottom bar iOS con
  safe-area, skeleton loader, regola advisor "zainetto in scadenza".

## Ricerca asset, aliquota automatica, storico crypto (feature aggiunte)

- **Ricerca asset unificata** (`lib/prices/search.ts` + `/api/search`): azioni/ETF via Yahoo
  (proxy, come /api/quote) + crypto via CoinGecko (diretto, CORS ok). Selezionando un
  risultato il form compila nome, ticker, simbolo, classe e provider prezzo; la sync del
  prezzo parte in background alla chiusura del modale (feedback col toast, senza bloccare).
  Ranking: ticker esatto in cima, ma le crypto poco capitalizzate (market_cap_rank assente o
  > 100) non scavalcano le azioni note.
- **Aliquota fiscale dalla classe**: l'aliquota effettiva è mostrata live nel form
  (`taxRate(assetClass, taxRegime, anno)`); per le crypto è 33% dal 2026 e il selettore
  regime è disabilitato (non si applica whitelist). Per i titoli di Stato resta la scelta
  whitelist 12,5%.
- **Storico prezzi crypto** (`lib/prices/history.ts`, CoinGecko `market_chart`): helper
  unificato `ensureAssetHistory` (Yahoo o CoinGecko, cache 24h namespaced `cg:<id>`). Le
  crypto entrano ora nel grafico «valore investimenti 12 mesi» e nel mini-grafico del
  dettaglio asset. Il benchmark VWCE già includeva i flussi crypto.
- **Performance Monte Carlo**: `goalProbability` ha una cache di sessione (deterministica);
  l'advisor riusa il `derived` già calcolato invece di ricalcolarlo; la pagina Obiettivi
  memoizza i calcoli per obiettivo.
- **Avviso duplicati** sull'inserimento manuale di entrate/uscite (stessa impronta), con
  conferma "aggiungi comunque".
- **Budget rollover trasparente**: riga "di cui X riportati dal mese scorso" nel riepilogo.

## Batch robustezza + dividendi/split + collegamenti (feature aggiunte)

- **Attività giornaliere su `visibilitychange`**: la PWA iOS resta viva per giorni senza
  ricaricarsi; quando torna visibile in un giorno nuovo, ricorrenti/snapshot/sync/backup si
  rieseguono (sono idempotenti). `lastBootDate` a livello di modulo.
- **Offline per-route**: il service worker (v3) cacha ogni pagina visitata; offline si apre
  la pagina richiesta, con fallback finale alla shell.
- **Error boundary** (`app/error.tsx`): mai schermo bianco; offre "Riprova" e un backup di
  emergenza scaricabile (i dati in IndexedDB restano intatti).
- **Bundle**: Recharts (~450 KB) e le librerie xpub (@scure/@noble) sono caricate on-demand
  (`components/lazyCharts.tsx` con next/dynamic — le opzioni DEVONO essere oggetti letterali —
  e import dinamici in `lib/prices/wallet.ts`). La palette dei grafici vive in
  `components/chartTheme.ts` senza dipendere da Recharts.
- **Security headers** in `next.config.ts`: CSP con connect-src limitato ai provider dati
  usati, nosniff, frame-ancestors none. `'unsafe-inline'` negli script per lo script inline
  anti-flash del tema.
- **Dividendi come operazione**: tipo `dividendo` su assetTransactions — entra nell'XIRR
  come incasso e genera un'entrata reale collegata (`sourceRef "tx:<id>"`, eliminata e
  ripristinata insieme all'operazione). Tassazione dei dividendi fuori perimetro (ritenuta
  alla fonte), dichiarato.
- **Frazionamenti (split)**: tipo `frazionamento` — `quantity` è il fattore; moltiplica la
  quantità e divide il PMC (capitale investito invariato, nessun flusso di cassa).
- **Annulla import CSV**: ogni import ha un `importBatch` id; il toast offre "Annulla
  import" che rimuove l'intero lotto.
- **Obiettivi collegati a un conto**: `Goal.linkedAccountId` — il versato è il saldo del
  conto (in EUR, limitato al target, `goalEffectiveSaved`); "Versa" nascosto; advisor
  allineato.
- **Tasse multi-anno**: selettore anno (anni con operazioni + corrente); le rettifiche
  manuali valgono solo per l'anno corrente. CSV e report PDF seguono l'anno scelto.
- **Metadati asset**: borsa salvata dalla ricerca, politica dividendi dedotta dal nome
  (Acc/Dist, euristica dichiarata), TER manuale (nessuna fonte gratuita affidabile).
  La ricerca accetta anche ISIN (Yahoo li risolve nativamente).
- **iOS**: splash screen per i formati iPhone comuni + icona maskable con safe zone.

## Dati e fisco

- **Fingerprint dedupe import** = `data|importo con segno|descrizione normalizzata
  (lowercase, spazi collassati)`. Calcolata anche al volo sui movimenti storici senza campo
  `fingerprint`, così la dedupe funziona pure contro i movimenti inseriti a mano.
- **Zainetto fiscale**: modificabile a mano per anno di formazione (ammessi ultimi 5 anni);
  pruning automatico delle minusvalenze scadute a ogni apertura. Semplificazione dichiarata:
  non distinguiamo redditi diversi vs redditi da capitale.
- **Plus/minusvalenze realizzate**: campi manuali (non esiste un'entità "vendita"); l'utente
  li aggiorna quando vende. Dichiarato nella pagina Tasse.
- **Titoli LSE in GBp**: normalizzati automaticamente a GBP (÷100) prima della conversione BCE.
- **Twelve Data `/price`** non restituisce la valuta: si usa la valuta dichiarata sull'asset
  (default EUR), convertita via Frankfurter se diversa.
- **Snapshot id = data (YYYY-MM-DD)**: garantisce strutturalmente max 1 snapshot al giorno.

## UX

- **Onboarding**: le spese del passo 5 diventano movimenti reali datati oggi (descrizione
  "Stima … del mese"), così budget/tasso di risparmio sono subito vivi; lo stipendio diventa
  una `recurringTransaction` con `startDate = oggi` (prima registrazione alla prossima
  occorrenza del giorno indicato).
- **Eliminazioni annullabili**: la riga viene rimossa subito e il toast "Annulla" (6 s) la
  ripristina identica (stesso id). Più robusto di un delete ritardato.
- **Giorni di addebito limitati a 1–28** per evitare ambiguità nei mesi corti (clamp comunque
  presente nel motore).
- **Refresh manuale calendario economico** con throttle di 5 minuti lato client, oltre alla
  cache server di 4 ore: il feed è rate-limitato (~2 req/5 min).
- **Service worker registrato solo in produzione** per non interferire con HMR in sviluppo.

## Design

- **Palette "verde bosco su carta calda"** (`#12382b` su `#f6f4ef`): il verde profondo
  comunica solidità e denaro senza l'aggressività del fintech neon; la carta calda evita il
  bianco clinico e dà il tono "quaderno dei conti" premium. Semantica fissa: verde `#177347`
  = positivo/entrate, rosso `#b03a3a` = negativo/uscite/rischio, **cobalto `#2b59c3` riservato
  all'interattività** (link, filtri, azioni) così non si confonde mai con i segnali finanziari.
- **Contrasto WCAG AA verificato con axe-core** (luglio 2026) su tutte le 14 pagine, tema
  chiaro e scuro: ogni coppia testo/sfondo dei token ≥ 4,5:1. Il token `--on-fill` gestisce il
  testo sopra i colori pieni pos/neg/warn/accent (bianco al chiaro, scuro al buio, dove quei
  colori si schiariscono). Se si aggiunge un colore, ricontrollare i rapporti prima di usarlo.
- **Tipografia**: Fraunces (display serif con carattere, per titoli e hero) + Inter (testo);
  **cifre tabulari** (`font-variant-numeric: tabular-nums`) su tutti gli importi via classe
  `.tnum`.
- **Elemento firma**: la hero del patrimonio netto — pannello verde bosco a tutta larghezza
  con cifra Fraunces gigante e chip di variazione 30g. Il resto della UI è volutamente quieto
  (card bianche, bordi sottili).
- **Mobile**: drawer di navigazione dedicato, KPI a 2 colonne, liste che avvolgono su più
  righe; target touch ≥ 44 px (`min-h-11`) su tutti i controlli.
