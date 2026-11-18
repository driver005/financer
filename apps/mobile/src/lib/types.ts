export type Ingredient = {
  name: string;
  amount: string;
};

export type Recipe = {
  id: string;
  title: string;
  summary: string;
  image?: string;
  category: string;
  area: string;
  minutes: number;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  source: "themealdb" | "custom";
};

export type Scope = "week" | "month";

export type ShoppingItem = {
  id: number;
  name: string;
  qty: string;
  scope: Scope;
  period: string;
  store: string;
  recipeId: string | null;
  checked: number;
  offerPrice?: string;
  offerProduct?: string;
  createdAt: number;
};

export type StoreId = "rewe" | "kaufland" | "lidl" | "aldi" | "penny" | "netto" | "custom";

export type Store = {
  id: string;
  name: string;
  aliases: string;
  active: number;
};

export type Offer = {
  id: number;
  storeId: string;
  product: string;
  price: string;
  note: string;
  validFrom: string;
  validTo: string;
  source: string;
  createdAt: number;
};

export type Transaction = {
  id: number;
  date: string;
  merchant: string;
  amountCents: number;
  category: string;
  storeId: string | null;
  source: string;
  externalId: string | null;
  accountId?: string;
  kind?: "expense" | "income" | "transfer";
};

export type BankProviderId = "plaid" | "gocardless" | "csv" | "manual";

export type BankProvider = {
  id: BankProviderId;
  name: string;
  note: string;
};
