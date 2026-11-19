/**
 * Compatibility shim. The app has ONE UI kit: @finance/ui.
 * Existing imports keep working while every screen uses the same tokens/components.
 */
export {
  AsyncBoundary, Badge, Box, Button, Card, Checkbox, Chip, Divider, Empty, EmptyState,
  ErrorState, FadeIn, Icon, IconButton, Loading, Note, Screen, SectionTitle, Segmented,
  Skeleton, Stepper, SwitchRow, Text, TextField, Tile,
  type IconName, type TextVariant,
  useFinanceTheme,
} from "@finance/ui";
