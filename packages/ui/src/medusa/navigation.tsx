import { Children, Fragment, type ReactNode, useState } from "react";

import { Box, Row } from "../primitives/Box";
import { Icon } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { Divider } from "../components/Divider";
import { type StepStatus, statusIcon, statusTone } from "./shared";

export type TabItem<T extends string> = { value: T; label: string };

/** Medusa `Tabs`: labels with a line under the chosen one; the children are the chosen panel. */
export function Tabs<T extends string>({ tabs, value, onValueChange, children }: { tabs: readonly TabItem<T>[]; value: T; onValueChange: (v: T) => void; children?: ReactNode }) {
  return (
    <Box gap="lg">
      <Row gap="lg" accessibilityRole="tablist">
        {tabs.map((t) => {
          const on = t.value === value;
          return (
            <Touchable key={t.value} onPress={() => onValueChange(t.value)} label={t.label} role="tab" selected={on} gap="xs" hit={false} touch justify="end">
              <Text variant="compactStrong" tone={on ? "default" : "muted"}>{t.label}</Text>
              <Box pt="2xs" bg={on ? "accent-solid" : undefined} radius="full" />
            </Touchable>
          );
        })}
      </Row>
      {children}
    </Box>
  );
}

export type ProgressTab<T extends string> = TabItem<T> & { status?: StepStatus };

/** Medusa `ProgressTabs`: steps of a flow with a status mark each; the children are the chosen step. */
export function ProgressTabs<T extends string>({ tabs, value, onValueChange, children }: { tabs: readonly ProgressTab<T>[]; value: T; onValueChange: (v: T) => void; children?: ReactNode }) {
  return (
    <Box gap="lg">
      <Row gap="sm" accessibilityRole="tablist" wrap>
        {tabs.map((t) => {
          const on = t.value === value;
          const status = t.status ?? "not-started";
          return (
            <Touchable key={t.value} onPress={() => onValueChange(t.value)} label={`${t.label}, ${status}`} role="tab" selected={on} direction="row" align="center" gap="xs" px="md" py="sm" radius="lg" bg={on ? "sunken" : undefined} hit={false}>
              <Icon name={statusIcon[status]} size="sm" tone={statusTone[status]} />
              <Text variant="compactStrong" tone={on ? "default" : "muted"}>{t.label}</Text>
            </Touchable>
          );
        })}
      </Row>
      {children}
    </Box>
  );
}

export type ProgressAccordionItem = { value: string; title: string; status?: StepStatus; children: ReactNode };

/** Medusa `ProgressAccordion`: sections with a status mark; one is open at a time. */
export function ProgressAccordion({ items, defaultValue }: { items: readonly ProgressAccordionItem[]; defaultValue?: string }) {
  const [open, setOpen] = useState<string | undefined>(defaultValue);
  return (
    <Box>
      {items.map((it, i) => {
        const on = open === it.value;
        const status = it.status ?? "not-started";
        return (
          <Fragment key={it.value}>
            {i > 0 ? <Divider /> : null}
            <Touchable onPress={() => setOpen(on ? undefined : it.value)} label={it.title} role="button" selected={on} direction="row" align="center" gap="md" py="md" touch hit={false}>
              <Icon name={statusIcon[status]} size="md" tone={statusTone[status]} />
              <Box grow>
                <Text variant="bodySmall">{it.title}</Text>
              </Box>
              <Icon name={on ? "chevron-up" : "chevron-down"} size="md" tone="muted" />
            </Touchable>
            {on ? <Box pb="lg">{it.children}</Box> : null}
          </Fragment>
        );
      })}
    </Box>
  );
}

/** A cell: words get the table text, anything else is placed as it is. */
function Cell({ children, header, end }: { children?: ReactNode; header?: boolean; end?: boolean }) {
  return (
    <Box equal px="md" py="sm" justify="center" align={end ? "end" : "start"}>
      {typeof children === "string" || typeof children === "number" ? (
        <Text variant={header ? "compactStrong" : "compact"} tone={header ? "muted" : "default"} numberOfLines={1}>{children}</Text>
      ) : (
        children
      )}
    </Box>
  );
}

/** Medusa `Table` with `Table.Header`, `Table.Body`, `Table.Row`, `Table.HeaderCell`, `Table.Cell`. Rows are separated by a hairline. */
export function Table({ children }: { children: ReactNode }) {
  return <Box accessibilityRole="none" overflow="hidden">{children}</Box>;
}
Table.Header = function TableHeader({ children }: { children: ReactNode }) {
  return (
    <Box bg="sunken" radius="lg" accessibilityRole="header">
      {children}
    </Box>
  );
};
Table.Body = function TableBody({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <Box>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? <Divider /> : null}
          {row}
        </Fragment>
      ))}
    </Box>
  );
};
Table.Row = function TableRow({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return onPress ? (
    <Touchable onPress={onPress} direction="row" align="center" hit={false} touch>{children}</Touchable>
  ) : (
    <Row gap="none" touch>{children}</Row>
  );
};
Table.HeaderCell = function TableHeaderCell({ children, end }: { children?: ReactNode; end?: boolean }) {
  return <Cell header end={end}>{children}</Cell>;
};
Table.Cell = function TableCell({ children, end }: { children?: ReactNode; end?: boolean }) {
  return <Cell end={end}>{children}</Cell>;
};
