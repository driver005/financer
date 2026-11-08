import { useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { Box, FullScreenSheet, Group, IconBadge, IconButton, ListItem, Row, Scroll, Spinner, Stack, Text, TextField } from "@financer/ui";

import { useApi } from "@/api/config";
import { KIND_LABEL, KIND_ORDER, loadEntries, pageEntries, searchEntries, type MailChat, type SearchEntry, type SearchKind } from "@/globalSearch";
import { loadMailChats } from "@/mail/chats";
import { asIcon } from "@/uiTone";

const ICON: Record<SearchKind, string> = { page: "view-dashboard-outline", booking: "swap-vertical", chat: "email-outline", event: "calendar-month-outline", recipe: "chef-hat", price: "tag-outline" };
const TONE: Record<SearchKind, "accent" | "success" | "info" | "warning" | "danger" | "neutral"> = { page: "accent", booking: "success", chat: "info", event: "warning", recipe: "danger", price: "neutral" };
/** What the person's data is kept for, so that opening the search twice in a minute does not load it twice. */
const KEEP_MS = 60_000;
/** The pages shown before anything is typed. */
const JUMP = ["Spending", "Today", "Mail", "Calendar", "Prices", "Recipes", "Budget", "Settings"];

type Ctx = { open: () => void };
const SearchContext = createContext<Ctx>({ open: () => undefined });

/** Opens the one search of the app (also Ctrl or Cmd + K on the web). */
export const useGlobalSearch = () => useContext(SearchContext);

export function GlobalSearchProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <SearchContext.Provider value={value}>
      {children}
      <GlobalSearchSheet visible={visible} onClose={() => setVisible(false)} />
    </SearchContext.Provider>
  );
}

function GlobalSearchSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const { api, config, mode } = useApi();
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState<SearchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedAt = useRef(0);
  const pages = useMemo(pageEntries, []);

  // the person's own things are loaded when the search opens (and again after a minute)
  useEffect(() => {
    if (!visible || !api || Date.now() - loadedAt.current < KEEP_MS) return;
    let live = true;
    setLoading(true);
    const mail = async (): Promise<MailChat[]> => (mode === "remote" && config ? loadMailChats({ baseUrl: config.baseUrl, token: config.token }) : []);
    void loadEntries(api, mail).then((list) => {
      if (!live) return;
      setMine(list);
      loadedAt.current = Date.now();
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [visible, api, config, mode]);

  const all = useMemo(() => [...pages, ...mine], [pages, mine]);
  const hits = useMemo(() => searchEntries(all, query), [all, query]);
  const grouped = KIND_ORDER.map((k) => ({ kind: k, items: hits.filter((h) => h.kind === k) })).filter((g) => g.items.length > 0);
  const jump = JUMP.map((t) => pages.find((p) => p.title === t)).filter((p): p is SearchEntry => Boolean(p));

  const go = (e: SearchEntry) => {
    onClose();
    setQuery("");
    router.push(e.href as never);
  };
  const close = () => {
    onClose();
    setQuery("");
  };

  const row = (e: SearchEntry, i: number) => (
    <ListItem key={`${e.kind}-${i}-${e.title}`} leading={<IconBadge icon={asIcon(ICON[e.kind])} tone={TONE[e.kind]} />} title={e.title} subtitle={e.subtitle} chevron onPress={() => go(e)} />
  );

  return (
    <FullScreenSheet visible={visible} onClose={close}>
      <Box px="lg" pt="md" pb="sm">
        <Row gap="sm" align="center">
          <IconButton icon="arrow-left" label="Close the search" onPress={close} />
          <Box grow>
            <TextField variant="primary" pill autoFocus clearable value={query} onChangeText={setQuery} placeholder="Search the whole app" icon="magnify" returnKeyType="search" testID="global-search" />
          </Box>
        </Row>
      </Box>
      <Scroll>
        <Stack gap="lg" pb="xl">
          {query.trim() === "" ? (
            <Stack gap="sm">
              <Text variant="label" tone="muted">Jump to</Text>
              <Group inset>{jump.map(row)}</Group>
              <Text variant="caption" tone="muted">Bookings, events, recipes, prices and mail are found here too. A typo does not matter.</Text>
            </Stack>
          ) : grouped.length === 0 ? (
            <Stack gap="xs" align="center" py="xl">
              {loading ? <Spinner /> : null}
              <Text variant="bodyStrong">{loading ? "Looking through your things…" : "Nothing found"}</Text>
              {loading ? null : <Text variant="label" tone="muted" align="center">Try fewer letters or another word.</Text>}
            </Stack>
          ) : (
            grouped.map((g) => (
              <Stack key={g.kind} gap="sm">
                <Text variant="label" tone="muted">{KIND_LABEL[g.kind]}</Text>
                <Group inset>{g.items.map(row)}</Group>
              </Stack>
            ))
          )}
          {loading && grouped.length > 0 ? (
            <Row gap="sm" justify="center">
              <Spinner />
              <Text variant="caption" tone="muted">Still looking through your things…</Text>
            </Row>
          ) : null}
        </Stack>
      </Scroll>
    </FullScreenSheet>
  );
}
