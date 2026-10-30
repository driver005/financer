// Which apps this build contains. The finance app is always there; the shopping assistant is a
// second app of the same project (packages/shopping) that a build can include. Set
// `EXPO_PUBLIC_SHOPPING=1` when starting or building to include it (see docs/SHOP.md); without
// it the app is the finance app alone and the shopping code is not bundled.

export const SHOPPING_ENABLED = process.env.EXPO_PUBLIC_SHOPPING === "1";
