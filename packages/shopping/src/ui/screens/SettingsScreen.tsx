import { useState } from "react";

import { Badge, Banner, Box, Button, Card, Divider, ListItem, Row, Screen, Section, Segmented, Split, Stack, SwitchRow, Text, TextField, TopBar } from "@financer/ui";

import { SOURCES_EXAMPLE, checkSources } from "../../logic/sources";
import { useNav } from "../nav";
import { useShop, type Mode } from "../runtime";

export function SettingsScreen() {
  const shop = useShop();
  const nav = useNav();
  const canPhone = Boolean(shop.host.startEmbedded);
  const [mode, setMode] = useState<Mode>(shop.settings.mode === "auto" ? (shop.where === "server" ? "server" : canPhone ? "phone" : "server") : shop.settings.mode);
  const [url, setUrl] = useState(shop.settings.serverUrl);
  const [token, setToken] = useState(shop.secrets.token);
  const [alerts, setAlerts] = useState(shop.settings.dealAlerts);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setNote(null);
    try {
      await shop.save({ mode, serverUrl: url.trim() }, { token: token.trim() });
      setNote("Saved.");
    } finally {
      setBusy(false);
    }
  };

  const toggleAlerts = async (on: boolean) => {
    setAlerts(on);
    if (on && !(await shop.host.notices.requestPermission())) {
      setAlerts(false);
      setNote("Notifications are not allowed for this app. Allow them in the system settings.");
      return;
    }
    await shop.save({ dealAlerts: on });
    if (on && shop.where === "server" && shop.client && shop.host.notices.pushToken) {
      try {
        const t = await shop.host.notices.pushToken();
        if (t) await shop.client.addPushToken(t);
      } catch {
        setNote("Alerts work while the app is open. Push when it is closed needs the server's Expo push setting.");
      }
    }
  };

  const onMore = nav.stack.length === 0;
  return (
    <Screen header={<TopBar title="Settings" onBack={onMore ? undefined : nav.pop} />}>
      {shop.status === "error" ? <Banner tone="danger">{shop.error ?? "Could not connect."}</Banner> : null}
      {shop.status === "unconfigured" ? <Banner tone="warning">Choose where the searching happens.</Banner> : null}
      {note ? <Banner tone="success">{note}</Banner> : null}

      <Split from="expanded">
        <Stack gap="xl">
        <Section title="Where it runs" card>
          <>
            <Segmented<Mode>
              value={mode === "auto" ? "server" : mode}
              onChange={setMode}
              options={[{ value: "server", label: "My server" }, ...(canPhone ? [{ value: "phone" as const, label: "This phone" }] : [])]}
            />
            <Text variant="caption" tone="muted">
              {mode === "phone"
                ? "The phone reads the web only when you press Search, shows progress in a notification, and keeps everything on this device. It cannot watch prices while the app is closed."
                : "A server searches all the time like a search engine, keeps price history and tells you about deals, even when this app is closed."}
            </Text>
            {mode !== "phone" ? (
              <>
                <TextField label="Server address" value={url} onChangeText={setUrl} placeholder="https://shop.example.com" keyboardType="url" />
                <TextField label="Token" value={token} onChangeText={setToken} secure placeholder="FINANCER_SHOP_API_TOKEN" />
              </>
            ) : null}
            <Row><Button label="Connect" onPress={() => void connect()} loading={busy} /></Row>
          </>
        </Section>
        </Stack>
        <Stack gap="xl">
        {shop.info ? (
          <Card tone="accent" gap="xs">
            <Row gap="sm"><Text variant="bodyStrong" tone="on-accent-soft">{shop.info.mode === "server" ? "Server mode" : "Integrated mode"}</Text><Badge label="connected" tone="success" /></Row>
            <Text variant="caption" tone="on-accent-soft">{`${shop.info.products} products · ${shop.info.sources.length} shops · ${shop.info.categories} categories`}</Text>
            {shop.info.notifiers.length > 0 ? <Text variant="caption" tone="on-accent-soft">{`Deal messages through: ${shop.info.notifiers.join(", ")}`}</Text> : null}
            {shop.info.last_error ? <Text variant="caption" tone="on-accent-soft">{`Last problem: ${shop.info.last_error}`}</Text> : null}
          </Card>
        ) : null}

        <Section title="Alerts" card>
          <SwitchRow
            label="Tell me about deals"
            description={shop.where === "server" ? "The server pushes them; this app also shows the ones it finds when open." : "Shown when a search finds a watched price."}
            value={alerts}
            onChange={(v) => void toggleAlerts(v)}
          />
        </Section>

        <Section title="More">
          <Card padded={false}>
            <Box px="lg">
              <ListItem title="Shops to read" subtitle="Where prices and specs come from" icon="storefront-outline" onPress={() => nav.push({ name: "sources" })} />
              <Divider />
              <ListItem title="Categories and criteria" subtitle="Change what is measured" icon="shape-outline" onPress={() => nav.push({ name: "categories" })} />
            </Box>
          </Card>
        </Section>
        </Stack>
      </Split>
    </Screen>
  );
}

export function SourcesScreen() {
  const shop = useShop();
  const nav = useNav();
  const phone = shop.where === "phone";
  const [text, setText] = useState(shop.settings.sourcesJson);
  const [claude, setClaude] = useState(shop.secrets.claude);
  const [openai, setOpenai] = useState(shop.secrets.openai);
  const [problems, setProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const check = checkSources(text);
    if (!check.ok) return setProblems(check.problems);
    setProblems([]);
    await shop.save({ sourcesJson: text }, { claude: claude.trim(), openai: openai.trim() });
    setSaved(true);
  };

  return (
    <Screen header={<TopBar title="Shops to read" onBack={nav.pop} />}>
      {!phone ? (
        <>
          <Banner tone="info">A server reads the shops listed in its own sources file (FINANCER_SHOP_SOURCES). These are the ones it reads now:</Banner>
          <Card padded={false}>
            <Box px="lg">
              {(shop.info?.sources ?? []).map((s, i) => (
                <Box key={s.name}>
                  {i > 0 ? <Divider /> : null}
                  <ListItem title={s.name} subtitle={`${s.kind}${s.category ? ` · ${s.category}` : ""}`} icon="storefront-outline" />
                </Box>
              ))}
            </Box>
          </Card>
        </>
      ) : (
        <>
          <Card gap="md">
          <Text variant="body" tone="muted">
            Say where prices and specs come from: product pages with schema.org data, a shop search, a product feed (CSV or JSON) or a sitemap. Adding a shop is adding an entry.
          </Text>
          <Stack gap="md">
            <TextField label="Sources (JSON)" value={text} onChangeText={setText} multiline placeholder="[ ... ]" />
            {problems.length > 0 ? (
              <Banner tone="danger" title="Not saved">
                <Stack gap="xs">{problems.map((m) => <Text key={m} variant="body" tone="on-danger-soft">• {m}</Text>)}</Stack>
              </Banner>
            ) : null}
            <Row><Button label="Use the example" variant="outline" tone="neutral" onPress={() => setText(SOURCES_EXAMPLE)} /></Row>
          </Stack>
          </Card>
          <Section card title="Reading pages without structured data (optional)" description="A Claude or OpenAI key lets the phone read ordinary pages with a model. The page text is sent to the provider, so it is off unless a source asks for it (use_llm).">
            <Stack gap="md">
              <TextField label="Claude API key" value={claude} onChangeText={setClaude} secure />
              <TextField label="OpenAI API key" value={openai} onChangeText={setOpenai} secure />
            </Stack>
          </Section>
          <Row><Button label={saved ? "Saved" : "Save"} size="lg" onPress={() => void save()} /></Row>
        </>
      )}
    </Screen>
  );
}
