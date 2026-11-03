import { useEffect, useState } from "react";

import { Banner, Button, Chip, ChipRow, EmptyState, Screen, Section, Stack, Text, TextField, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { AttributeDef, CategoryItem } from "../../api/types";
import { buildProduct, EMPTY_FORM, type ProductForm } from "../../logic/library";
import { useNav } from "../nav";
import { useShop } from "../runtime";

const HINT: Record<string, string> = { number: "A number", bool: "yes or no", list: "Separate with commas" };

/** Add a product you know about: its name, specs and a price from a shop. It is ranked and compared like the ones searches find. */
export function AddProductScreen({ category: initial }: { category?: string }) {
  const { client } = useShop();
  const nav = useNav();
  const [categories, setCategories] = useState<CategoryItem[] | null>(null);
  const [defs, setDefs] = useState<AttributeDef[]>([]);
  const [form, setForm] = useState<ProductForm>({ ...EMPTY_FORM, category: initial ?? "" });
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    client?.categories().then(setCategories).catch(() => setCategories([]));
  }, [client]);

  useEffect(() => {
    if (!client || !form.category) return setDefs([]);
    let alive = true;
    client
      .category(form.category)
      .then((d) => alive && setDefs(d.resolved.attributes ?? []))
      .catch(() => alive && setDefs([]));
    return () => {
      alive = false;
    };
  }, [client, form.category]);

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const plan = categories?.find((c) => c.id === form.category)?.kind === "subscription";

  const save = async () => {
    if (!client) return;
    const built = buildProduct(form, defs, plan);
    if (!built.ok) return setProblems(built.problems);
    setProblems([]);
    setBusy(true);
    try {
      const saved = await client.addProduct(built.request);
      nav.pop();
      nav.push({ name: "product", id: saved.id });
    } catch (e) {
      setProblems([e instanceof ShopApiError ? [e.message, ...e.problems].join(" ") : "Could not save the product."]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      maxW="normal"
      header={<TopBar title="Add a product" onBack={nav.pop} />}
      footer={
        <Stack gap="sm" px={{ base: "lg", md: "xl" }} py="md" bg="surface">
          {problems.length > 0 ? (
            <Banner tone="danger" title="Not saved">
              <Stack gap="xs">{problems.map((m) => <Text key={m} variant="body" tone="on-danger-soft">• {m}</Text>)}</Stack>
            </Banner>
          ) : null}
          <Button label="Add product" size="lg" full loading={busy} onPress={() => void save()} testID="add-product" />
        </Stack>
      }
    >
      <Section title="What is it" card>
        <Stack gap="md">
          {categories && categories.length === 0 ? (
            <EmptyState icon="shape-outline" title="No categories" message="Categories say what a product is measured by. Add one under More > Categories and criteria." />
          ) : (
            <Stack gap="xs">
              <Text variant="label" tone="muted">Category</Text>
              <ChipRow>
                {(categories ?? []).map((c) => <Chip key={c.id} label={c.name} selected={form.category === c.id} onPress={() => set("category", c.id)} />)}
              </ChipRow>
            </Stack>
          )}
          <TextField label="Name" value={form.title} onChangeText={(v) => set("title", v)} placeholder="Pixel 9 128 GB" capitalize />
          <TextField label="Brand" value={form.brand} onChangeText={(v) => set("brand", v)} placeholder="Optional" capitalize />
          <TextField label="Barcode" value={form.gtin} onChangeText={(v) => set("gtin", v)} placeholder="Optional, 8 to 14 digits" keyboardType="numeric" helper="With a barcode the same product from another shop joins this one." />
        </Stack>
      </Section>

      <Section title={plan ? "Price per month" : "Price"} description="From one shop. More prices arrive when searches read the shops." card>
        <Stack gap="md">
          <TextField label="Shop" value={form.shop} onChangeText={(v) => set("shop", v)} placeholder="Shop A" capitalize />
          <TextField label={plan ? "Per month (€)" : "Price (€)"} value={plan ? form.monthly : form.price} onChangeText={(v) => set(plan ? "monthly" : "price", v)} placeholder="799,00" keyboardType="numeric" />
          <TextField label="Link" value={form.url} onChangeText={(v) => set("url", v)} placeholder="https://" keyboardType="url" helper="Optional. Where you found it." />
        </Stack>
      </Section>

      {defs.length > 0 ? (
        <Section title="Specifications" description="Fill in what you know; the rest is left out of the ranking, not counted against it." card>
          <Stack gap="md">
            {defs.map((d) => (
              <TextField
                key={d.key}
                label={d.unit ? `${d.label} (${d.unit})` : d.label}
                value={form.attributes[d.key] ?? ""}
                onChangeText={(v) => setForm((f) => ({ ...f, attributes: { ...f.attributes, [d.key]: v } }))}
                helper={HINT[d.kind ?? "text"]}
              />
            ))}
          </Stack>
        </Section>
      ) : null}
    </Screen>
  );
}
