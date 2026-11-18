import type { ReactNode } from "react";

import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { MedusaIcon, type MedusaIconName } from "../primitives/MedusaIcon";
import { Text, type TextTone } from "../primitives/Text";
import { Banner } from "../components/Banner";
import { type MedusaColor, colorTone } from "./shared";

/** Medusa `Container`: a bordered card for a block of a page. */
export function Container({ children }: { children: ReactNode }) {
  return <Box bg="surface" radius="lg" shadow="surface" border="hairline" borderTone="default" overflow="hidden">{children}</Box>;
}

const HEADING = { h1: "title", h2: "subheading", h3: "bodyStrong" } as const;

/** Medusa `Heading`: h1, h2 and h3 as the title, subheading and strong body variants. */
export function Heading({ level = "h1", children }: { level?: "h1" | "h2" | "h3"; children: ReactNode }) {
  return <Text variant={HEADING[level]} level={Number(level[1]) as 1 | 2 | 3}>{children}</Text>;
}

const LABEL = {
  small: { regular: "compact", plus: "compactStrong" },
  base: { regular: "bodySmall", plus: "label" },
  large: { regular: "body", plus: "control" },
} as const;

/** Medusa `Label`: the caption of a field, in three sizes and two weights. */
export function Label({ children, size = "base", weight = "regular", tone = "default" }: { children: ReactNode; size?: keyof typeof LABEL; weight?: "regular" | "plus"; tone?: TextTone }) {
  return <Text variant={LABEL[size][weight]} tone={tone}>{children}</Text>;
}

/** Medusa `Kbd`: a key or a short code in a small chip. */
export function Kbd({ children }: { children: string }) {
  return (
    <Box bg="sunken" radius="base" px="xs" border="hairline" borderTone="default" align="center" justify="center">
      <Text variant="caption" tone="muted">{children}</Text>
    </Box>
  );
}

/** Medusa `Code`: a piece of code inside a line. */
export function Code({ children }: { children: string }) {
  return (
    <Box bg="sunken" radius="md" px="xs" py="2xs" border="hairline" borderTone="default">
      <Text variant="compact">{children}</Text>
    </Box>
  );
}

const TIP_TONE = { tip: "info", warning: "warning", error: "danger", success: "success" } as const;

/** Medusa `InlineTip`: a short hint in the flow of a form, with a bold label. */
export function InlineTip({ label, variant = "tip", children }: { label?: string; variant?: keyof typeof TIP_TONE; children: ReactNode }) {
  const tone = TIP_TONE[variant];
  const text = `on-${tone}-soft` as const;
  return (
    <Row bg={`${tone}-soft`} radius="lg" p="md" gap="sm" align="start">
      <Text variant="compactStrong" tone={text}>{label ?? variant[0].toUpperCase() + variant.slice(1)}</Text>
      <Box grow>
        <Text variant="compact" tone={text}>{children}</Text>
      </Box>
    </Row>
  );
}

/** Medusa `StatusBadge`: a state in words with a coloured dot in front. */
export function StatusBadge({ color = "grey", children }: { color?: MedusaColor; children: ReactNode }) {
  const tone = colorTone[color];
  return (
    <Row bg="sunken" radius="full" px="sm" py="2xs" gap="xs" border="hairline" borderTone="default">
      <Icon name="circle" size="xs" tone={tone} />
      <Text variant="badge">{children}</Text>
    </Row>
  );
}

/** Medusa `IconBadge` (named MedusaIconBadge: packages/ui already has an IconBadge with a text and a tone): an icon in a tinted square (a block header, an empty state). */
export function MedusaIconBadge({ icon, color = "grey", large }: { icon: MedusaIconName; color?: MedusaColor; large?: boolean }) {
  const tone = colorTone[color];
  return (
    <Box bg={`${tone}-soft`} radius="md" dim={large ? "icon-xl" : "icon-lg"} align="center" justify="center">
      <MedusaIcon name={icon} size={large ? "md" : "sm"} tone={`on-${tone}-soft`} />
    </Box>
  );
}

const ALERT_TONE = { error: "danger", success: "success", warning: "warning", info: "info" } as const;

/** Medusa `Alert`: a message in the page; the four variants are the four status tones. */
export function Alert({ variant = "info", title, children }: { variant?: keyof typeof ALERT_TONE; title?: string; children: ReactNode }) {
  return <Banner tone={ALERT_TONE[variant]} title={title}>{children}</Banner>;
}

export type { IconName };
