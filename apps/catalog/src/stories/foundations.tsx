import {
  Badge, Box, Row, Stack, Text, breakpoints, contrast, fontSize, lineHeight, radius, shadows, space, textVariants, tones, useColors, useLayout,
  type Radius, type Shadow, type Space, type TextVariant, type Tone,
} from "@financer/ui";

import type { StoryDef } from "../Story";

function Swatches() {
  const c = useColors();
  return (
    <Stack gap="lg">
      {tones.map((t: Tone) => {
        const tc = c.tones[t];
        return (
          <Row key={t} gap="sm" wrap align="stretch">
            <Box bg={`${t}-solid`} radius="lg" p="md" gap="2xs" basis="auto">
              <Text variant="label" tone={`on-${t}-solid`}>{t} solid</Text>
              <Text variant="caption" tone={`on-${t}-solid`}>{contrast(tc.onSolid, tc.solid).toFixed(1)}:1</Text>
            </Box>
            <Box bg={`${t}-soft`} radius="lg" p="md" gap="2xs">
              <Text variant="label" tone={`on-${t}-soft`}>{t} soft</Text>
              <Text variant="caption" tone={`on-${t}-soft`}>{contrast(tc.onSoft, tc.soft).toFixed(1)}:1</Text>
            </Box>
            <Box bg="surface" border="hairline" borderTone={t} radius="lg" p="md" gap="2xs">
              <Text variant="label" tone={t}>{t} text</Text>
              <Text variant="caption" tone="muted">{contrast(tc.text, c.surface).toFixed(1)}:1</Text>
            </Box>
          </Row>
        );
      })}
      <Row gap="sm" wrap>
        {(["background", "surface", "raised", "sunken"] as const).map((b) => (
          <Box key={b} bg={b} border="hairline" radius="lg" p="md" gap="2xs">
            <Text variant="label">{b}</Text>
            <Text variant="caption" tone="muted">{contrast(c.text.default, c[b]).toFixed(1)}:1 text</Text>
          </Box>
        ))}
      </Row>
    </Stack>
  );
}

function Spacing() {
  return (
    <Stack gap="sm">
      {(Object.keys(space) as Space[]).map((s) => (
        <Row key={s} gap="md">
          <Box basis="auto"><Text variant="label">{s}</Text></Box>
          <Text variant="caption" tone="muted">{space[s]} px</Text>
          <Box bg="accent-solid" radius="sm" px={s} py="2xs" />
        </Row>
      ))}
    </Stack>
  );
}

function Corners() {
  return (
    <Row gap="md" wrap>
      {(Object.keys(radius) as Radius[]).map((r) => (
        <Stack key={r} gap="xs" align="center">
          <Box dim="avatar-lg" bg="accent-soft" border="hairline" borderTone="accent" radius={r} />
          <Text variant="caption">{r}</Text>
        </Stack>
      ))}
    </Row>
  );
}

function Elevation() {
  return (
    <Row gap="xl" wrap p="md">
      {(Object.keys(shadows) as Shadow[]).map((s) => (
        <Stack key={s} gap="sm" align="center">
          <Box dim="avatar-lg" bg="raised" radius="lg" shadow={s} />
          <Text variant="caption">{s}</Text>
        </Stack>
      ))}
    </Row>
  );
}

function Type() {
  return (
    <Stack gap="md">
      {(Object.keys(textVariants) as TextVariant[]).map((v) => (
        <Stack key={v} gap="2xs">
          <Text variant="caption" tone="subtle">{v} · {fontSize[textVariants[v].size]}/{lineHeight[textVariants[v].size]} · {textVariants[v].weight}</Text>
          <Text variant={v}>{v.startsWith("price") ? "1.299,00 €" : "Compare phones by what matters to you"}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

function Window() {
  const l = useLayout();
  return (
    <Stack gap="sm">
      <Row gap="sm" wrap>
        <Badge label={`${l.width} wide`} />
        <Badge label={`breakpoint ${l.breakpoint}`} tone="accent" />
        <Badge label={l.layout === "compact" ? "phone: bottom bar" : l.layout === "medium" ? "tablet: rail" : "web: sidebar"} tone="success" />
        <Badge label={`${l.columns} product columns`} />
      </Row>
      <Text variant="caption" tone="muted">
        {Object.entries(breakpoints).map(([k, v]) => `${k} ${v}`).join(" · ")}
      </Text>
    </Stack>
  );
}

export const foundations: StoryDef[] = [
  { id: "colors", title: "Colours", note: "Roles, not shades. The ratio is the WCAG contrast of the text on that fill (4.5 and up is AA).", render: () => <Swatches /> },
  { id: "spacing", title: "Spacing", note: "Tailwind's scale on a grid of 4. Screens say `p=\"md\"`, never a number.", render: () => <Spacing /> },
  { id: "radius", title: "Corners", render: () => <Corners /> },
  { id: "shadows", title: "Elevation", render: () => <Elevation /> },
  { id: "type", title: "Type", note: "Tailwind's sizes and line heights, as named roles.", render: () => <Type /> },
  { id: "window", title: "This window", note: "What the layout classes see right now. Use the device switch above to preview others.", render: () => <Window /> },
];
