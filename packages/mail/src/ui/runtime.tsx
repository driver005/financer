import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { MailBackend } from "../api/backend";
import { MailApiError, MailClient } from "../api/client";
import { SdkMailClient } from "../api/sdk";
import { RemoteMailTransport } from "../api/transport";
import type { MailInfo, SyncReport } from "../api/types";
import type { MailHost } from "../host";
import type { Fmt } from "../logic/format";

type Status = "loading" | "ready" | "no-server" | "error";

export type Runtime = {
  status: Status;
  error: string | null;
  client: MailBackend | null;
  /** Which one carries the calls: the Rust SDK, or the TypeScript client over HTTP. */
  backend: "rust" | "typescript" | null;
  info: MailInfo | null;
  /** Locale and zone of this device, for times in the lists. */
  fmt: Fmt;
  /** Seconds since the epoch. */
  now(): number;
  /** Counts up whenever mail changed (a sync, a message sent), so open lists reload. */
  version: number;
  bump(): void;
  syncing: boolean;
  /** Read new mail now. */
  syncNow(): Promise<SyncReport | null>;
  refreshInfo(): Promise<void>;
  exit?: () => void;
};

const Ctx = createContext<Runtime | null>(null);

export function useMail(): Runtime {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMail must be used inside <MailModule>");
  return v;
}

/** How often the unread count and the sync state are looked up while the module is open. */
const INFO_EVERY_MS = 60_000;
/** A new open syncs only when the last sync is older than this. */
const FRESH_SECS = 60;

export function MailRuntime({ host, children }: { host: MailHost; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState<MailBackend | null>(null);
  const [backend, setBackend] = useState<"rust" | "typescript" | null>(null);
  const [info, setInfo] = useState<MailInfo | null>(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const fmt = useMemo<Fmt>(() => ({}), []);
  const now = useCallback(() => Math.floor(Date.now() / 1000), []);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const server = await host.server();
        if (!alive) return;
        if (!server) {
          setStatus("no-server");
          return;
        }
        // the Rust SDK when this build has it; if it cannot be loaded, the TypeScript client does the same
        let c: MailBackend | null = null;
        let which: "rust" | "typescript" = "typescript";
        if (host.sdk) {
          try {
            c = await SdkMailClient.connect(host.sdk, server.baseUrl, server.token);
            which = "rust";
          } catch (e) {
            console.warn("The Rust SDK could not be loaded; using the TypeScript client.", e);
          }
        }
        c ??= new MailClient(new RemoteMailTransport(server));
        const i = await c.info();
        if (!alive) return;
        setBackend(which);
        setClient(c);
        setInfo(i);
        setStatus("ready");
        // fresh mail on opening, unless the server read it a moment ago (it also reads by itself)
        if (i.configured && !i.syncing && (!i.last_sync || now() - i.last_sync.at > FRESH_SECS)) {
          setSyncing(true);
          c.sync()
            .then(() => c.info().then((n) => alive && setInfo(n)))
            .catch(() => undefined)
            .finally(() => {
              if (alive) {
                setSyncing(false);
                setVersion((v) => v + 1);
              }
            });
        }
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [host, now]);

  const refreshInfo = useCallback(async () => {
    if (!client) return;
    try {
      setInfo(await client.info());
    } catch {
      // the next look will try again
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const timer = setInterval(() => void refreshInfo(), INFO_EVERY_MS);
    return () => clearInterval(timer);
  }, [client, refreshInfo]);

  const syncNow = useCallback(async (): Promise<SyncReport | null> => {
    if (!client || syncing) return null;
    setSyncing(true);
    try {
      const report = await client.sync();
      await refreshInfo();
      setVersion((v) => v + 1);
      return report;
    } catch (e) {
      if (e instanceof MailApiError) setError(e.message);
      return null;
    } finally {
      setSyncing(false);
    }
  }, [client, syncing, refreshInfo]);

  const value = useMemo<Runtime>(
    () => ({ status, error, client, backend, info, fmt, now, version, bump, syncing, syncNow, refreshInfo, exit: host.onExit }),
    [status, error, client, backend, info, fmt, now, version, bump, syncing, syncNow, refreshInfo, host.onExit],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
