import { useRouter } from "expo-router";
import { Card, ListItem } from "@financer/ui";

/** Entry point on the Today tab for the Stores screen (spending per supermarket). */
export function StoresLink() {
  const router = useRouter();
  return (
    <Card padded={false}>
      <ListItem icon="storefront-outline" tile title="Where you shop" subtitle="What you spend at each supermarket" label="Where you shop. See what you spend at each supermarket" onPress={() => router.push("/stores")} />
    </Card>
  );
}
