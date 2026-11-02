import { Card } from "../components/Card";
import { Skeleton } from "../components/Skeleton";
import { Box, Row, Stack } from "../primitives/Box";

/** A product card while its data loads: the picture, a name, a price and two chips as grey blocks. */
export function ProductCardSkeleton() {
  return (
    <Card padded={false}>
      <Row gap="md" p="md" align="start" accessibilityLabel="Loading">
        <Box dim="thumb-md" radius="lg" bg="sunken" />
        <Stack gap="sm" grow>
          <Skeleton height="xs" />
          <Skeleton height="xs" width="half" />
          <Row gap="sm"><Box grow><Skeleton height="xs" radius="full" /></Box><Box grow><Skeleton height="xs" radius="full" /></Box></Row>
        </Stack>
      </Row>
    </Card>
  );
}

/** A few of them, for a list that is loading. */
export function ProductCardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <Stack gap="md">
      {Array.from({ length: count }, (_, i) => <ProductCardSkeleton key={i} />)}
    </Stack>
  );
}
