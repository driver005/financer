import { Children, Fragment, type ReactNode } from "react";

import { Box } from "../primitives/Box";
import { Card } from "./Card";
import { Divider } from "./Divider";

/**
 * A white card of rows with a hairline between them (a list, the settings). Give the rows `ListItem`s.
 * With `inset` the hairline does not run edge to edge but stops short of the card's sides, as in a list of bookings.
 */
export function Group({ children, inset }: { children: ReactNode; inset?: boolean }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <Card padded={false} gap="none">
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? (inset ? <Box px="lg"><Divider /></Box> : <Divider />) : null}
          <Box px="lg">{row}</Box>
        </Fragment>
      ))}
    </Card>
  );
}
