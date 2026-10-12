import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text as RNText, View } from "react-native";

import { StepFrame, Note } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { mascotFor } from "@/onboarding";
import { usePalette } from "@/theme";

const PROMISES = [
  { icon: "cash-check", title: "What is safe to spend", body: "One daily number from your income, bills and budget." },
  { icon: "cart-outline", title: "What to buy, and where", body: "Your usual items priced at Lidl, Aldi, Kaufland and Rewe." },
  { icon: "fire", title: "Small wins that stick", body: "Streaks and quests that make staying on budget a game." },
];

export function WelcomeStep({ ctx }: { ctx: StepCtx }) {
  const p = usePalette();
  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("welcome", ctx.draft, ctx.build)}
      title="Know what you can spend and what to buy"
      why="Setup takes about two minutes. Every question can be skipped, and you can change all of it later in Settings."
      primary={{ label: "Get started", onPress: ctx.next, icon: "arrow-right" }}
      onSkip={() => {
        ctx.update({ backend: "server" });
        ctx.goto("data");
      }}
      skipLabel="I already have a server"
    >
      {PROMISES.map((x) => (
        <View key={x.title} style={{ flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 14 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
            <MaterialCommunityIcons name={x.icon as never} size={24} color={p.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={{ color: p.text, fontSize: 16, fontWeight: "800" }}>{x.title}</RNText>
            <RNText style={{ color: p.muted, fontSize: 14 }}>{x.body}</RNText>
          </View>
        </View>
      ))}
      <Note icon="shield-lock-outline">
        There is no Financer account and no cloud of ours. Your data lives where you choose on the next screen.
      </Note>
    </StepFrame>
  );
}
