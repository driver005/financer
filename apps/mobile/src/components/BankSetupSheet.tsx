import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Button, Chip, ChipRow, Note, Sheet, Spinner, Text, TextField, ListItem } from "@financer/ui";

import { ApiError } from "@/api/client";
import { connectApi } from "@/api/connect";
import { useApi } from "@/api/config";
import type { BankConnection } from "@/api/client";
import {
  SOURCES,
  linksOnceSource,
  setupBlocked,
  setupChange,
  setupDefaults,
  setupFields,
  setupProblems,
  sourceInfo,
  sourceStatus,
  type SetupValues,
  type SourceId,
} from "@/bankSetup";
import { savedText, waitForRestart, type ConfigView } from "@/serverConfig";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Phase = "idle" | "saving" | "restarting";

/**
 * "What do you want to connect?": the menu of every source (CSV file, Sparkasse over FinTS, GoCardless,
 * Plaid, finAPI). A CSV import and FinTS start right away; the other three ask for their keys (when the
 * server does not have them yet) and a name, save that into the server's settings, and wait for the
 * server to restart. Then the Spending screen shows the new connection with its "Connect" button.
 */
export function BankSetupSheet({
  visible,
  start,
  list,
  onClose,
  onImportCsv,
  onSaved,
}: {
  visible: boolean;
  /** Open straight on this source's form instead of the menu. */
  start?: SourceId;
  list: BankConnection[];
  onClose: () => void;
  onImportCsv: () => void;
  /** The setup was saved and the server restarted with it. */
  onSaved: (id: SourceId) => void;
}) {
  const { api, config, mode } = useApi();
  const router = useRouter();
  const [chosen, setChosen] = useState<SourceId | null>(null);
  const [view, setView] = useState<ConfigView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<SetupValues>({});
  const [shown, setShown] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setChosen(start && linksOnceSource(start) ? start : null);
    setValues({});
    setShown(false);
    setError([]);
    setPhase("idle");
  }, [visible, start]);

  // the form needs the server's settings (what it has, what is locked)
  useEffect(() => {
    if (!visible || chosen === null || !linksOnceSource(chosen) || !api || mode === "embedded") return;
    let alive = true;
    setView(null);
    setLoadError(null);
    api
      .serverConfig()
      .then((v) => {
        if (!alive) return;
        setView(v);
        setValues(setupDefaults(setupFields(v, chosen)));
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : "Could not read the server's settings");
      });
    return () => {
      alive = false;
    };
  }, [visible, chosen, api, mode]);

  const choose = useCallback(
    (id: SourceId) => {
      if (id === "csv") {
        onClose();
        onImportCsv();
      } else if (id === "fints") {
        onClose();
        router.push("/sync");
      } else {
        setChosen(id);
      }
    },
    [onClose, onImportCsv, router],
  );

  async function save() {
    if (!api || !config || !view || chosen === null) return;
    setShown(true);
    if (Object.keys(setupProblems(view, chosen, values)).length > 0) return;
    setError([]);
    setPhase("saving");
    try {
      const saved = await api.saveServerConfig(setupChange(view, chosen, values));
      if (saved.restarting) {
        setPhase("restarting");
        const outcome = await waitForRestart(async () => ({ view: await (await connectApi({ baseUrl: config.baseUrl, token: config.token })).serverConfig(), token: config.token }), sleep);
        if (outcome.kind === "timeout") {
          setError(["The server did not come back within a minute. Check that it is running, then open this menu again."]);
          return;
        }
        if (outcome.kind === "rolled_back") {
          setError([outcome.view.message ?? "The new settings did not start, so the previous ones are back.", "Check the keys and try again."]);
          return;
        }
      } else {
        setError([savedText(saved)]);
      }
      onSaved(chosen);
    } catch (e) {
      setError(e instanceof ApiError && e.problems.length > 0 ? ["Nothing was saved.", ...e.problems] : ["Nothing was saved.", e instanceof Error ? e.message : "Could not save"]);
    } finally {
      setPhase("idle");
    }
  }

  const info = chosen ? sourceInfo(chosen) : null;
  const blocked = chosen === null ? null : mode === "embedded" ? "The backend runs inside this app and has no server settings. Use CSV import here, or run the server and set this up there." : setupBlocked(view, chosen);
  const fields = view && chosen ? setupFields(view, chosen) : [];
  const problems = view && chosen && shown ? setupProblems(view, chosen, values) : {};
  const working = phase !== "idle";

  return (
    <Sheet visible={visible} onClose={working ? () => {} : onClose} title={info ? `Set up ${info.label}` : "Connect your transactions"}>
      {info === null ? (
        <Box gap="sm">
          <Text variant="caption" tone="muted">Pick where your transactions come from. You can use several and switch between them on the Spending screen.</Text>
          {SOURCES.map((s) => (
            <ListItem
              key={s.id}
              icon={s.icon}
              tile
              title={s.label}
              subtitle={s.blurb}
              trailing={<Badge label={sourceStatus(list, s.id)} tone={s.id !== "csv" && list.some((c) => c.kind === s.id) ? "success" : "neutral"} />}
              chevron
              onPress={() => choose(s.id)}
            />
          ))}
          <Button label="Close" variant="ghost" onPress={onClose} />
        </Box>
      ) : (
        <Box gap="md">
          <Text variant="body" tone="muted">{info.blurb}</Text>
          {blocked ? <Note tone="error">{blocked}</Note> : null}
          {loadError ? <Note tone="error">{loadError}</Note> : null}
          {!blocked && !loadError && !view ? (
            <Box direction="row" gap="md" align="center">
              <Spinner />
              <Text variant="body">Reading the server's settings…</Text>
            </Box>
          ) : null}
          {view && !blocked ? (
            <>
              {fields.length <= 1 ? <Text variant="caption" tone="muted">The server already has the keys for this provider, so only a name is needed.</Text> : <Text variant="caption" tone="muted">{`Needs: ${info.needs} The keys are saved on the server, never in this app.`}</Text>}
              {fields.map((f) =>
                f.options ? (
                  <Box key={f.id} gap="xs">
                    <Text variant="label" tone="muted">{f.label}</Text>
                    <ChipRow>
                      {f.options.map((o) => (
                        <Chip key={o} label={o} selected={(values[f.id] ?? f.options?.[0]) === o} onPress={() => setValues((cur) => ({ ...cur, [f.id]: o }))} />
                      ))}
                    </ChipRow>
                    {f.help ? <Text variant="caption" tone="muted">{f.help}</Text> : null}
                  </Box>
                ) : (
                  <TextField
                    key={f.id}
                    label={f.label}
                    value={values[f.id] ?? ""}
                    onChangeText={(v) => setValues((cur) => ({ ...cur, [f.id]: v }))}
                    placeholder={f.placeholder}
                    helper={f.help}
                    error={problems[f.id]}
                    secure={f.secret}
                    editable={!working}
                  />
                ),
              )}
              {error.map((line) => (
                <Note key={line} tone="error">{line}</Note>
              ))}
              {phase === "restarting" ? <Note>Restarting the server. This takes a few seconds.</Note> : null}
              <Button label={phase === "saving" ? "Saving…" : phase === "restarting" ? "Restarting…" : "Save and restart"} icon="content-save-outline" onPress={() => void save()} disabled={working} />
            </>
          ) : null}
          <Button label="Back" variant="ghost" onPress={() => setChosen(null)} disabled={working} />
        </Box>
      )}
    </Sheet>
  );
}
