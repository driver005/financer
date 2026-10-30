import { useState } from "react";
import { Switch, View } from "react-native";

import { SOURCES_EXAMPLE, checkSources } from "../../logic/sources";
import { Banner, Body, Button, Card, Field, H2, Problems, Row, Screen, Segmented, Title } from "../kit";
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

  return (
    <Screen>
      <Title onBack={nav.pop}>Settings</Title>
      {shop.status === "error" ? <Banner tone="bad">{shop.error ?? "Could not connect."}</Banner> : null}
      {shop.status === "unconfigured" ? <Banner tone="warn">Choose where the searching happens.</Banner> : null}
      {note ? <Banner>{note}</Banner> : null}

      <H2>Where it runs</H2>
      <Segmented<Mode>
        value={mode === "auto" ? "server" : mode}
        onChange={setMode}
        options={[
          { value: "server", label: "My server" },
          ...(canPhone ? [{ value: "phone" as const, label: "This phone" }] : []),
        ]}
      />
      {mode === "phone" ? (
        <Body small muted>
          The phone reads the web only when you press Search, shows progress in a notification, and keeps everything on this device. It cannot watch prices while the app is closed.
        </Body>
      ) : (
        <Body small muted>
          A server searches all the time like a search engine, keeps price history and tells you about deals, even when this app is closed.
        </Body>
      )}
      {mode !== "phone" ? (
        <>
          <Field label="Server address" value={url} onChangeText={setUrl} placeholder="https://shop.example.com" keyboardType="url" />
          <Field label="Token" value={token} onChangeText={setToken} secureTextEntry placeholder="FINANCER_SHOP_API_TOKEN" />
        </>
      ) : null}
      <Button label="Connect" onPress={connect} busy={busy} />

      {shop.info ? (
        <Card>
          <Body>{shop.info.mode === "server" ? "Server mode" : "Integrated mode"}</Body>
          <Body small muted>
            {`${shop.info.products} products · ${shop.info.sources.length} shops · ${shop.info.categories} categories`}
          </Body>
          {shop.info.notifiers.length > 0 ? <Body small muted>{`Deal messages through: ${shop.info.notifiers.join(", ")}`}</Body> : null}
          {shop.info.last_error ? <Body small>{`Last problem: ${shop.info.last_error}`}</Body> : null}
        </Card>
      ) : null}

      <H2>Alerts</H2>
      <Row between>
        <View style={{ flex: 1 }}>
          <Body>Tell me about deals</Body>
          <Body small muted>
            {shop.where === "server" ? "The server pushes them; this app also shows the ones it finds when open." : "Shown when a search finds a watched price."}
          </Body>
        </View>
        <Switch value={alerts} onValueChange={toggleAlerts} accessibilityLabel="Tell me about deals" />
      </Row>

      <H2>More</H2>
      <Button label="Shops to read" kind="secondary" onPress={() => nav.push({ name: "sources" })} />
      <Button label="Categories and criteria" kind="secondary" onPress={() => nav.push({ name: "categories" })} />
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
    <Screen>
      <Title onBack={nav.pop}>Shops to read</Title>
      {!phone ? (
        <>
          <Banner>
            A server reads the shops listed in its own sources file (FINANCER_SHOP_SOURCES). These are the ones it reads now:
          </Banner>
          {(shop.info?.sources ?? []).map((s) => (
            <Card key={s.name}>
              <Body>{s.name}</Body>
              <Body small muted>{`${s.kind}${s.category ? ` · ${s.category}` : ""}`}</Body>
            </Card>
          ))}
        </>
      ) : (
        <>
          <Body muted>
            Say where prices and specs come from: product pages with schema.org data, a shop search, a product feed (CSV or JSON) or a sitemap. Adding a shop is adding an entry.
          </Body>
          <Field label="Sources (JSON)" value={text} onChangeText={setText} multiline placeholder="[ ... ]" />
          <Problems items={problems} />
          <Row wrap>
            <Button label="Use the example" kind="secondary" onPress={() => setText(SOURCES_EXAMPLE)} />
          </Row>
          <H2>Reading pages without structured data (optional)</H2>
          <Body small muted>
            A Claude or OpenAI key lets the phone read ordinary pages with a model. The page text is sent to the provider, so it is off unless a source asks for it (use_llm).
          </Body>
          <Field label="Claude API key" value={claude} onChangeText={setClaude} secureTextEntry />
          <Field label="OpenAI API key" value={openai} onChangeText={setOpenai} secureTextEntry />
          <Button label={saved ? "Saved" : "Save"} onPress={save} />
        </>
      )}
    </Screen>
  );
}
