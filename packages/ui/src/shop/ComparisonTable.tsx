import { useState } from "react";
import { ScrollView, View } from "react-native";

import { SwitchRow } from "../components/Switch";
import { Divider } from "../components/Divider";
import { Icon } from "../primitives/Icon";
import { ScoreRing } from "../components/ScoreRing";
import { Box, Row, Stack } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { size } from "../constants/sizes";
import { useLayout } from "../responsive/useLayout";

export type CompareColumn = { id: string; title: string; subtitle?: string | null; priceText?: string | null; score?: number | null };
export type CompareCell = { value: string | null; best?: boolean };
export type CompareRow = { key: string; label: string; cells: readonly CompareCell[]; group?: string | null };

/** Rows where every product has the same value say nothing about the choice. */
export function differingRows(rows: readonly CompareRow[]): CompareRow[] {
  return rows.filter((r) => new Set(r.cells.map((c) => c.value ?? "")).size > 1);
}

export type ComparisonTableProps = {
  columns: readonly CompareColumn[];
  rows: readonly CompareRow[];
  /** Start with only the rows that differ (the research's most useful default). */
  onlyDifferences?: boolean;
};

/**
 * Products side by side. The product headers stay on top while the rows scroll (sticky), the best
 * value of a row is marked, and identical rows can be hidden. On a phone each row's label sits above
 * its values so that three products still fit without sideways scrolling.
 */
export function ComparisonTable({ columns, rows, onlyDifferences = true }: ComparisonTableProps) {
  const [diff, setDiff] = useState(onlyDifferences);
  const { isCompact } = useLayout();
  const shown = diff ? differingRows(rows) : rows;
  const labelWidth = size.table.label;
  const header = (
    <Row bg="surface" align="start" gap="sm" px="md" py="md">
      {isCompact ? null : <LabelSpacer width={labelWidth} />}
      {columns.map((c) => (
        <Box key={c.id} equal gap="xs" align="start">
          <Text variant="label" numberOfLines={3}>{c.title}</Text>
          {c.priceText ? <Text variant="number" tone="accent">{c.priceText}</Text> : null}
          {typeof c.score === "number" ? <ScoreRing score={c.score} size="sm" /> : null}
        </Box>
      ))}
    </Row>
  );
  return (
    <Box grow gap="md">
      <SwitchRow label="Show only what differs" value={diff} onChange={setDiff} />
      <Box grow bg="surface" radius="2xl" border="hairline" overflow="hidden">
        <ScrollView stickyHeaderIndices={[0]}>
          <Box bg="surface">{header}<Divider /></Box>
          {shown.length === 0 ? (
            <Box p="xl"><Text variant="body" tone="muted" align="center">These products do not differ in anything we know.</Text></Box>
          ) : (
            shown.map((r) => (
              <Box key={r.key}>
                <Stack gap="xs" px="md" py="md">
                  {isCompact ? <Text variant="caption" tone="muted">{r.label}</Text> : null}
                  <Row gap="sm" align="start">
                    {isCompact ? null : <LabelCell width={labelWidth} text={r.label} />}
                    {r.cells.map((cell, i) => (
                      <Box key={columns[i]?.id ?? i} equal gap="2xs" bg={cell.best ? "success-soft" : undefined} radius="md" px="xs" py="2xs">
                        <Row gap="xs" align="center">
                          {cell.best ? <Icon name="check" size="xs" tone="on-success-soft" label="Best in this row" /> : null}
                          <Box grow>
                            <Text variant="number" tone={cell.best ? "on-success-soft" : cell.value ? "default" : "subtle"} numberOfLines={3}>{cell.value ?? "unknown"}</Text>
                          </Box>
                        </Row>
                      </Box>
                    ))}
                  </Row>
                </Stack>
                <Divider />
              </Box>
            ))
          )}
        </ScrollView>
      </Box>
    </Box>
  );
}
function LabelSpacer({ width }: { width: number }) {
  return <View style={{ width }} />;
}
function LabelCell({ width, text }: { width: number; text: string }) {
  return (
    <View style={{ width }}>
      <Text variant="label" tone="muted">{text}</Text>
    </View>
  );
}
