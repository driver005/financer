import { Box, IconBadge, Row, Text } from "@financer/ui";

import { StepFrame, Note } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { mascotFor } from "@/onboarding";
import { asIcon } from "@/uiTone";

const PROMISES = [
  { icon: "cash-check", title: "What is safe to spend", body: "One daily number from your income, bills and budget." },
  { icon: "cart-outline", title: "What to buy, and where", body: "Your usual items priced at Lidl, Aldi, Kaufland and Rewe." },
  { icon: "fire", title: "Small wins that stick", body: "Streaks and quests that make staying on budget a game." },
];

export function WelcomeStep({ ctx }: { ctx: StepCtx }) {
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
        <Row key={x.title} gap="md">
          <IconBadge icon={asIcon(x.icon)} />
          <Box grow>
            <Text variant="bodyStrong">{x.title}</Text>
            <Text variant="label" tone="muted">{x.body}</Text>
          </Box>
        </Row>
      ))}
      <Note icon="shield-lock-outline">There is no Financer account and no cloud of ours. Your data lives where you choose on the next screen.</Note>
    </StepFrame>
  );
}
