// ── Ricalcolo e salvataggio della posizione di un asset ─────────────────────
// Da chiamare dopo ogni aggiunta/modifica/eliminazione di un'operazione:
// riapplica tutta la storia alla posizione iniziale e salva quantità e PMC.

import { storage } from "./storage";
import type { Asset, AssetTransaction } from "./types";
import { applyTransactions, basePosition } from "./engine/transactions";

export async function recomputeAssetPosition(assetId: string): Promise<Asset | null> {
  const asset = await storage.get<Asset>("assets", assetId);
  if (!asset) return null;
  const allTxs = await storage.list<AssetTransaction>("assetTransactions");
  const txs = allTxs.filter((t) => t.assetId === assetId);
  const base = basePosition(asset);
  const { position } = applyTransactions(asset, txs);
  const updated: Asset = {
    ...asset,
    baseQuantity: base.quantity,
    baseAvgCost: base.avgCost,
    quantity: position.quantity,
    avgCost: position.avgCost,
  };
  await storage.put("assets", updated);
  return updated;
}
