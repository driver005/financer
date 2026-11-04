import { useCallback, useEffect, useState } from "react";

import { Badge, Banner, Button, Card, EmptyState, Row, Box, Screen, Section, Stack, Text, TextField, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { Profile } from "../../api/types";
import { DEFAULT_PROFILE, orderProfiles, profileNameProblem, profileSummary } from "../../logic/profiles";
import { useNav } from "../nav";
import { useShop } from "../runtime";

type Saved = { name: string; profile: Profile };

/** What matters to you, kept under names: switch the one searches use, keep a copy for a purpose, delete the ones you do not need. */
export function ProfilesScreen() {
  const shop = useShop();
  const nav = useNav();
  const { client } = shop;
  const [all, setAll] = useState<Saved[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setAll(orderProfiles(await client.profiles()));
      setError(null);
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not load the saved priorities.");
    }
  }, [client]);
  useEffect(() => void load(), [load]);

  const current = all?.find((p) => p.name === DEFAULT_PROFILE)?.profile;
  const nameProblem = name.trim() ? profileNameProblem(name, (all ?? []).map((p) => p.name)) : null;

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null);
    setNote(null);
    try {
      await action();
      shop.bumpProfile();
      setNote(done);
      await load();
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "That did not work.");
    }
  };

  return (
    <Screen maxW="normal" header={<TopBar title="Saved priorities" subtitle="What matters to you, by name" onBack={nav.pop} />}>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {note ? <Banner tone="success">{note}</Banner> : null}
      <Section title="Yours" description="Searches use the one marked in use. Change its priorities from any search result with What matters to me.">
        {all === null ? null : all.length === 0 ? (
          <EmptyState icon="tune-variant" title="Nothing saved yet" message="Set what matters to you from a search result, and it is kept here." />
        ) : (
          <Stack gap="sm">
            {all.map((p) => {
              const inUse = p.name === DEFAULT_PROFILE;
              return (
                <Card key={p.name} variant={inUse ? "raised" : "flat"} tone={inUse ? "accent" : undefined} gap="xs">
                  <Row justify="between" gap="sm">
                    <Box grow><Text variant="bodyStrong" tone={inUse ? "on-accent-soft" : "default"}>{inUse ? "In use for searches" : p.name}</Text></Box>
                    {inUse ? <Badge label="Active" tone="accent" solid /> : null}
                  </Row>
                  <Text variant="label" tone={inUse ? "on-accent-soft" : "muted"}>{profileSummary(p.profile)}</Text>
                  <Row gap="sm" wrap>
                    {inUse ? null : <Button label="Use for searches" size="sm" variant="soft" onPress={() => void run(() => client!.saveProfile(DEFAULT_PROFILE, p.profile), `Searches now use “${p.name}”.`)} />}
                    {asking === p.name ? (
                      <>
                        <Button label={inUse ? "Yes, clear it" : "Yes, delete it"} size="sm" tone="danger" onPress={() => { setAsking(null); void run(() => client!.deleteProfile(p.name), inUse ? "Cleared. Everything counts the same again." : `Deleted “${p.name}”.`); }} />
                        <Button label="Keep it" size="sm" variant="ghost" tone="neutral" onPress={() => setAsking(null)} />
                      </>
                    ) : (
                      <Button label={inUse ? "Clear" : "Delete"} size="sm" variant="ghost" tone="danger" onPress={() => setAsking(p.name)} />
                    )}
                  </Row>
                </Card>
              );
            })}
          </Stack>
        )}
      </Section>

      {current ? (
        <Section title="Keep a copy" description="Save what searches use now under a name, to come back to (a gift, work, a budget month)." card>
          <Stack gap="md">
            <TextField label="Name" value={name} onChangeText={setName} placeholder="Gift for Anna" capitalize error={nameProblem ?? undefined} />
            <Row><Button label="Save a copy" variant="soft" disabled={!name.trim() || Boolean(nameProblem)} onPress={() => void run(async () => { await client!.saveProfile(name.trim(), current); setName(""); }, "Saved.")} /></Row>
          </Stack>
        </Section>
      ) : null}
    </Screen>
  );
}
