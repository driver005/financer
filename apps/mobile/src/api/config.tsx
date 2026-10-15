import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Api, type ApiConfig } from "./client";
import { CONFIG_KEY, MODE_KEY } from "./keys";
import { initialMode, type BackendMode } from "./mode";
import { deleteSecret, getSecret, setSecret } from "./storage";
import { EmbeddedTransport } from "./transport";
import { disableBackgroundRefresh, enableBackgroundRefresh } from "../native/background";
import {
  EMBEDDED_KEY,
  EMPTY_EMBEDDED_SETTINGS,
  embeddedAvailable,
  startEmbedded,
  type EmbeddedSettings,
} from "../native/embedded";

const KEY = CONFIG_KEY;

export type { BackendMode };

type ConfigState = {
  /** `false` until the stored config has been read (and the on-phone backend started, if used). */
  loaded: boolean;
  /** Where the backend runs: a server you host, or inside this app. */
  mode: BackendMode;
  /** True once a mode was saved. A compact build starts in on-phone mode before that (see mode.ts). */
  modeChosen: boolean;
  setMode: (mode: BackendMode) => Promise<void>;
  /** Server address and token (remote mode). */
  config: ApiConfig | null;
  api: Api | null;
  save: (config: ApiConfig) => Promise<void>;
  clear: () => Promise<void>;
  /** On-phone backend: whether this build has it, its settings and any start-up error. */
  embeddedAvailable: boolean;
  embedded: EmbeddedSettings;
  saveEmbedded: (settings: EmbeddedSettings) => Promise<void>;
  embeddedError: string | null;
};

const Ctx = createContext<ConfigState | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [mode, setModeState] = useState<BackendMode>("remote");
  const [modeChosen, setModeChosen] = useState(false);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [embedded, setEmbedded] = useState<EmbeddedSettings>(EMPTY_EMBEDDED_SETTINGS);
  const [embeddedApi, setEmbeddedApi] = useState<Api | null>(null);
  const [embeddedError, setEmbeddedError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await getSecret(KEY);
        if (raw) setConfig(JSON.parse(raw) as ApiConfig);
        const storedMode = await getSecret(MODE_KEY);
        const start = initialMode({ storedMode, hasServer: raw !== null, embeddedAvailable });
        setModeState(start.mode);
        setModeChosen(start.chosen);
        const rawEmbedded = await getSecret(EMBEDDED_KEY);
        if (rawEmbedded) setEmbedded({ ...EMPTY_EMBEDDED_SETTINGS, ...(JSON.parse(rawEmbedded) as Partial<EmbeddedSettings>) });
      } catch {
        // unreadable or missing: start unconfigured
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // (Re)start the on-phone backend whenever its mode or settings change.
  useEffect(() => {
    if (!loaded || mode !== "embedded") {
      setEmbeddedApi(null);
      setEmbeddedError(null);
      if (loaded) void disableBackgroundRefresh().catch(() => {});
      return;
    }
    let cancelled = false;
    startEmbedded(embedded)
      .then((backend) => {
        if (!cancelled) {
          setEmbeddedApi(new Api(new EmbeddedTransport(backend)));
          setEmbeddedError(null);
          // refresh prices once now (the app is open) and ask the OS for background windows
          void backend.refreshPrices().catch(() => {});
          void backend.syncReceiptsNow().catch(() => {}); // does nothing unless Lidl Plus is switched on
          void enableBackgroundRefresh().catch(() => {});
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setEmbeddedApi(null);
          setEmbeddedError(e instanceof Error ? e.message : "Could not start the on-phone backend");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, mode, embedded]);

  const save = useCallback(async (next: ApiConfig) => {
    await setSecret(KEY, JSON.stringify(next));
    setConfig(next);
  }, []);

  const clear = useCallback(async () => {
    await deleteSecret(KEY);
    setConfig(null);
  }, []);

  const setMode = useCallback(async (next: BackendMode) => {
    await setSecret(MODE_KEY, next);
    setModeState(next);
    setModeChosen(true);
  }, []);

  const saveEmbedded = useCallback(async (next: EmbeddedSettings) => {
    await setSecret(EMBEDDED_KEY, JSON.stringify(next));
    setEmbedded(next);
  }, []);

  const remoteApi = useMemo(() => (config ? new Api(config) : null), [config]);
  const value = useMemo<ConfigState>(
    () => ({
      loaded,
      mode,
      modeChosen,
      setMode,
      config,
      api: mode === "embedded" ? embeddedApi : remoteApi,
      save,
      clear,
      embeddedAvailable,
      embedded,
      saveEmbedded,
      embeddedError,
    }),
    [loaded, mode, setMode, config, embeddedApi, remoteApi, save, clear, embedded, saveEmbedded, embeddedError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApi(): ConfigState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApi must be used inside <ApiProvider>");
  return v;
}
