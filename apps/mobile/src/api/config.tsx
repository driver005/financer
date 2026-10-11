import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Api, type ApiConfig } from "./client";

const KEY = "financer.api-config";

type ConfigState = {
  /** `null` until the stored config has been read. */
  loaded: boolean;
  config: ApiConfig | null;
  api: Api | null;
  save: (config: ApiConfig) => Promise<void>;
  clear: () => Promise<void>;
};

const Ctx = createContext<ConfigState | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<ApiConfig | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        if (raw) setConfig(JSON.parse(raw) as ApiConfig);
      } catch {
        // unreadable or missing: start unconfigured
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const save = useCallback(async (next: ApiConfig) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    setConfig(next);
  }, []);

  const clear = useCallback(async () => {
    await SecureStore.deleteItemAsync(KEY);
    setConfig(null);
  }, []);

  const value = useMemo<ConfigState>(
    () => ({ loaded, config, api: config ? new Api(config) : null, save, clear }),
    [loaded, config, save, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApi(): ConfigState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApi must be used inside <ApiProvider>");
  return v;
}
