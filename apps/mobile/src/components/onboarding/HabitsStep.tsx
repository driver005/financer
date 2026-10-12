import { ChoiceCard, Note, StepFrame } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { mascotFor, type HabitMode } from "@/onboarding";

// These are the three modes the "How should I learn what you buy?" setting already has.
const MODES: { id: HabitMode; icon: string; title: string; body: string; note?: string }[] = [
  {
    id: "manual",
    icon: "format-list-checks",
    title: "My own list",
    body: "You tell me what you usually buy. Most control, a little typing once.",
  },
  {
    id: "receipts",
    icon: "receipt-text-outline",
    title: "Receipts",
    body: "Photograph a paper receipt or paste a digital one and I read the items. The more you add, the better I know your basket.",
    note: "Reading a photo uses an AI model, which needs an API key in Settings. Pasted text does not.",
  },
  {
    id: "spending",
    icon: "chart-line",
    title: "Spending only",
    body: "Nothing to do. I estimate with a generic basket from your bank totals. Least accurate, zero effort.",
  },
];

export function HabitsStep({ ctx }: { ctx: StepCtx }) {
  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("habits", ctx.draft, ctx.build)}
      title="How should I learn what you buy?"
      why={'Your bank only shows "REWE, 23,47 €", not what was in the bag. Pick how I should find out. You can change this in Settings.'}
      primary={{ label: "Continue", onPress: ctx.next, icon: "arrow-right" }}
      onSkip={ctx.next}
    >
      {MODES.map((m) => (
        <ChoiceCard
          key={m.id}
          icon={m.icon}
          title={m.title}
          body={m.body}
          note={m.note}
          selected={ctx.draft.habitMode === m.id}
          onPress={() => ctx.update({ habitMode: m.id })}
        />
      ))}
      <Note icon="shield-lock-outline">Only item names, offers, diet and budget are ever sent to an AI model, never bank data.</Note>
    </StepFrame>
  );
}
