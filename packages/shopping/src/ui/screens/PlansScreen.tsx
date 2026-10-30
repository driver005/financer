import { useEffect, useState } from "react";

import { ShopApiError } from "../../api/client";
import type { CategoryItem, MyPlan } from "../../api/types";
import { Banner, Body, Button, Card, Chip, Empty, Field, H2, Row, Screen, Title } from "../kit";
import { useShop } from "../runtime";
import { SearchScreen } from "./SearchScreen";

/**
 * Subscriptions: phone plans, home internet, streaming. They are ranked by what they really
 * cost over the term (promotions, fees, cash back), and compared with what you pay now.
 */
export function PlansScreen() {
  const { client } = useShop();
  const [cats, setCats] = useState<CategoryItem[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [mine, setMine] = useState<MyPlan | null>(null);
  const [name, setName] = useState("");
  const [monthly, setMonthly] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    client?.categories().then((all) => {
      const subs = all.filter((c) => c.kind === "subscription");
      setCats(subs);
      setCurrent((c) => c ?? subs[0]?.id ?? null);
    });
  }, [client]);

  useEffect(() => {
    if (!client || !current) return;
    setSaved(false);
    client.myPlan(current).then((m) => {
      setMine(m);
      setName(m?.name ?? "");
      setMonthly(m ? String((m.monthly_cents / 100).toFixed(2)) : "");
    });
  }, [client, current]);

  const save = async () => {
    const euros = Number(monthly.replace(",", "."));
    if (!client || !current || !(euros >= 0)) return;
    try {
      setMine(await client.saveMyPlan(current, { name: name.trim() || null, monthly_cents: Math.round(euros * 100) }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not save.");
    }
  };

  if (cats.length === 0) {
    return (
      <Screen>
        <Title>Subscriptions</Title>
        <Empty title="No subscription categories" message="Add one under More › Categories, for example a gym or an insurance." />
      </Screen>
    );
  }
  const category = cats.find((c) => c.id === current) ?? cats[0];
  const header = (
    <>
      <Row wrap>
        {cats.map((c) => (
          <Chip key={c.id} label={c.name} selected={c.id === category.id} onPress={() => setCurrent(c.id)} />
        ))}
      </Row>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      <Card tone="accent">
        <H2>What you pay now</H2>
        <Body small muted>
          Alternatives show how much you would save a month and over the term.
        </Body>
        <Field label="Name of your plan (optional)" value={name} onChangeText={setName} placeholder="My current plan" autoCapitalize="sentences" />
        <Field label="Cost per month (€)" value={monthly} onChangeText={setMonthly} keyboardType="numeric" placeholder="29,99" />
        <Button label={saved ? "Saved" : mine ? "Update" : "Save"} kind="secondary" onPress={save} disabled={!monthly.trim()} />
      </Card>
    </>
  );
  return (
    <SearchScreen
      key={category.id + String(mine?.monthly_cents ?? "")}
      category={category.id}
      title="Subscriptions"
      placeholder="e.g. 20 GB 5G, no contract"
      header={header}
    />
  );
}
