import { useEffect, useState } from "react";

import { Banner, Box, Button, Card, Chip, ChipRow, EmptyState, Row, Screen, Section, Stack, Text, TextField, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { CategorySchema, Profile } from "../../api/types";
import { LEVELS, LEVEL_LABEL, currentLevel, groups, presetsFor, ratable, resetWeights, setLevel } from "../../logic/weights";
import { useNav } from "../nav";
import { useShop } from "../runtime";

/** What matters to you: importance per criterion, wishes (ecosystem, network), and a budget. */
export function WeightsScreen({ category }: { category: string }) {
  const shop = useShop();
  const nav = useNav();
  const [schema, setSchema] = useState<CategorySchema | null>(null);
  const [profile, setProfile] = useState<Profile>({});
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState("");

  useEffect(() => {
    const c = shop.client;
    if (!c) return;
    Promise.all([c.category(category), c.profiles()])
      .then(([detail, all]) => {
        setSchema(detail.resolved);
        const mine = all.find((x) => x.name === "default")?.profile ?? {};
        setProfile(mine);
        setBudget(mine.max_price_cents ? String(Math.round(mine.max_price_cents / 100)) : "");
      })
      .catch((e) => setError(e instanceof ShopApiError ? e.message : "Could not load the criteria."));
  }, [shop.client, category]);

  const header = <TopBar title="What matters to me" onBack={nav.pop} />;
  if (!schema) {
    return (
      <Screen header={header}>
        {error ? <Banner tone="danger">{error}</Banner> : <EmptyState icon="timer-sand" title="Loading…" />}
      </Screen>
    );
  }

  const criteria = ratable(schema, profile);
  const wishes = criteria.filter((c) => c.kind === "match") as ((typeof criteria)[number] & { kind: "match"; preference: string })[];
  const save = async () => {
    const euros = Number(budget.replace(",", "."));
    const next: Profile = { ...profile, max_price_cents: budget.trim() && Number.isFinite(euros) && euros > 0 ? Math.round(euros * 100) : null };
    try {
      await shop.client?.saveProfile("default", next);
      shop.bumpProfile();
      nav.pop();
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not save.");
    }
  };

  return (
    <Screen
      header={header}
      footer={
        <Box bg="surface" px="lg" py="md" shadow="lg">
          <Button label="Save and rank again" size="lg" full onPress={() => void save()} />
        </Box>
      }
    >
      <Text variant="body" tone="muted">Set how much each thing counts for {schema.name.toLowerCase()}. The ranking re-orders as soon as you save.</Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Section title="Start from">
        <ChipRow>
          {presetsFor(schema, profile).map((preset) => (
            <Chip key={preset.id} label={preset.label} onPress={() => setProfile({ ...profile, weights: preset.profile.weights })} />
          ))}
          <Chip label="Reset" icon="restore" onPress={() => setProfile(resetWeights(profile))} />
        </ChipRow>
      </Section>

      <Section title="Budget">
        <TextField label={schema.kind === "subscription" ? "Most per month (€)" : "Most to spend (€)"} value={budget} onChangeText={setBudget} keyboardType="numeric" placeholder="no limit" />
      </Section>

      {wishes.length > 0 ? (
        <Section title="Wishes" description="Things only you can say: which ecosystem, which network.">
          <Stack gap="md">
            {wishes.map((w) => {
              const pref = profile.preferences?.[w.preference] ?? {};
              return (
                <TextField
                  key={w.key}
                  label={`${w.label}: prefer (comma separated)`}
                  value={(pref.prefer ?? []).join(", ")}
                  onChangeText={(t) =>
                    setProfile({ ...profile, preferences: { ...(profile.preferences ?? {}), [w.preference]: { ...pref, prefer: t.split(",").map((x) => x.trim()).filter(Boolean) } } })
                  }
                  placeholder={w.preference === "ecosystem" ? "apple, samsung" : "telekom"}
                />
              );
            })}
          </Stack>
        </Section>
      ) : null}

      {groups(criteria).map((g) => (
        <Section key={g.id} title={g.label}>
          <Stack gap="sm">
            {g.criteria.map((c) => {
              const level = currentLevel(c, profile);
              return (
                <Card key={c.key} gap="sm">
                  <Text variant="bodyStrong">{c.label}</Text>
                  {c.description ? <Text variant="caption" tone="muted">{c.description}</Text> : null}
                  <Row wrap gap="xs">
                    {LEVELS.map((l) => (
                      <Chip key={l} label={LEVEL_LABEL[l]} selected={level === l} onPress={() => setProfile(setLevel(profile, c, l))} />
                    ))}
                  </Row>
                </Card>
              );
            })}
          </Stack>
        </Section>
      ))}

      <Section title="Change what is measured">
        <Row><Button label="Edit this category" variant="outline" tone="neutral" icon="pencil-outline" onPress={() => nav.push({ name: "category", id: category })} /></Row>
      </Section>
    </Screen>
  );
}
