import type { ReactNode } from "react";
import { Box, Button, ChoiceCard as UiChoiceCard, Chip, ChipRow, Confetti, Hint, IconButton, Meter, MascotFace, Row, Screen, Text, type IconName } from "@financer/ui";

import type { MascotLine } from "@/onboarding";
import { tap } from "@/native/haptics";
import { asIcon } from "@/uiTone";

/** "3/8" read out as "Step 3 of 8". */
export function spokenStep(label: string): string {
  const m = /^(\d+)\/(\d+)$/.exec(label);
  return m ? `Step ${m[1]} of ${m[2]}` : label;
}

/**
 * One setup step: a thin progress bar with a back (or, on the first step, close) button, the
 * mascot's speech bubble, one question, and a footer that stays put with the main button and a
 * Skip. The body scrolls and keeps taps working while the keyboard is open.
 */
export function StepFrame({
  fraction,
  stepLabel,
  onBack,
  backIsClose,
  mascot,
  title,
  why,
  children,
  primary,
  onSkip,
  skipLabel = "Skip for now",
  footerExtra,
  confetti,
}: {
  fraction: number;
  stepLabel: string;
  onBack: () => void;
  /** First step: the button closes the setup instead of going back. */
  backIsClose?: boolean;
  mascot: MascotLine;
  title: string;
  /** Plain-language reason for the question, shown under the title. */
  why?: string;
  children: ReactNode;
  primary: { label: string; onPress: () => void; disabled?: boolean; icon?: string };
  onSkip?: () => void;
  skipLabel?: string;
  footerExtra?: ReactNode;
  confetti?: boolean;
}) {
  return (
    <>
      <Screen
        maxW="narrow"
        safeBottom
        header={
          <Box maxW="narrow" px="lg" py="sm">
            <Row gap="sm">
            <IconButton
              icon={backIsClose ? "close" : "arrow-left"}
              label={backIsClose ? "Close setup" : "Back"}
              onPress={() => {
                tap();
                onBack();
              }}
            />
            <Box grow><Meter value={fraction} thickness="lg" label={spokenStep(stepLabel)} /></Box>
            <Text variant="caption" tone="muted" accessibilityLabel={spokenStep(stepLabel)}>{stepLabel}</Text>
            </Row>
          </Box>
        }
        footer={
          <Box bg="surface" p="lg" gap="xs" align="center">
            <Box maxW="narrow" gap="xs">
              {footerExtra}
              <Button label={primary.label} icon={primary.icon ? asIcon(primary.icon) : undefined} onPress={primary.onPress} disabled={primary.disabled} />
              {onSkip ? <Button variant="ghost" label={skipLabel} onPress={onSkip} /> : null}
            </Box>
          </Box>
        }
      >
        <Row gap="md">
          <MascotFace mood={mascot.mood} />
          <Box grow bg="surface" radius="2xl" border="hairline" py="md" px="lg" accessibilityRole="text">
            <Text variant="bodyStrong">{mascot.message}</Text>
          </Box>
        </Row>
        <Box gap="xs">
          <Text variant="title" level={1}>{title}</Text>
          {why ? <Text variant="body" tone="muted">{why}</Text> : null}
        </Box>
        <Box gap="md">{children}</Box>
      </Screen>
      {confetti ? <Confetti /> : null}
    </>
  );
}

/** A big tappable answer: a titled card that gets the accent border when chosen. */
export function ChoiceCard({
  title,
  body,
  icon,
  selected,
  onPress,
  disabled,
  note,
  role = "radio",
  children,
}: {
  title: string;
  body?: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** A line under the text, e.g. why the choice is not available. */
  note?: string;
  role?: "radio" | "checkbox";
  children?: ReactNode;
}) {
  return (
    <UiChoiceCard
      title={title}
      body={body}
      note={note}
      icon={asIcon(icon)}
      selected={selected}
      disabled={disabled}
      role={role}
      onPress={() => {
        tap();
        onPress();
      }}
    >
      {children}
    </UiChoiceCard>
  );
}

/** A row of number tiles to pick from (household size and the like). */
export function NumberTiles({ values, value, onChange, label }: { values: number[]; value: number | undefined; onChange: (n: number) => void; label: (n: number) => string }) {
  return (
    <ChipRow>
      {values.map((n) => (
        <Chip
          key={n}
          label={String(n)}
          selected={n === value}
          onPress={() => {
            tap();
            onChange(n);
          }}
        />
      ))}
    </ChipRow>
  );
}

/** A pill you can switch on and off (stores, for example), with a check mark when on. */
export function ToggleChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Chip
      label={label}
      selected={selected}
      icon={selected ? ("check" as IconName) : undefined}
      onPress={() => {
        tap();
        onPress();
      }}
    />
  );
}

/** A small label above a group of answers. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text variant="label" tone="muted" level={2}>{children}</Text>;
}

/** A short box with an icon, for the "why we ask" and security notes. */
export function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return <Hint icon={asIcon(icon)}>{children}</Hint>;
}
