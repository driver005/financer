import { useRouter } from "expo-router";
import { useCallback, useRef, useState, type ComponentType, type Ref } from "react";
import { Platform } from "react-native";
import { WebView } from "react-native-webview";
import { Banner, Box, Button, Card, Stack, Text } from "@financer/ui";

import type { ReceiptInput } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { Empty, NeedsSetup } from "@/components/Status";
import {
  LIST_SCRIPT,
  REWE_START_URL,
  detailScript,
  idsToRead,
  isReweUrl,
  isShopPage,
  parseList,
  parseMessage,
  runText,
  toImport,
  type ListEntry,
} from "@/reweSync";

/** The few things used of the browser window. (The package's own prop types collapse to `never` under this React Native version, so they are spelled out.) */
type BrowserHandle = { injectJavaScript(script: string): void };
type BrowserProps = {
  ref?: Ref<BrowserHandle>;
  source: { uri: string };
  originWhitelist: string[];
  onShouldStartLoadWithRequest: (request: { url: string }) => boolean;
  onMessage: (event: { nativeEvent: { url: string; data: string } }) => void;
  onLoadEnd: () => void;
  javaScriptEnabled: boolean;
  domStorageEnabled: boolean;
  sharedCookiesEnabled: boolean;
  setSupportMultipleWindows: boolean;
};
const Browser = WebView as unknown as ComponentType<BrowserProps>;

type Phase = "login" | "reading" | "saving" | "done" | "error";

/**
 * REWE's web shop in a window of the app. You sign in there (on REWE's own page); once signed in,
 * a small script that the app runs inside the page lists your receipts and fetches the new ones, and
 * the app hands them to your server. Nothing but REWE's pages loads in the window, and no cookie
 * leaves it.
 */
export default function ReweSync() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const web = useRef<BrowserHandle>(null);
  const [phase, setPhase] = useState<Phase>("login");
  const [text, setText] = useState("Sign in to your REWE account below. The receipts are read as soon as you are signed in.");
  const busy = useRef(false);
  const list = useRef<ListEntry[]>([]);
  const left = useRef(0);
  const wanted = useRef<string[]>([]);
  const details = useRef(new Map<string, string>());

  const readList = useCallback(() => {
    web.current?.injectJavaScript(LIST_SCRIPT);
  }, []);

  const fail = useCallback((why: unknown) => {
    busy.current = false;
    setPhase("error");
    setText(why instanceof Error ? why.message : "Something went wrong.");
  }, []);

  const onList = useCallback(
    async (status: number, body: string) => {
      const entries = status === 200 ? parseList(body) : null;
      if (!entries) {
        // not signed in yet (or the answer is not what was expected): keep waiting for the sign-in
        setText("Sign in to your REWE account below. The receipts are read as soon as you are signed in.");
        return;
      }
      if (!api || busy.current) return;
      busy.current = true;
      try {
        list.current = entries;
        const known = await api.knownReceipts("rewe_app", entries.map((e) => e.id));
        const ids = idsToRead(entries, known.unknown);
        left.current = known.unknown.length - ids.length;
        if (ids.length === 0) {
          busy.current = false;
          setPhase("done");
          setText(entries.length === 0 ? "There are no receipts in your REWE account." : "No new receipts.");
          return;
        }
        wanted.current = ids;
        details.current = new Map();
        setPhase("reading");
        setText(`Reading ${ids.length} new receipt${ids.length === 1 ? "" : "s"} from REWE…`);
        web.current?.injectJavaScript(detailScript(ids));
      } catch (e) {
        fail(e);
      }
    },
    [api, fail],
  );

  const onDone = useCallback(async () => {
    if (!api) return;
    try {
      setPhase("saving");
      setText("Saving the receipts…");
      const byId = new Map(list.current.map((e) => [e.id, e]));
      const receipts: ReceiptInput[] = [];
      let unreadable = 0;
      for (const id of wanted.current) {
        const entry = byId.get(id);
        const body = details.current.get(id);
        const r = entry && body ? toImport(entry, body) : null;
        if (r) receipts.push(r);
        else unreadable += 1;
      }
      const total = { imported: 0, duplicates: 0, skipped: unreadable, linked: 0 };
      for (let i = 0; i < receipts.length; i += 100) {
        const r = await api.importReceipts("rewe_app", receipts.slice(i, i + 100));
        total.imported += r.imported;
        total.duplicates += r.duplicates;
        total.skipped += r.skipped;
        total.linked += r.linked;
      }
      busy.current = false;
      wanted.current = [];
      setPhase("done");
      setText(runText(total, left.current));
    } catch (e) {
      fail(e);
    }
  }, [api, fail]);

  const onMessage = useCallback(
    (e: { nativeEvent: { url: string; data: string } }) => {
      // only the shop's own page may talk to the app
      if (!isShopPage(e.nativeEvent.url)) return;
      const m = parseMessage(e.nativeEvent.data);
      if (!m) return;
      if (m.kind === "list") void onList(m.status, m.body);
      else if (m.kind === "detail") {
        if (m.status === 200 && wanted.current.includes(m.id)) details.current.set(m.id, m.body);
      } else if (m.kind === "done" && phaseIs(wanted.current)) void onDone();
    },
    [onList, onDone],
  );

  if (loaded && !api) {
    return (
      <Page title="REWE receipts">
        <NeedsSetup />
      </Page>
    );
  }
  if (Platform.OS === "web") {
    return (
      <Page title="REWE receipts">
        <Empty title="This needs the phone app" message="The sign-in window for REWE is part of the phone app. In a browser, use the mailed eBon (the Email source) instead." />
      </Page>
    );
  }

  const finished = phase === "done" || phase === "error";
  return (
    <Page title="REWE receipts" subtitle="Unofficial, read in a window of the app" fixed>
      <Stack gap="md" grow>
        <Banner tone={phase === "error" ? "danger" : phase === "done" ? "success" : "info"}>{text}</Banner>
        {finished ? (
          <Card gap="md">
            <Text variant="body" tone="muted">
              The window is closed. Open this screen again whenever you want to read new receipts; if you are still signed in to REWE, that happens by itself.
            </Text>
            <Button label="Done" icon="check" onPress={() => (router.canGoBack() ? router.back() : router.replace("/receipt-sources"))} />
            <Button label="Read again" icon="refresh" variant="outline" onPress={() => { busy.current = false; setPhase("login"); setText("Reading again…"); }} />
          </Card>
        ) : (
          <>
            <Button label="I am signed in: read my receipts" icon="receipt-text-outline" variant="outline" onPress={readList} disabled={phase !== "login"} />
            <Box grow>
              <Browser
                ref={web}
                source={{ uri: REWE_START_URL }}
                originWhitelist={["https://rewe.de", "https://*.rewe.de"]}
                onShouldStartLoadWithRequest={(r: { url: string }) => isReweUrl(r.url)}
                onMessage={onMessage}
                onLoadEnd={() => {
                  if (phase === "login") readList();
                }}
                javaScriptEnabled
                domStorageEnabled
                sharedCookiesEnabled
                setSupportMultipleWindows={false}
              />
            </Box>
          </>
        )}
      </Stack>
    </Page>
  );
}

/** A run is on when receipts were asked for. */
function phaseIs(wanted: string[]): boolean {
  return wanted.length > 0;
}
