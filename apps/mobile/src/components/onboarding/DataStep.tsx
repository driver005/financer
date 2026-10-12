import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { Api } from "@/api/client";
import { useApi } from "@/api/config";
import { HelperText, TextInput } from "@/components/kit";
import { ChoiceCard, FieldLabel, Note, StepFrame } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { mascotFor, validateServer, type BackendChoice } from "@/onboarding";

/**
 * The packaged web app is served by the server itself, so its own address is the server
 * address (same rule as in Settings). Not in development, where the page comes from Expo.
 */
function defaultServerUrl(): string {
  if (Platform.OS !== "web" || process.env.NODE_ENV !== "production") return "";
  return globalThis.location?.origin ?? "";
}

export function DataStep({ ctx }: { ctx: StepCtx }) {
  const { config, save, setMode, mode, embeddedAvailable, embeddedError } = useApi();
  const choice = ctx.draft.backend;
  const [baseUrl, setBaseUrl] = useState(defaultServerUrl);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // a saved server counts as connected until the address or token is edited
  const [connected, setConnected] = useState(false);

  // Replay or resume: start from what the app is set up with now.
  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl);
      setToken(config.token);
      setConnected(mode === "remote");
    }
    if (choice === undefined) {
      if (mode === "embedded" && embeddedAvailable) ctx.update({ backend: "embedded" });
      else if (config) ctx.update({ backend: "server" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, mode]);

  const check = validateServer(baseUrl, token);

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      // the same check as Settings: reachable, a Financer server, and the token works
      const probe = new Api({ baseUrl: check.normalized, token: token.trim() });
      if (!(await probe.health())) throw new Error("The server answered, but not as a Financer server");
      await probe.transactions();
      await save({ baseUrl: check.normalized, token: token.trim() });
      await setMode("remote");
      setConnected(true);
      setStatus({ text: "Connected. The address and token are saved.", ok: true });
    } catch (e) {
      setConnected(false);
      setStatus({ text: e instanceof Error ? e.message : "Could not connect", ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function choose(next: BackendChoice) {
    ctx.update({ backend: next });
    setStatus(null);
  }

  async function advance() {
    if (choice === "embedded") await setMode("embedded");
    ctx.next();
  }

  const primary =
    choice === "server" && !connected
      ? { label: busy ? "Connecting…" : "Test connection", onPress: () => void test(), disabled: busy || !check.ok, icon: "server-network" }
      : { label: "Continue", onPress: () => void advance(), disabled: choice === undefined, icon: "arrow-right" };

  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("data", ctx.draft, ctx.build)}
      title="Where should your data live?"
      why="This decides who holds your bookings. You can switch later in Settings and move your data with a backup file."
      primary={primary}
      onSkip={ctx.next}
    >
      <ChoiceCard
        icon="cellphone-lock"
        title="Compact: on this phone"
        body="The Rust backend runs inside the app, so there is nothing to host and your data never leaves the phone. Prices refresh when the app is open (and when the system allows a background run), and the data is not shared with other devices."
        selected={choice === "embedded"}
        disabled={!embeddedAvailable}
        note={embeddedAvailable ? undefined : "This build talks to a server"}
        onPress={() => void choose("embedded")}
      />
      <ChoiceCard
        icon="server-network"
        title="My own server"
        body="A server you run keeps refreshing prices around the clock, and every device you connect shows the same data. You have to host it and keep it running, which costs a small server."
        selected={choice === "server"}
        onPress={() => void choose("server")}
      />

      {choice === "embedded" && embeddedError ? <HelperText type="error" visible>{embeddedError}</HelperText> : null}

      {choice === "server" ? (
        <>
          <FieldLabel>Your server</FieldLabel>
          <TextInput
            mode="outlined"
            label="Address (use https://)"
            accessibilityLabel="Server address"
            value={baseUrl}
            onChangeText={(v) => {
              setBaseUrl(v);
              setConnected(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://financer.example.com"
          />
          <TextInput
            mode="outlined"
            label="API token"
            accessibilityLabel="API token"
            value={token}
            onChangeText={(v) => {
              setToken(v);
              setConnected(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={{ marginTop: 8 }}
          />
          {baseUrl.trim() && token.trim() && !check.ok ? <HelperText type="error" visible>{check.error}</HelperText> : null}
          {check.ok && check.warning ? <HelperText type="error" visible>{check.warning}</HelperText> : null}
          {status ? <HelperText type={status.ok ? "info" : "error"} visible>{status.text}</HelperText> : null}
          <Note icon="shield-lock-outline">
            Why we ask: the token is the password you set on the server (FINANCER_API_TOKEN). It is kept in this phone's secure storage and only sent to the address above.
          </Note>
        </>
      ) : null}
    </StepFrame>
  );
}
