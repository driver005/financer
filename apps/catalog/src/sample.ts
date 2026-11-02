// Made-up products for the catalog. Nothing here is real.
export const products = [
  { id: "a", title: "Pixel 9 128 GB", brand: "Google", price: 64900, was: 79900, shop: "Example Shop", score: 78, tier: "upper mid-range", strengths: ["Software updates", "Camera"], weaknesses: ["Charging speed"] },
  { id: "b", title: "Galaxy S25 256 GB", brand: "Samsung", price: 79900, was: null, shop: "Tech Store", score: 71, tier: "flagship", strengths: ["Display"], weaknesses: ["Price"] },
  { id: "c", title: "Pixel 9a 128 GB", brand: "Google", price: 44900, was: 49900, shop: "Example Shop", score: 64, tier: "mid-range", strengths: ["Price", "Battery"], weaknesses: ["Performance"] },
  { id: "d", title: "iPhone 16 128 GB", brand: "Apple", price: 79900, was: null, shop: "Fruit Store", score: 69, tier: "flagship", strengths: ["Performance"], weaknesses: ["Battery"] },
  { id: "e", title: "Moto G85 256 GB", brand: "Motorola", price: 24900, was: 29900, shop: "Discount World", score: 52, tier: "budget", strengths: ["Price"], weaknesses: ["Updates", "Camera"] },
  { id: "f", title: "Fairphone 5", brand: "Fairphone", price: 59900, was: null, shop: "Fairphone", score: 58, tier: "mid-range", strengths: ["Repairability"], weaknesses: ["Performance"] },
] as const;

export const history = [64900, 64900, 69900, 69900, 67900, 64900, 59900, 62900, 59900, 56900, 56900, 54900];

export const compareColumns = [
  { id: "a", title: "Pixel 9", priceText: "649,00 €", score: 78 },
  { id: "c", title: "Pixel 9a", priceText: "449,00 €", score: 64 },
  { id: "d", title: "iPhone 16", priceText: "799,00 €", score: 69 },
] as const;

export const compareRows = [
  { key: "battery", label: "Battery", cells: [{ value: "4700 mAh" }, { value: "5100 mAh", best: true }, { value: "3561 mAh" }] },
  { key: "ram", label: "RAM", cells: [{ value: "12 GB", best: true }, { value: "8 GB" }, { value: "8 GB" }] },
  { key: "updates", label: "Software updates", cells: [{ value: "7 years", best: true }, { value: "7 years", best: true }, { value: "6 years" }] },
  { key: "nfc", label: "NFC", cells: [{ value: "yes" }, { value: "yes" }, { value: "yes" }] },
  { key: "weight", label: "Weight", cells: [{ value: "198 g" }, { value: "186 g", best: true }, { value: "170 g" }] },
  { key: "water", label: "Water resistance", cells: [{ value: "IP68" }, { value: "IP68" }, { value: null }] },
] as const;
