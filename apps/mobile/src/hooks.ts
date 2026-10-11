import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import type { Api } from "@/api/client";
import { useApi } from "@/api/config";

/** Load data from the server whenever the screen gains focus; `reload` refreshes on demand. */
export function useScreenData<T>(load: (api: Api) => Promise<T>) {
  const { api } = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      setData(await load(api));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
    // `load` is expected to be stable (defined with useCallback by the caller) or inline-constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, setData, error, busy, reload };
}

export const CHAIN_LABEL: Record<string, string> = {
  aldi: "Aldi",
  lidl: "Lidl",
  kaufland: "Kaufland",
  rewe: "Rewe",
};

export function chainLabel(chain: string): string {
  return CHAIN_LABEL[chain] ?? chain;
}
