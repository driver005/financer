import { useCallback, useEffect, useState } from "react";

import { Badge, Banner, Box, Button, Card, Chip, ChipRow, Divider, EmptyState, ListItem, Row, Screen, Section, Segmented, Sheet, Stack, Text, TextField, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { AttrKind, CategoryDetail, CategoryItem, CategorySchema } from "../../api/types";
import { addAlias, addAttribute, addCriterion, formulaNames, formulaProblem, newCategory, removeAlias, removeCriterion } from "../../logic/schemaEdit";
import { useNav } from "../nav";
import { useShop } from "../runtime";

function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Banner tone="danger" title={items.length === 1 ? "Not saved" : `${items.length} problems`}>
      <Stack gap="xs">{items.map((m) => <Text key={m} variant="body" tone="on-danger-soft">• {m}</Text>)}</Stack>
    </Banner>
  );
}

export function CategoriesScreen() {
  const { client } = useShop();
  const nav = useNav();
  const [cats, setCats] = useState<CategoryItem[]>([]);
  const [name, setName] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [error, setError] = useState<string[]>([]);

  const load = useCallback(() => void client?.categories().then(setCats), [client]);
  useEffect(load, [load]);

  const create = async () => {
    if (!client || !name.trim()) return;
    const schema = newCategory(name, base);
    try {
      await client.saveCategory(schema);
      setName("");
      load();
      nav.push({ name: "category", id: schema.id });
    } catch (e) {
      setError(e instanceof ShopApiError ? (e.problems.length ? e.problems : [e.message]) : ["Could not create it."]);
    }
  };

  return (
    <Screen header={<TopBar title="Categories" onBack={nav.pop} />}>
      <Text variant="body" tone="muted">A category says what is known about a kind of product and how it is judged. Add your own, or start from one and change it.</Text>
      <Card padded={false}>
        <Box px="lg">
          {cats.map((c, i) => (
            <Box key={c.id}>
              {i > 0 ? <Divider /> : null}
              <ListItem
                title={c.name}
                subtitle={`${c.criteria} criteria · ${c.attributes} attributes · ${c.products} products`}
                icon={c.kind === "subscription" ? "sim-outline" : "shape-outline"}
                trailing={<Badge label={c.kind === "subscription" ? "subscription" : c.customized ? "changed" : c.builtin ? "built in" : "yours"} />}
                onPress={() => nav.push({ name: "category", id: c.id })}
              />
            </Box>
          ))}
        </Box>
      </Card>
      <Section title="New category" card>
        <Stack gap="md">
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Gaming phone" capitalize />
          <Text variant="label" tone="muted">Start from</Text>
          <ChipRow>
            <Chip label="Nothing" selected={base === null} onPress={() => setBase(null)} />
            {cats.map((c) => <Chip key={c.id} label={c.name} selected={base === c.id} onPress={() => setBase(c.id)} />)}
          </ChipRow>
          <Problems items={error} />
          <Row><Button label="Create" icon="plus" onPress={() => void create()} disabled={!name.trim()} /></Row>
        </Stack>
      </Section>
    </Screen>
  );
}

type CriterionKindChoice = "number" | "flag" | "formula" | "match";

export function CategoryEditorScreen({ id }: { id: string }) {
  const { client } = useShop();
  const nav = useNav();
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [draft, setDraft] = useState<CategorySchema | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [json, setJson] = useState<string | null>(null);

  const [attrLabel, setAttrLabel] = useState("");
  const [attrKind, setAttrKind] = useState<AttrKind>("number");
  const [attrUnit, setAttrUnit] = useState("");
  const [aliasKey, setAliasKey] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [critLabel, setCritLabel] = useState("");
  const [critKind, setCritKind] = useState<CriterionKindChoice>("number");
  const [critAttr, setCritAttr] = useState<string | null>(null);
  const [critExpr, setCritExpr] = useState("");
  const [critMin, setCritMin] = useState("0");
  const [critMax, setCritMax] = useState("100");
  const [higher, setHigher] = useState(true);
  const [pref, setPref] = useState("ecosystem");

  const load = useCallback(async () => {
    if (!client) return;
    const d = await client.category(id);
    setDetail(d);
    setDraft(d.raw);
    setDirty(false);
    setJson(null);
  }, [client, id]);
  useEffect(() => void load(), [load]);

  if (!detail || !draft) {
    return (
      <Screen header={<TopBar title="Category" onBack={nav.pop} />}>
        <EmptyState icon="timer-sand" title="Loading…" />
      </Screen>
    );
  }
  const edit = (next: CategorySchema) => {
    setDraft(next);
    setDirty(true);
    setProblems([]);
  };
  const resolved = detail.resolved;
  const allAttrs = resolved.attributes ?? [];
  const mine = new Set((draft.criteria ?? []).map((c) => c.key));
  const own = new Set((draft.attributes ?? []).map((a) => a.key));

  const save = async (schema: CategorySchema) => {
    try {
      const saved = await client?.saveCategory(schema);
      if (saved) {
        setDetail(saved);
        setDraft(saved.raw);
        setDirty(false);
        setJson(null);
        setProblems([]);
      }
    } catch (e) {
      setProblems(e instanceof ShopApiError ? (e.problems.length ? e.problems : [e.message]) : ["Could not save."]);
    }
  };

  const addCrit = () => {
    const label = critLabel.trim();
    if (!label) return;
    const min = Number(critMin.replace(",", "."));
    const max = Number(critMax.replace(",", "."));
    let res: { schema: CategorySchema } | null = null;
    if (critKind === "flag" && critAttr) res = addCriterion(draft, label, { kind: "flag", attribute: critAttr });
    else if (critKind === "number" && critAttr) res = addCriterion(draft, label, { kind: "number", attribute: critAttr, min, max, higherIsBetter: higher });
    else if (critKind === "match" && critAttr) res = addCriterion(draft, label, { kind: "match", attribute: critAttr, preference: pref.trim() || "preference" });
    else if (critKind === "formula") {
      const problem = formulaProblem(critExpr);
      if (problem) return setProblems([problem]);
      res = addCriterion(draft, label, { kind: "formula", expr: critExpr, min, max, higherIsBetter: higher });
    }
    if (!res) return setProblems(["Pick the attribute this is about."]);
    edit(res.schema);
    setCritLabel("");
    setCritExpr("");
  };

  return (
    <Screen
      header={<TopBar title={resolved.name} subtitle={resolved.extends ? `Starts from ${resolved.extends.replace(/_/g, " ")}` : undefined} onBack={nav.pop} />}
      footer={dirty ? <Box bg="surface" px="lg" py="md" shadow="lg"><Button label="Save changes" size="lg" full onPress={() => void save(draft)} /></Box> : undefined}
    >
      <Text variant="body" tone="muted">Everything here is data: change it and the ranking changes, no update needed.</Text>
      <Problems items={problems} />

      <Section title="What is measured">
        <Card padded={false}>
          <Box px="lg">
            {(resolved.criteria ?? []).map((c, i) => (
              <Box key={c.key}>
                {i > 0 ? <Divider /> : null}
                <ListItem
                  title={c.label}
                  subtitle={`${"attribute" in c ? c.attribute.replace(/_/g, " ") : c.kind === "formula" ? c.expr : "from the offers"} · weight ${c.weight ?? 1}`}
                  trailing={
                    <Row gap="sm">
                      <Badge label={c.kind === "flag" ? "yes/no" : c.kind} />
                      <Button label={mine.has(c.key) ? "Remove" : "Switch off"} variant="ghost" tone="danger" size="sm" onPress={() => edit(removeCriterion(draft, c.key))} />
                    </Row>
                  }
                />
              </Box>
            ))}
          </Box>
        </Card>
      </Section>

      <Section title="What is known" description="Tap one to give it another name that shops use." card>
        <ChipRow>
          {allAttrs.map((a) => <Chip key={a.key} label={a.label} selected={aliasKey === a.key} onPress={() => setAliasKey(aliasKey === a.key ? null : a.key)} />)}
        </ChipRow>
        {aliasKey ? (
          <Card gap="md">
            <Text variant="caption" tone="muted">Another name shops use for “{allAttrs.find((a) => a.key === aliasKey)?.label}”:</Text>
            <TextField label="Name on shop pages" value={alias} onChangeText={setAlias} placeholder="Akkulaufzeit" capitalize />
            <Row>
              <Button
                label="Add name"
                variant="soft"
                disabled={!alias.trim() || !own.has(aliasKey)}
                onPress={() => {
                  edit(addAlias(draft, aliasKey, alias));
                  setAlias("");
                }}
              />
            </Row>
            {(draft.attributes ?? []).find((a) => a.key === aliasKey)?.aliases?.length ? (
              <ChipRow>
                {((draft.attributes ?? []).find((a) => a.key === aliasKey)?.aliases ?? []).map((name) => (
                  <Chip key={name} label={name} onRemove={() => edit(removeAlias(draft, aliasKey, name))} />
                ))}
              </ChipRow>
            ) : null}
            {!own.has(aliasKey) ? <Text variant="caption" tone="muted">This attribute comes from the category you started from. Add a new attribute with the same name to override it.</Text> : null}
          </Card>
        ) : null}
      </Section>

      <Section title="Add an attribute" card>
        <Stack gap="md">
          <TextField label="Name" value={attrLabel} onChangeText={setAttrLabel} placeholder="Shoulder triggers" capitalize />
          <Segmented<AttrKind> value={attrKind} onChange={setAttrKind} options={[{ value: "number", label: "Number" }, { value: "bool", label: "Yes/no" }, { value: "text", label: "Text" }, { value: "list", label: "List" }]} />
          {attrKind === "number" ? <TextField label="Unit (optional)" value={attrUnit} onChangeText={setAttrUnit} placeholder="mAh" /> : null}
          <Row>
            <Button
              label="Add attribute"
              variant="soft"
              disabled={!attrLabel.trim()}
              onPress={() => {
                edit(addAttribute(draft, attrLabel, attrKind, attrUnit).schema);
                setAttrLabel("");
                setAttrUnit("");
              }}
            />
          </Row>
        </Stack>
      </Section>

      <Section title="Add something to judge by" card>
        <Stack gap="md">
          <TextField label="Name" value={critLabel} onChangeText={setCritLabel} placeholder="Battery per gram" capitalize />
          <Segmented<CriterionKindChoice> value={critKind} onChange={setCritKind} options={[{ value: "number", label: "Number" }, { value: "flag", label: "Yes/no" }, { value: "formula", label: "Formula" }, { value: "match", label: "Wish" }]} />
          {critKind === "formula" ? (
            <>
              <TextField label="Formula" value={critExpr} onChangeText={setCritExpr} placeholder="battery_mah / weight_g" />
              <Text variant="caption" tone="muted">You can use: {formulaNames(draft.extends ? resolved : draft).slice(0, 14).join(", ")}</Text>
            </>
          ) : (
            <>
              <ChipRow>
                {allAttrs
                  .filter((a) => (critKind === "number" ? (a.kind ?? "number") === "number" : critKind === "flag" ? a.kind === "bool" : true))
                  .map((a) => <Chip key={a.key} label={a.label} selected={critAttr === a.key} onPress={() => setCritAttr(a.key)} />)}
              </ChipRow>
              {critKind === "match" ? <TextField label="Wish name (used under What matters to me)" value={pref} onChangeText={setPref} placeholder="ecosystem" /> : null}
            </>
          )}
          {critKind === "number" || critKind === "formula" ? (
            <>
              <Row gap="md" align="start">
                <Box equal><TextField label="Worst value" value={critMin} onChangeText={setCritMin} keyboardType="numeric" /></Box>
                <Box equal><TextField label="Best value" value={critMax} onChangeText={setCritMax} keyboardType="numeric" /></Box>
              </Row>
              <ChipRow>
                <Chip label="Higher is better" selected={higher} onPress={() => setHigher(true)} />
                <Chip label="Lower is better" selected={!higher} onPress={() => setHigher(false)} />
              </ChipRow>
            </>
          ) : null}
          <Row><Button label="Add" variant="soft" disabled={!critLabel.trim()} onPress={addCrit} /></Row>
        </Stack>
      </Section>

      <Section title="Advanced" card>
        <Row><Button label="Edit as JSON" variant="outline" tone="neutral" icon="code-json" onPress={() => setJson(JSON.stringify(draft, null, 2))} /></Row>
      </Section>

      <Sheet
        visible={json !== null}
        onClose={() => setJson(null)}
        title="Category definition"
        footer={
          <Row gap="sm">
            <Button
              label="Save JSON"
              onPress={() => {
                try {
                  void save(JSON.parse(json ?? "") as CategorySchema);
                } catch (e) {
                  setProblems([`Not valid JSON: ${e instanceof Error ? e.message : "unreadable"}`]);
                }
              }}
            />
            <Button label="Close" variant="ghost" tone="neutral" onPress={() => setJson(null)} />
          </Row>
        }
      >
        <TextField label="Category definition" value={json ?? ""} onChangeText={setJson} multiline />
        <Problems items={problems} />
      </Sheet>

      {detail.customized ? (
        <Row>
          <Button
            label={detail.builtin ? "Back to built-in" : "Delete category"}
            variant="outline"
            tone="danger"
            onPress={async () => {
              await client?.deleteCategory(id);
              if (detail.builtin) await load();
              else nav.pop();
            }}
          />
        </Row>
      ) : null}
    </Screen>
  );
}
