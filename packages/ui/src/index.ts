// @financer/ui: tokens, theme, responsive helpers and every UI element of the apps.
// Apps import from here and from nowhere else for anything visual (CLAUDE.md, docs/UI.md).

export * from "./constants";

export { ThemeProvider, useColors, useTheme, type SchemeSetting, type Theme } from "./theme/ThemeProvider";
export { useLayout, useResponsive, type Layout } from "./responsive/useLayout";
export { resolve, type Responsive } from "./responsive/resolve";
export { Viewport, useViewportWidth } from "./responsive/Viewport";
export { contrast } from "./responsive/contrast";
export { formatCents, formatPercent } from "./format";

export { Box, Row, Spacer, Stack, type BoxProps } from "./primitives/Box";
export type { BgToken, Dim, MaxWidth } from "./primitives/box";
export { Text, type TextProps, type TextTone } from "./primitives/Text";
export { Icon, type IconName } from "./primitives/Icon";
export { Touchable } from "./primitives/Touchable";

export { Badge } from "./components/Badge";
export { Banner } from "./components/Banner";
export { Button, IconButton, type ButtonProps, type ButtonSize, type ButtonVariant } from "./components/Button";
export { Card, type CardProps } from "./components/Card";
export { Checkbox } from "./components/Checkbox";
export { Chip, ChipRow, type ChipProps } from "./components/Chip";
export { Divider } from "./components/Divider";
export { Hint } from "./components/Hint";
export { MatchBadge } from "./components/MatchBadge";
export { EmptyState } from "./components/EmptyState";
export { ListItem, type ListItemProps } from "./components/ListItem";
export { Meter, MeterRow, toneForScore } from "./components/Meter";
export { OptionList, type Option } from "./components/OptionList";
export { ScoreRing } from "./components/ScoreRing";
export { Segmented, type SegmentedOption } from "./components/Segmented";
export { Skeleton } from "./components/Skeleton";
export { Sparkline } from "./components/Sparkline";
export { Spinner } from "./components/Spinner";
export { Switch, SwitchRow } from "./components/Switch";
export { SearchBar, TextField, type TextFieldProps } from "./components/TextField";
export { Thumbnail } from "./components/Thumbnail";

export { Grid } from "./layout/Grid";
export { AppShell, NavRail, Sidebar, TabBar, type NavItem } from "./layout/navigation";
export { Screen } from "./layout/Screen";
export { Section } from "./layout/Section";
export { Sheet } from "./layout/Sheet";
export { TopBar } from "./layout/TopBar";

export { ComparisonTable, differingRows, type CompareCell, type CompareColumn, type CompareRow } from "./shop/ComparisonTable";
export { DealBadge, type Verdict } from "./shop/DealBadge";
export { FilterBar, type AppliedFilter } from "./shop/FilterBar";
export { OfferRow } from "./shop/OfferRow";
export { PriceHistory } from "./shop/PriceHistory";
export { PriceTag, Stat } from "./shop/PriceTag";
export { SavingsBar, type SavingsBarProps } from "./shop/SavingsBar";
export { ProductCard, type ProductBadge, type ProductCardProps } from "./shop/ProductCard";
export { ProductGrid } from "./shop/ProductGrid";
