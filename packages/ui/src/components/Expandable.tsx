import { type ReactNode, useState } from "react";

import type { IconName } from "../primitives/Icon";
import { Box } from "../primitives/Box";
import { ListItem } from "./ListItem";

/**
 * A row that opens in place: the header looks like a settings row, the body (a form, a longer
 * explanation) shows underneath when it is open. No animation, so nothing moves for people who ask
 * for less motion.
 */
export function Expandable({ icon, title, summary, defaultOpen = false, children }: { icon?: IconName; title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box>
      <ListItem icon={icon} tile title={title} subtitle={summary} disclosure={open ? "open" : "closed"} onPress={() => setOpen(!open)} />
      {open ? <Box pb="lg" gap="md">{children}</Box> : null}
    </Box>
  );
}
