import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text as RNText } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, IconButton, Screen, Text } from "../ui/primitives";
import { tokens, useTheme } from "../ui/theme";
import { allTransactions } from "../db/moneyTracker";
import { core } from "../rust/core";
import { saveDocument } from "../lib/file";

export default function ReportsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [html, setHtml] = useState("");
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    void allTransactions().then((data) => {
      setRows(data);
      setHtml(core.reportHtml(data, "Pantry money report"));
      setCsv(core.reportCsv(data));
    });
  }, []);

  const exportPdf = () => saveDocument(core.reportPdf(rows, "Pantry money report"), "pantry-report.pdf", "application/pdf");
  const exportXlsx = () => saveDocument(core.xlsx(rows), "pantry-report.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  return (
    <Screen
      title="Reports"
      subtitle="Printable HTML and Excel-compatible CSV"
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      <Card>
        <Text variant="caption" color="muted">Generate a real PDF file, print the HTML view, or open the Excel-compatible CSV.</Text>
        <Button label="Export PDF report" icon="file-pdf-box" onPress={() => void exportPdf()} />
        <Button label="Export XLSX workbook" icon="file-excel" tone="secondary" onPress={() => void exportXlsx()} />
        <Button label="Open CSV export" icon="file-export" tone="secondary" onPress={() => router.push("/export")} />
      </Card>
      <ScrollView style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <RNText selectable style={[styles.text, { color: colors.text }]}>{html || "Building report…"}</RNText>
      </ScrollView>
      <ScrollView style={[styles.box, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <RNText selectable style={[styles.text, { color: colors.text }]}>{csv}</RNText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { maxHeight: 320, borderWidth: 1, borderRadius: tokens.radius.card, padding: tokens.md },
  text: { fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
});
