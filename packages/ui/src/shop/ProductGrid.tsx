import type { ReactNode } from "react";

import { Grid } from "../layout/Grid";

/** Product cards in columns that follow the window: 2 on a phone, 3 on a tablet, 4 or 5 on a large screen. */
export function ProductGrid({ children }: { children: ReactNode }) {
  return <Grid>{children}</Grid>;
}
