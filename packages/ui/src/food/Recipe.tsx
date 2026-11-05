import type { ReactNode } from "react";

import type { Tone } from "../constants/colors";
import { Divider } from "../components/Divider";
import { Stepper } from "../components/Stepper";
import { Box, Row, Stack } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

/**
 * The top of a recipe page where a photo would be: a large soft tile in the dish's tone with its
 * first letter and a chef's hat, and room for badges in the corner. It keeps the page's rhythm
 * (big picture, then title) for recipes that have no photo.
 */
export function RecipeCover({ tone, letter, children }: { tone: Tone; letter: string; children?: ReactNode }) {
  return (
    <Box bg={`${tone}-soft`} radius="3xl" p="lg" gap="md" overflow="hidden" align="stretch">
      <Row justify="between" align="start" gap="md">
        <Icon name="chef-hat" size="lg" tone={`on-${tone}-soft`} />
        {children}
      </Row>
      <Box align="center" py="xl">
        <Text variant="display" tone={`on-${tone}-soft`} align="center">{letter}</Text>
      </Box>
    </Box>
  );
}

export type RecipeFact = { icon: IconName; label: string; value: string };

/** The strip of facts under the title (time, servings, price): an icon, a small label and the value, with hairlines between. */
export function RecipeFacts({ facts }: { facts: readonly RecipeFact[] }) {
  return (
    <Row bg="surface" radius="2xl" py="md" align="stretch" accessibilityRole="summary">
      {facts.map((f, i) => (
        <Row key={f.label} grow align="stretch">
          {i > 0 ? <Divider vertical /> : null}
          <Stack grow align="center" gap="2xs" px="sm" accessible accessibilityLabel={`${f.label}: ${f.value}`}>
            <Icon name={f.icon} size="md" tone="muted" />
            <Text variant="bodyStrong" align="center" numberOfLines={1}>{f.value}</Text>
            <Text variant="caption" tone="muted" align="center" numberOfLines={1}>{f.label}</Text>
          </Stack>
        </Row>
      ))}
    </Row>
  );
}

/** "Ingredients for 4 servings" with the stepper that rescales every amount. */
export function ServingsPicker({ label, value, unit, onChange, min = 1, max = 24 }: { label: string; value: number; unit: string; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <Row justify="between" gap="md" bg="sunken" radius="2xl" p="md">
      <Box grow>
        <Text variant="bodyStrong">{label}</Text>
      </Box>
      <Stepper
        value={value}
        unit={unit}
        minusLabel="Fewer servings"
        plusLabel="More servings"
        onMinus={() => onChange(Math.max(min, value - 1))}
        onPlus={() => onChange(Math.min(max, value + 1))}
      />
    </Row>
  );
}

export type IngredientState = "have" | "missing" | "offer";

const STATE: Record<IngredientState, { icon: IconName; tone: Tone; word: string }> = {
  have: { icon: "check-circle-outline", tone: "success", word: "You usually buy this" },
  missing: { icon: "cart-plus", tone: "warning", word: "Not in your usual items" },
  offer: { icon: "tag", tone: "danger", word: "On offer" },
};

/** One ingredient the way Chefkoch lists it: the amount first and in strong type, then the name, then how it fits what you buy. */
export function IngredientRow({ amount, name, state }: { amount: string; name: string; state?: IngredientState }) {
  const s = state ? STATE[state] : null;
  return (
    <Row gap="md" py="md" align="center" accessible accessibilityLabel={`${amount} ${name}${s ? `, ${s.word}` : ""}`}>
      <Box basis="third">
        <Text variant="bodyStrong">{amount}</Text>
      </Box>
      <Box grow>
        <Text variant="body">{name}</Text>
      </Box>
      {s ? <Icon name={s.icon} size="md" tone={s.tone} /> : null}
    </Row>
  );
}

/** A numbered step of the method, in a readable size, with the number in a soft circle. */
export function RecipeStep({ n, text }: { n: number; text: string }) {
  return (
    <Row gap="md" align="start" py="sm">
      <Box dim="avatar-sm" radius="full" bg="accent-soft" align="center" justify="center" shrink={false}>
        <Text variant="label" tone="on-accent-soft">{String(n)}</Text>
      </Box>
      <Box grow>
        <Text variant="body">{text}</Text>
      </Box>
    </Row>
  );
}
