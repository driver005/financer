import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking } from "react-native";

import type { BankConnection } from "@/api/client";
import { useApi } from "@/api/config";
import { POLL_MS, anyBusy, connectionKey, isSafeLinkUrl } from "@/bankConnections";

/**
 * The bank connections of the server, kept fresh while one of them is working, with the actions the
 * Spending screen needs: start a sync (and open the provider's sign-in page when it asks for one).
 * `onSettled` runs when a sync that was running has finished, so the screen can reload its list.
 */
export function useBankSources(onSettled?: () => void) {
  const { api } = useApi();
  const [list, setList] = useState<BankConnection[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setList(await api.bankConnections());
    } catch {
      // an older server, or the on-phone backend: no connections
      setList([]);
    }
  }, [api]);

  const busy = list ? anyBusy(list) : false;
  useFocusEffect(
    useCallback(() => {
      void load();
      if (!busy) return;
      const timer = setInterval(() => {
        void api
          ?.bankConnections()
          .then((next) => {
            setList(next);
            if (!anyBusy(next)) onSettled?.();
          })
          .catch(() => {});
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [api, load, busy, onSettled]),
  );

  const setError = useCallback((key: string, message: string | null) => {
    setErrors((cur) => {
      const next = { ...cur };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }, []);

  const openLink = useCallback(
    async (conn: BankConnection) => {
      const key = connectionKey(conn);
      if (!isSafeLinkUrl(conn.link_url)) {
        setError(key, "The sign-in address from the server does not look like a page of Plaid, GoCardless or finAPI, so it was not opened.");
        return;
      }
      try {
        await Linking.openURL(conn.link_url);
      } catch {
        setError(key, "Could not open the browser. Try again.");
      }
    },
    [setError],
  );

  /** Start a sync. FinTS needs a PIN and an approval, so it goes on the Sync screen instead of here. */
  const start = useCallback(
    async (conn: BankConnection) => {
      if (!api) return;
      const key = connectionKey(conn);
      setError(key, null);
      setStarting(key);
      try {
        const updated = await api.syncConnection(conn.name);
        setList((cur) => (cur ?? []).map((c) => (connectionKey(c) === key ? updated : c)));
        if (updated.state === "needs_link") await openLink(updated);
      } catch (e) {
        setError(key, e instanceof Error ? e.message : "Could not start the sync");
        await load();
      } finally {
        setStarting(null);
      }
    },
    [api, load, openLink, setError],
  );

  const cancel = useCallback(
    async (conn: BankConnection) => {
      if (!api) return;
      const key = connectionKey(conn);
      try {
        const updated = await api.cancelConnection(conn.name);
        setList((cur) => (cur ?? []).map((c) => (connectionKey(c) === key ? updated : c)));
      } catch (e) {
        setError(key, e instanceof Error ? e.message : "Could not cancel");
        await load();
      }
    },
    [api, load, setError],
  );

  return { list, load, starting, errors, start, cancel, openLink };
}
