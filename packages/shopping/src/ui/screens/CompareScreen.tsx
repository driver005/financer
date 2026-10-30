import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { ShopApiError } from "../../api/client";
import type { Comparison } from "../../api/types";
import { formatPrice } from "../../logic/format";
import { groupLabel } from "../../logic/weights";
import { Banner, Body, Button, Card, H2, Meter, Screen, Title } from "../kit";
import { useNav } from "../nav";
import { useShop } from "../runtime";
import { scoreTone, usePalette, type } from "../theme";

const COLUMN = 132;
const LABEL = 118;

export function CompareScreen({ ids }: { ids: string[] }) {
  const { client } = useShop();
  const nav = useNav();
  const p = usePalette();
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [profile, setProfile] = useState<import("../../api/types").Profile | undefined>();

  useEffect(() => {
    client?.profiles().then((all) => setProfile(all.find((x) => x.name === "default")?.profile)).finally(() => setProfileLoaded(true));
  }, [client]);
  useEffect(() => {
    if (!client || !profileLoaded) return;
    client.compare(ids, profile).then(setCmp).catch((e) => setError(e instanceof ShopApiError ? e.message : "Could not compare."));
  }, [client, ids, profile, profileLoaded]);

  if (!cmp) {
    return (
      <Screen>
        <Title onBack={nav.pop}>Compare</Title>
        {error ? <Banner tone="bad">{error}</Banner> : <Body muted>Comparing…</Body>}
      </Screen>
    );
  }
  const winner = cmp.columns.find((c) => c.product_id === cmp.winner);
  const sections: { group: string; rows: Comparison["rows"] }[] = [];
  for (const row of cmp.rows) {
    const g = row.kind === "price" ? "cost" : (row.group ?? (row.kind === "spec" ? "specs" : "other"));
    const last = sections[sections.length - 1];
    if (last && last.group === g) last.rows.push(row);
    else sections.push({ group: g, rows: [row] });
  }

  return (
    <Screen>
      <Title onBack={nav.pop}>Compare</Title>
      {winner ? (
        <Card tone="accent">
          <Body small muted>
            Best fit for your weights
          </Body>
          <Text style={[type.heading, { color: p.text }]}>{winner.title}</Text>
          <Body small muted>{`score ${Math.round(winner.score)} · ${formatPrice(winner.price_cents)}`}</Body>
        </Card>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: LABEL }} />
            {cmp.columns.map((c) => (
              <View key={c.product_id} style={{ width: COLUMN, paddingRight: 8, gap: 2 }}>
                <Text style={[type.small, { color: p.text, fontWeight: "700" }]} numberOfLines={3}>
                  {c.title}
                </Text>
                <Text style={[type.small, { color: p.muted }]}>{c.tier ?? ""}</Text>
                <Meter value={c.score / 100} label={`${c.title}: score ${Math.round(c.score)}`} />
                <Text style={[type.small, { color: p.muted }]}>{`score ${Math.round(c.score)}`}</Text>
              </View>
            ))}
          </View>
          {sections.map((s) => (
            <View key={s.group}>
              <H2>{groupLabel(s.group)}</H2>
              {s.rows.map((row) => (
                <View key={row.key} style={{ flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: p.border }}>
                  <Text style={[type.small, { color: p.muted, width: LABEL, paddingRight: 8 }]}>{row.label}</Text>
                  {row.cells.map((cell, i) => {
                    const tone = scoreTone(cell.score);
                    return (
                      <Text
                        key={cmp.columns[i].product_id}
                        style={[type.small, { width: COLUMN, paddingRight: 8, color: cell.best ? p.good : tone === "bad" ? p.bad : p.text, fontWeight: cell.best ? "700" : "400" }]}
                      >
                        {cell.value ?? "unknown"}
                      </Text>
                    );
                  })}
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      <Button label="Back to results" kind="secondary" onPress={nav.pop} />
    </Screen>
  );
}
