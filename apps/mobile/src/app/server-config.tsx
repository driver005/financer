import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Banner, Box, Button, Expandable, Group, Note, Text } from "@financer/ui";

import { ApiError } from "@/api/client";
import { connectApi } from "@/api/connect";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { KeyField } from "@/components/serverConfig/KeyField";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
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
  const [view, setView] = useState<ConfigView | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; text: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<Message | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** The result of a save is shown in the bar at the foot of the page, so it is in view. */
  const show = useCallback((next: Message) => setMessage(next), []);

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
            return { view: await (await connectApi({ baseUrl: config.baseUrl, token: t })).serverConfig(), token: t };
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

  if (!loaded) return <Page title="Server settings"><Loading /></Page>;
  if (mode === "embedded") {
    return (
      <Page title="Server settings">
        <Empty title="This is for a server" message="The backend runs inside this app, so there is no financer.toml. Its few settings are under Settings > Backend." mood="happy" />
      </Page>
    );
  }
  if (!api) return <Page title="Server settings"><NeedsSetup /></Page>;
  const tooOld = loadError !== null && (loadError.status === 404 || /not found/i.test(loadError.text));
  const blocked = Object.keys(problems).length > 0;

  return (
    <Page
      title="Server settings"
      subtitle="What the server's financer.toml can hold, kept on the server"
      footer={
        view && (count > 0 || message) ? (
          <Box bg="surface" p="lg" gap="sm" accessibilityRole="alert">
            {message ? message.lines.map((line, i) => <Note key={i} tone={message.tone}>{line}</Note>) : null}
            {count > 0 ? (
              <>
                <Text variant="bodyStrong">{saveSummary(draft)}</Text>
                {confirming ? warnings.map((w) => <Note key={w.label} tone="error">{`${w.label}: ${w.warning}`}</Note>) : null}
                {blocked ? <Note tone="error">Fix the marked fields first.</Note> : null}
                <Button
                  label={phase === "saving" ? "Saving…" : phase === "restarting" ? "Restarting…" : confirming ? "Save anyway" : "Save and restart"}
                  icon="content-save-outline"
                  onPress={save}
                  disabled={phase !== "idle" || blocked || !view.writable}
                />
                <Button
                  variant="outline"
                  label="Discard"
                  onPress={() => {
                    setDraft(EMPTY_DRAFT);
                    setConfirming(false);
                  }}
                  disabled={phase !== "idle"}
                />
              </>
            ) : null}
          </Box>
        ) : null
      }
    >
      {tooOld ? (
        <Empty title="This server cannot do that yet" message="Update the server to a newer version to change its settings from the app." mood="worried" />
      ) : loadError && !view ? (
        <Empty title="Could not load the settings" message={loadError.text} actionLabel="Try again" actionIcon="refresh" onAction={() => void load()} mood="worried" />
      ) : null}
      {!view && !loadError ? <Loading rows={4} /> : null}

      {view ? (
        <>
          {phase === "restarting" ? <Banner tone="info">Restarting the server. This takes a few seconds, and this screen waits for it.</Banner> : null}
          {view.state === "rolled_back" && view.message && !message ? <Note tone="error">{view.message}</Note> : null}
          {!view.writable ? (
            <Note tone="error">
              {`The server cannot write its settings file (${view.settings_file}). Set FINANCER_SETTINGS_FILE on the server to a place it can write, such as the folder of its database.`}
            </Note>
          ) : null}
          {view.problems.map((problem) => (
            <Note key={problem} tone="error">{problem}</Note>
          ))}
          {view.warnings.map((warning) => (
            <Note key={warning}>{warning}</Note>
          ))}

          <Text variant="caption" tone="muted">Changes are saved on the server and applied by restarting it. A value set by an environment variable is locked.</Text>

          <Box pointerEvents={phase === "idle" ? "auto" : "none"}>
            <Group>
              {view.groups.map((group) => (
                <Expandable key={group.id} icon={group.icon as never} title={group.title} summary={groupSummary(group, draft)}>
                  <Text variant="caption" tone="muted">{group.hint}</Text>
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
                </Expandable>
              ))}
            </Group>
          </Box>
          <Text variant="caption" tone="muted">{`Kept in ${view.settings_file}, secrets included, readable by the server's user only. It ranks after financer.toml and before the environment.`}</Text>
        </>
      ) : null}
    </Page>
  );
}
