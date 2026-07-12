"use client";

// Apre il modale "nuovo" quando si arriva da un'azione della command palette
// (flag effimero in sessionStorage). Consumato una sola volta.

import { useEffect } from "react";

export function useOpenNew(onOpen: () => void) {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("pfos-open-new") === "1") {
        sessionStorage.removeItem("pfos-open-new");
        onOpen();
      }
    } catch {
      // storage non disponibile: nessuna apertura automatica
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
