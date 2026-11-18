import React from "react";
import { Image, StyleSheet } from "react-native";
import { Icon, useFinanceTheme, type IconName } from "./primitives";
import { radius } from "./tokens";

/** Category artwork from Pockaw (GPL-3.0), kept in docs/reference/pockaw. */
const ASSETS: Record<string, unknown> = {
  food: require("../assets/categories/category-food-1.webp"),
  transport: require("../assets/categories/category-transportation-1.webp"),
  shopping: require("../assets/categories/category-shopping-1.webp"),
  entertainment: require("../assets/categories/category-entertainment-1.webp"),
  education: require("../assets/categories/category-education-1.webp"),
  finance: require("../assets/categories/category-finance-1.webp"),
  health: require("../assets/categories/category-health-1.webp"),
  housing: require("../assets/categories/category-housing-1.webp"),
};

const MAP: Record<string, string> = {
  groceries: "food", food: "food", restaurant: "food",
  transport: "transport", bus: "transport", fuel: "transport", train: "transport",
  shopping: "shopping", clothes: "shopping",
  leisure: "entertainment", entertainment: "entertainment",
  education: "education", school: "education",
  bills: "finance", rent: "finance", finance: "finance", income: "finance",
};

export function CategoryAssetIcon({ category, size = 40, fallback = "shape-outline" }: { category: string; size?: number; fallback?: IconName }) {
  const theme = useFinanceTheme();
  const key = MAP[category.toLowerCase()] ?? "finance";
  const source = ASSETS[key];
  if (!source) return <Icon name={fallback} size={size / 2} color={theme.primary} />;
  return <Image source={source as never} style={[styles.image, { width: size, height: size, borderRadius: radius.card }]} />;
}

const styles = StyleSheet.create({ image: { resizeMode: "cover" } });
