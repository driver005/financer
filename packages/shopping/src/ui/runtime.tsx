import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ShopClient } from "../api/client";
import { EmbeddedShopTransport, RemoteShopTransport, type ShopTransport } from "../api/transport";
import type { IndexReport, IndexRequest, JobView, ShopInfo } from "../api/types";
import type { ModuleHost } from "../host";
import { followJob, progressModel, type ProgressModel, type ProgressSurface } from "../logic/progress";

export type Mode = "auto" | "server" | "phone";

export type ShopSettings = {
  mode: Mode;
  serverUrl: string;
  /** The JSON array of shop sources used by the on-phone backend (a server has its own). */
  sourcesJson: string;
  dealAlerts: boolean;
  lastNoticeId: number;
};

export const DEFAULT_SETTINGS: ShopSettings = { mode: "auto", serverUrl: "", sourcesJson: "", dealAlerts: false, lastNoticeId: 0 };

const SETTINGS_KEY = "financer.shop.settings";
export const SECRET_KEYS = { token: "financer.shop.token", claude: "financer.shop.claude-key", openai: "financer.shop.openai-key" } as const;

export function parseSettings(raw: string | null): ShopSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const v = JSON.parse(raw) as Partial<ShopSettings>;
    return {
      mode: v.mode === "server" || v.mode === "phone" ? v.mode : "auto",
      serverUrl: typeof v.serverUrl === "string" ? v.serverUrl : "",
      sourcesJson: typeof v.sourcesJson === "string" ? v.sourcesJson : "",
      dealAlerts: v.dealAlerts === true,
      lastNoticeId: typeof v.lastNoticeId === "number" ? v.lastNoticeId : 0,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export type Secrets = { token: string; claude: string; openai: string };

type Status = "loading" | "ready" | "unconfigured" | "error";

export type Indexing = { jobId: string; query: string; model: ProgressModel } | null;

export type Runtime = {
  host: ModuleHost;
  status: Status;
  error: string | null;
  client: ShopClient | null;
  info: ShopInfo | null;
  /** True when nothing searches by itself: the build without a server, or a server with crawling off. */
  integrated: boolean;
  where: "server" | "phone" | null;
  settings: ShopSettings;
  secrets: Secrets;
  save(settings: Partial<ShopSettings>, secrets?: Partial<Secrets>): Promise<void>;
  reconnect(): Promise<void>;
  indexing: Indexing;
  /** Start reading the sources for a search; resolves with the finished job. */
  startIndex(req: IndexRequest): Promise<JobView | null>;
  cancelIndex(): Promise<void>;
  lastReport: IndexReport | null;
  /** Bumped when the default profile changes, so open searches re-run. */
  profileVersion: number;
  bumpProfile(): void;
};

const Ctx = createContext<Runtime | null>(null);

export function useShop(): Runtime {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShop must be used inside <ShoppingModule>");
  return v;
}

const EMPTY_SECRETS: Secrets = { token: "", claude: "", openai: "" };

export function ShopRuntime({ host, children }: { host: ModuleHost; children: ReactNode }) {
  const [settings, setSettings] = useState<ShopSettings>(DEFAULT_SETTINGS);
  const [secrets, setSecrets] = useState<Secrets>(EMPTY_SECRETS);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<ShopClient | null>(null);
  const [info, setInfo] = useState<ShopInfo | null>(null);
  const [where, setWhere] = useState<"server" | "phone" | null>(null);
  const [indexing, setIndexing] = useState<Indexing>(null);
  const [lastReport, setLastReport] = useState<IndexReport | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const running = useRef<string | null>(null);

  const connect = useCallback(
    async (s: ShopSettings, k: Secrets) => {
      setStatus("loading");
      setError(null);
      try {
        const shared = host.sharedServer ? await host.sharedServer() : null;
        const canPhone = Boolean(host.startEmbedded);
        const wantServer = s.mode === "server" || (s.mode === "auto" && (Boolean(shared) || (!canPhone && s.serverUrl !== "")));
        const wantPhone = s.mode === "phone" || (s.mode === "auto" && !wantServer && canPhone);
        let transport: ShopTransport;
        if (wantServer) {
          const baseUrl = s.serverUrl.trim() || shared?.baseUrl || "";
          const token = k.token.trim() || shared?.token || "";
          if (!baseUrl || !token) {
            setStatus("unconfigured");
            setClient(null);
            return;
          }
          transport = new RemoteShopTransport({ baseUrl, token });
          setWhere("server");
        } else if (wantPhone && host.startEmbedded) {
          const backend = await host.startEmbedded({
            dbPath: `${host.dataDir ?? ""}financer-shop.db`,
            sourcesJson: s.sourcesJson.trim() || undefined,
            claudeApiKey: k.claude.trim() || undefined,
            openaiApiKey: k.openai.trim() || undefined,
          });
          transport = new EmbeddedShopTransport(backend);
          setWhere("phone");
        } else {
          setStatus("unconfigured");
          setClient(null);
          return;
        }
        const c = new ShopClient(transport);
        const i = await c.info();
        setClient(c);
        setInfo(i);
        setStatus("ready");
      } catch (e) {
        setClient(null);
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [host],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      const [raw, token, claude, openai] = await Promise.all([
        host.storage.get(SETTINGS_KEY),
        host.secrets.get(SECRET_KEYS.token),
        host.secrets.get(SECRET_KEYS.claude),
        host.secrets.get(SECRET_KEYS.openai),
      ]);
      if (!alive) return;
      const s = parseSettings(raw);
      const k = { token: token ?? "", claude: claude ?? "", openai: openai ?? "" };
      setSettings(s);
      setSecrets(k);
      await connect(s, k);
    })();
    return () => {
      alive = false;
    };
  }, [host, connect]);

  const save = useCallback(
    async (patch: Partial<ShopSettings>, secretPatch?: Partial<Secrets>) => {
      const next = { ...settings, ...patch };
      const nextSecrets = { ...secrets, ...secretPatch };
      await host.storage.set(SETTINGS_KEY, JSON.stringify(next));
      if (secretPatch) {
        const pairs: [keyof Secrets, string][] = [
          ["token", SECRET_KEYS.token],
          ["claude", SECRET_KEYS.claude],
          ["openai", SECRET_KEYS.openai],
        ];
        for (const [name, key] of pairs) {
          if (name in secretPatch) {
            const value = nextSecrets[name];
            if (value) await host.secrets.set(key, value);
            else await host.secrets.remove(key);
          }
        }
      }
      setSettings(next);
      setSecrets(nextSecrets);
      // only a change to the connection needs a reconnect; the notice counter must not
      const connectionChanged = ["mode", "serverUrl", "sourcesJson"].some((f) => f in patch) || Boolean(secretPatch);
      if (connectionChanged) await connect(next, nextSecrets);
    },
    [host, settings, secrets, connect],
  );

  const startIndex = useCallback(
    async (req: IndexRequest): Promise<JobView | null> => {
      if (!client || running.current) return null;
      const job = await client.startIndex(req);
      running.current = job.id;
      const surface = host.progress(req.query);
      const mirror: ProgressSurface = {
        show: async (m) => void (await surface.show(m)),
        finish: async (m) => void (await surface.finish(m)),
      };
      setIndexing({ jobId: job.id, query: req.query, model: progressModel(req.query, job.progress) });
      const result = await followJob(job.id, req.query, {
        poll: async (id) => {
          const j = await client.indexJob(id);
          setIndexing({ jobId: id, query: req.query, model: progressModel(req.query, j.progress) });
          return j;
        },
        surface: mirror,
        pollMs: 700,
      });
      running.current = null;
      setIndexing(null);
      setLastReport(result.job?.report ?? null);
      return result.job;
    },
    [client, host],
  );

  const cancelIndex = useCallback(async () => {
    if (client && running.current) await client.cancelIndex(running.current);
  }, [client]);

  const value = useMemo<Runtime>(
    () => ({
      host,
      status,
      error,
      client,
      info,
      integrated: info ? !info.continuous : true,
      where,
      settings,
      secrets,
      save,
      reconnect: () => connect(settings, secrets),
      indexing,
      startIndex,
      cancelIndex,
      lastReport,
      profileVersion,
      bumpProfile: () => setProfileVersion((v) => v + 1),
    }),
    [host, status, error, client, info, where, settings, secrets, save, connect, indexing, startIndex, cancelIndex, lastReport, profileVersion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
