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
export type { BgToken, Dim, MaxWidth, Share } from "./primitives/boxStyle";
export { Text, type TextProps, type TextTone } from "./primitives/Text";
export { Icon, type IconName } from "./primitives/Icon";
export { Dot } from "./primitives/Dot";
export { Touchable } from "./primitives/Touchable";

export { Avatar, AVATAR_TONES, initialsOf, toneForSeed, type AvatarProps } from "./components/Avatar";
export { Badge } from "./components/Badge";
export { Banner } from "./components/Banner";
export { Button, IconButton, type ButtonProps, type ButtonSize, type ButtonVariant } from "./components/Button";
export { Card, type CardProps } from "./components/Card";
export { ChatBubble, type ChatBubbleProps } from "./components/ChatBubble";
export { DateBadge, type DateBadgeProps } from "./components/DateBadge";
export { Checkbox } from "./components/Checkbox";
export { Chip, ChipRow, type ChipProps } from "./components/Chip";
export { Pill, PillRow } from "./components/Pill";
export { Divider, DividerLabel } from "./components/Divider";
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
export { FullScreenSheet } from "./layout/FullScreenSheet";
export { Scroll } from "./layout/Scroll";
export { Section } from "./layout/Section";
export { Sheet } from "./layout/Sheet";
export { Split } from "./layout/Split";
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
export { ProductCardSkeleton, ProductCardSkeletonList } from "./shop/ProductCardSkeleton";

export { Group } from "./components/Group";
export { IconBadge } from "./components/IconBadge";
export { Stepper } from "./components/Stepper";
export { formatMoney, spokenMoney, splitMoney } from "./format";
export { Money, type MoneyTone } from "./finance/Money";
export { HeroCaption, HeroCard, HeroChip, HeroFigure, HeroNumber, HeroProgress, HeroStats } from "./finance/Hero";
export { Balance } from "./finance/Balance";
export { QuickActions, type QuickAction } from "./components/QuickActions";
export { BubbleCloud, type Bubble } from "./finance/BubbleCloud";
export { BarChart, ColumnChart, CompareBars, CurveChart, DonutChart, ProgressRing, useSeriesColor, type Column, type CompareBarRow, type CurveGeometry } from "./finance/charts";
export { ConfirmAction } from "./components/ConfirmAction";
export { Expandable } from "./components/Expandable";
export { Note } from "./components/Note";
export { ToggleRow } from "./components/ToggleRow";
export { Snackbar } from "./components/Snackbar";
export { VirtualList } from "./layout/VirtualList";
export { Mascot, MascotFace, type Mood } from "./finance/Mascot";
export { ScanFrame } from "./finance/ScanFrame";
export { TileButton } from "./components/TileButton";
export { ChoiceCard } from "./components/ChoiceCard";
export { Confetti } from "./finance/Confetti";
export { Cover, fill } from "./layout/Cover";
export { IngredientRow, RecipeCover, RecipeFacts, RecipeStep, ServingsPicker, type IngredientState, type RecipeFact } from "./food/Recipe";

export { AgendaList } from "./calendar/AgendaList";
export { FloatingButton } from "./calendar/FloatingButton";
export { MiniMonth } from "./calendar/MiniMonth";
export { MonthGrid } from "./calendar/MonthGrid";
export { TimeGrid } from "./calendar/TimeGrid";
export { TimePicker } from "./calendar/TimePicker";
export type { AgendaDay, CalendarItem, DayColumn, MiniCell, MonthCell, TimeBlock } from "./calendar/types";
