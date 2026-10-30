import { ShoppingEntry } from "@/shop/ShoppingEntry";

// The shopping assistant draws its own screens, tab bar and title (it is a separate app that this
// one can carry), so this route is bare: no finance tab bar around it.
export default function ShopRoute() {
  return <ShoppingEntry />;
}
