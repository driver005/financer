import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { ShopApiError } from "../../api/client";
import type { CategorySchema, Profile } from "../../api/types";
import { LEVELS, LEVEL_LABEL, currentLevel, groups, presetsFor, ratable, resetWeights, setLevel } from "../../logic/weights";
import { Banner, Body, Button, Card, Chip, Field, H2, Row, Screen, Title } from "../kit";
import { useNav } from "../nav";
import { useShop } from "../runtime";
import { usePalette, type } from "../theme";

/** What matters to you: importance per criterion, wishes (ecosystem, network), and a budget. */
export function WeightsScreen({ category }: { category: string }) {
  const shop = useShop();
  const nav = useNav();
  const p = usePalette();
  const [schema, setSchema] = useState<CategorySchema | null>(null);
  const [profile, setProfile] = useState<Profile>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
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

  if (!schema) {
    return (
      <Screen>
        <Title onBack={nav.pop}>What matters</Title>
        {error ? <Banner tone="bad">{error}</Banner> : <Body muted>Loading…</Body>}
      </Screen>
    );
  }

  const criteria = ratable(schema, profile);
  const wishes = criteria.filter((c) => c.kind === "match") as (typeof criteria[number] & { kind: "match"; preference: string })[];
  const save = async () => {
    const euros = Number(budget.replace(",", "."));
    const next: Profile = { ...profile, max_price_cents: budget.trim() && Number.isFinite(euros) && euros > 0 ? Math.round(euros * 100) : null };
    try {
      await shop.client?.saveProfile("default", next);
      shop.bumpProfile();
      setSaved(true);
      nav.pop();
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not save.");
    }
  };

  return (
    <Screen>
      <Title onBack={nav.pop}>What matters</Title>
      <Body muted>Set how much each thing counts for {schema.name.toLowerCase()}. The ranking re-orders as soon as you save.</Body>
      {error ? <Banner tone="bad">{error}</Banner> : null}

      <H2>Start from</H2>
      <Row wrap>
        {presetsFor(schema, profile).map((preset) => (
          <Chip key={preset.id} label={preset.label} onPress={() => setProfile({ ...profile, weights: preset.profile.weights })} />
        ))}
        <Chip label="Reset" onPress={() => setProfile(resetWeights(profile))} />
      </Row>

      <H2>Budget</H2>
      <Field label={schema.kind === "subscription" ? "Most per month (€)" : "Most to spend (€)"} value={budget} onChangeText={setBudget} keyboardType="numeric" placeholder="no limit" />

      {wishes.length > 0 ? <H2>Wishes</H2> : null}
      {wishes.map((w) => {
        const pref = profile.preferences?.[w.preference] ?? {};
        return (
          <Field
            key={w.key}
            label={`${w.label}: prefer (comma separated)`}
            value={(pref.prefer ?? []).join(", ")}
            onChangeText={(t) =>
              setProfile({
                ...profile,
                preferences: { ...(profile.preferences ?? {}), [w.preference]: { ...pref, prefer: t.split(",").map((x) => x.trim()).filter(Boolean) } },
              })
            }
            placeholder={w.preference === "ecosystem" ? "apple, samsung" : "telekom"}
          />
        );
      })}

      {groups(criteria).map((g) => (
        <View key={g.id} style={{ gap: 8 }}>
          <H2>{g.label}</H2>
          {g.criteria.map((c) => {
            const level = currentLevel(c, profile);
            return (
              <Card key={c.key}>
                <Text style={[type.body, { color: p.text, fontWeight: "600" }]}>{c.label}</Text>
                {c.description ? <Body small muted>{c.description}</Body> : null}
                <Row wrap>
                  {LEVELS.map((l) => (
                    <Chip key={l} label={LEVEL_LABEL[l]} selected={level === l} onPress={() => setProfile(setLevel(profile, c, l))} />
                  ))}
                </Row>
              </Card>
            );
          })}
        </View>
      ))}
      <Button label={saved ? "Saved" : "Save and rank again"} onPress={save} />
      <Button label="Change what is measured" kind="secondary" onPress={() => nav.push({ name: "category", id: category })} />
    </Screen>
  );
}
