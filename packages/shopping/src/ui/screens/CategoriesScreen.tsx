import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";

import { ShopApiError } from "../../api/client";
import type { AttrKind, CategoryDetail, CategoryItem, CategorySchema } from "../../api/types";
import { addAlias, addAttribute, addCriterion, formulaNames, formulaProblem, newCategory, removeCriterion } from "../../logic/schemaEdit";
import { Banner, Body, Button, Card, Chip, Field, H2, Problems, Row, Screen, Segmented, Title } from "../kit";
import { useNav } from "../nav";
import { useShop } from "../runtime";
import { usePalette, type } from "../theme";

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
    <Screen>
      <Title onBack={nav.pop}>Categories</Title>
      <Body muted>
        A category says what is known about a kind of product and how it is judged. Add your own, or start from one and change it.
      </Body>
      {cats.map((c) => (
        <Card key={c.id} onPress={() => nav.push({ name: "category", id: c.id })}>
          <Row between>
            <H2>{c.name}</H2>
            <Chip label={c.kind === "subscription" ? "subscription" : c.customized ? "changed" : c.builtin ? "built in" : "yours"} />
          </Row>
          <Body small muted>{`${c.criteria} criteria · ${c.attributes} attributes · ${c.products} products`}</Body>
        </Card>
      ))}
      <H2>New category</H2>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Gaming phone" autoCapitalize="sentences" />
      <Body small muted>Start from</Body>
      <Row wrap>
        <Chip label="Nothing" selected={base === null} onPress={() => setBase(null)} />
        {cats.map((c) => (
          <Chip key={c.id} label={c.name} selected={base === c.id} onPress={() => setBase(c.id)} />
        ))}
      </Row>
      <Problems items={error} />
      <Button label="Create" onPress={create} disabled={!name.trim()} />
    </Screen>
  );
}

type CriterionKindChoice = "number" | "flag" | "formula" | "match";

export function CategoryEditorScreen({ id }: { id: string }) {
  const { client } = useShop();
  const nav = useNav();
  const p = usePalette();
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [draft, setDraft] = useState<CategorySchema | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [json, setJson] = useState<string | null>(null);

  // new attribute
  const [attrLabel, setAttrLabel] = useState("");
  const [attrKind, setAttrKind] = useState<AttrKind>("number");
  const [attrUnit, setAttrUnit] = useState("");
  // alias
  const [aliasKey, setAliasKey] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  // new criterion
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
      <Screen>
        <Title onBack={nav.pop}>Category</Title>
        <Body muted>Loading…</Body>
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
    <Screen>
      <Title onBack={nav.pop}>{resolved.name}</Title>
      <Body muted>
        {resolved.extends ? `Starts from ${resolved.extends.replace(/_/g, " ")}. ` : ""}
        Everything here is data: change it and the ranking changes, no update needed.
      </Body>
      <Problems items={problems} />
      {dirty ? <Banner action={<Button label="Save changes" onPress={() => save(draft)} />}>You have unsaved changes.</Banner> : null}

      <H2>What is measured</H2>
      {(resolved.criteria ?? []).map((c) => (
        <Card key={c.key}>
          <Row between>
            <Text style={[type.body, { color: p.text, fontWeight: "600", flex: 1 }]}>{c.label}</Text>
            <Chip label={c.kind === "flag" ? "yes/no" : c.kind} />
          </Row>
          <Body small muted>
            {"attribute" in c ? c.attribute.replace(/_/g, " ") : c.kind === "formula" ? c.expr : "from the offers"}
            {` · weight ${c.weight ?? 1}`}
          </Body>
          <Button label={mine.has(c.key) ? "Remove" : "Switch off"} kind="ghost" onPress={() => edit(removeCriterion(draft, c.key))} />
        </Card>
      ))}

      <H2>What is known</H2>
      <Row wrap>
        {allAttrs.map((a) => (
          <Chip key={a.key} label={a.label} selected={aliasKey === a.key} onPress={() => setAliasKey(aliasKey === a.key ? null : a.key)} />
        ))}
      </Row>
      {aliasKey ? (
        <Card>
          <Body small muted>{`Another name shops use for “${allAttrs.find((a) => a.key === aliasKey)?.label}”:`}</Body>
          <Field label="Name on shop pages" value={alias} onChangeText={setAlias} placeholder="Akkulaufzeit" autoCapitalize="sentences" />
          <Button
            label="Add name"
            kind="secondary"
            disabled={!alias.trim() || !own.has(aliasKey)}
            onPress={() => {
              edit(addAlias(draft, aliasKey, alias));
              setAlias("");
            }}
          />
          {!own.has(aliasKey) ? <Body small muted>This attribute comes from the category you started from. Add a new attribute with the same name to override it.</Body> : null}
        </Card>
      ) : null}

      <H2>Add an attribute</H2>
      <Field label="Name" value={attrLabel} onChangeText={setAttrLabel} placeholder="Shoulder triggers" autoCapitalize="sentences" />
      <Segmented
        value={attrKind}
        onChange={setAttrKind}
        options={[
          { value: "number", label: "Number" },
          { value: "bool", label: "Yes/no" },
          { value: "text", label: "Text" },
          { value: "list", label: "List" },
        ]}
      />
      {attrKind === "number" ? <Field label="Unit (optional)" value={attrUnit} onChangeText={setAttrUnit} placeholder="mAh" /> : null}
      <Button
        label="Add attribute"
        kind="secondary"
        disabled={!attrLabel.trim()}
        onPress={() => {
          edit(addAttribute(draft, attrLabel, attrKind, attrUnit).schema);
          setAttrLabel("");
          setAttrUnit("");
        }}
      />

      <H2>Add something to judge by</H2>
      <Field label="Name" value={critLabel} onChangeText={setCritLabel} placeholder="Battery per gram" autoCapitalize="sentences" />
      <Segmented
        value={critKind}
        onChange={setCritKind}
        options={[
          { value: "number", label: "Number" },
          { value: "flag", label: "Yes/no" },
          { value: "formula", label: "Formula" },
          { value: "match", label: "Wish" },
        ]}
      />
      {critKind === "formula" ? (
        <>
          <Field label="Formula" value={critExpr} onChangeText={setCritExpr} placeholder="battery_mah / weight_g" />
          <Body small muted>{`You can use: ${formulaNames(draft.extends ? resolved : draft).slice(0, 14).join(", ")}`}</Body>
        </>
      ) : (
        <>
          <Row wrap>
            {allAttrs
              .filter((a) => (critKind === "number" ? (a.kind ?? "number") === "number" : critKind === "flag" ? a.kind === "bool" : true))
              .map((a) => (
                <Chip key={a.key} label={a.label} selected={critAttr === a.key} onPress={() => setCritAttr(a.key)} />
              ))}
          </Row>
          {critKind === "match" ? <Field label="Wish name (used in Weights › Wishes)" value={pref} onChangeText={setPref} placeholder="ecosystem" /> : null}
        </>
      )}
      {critKind === "number" || critKind === "formula" ? (
        <>
          <Row>
            <Field label="Worst value" value={critMin} onChangeText={setCritMin} keyboardType="numeric" />
            <Field label="Best value" value={critMax} onChangeText={setCritMax} keyboardType="numeric" />
          </Row>
          <Row>
            <Chip label="Higher is better" selected={higher} onPress={() => setHigher(true)} />
            <Chip label="Lower is better" selected={!higher} onPress={() => setHigher(false)} />
          </Row>
        </>
      ) : null}
      <Button label="Add" kind="secondary" disabled={!critLabel.trim()} onPress={addCrit} />

      <H2>Advanced</H2>
      {json === null ? (
        <Button label="Edit as JSON" kind="secondary" onPress={() => setJson(JSON.stringify(draft, null, 2))} />
      ) : (
        <>
          <Field label="Category definition" value={json} onChangeText={setJson} multiline />
          <Row>
            <Button
              label="Save JSON"
              onPress={() => {
                try {
                  void save(JSON.parse(json) as CategorySchema);
                } catch (e) {
                  setProblems([`Not valid JSON: ${e instanceof Error ? e.message : "unreadable"}`]);
                }
              }}
            />
            <Button label="Close" kind="ghost" onPress={() => setJson(null)} />
          </Row>
        </>
      )}

      <Row wrap>
        <Button label="Save" onPress={() => save(draft)} disabled={!dirty} />
        {detail.customized ? (
          <Button
            label={detail.builtin ? "Back to built-in" : "Delete category"}
            kind="danger"
            onPress={async () => {
              await client?.deleteCategory(id);
              if (detail.builtin) await load();
              else nav.pop();
            }}
          />
        ) : null}
      </Row>
    </Screen>
  );
}
