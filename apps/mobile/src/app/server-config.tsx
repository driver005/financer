import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text as RNText, View, type ScrollViewInstance } from "react-native";

import { Api, ApiError } from "@/api/client";
import { useApi } from "@/api/config";
import { EmptyState } from "@/components/EmptyState";
import { ChunkyButton } from "@/components/kit";
import { KeyField } from "@/components/serverConfig/KeyField";
import { FieldMessage, PanelText, SettingsGroup, SettingsPanel } from "@/components/settings/SettingsKit";
import { SkeletonList } from "@/components/Skeleton";
import { Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import {
  EMPTY_DRAFT,
  changeCount,
  clearSecret,
  discardKey,
  draftProblems,
  editorValue,
  groupSummary,
  newToken,
  resetKey,
  saveSummary,
  savedText,
  setValue,
  timeoutText,
  toChange,
  waitForRestart,
  warningsFor,
  type ConfigView,
  type Draft,
} from "@/serverConfig";
import { space, usePalette } from "@/theme";

type Message = { tone: "error" | "ok" | "info"; lines: string[] };
type Phase = "idle" | "saving" | "restarting";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Server settings: every key of the server's financer.toml, grouped, with the value in force, where
 * it comes from, and an editor. Changes are collected, checked by the server when you save, and
 * applied by a restart of the server (a few seconds). If the changed settings do not start, the
 * server puts the previous ones back and says so here.
 */
export default function ServerConfigScreen() {
  const { api, config, mode, loaded, save: saveConnection } = useApi();
  const p = usePalette();
  const [view, setView] = useState<ConfigView | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<Message | null>(null);
  const [confirming, setConfirming] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);

  /** The result of a save is at the top; bring it into view. */
  const show = useCallback((next: Message) => {
    setMessage(next);
    scroller.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setView(await api.serverConfig());
      setLoadError(null);
    } catch (e) {
      setLoadError({ status: e instanceof ApiError ? e.status : 0, text: e instanceof Error ? e.message : "Something went wrong" });
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      if (phase === "idle") void load();
    }, [load, phase]),
  );

  const problems = view ? draftProblems(view, draft) : {};
  const warnings = view ? warningsFor(view, draft) : [];
  const count = changeCount(draft);

  async function apply() {
    if (!api || !view || !config) return;
    setConfirming(false);
    setMessage(null);
    setPhase("saving");
    const token = newToken(draft);
    const listenAddressChanged = "server.bind" in draft.set || draft.reset.includes("server.bind");
    try {
      const saved = await api.saveServerConfig(toChange(view, draft));
      if (!saved.restarting) {
        show({ tone: "info", lines: [savedText(saved)] });
        setDraft(EMPTY_DRAFT);
        setPhase("idle");
        await load();
        return;
      }
      setPhase("restarting");
      // the server answers with the old token until it has restarted, and with the new one after
      const tokens = token && token !== config.token ? [token, config.token] : [config.token];
      const outcome = await waitForRestart(async () => {
        let last: unknown = new Error("no answer");
        for (const t of tokens) {
          try {
            return { view: await new Api({ baseUrl: config.baseUrl, token: t }).serverConfig(), token: t };
          } catch (e) {
            last = e;
          }
        }
        throw last;
      }, sleep);
      if (outcome.kind === "timeout") {
        show({ tone: "error", lines: [timeoutText(listenAddressChanged)] });
        return;
      }
      if (outcome.token !== config.token) await saveConnection({ baseUrl: config.baseUrl, token: outcome.token });
      setView(outcome.view);
      if (outcome.kind === "rolled_back") {
        show({
          tone: "error",
          lines: [outcome.view.message ?? "The changed settings did not start, so the previous ones are back.", "Your edits are still here; fix them and save again."],
        });
      } else {
        setDraft(EMPTY_DRAFT);
        show({ tone: "ok", lines: ["Saved. The server restarted with the new settings.", ...saved.warnings] });
      }
    } catch (e) {
      const lines = e instanceof ApiError && e.problems.length > 0 ? e.problems : [e instanceof Error ? e.message : "Could not save"];
      show({ tone: "error", lines: ["Nothing was saved.", ...lines] });
    } finally {
      setPhase("idle");
    }
  }

  function save() {
    if (warnings.length > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    void apply();
  }

  if (!loaded) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (mode === "embedded") {
    return (
      <Screen>
        <Title>Server settings</Title>
        <EmptyState
          title="This is for a server"
          message="The backend runs inside this app, so there is no financer.toml. Its few settings are under Settings > Backend."
          mood="happy"
        />
      </Screen>
    );
  }
  if (!api) {
    return (
      <Screen>
        <Title>Server settings</Title>
        <NeedsSetup />
      </Screen>
    );
  }
  const tooOld = loadError !== null && (loadError.status === 404 || /not found/i.test(loadError.text));

  return (
    <Screen>
      <Title subtitle="What the server's financer.toml can hold, kept on the server">Server settings</Title>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: space.xxl }}>
          {tooOld ? (
            <EmptyState title="This server cannot do that yet" message="Update the server to a newer version to change its settings from the app." mood="worried" />
          ) : loadError && !view ? (
            <EmptyState title="Could not load the settings" message={loadError.text} actionLabel="Try again" actionIcon="refresh" onAction={() => void load()} mood="worried" />
          ) : null}
          {!view && !loadError ? <SkeletonList rows={4} label="Loading the server settings" /> : null}

          {view ? (
            <>
              {phase === "restarting" ? (
                <Card>
                  <FieldMessage>Restarting the server. This takes a few seconds, and this screen waits for it.</FieldMessage>
                </Card>
              ) : null}
              {view.state === "rolled_back" && view.message && !message ? (
                <FieldMessage tone="error">{view.message}</FieldMessage>
              ) : null}
              {!view.writable ? (
                <FieldMessage tone="error">
                  The server cannot write its settings file ({view.settings_file}). Set FINANCER_SETTINGS_FILE on the server to a place it can write, such as the folder of its database.
                </FieldMessage>
              ) : null}
              {view.problems.map((problem) => (
                <FieldMessage key={problem} tone="error">
                  {problem}
                </FieldMessage>
              ))}
              {view.warnings.map((warning) => (
                <FieldMessage key={warning}>{warning}</FieldMessage>
              ))}
              {message ? (
                <View style={{ marginTop: space.sm }}>
                  {message.lines.map((line, i) => (
                    <FieldMessage key={i} tone={message.tone}>
                      {line}
                    </FieldMessage>
                  ))}
                </View>
              ) : null}

              <PanelText style={{ paddingHorizontal: space.xs, marginTop: space.xs }}>
                Changes are saved on the server and applied by restarting it. A value set by an environment variable is locked.
              </PanelText>

              <View style={{ marginTop: space.md }} pointerEvents={phase === "idle" ? "auto" : "none"}>
                <SettingsGroup>
                  {view.groups.map((group) => (
                    <SettingsPanel key={group.id} icon={group.icon} title={group.title} summary={groupSummary(group, draft)}>
                      <PanelText style={{ marginTop: 4 }}>{group.hint}</PanelText>
                      {group.keys.map((k) => (
                        <KeyField
                          key={k.path}
                          k={k}
                          draft={draft}
                          value={editorValue(k, draft)}
                          problem={problems[k.path]}
                          onChange={(next) => setDraft((d) => setValue(d, k, next))}
                          onClear={() => setDraft((d) => clearSecret(d, k))}
                          onReset={() => setDraft((d) => resetKey(d, k))}
                          onUndo={() => setDraft((d) => discardKey(d, k))}
                        />
                      ))}
                    </SettingsPanel>
                  ))}
                </SettingsGroup>
              </View>
              <PanelText style={{ paddingHorizontal: space.xs }}>
                Kept in {view.settings_file}, secrets included, readable by the server's user only. It ranks after financer.toml and before the environment.
              </PanelText>
            </>
          ) : null}
        </ScrollView>

        {view && count > 0 ? (
          <View
            accessibilityLiveRegion="polite"
            style={{ borderTopWidth: 1, borderTopColor: p.border, backgroundColor: p.surface, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm }}
          >
            <RNText style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{saveSummary(draft)}</RNText>
            {confirming ? (
              <View style={{ gap: space.xs }}>
                {warnings.map((w) => (
                  <FieldMessage key={w.label} tone="error">
                    {w.label}: {w.warning}
                  </FieldMessage>
                ))}
              </View>
            ) : null}
            {Object.keys(problems).length > 0 ? <FieldMessage tone="error">Fix the marked fields first.</FieldMessage> : null}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <ChunkyButton
                label={phase === "saving" ? "Saving…" : phase === "restarting" ? "Restarting…" : confirming ? "Save anyway" : "Save and restart"}
                icon="content-save-outline"
                onPress={save}
                disabled={phase !== "idle" || Object.keys(problems).length > 0 || !view.writable}
                style={{ flex: 1 }}
              />
              <ChunkyButton
                outline
                label="Discard"
                onPress={() => {
                  setDraft(EMPTY_DRAFT);
                  setConfirming(false);
                }}
                disabled={phase !== "idle"}
              />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}
