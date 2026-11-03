import { Children, Fragment, type ReactNode } from "react";

import { Box } from "../primitives/Box";
import { Card } from "./Card";
import { Divider } from "./Divider";

/** A white card of rows with a hairline between them (a list, the settings). Give the rows `ListItem`s. */
export function Group({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <Card padded={false} gap="none">
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? <Divider /> : null}
          <Box px="lg">{row}</Box>
        </Fragment>
      ))}
    </Card>
  );
}
