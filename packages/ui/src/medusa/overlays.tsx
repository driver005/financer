import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, View } from "react-native";

import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { Button, IconButton } from "../components/Button";
import { Divider } from "../components/Divider";
import { SearchBar } from "../components/TextField";
import { Sheet } from "../layout/Sheet";
import { Overlay } from "./shared";
import { useTheme } from "../theme/ThemeProvider";

/** Medusa `Popover`: a card over the page, opened by tapping its trigger. */
export function Popover({ trigger, label, children }: { trigger: ReactNode; label: string; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Touchable onPress={() => setOpen(true)} label={label}>{trigger}</Touchable>
      <Overlay visible={open} onClose={close}>
        <Box p="lg" gap="md">{typeof children === "function" ? children(close) : children}</Box>
      </Overlay>
    </>
  );
}

/** Medusa `Tooltip`: there is no hover on a phone, so a long press shows the words (a tap closes them). */
export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Touchable onLongPress={() => setOpen(true)} label={content} role="button" hit={false}>{children}</Touchable>
      <Overlay visible={open} onClose={() => setOpen(false)}>
        <Box p="md" bg="neutral-solid">
          <Text variant="compact" tone="on-neutral-solid">{content}</Text>
        </Box>
      </Overlay>
    </>
  );
}

/** Medusa `Drawer`: a panel from the edge; here the sheet of the design system. */
export function Drawer({ open, onOpenChange, title, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  return <Sheet visible={open} onClose={() => onOpenChange(false)} title={title} footer={footer}>{children}</Sheet>;
}

/** Medusa `FocusModal`: a whole-screen task with its own header and one or two actions. */
export function FocusModal({ open, onOpenChange, title, actions, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; actions?: ReactNode; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => onOpenChange(false)}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Row gap="md" px="lg" py="md" bg="surface">
          <IconButton icon="close" label="Close" onPress={() => onOpenChange(false)} />
          <Box grow>
            <Text variant="subheading" level={1} numberOfLines={1}>{title}</Text>
          </Box>
          {actions}
        </Row>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Box p="lg" gap="lg">{children}</Box>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Medusa `Prompt`: a question with a cancel and a confirm button (a deletion asks first). */
export function Prompt({ open, onOpenChange, title, description, cancelText = "Cancel", confirmText = "Confirm", variant = "confirmation", onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; cancelText?: string; confirmText?: string; variant?: "confirmation" | "danger"; onConfirm: () => void }) {
  return (
    <Overlay visible={open} onClose={() => onOpenChange(false)}>
      <Box p="xl" gap="lg" accessibilityRole="alert">
        <Box gap="xs">
          <Text variant="subheading" level={2}>{title}</Text>
          {description ? <Text variant="bodySmall" tone="muted">{description}</Text> : null}
        </Box>
        <Row gap="sm" justify="end">
          <Button label={cancelText} variant="tertiary" size="sm" onPress={() => onOpenChange(false)} />
          <Button label={confirmText} tone={variant === "danger" ? "danger" : "neutral"} size="sm" onPress={() => { onOpenChange(false); onConfirm(); }} />
        </Row>
      </Box>
    </Overlay>
  );
}

export type MenuItem = { label: string; icon?: IconName; onPress: () => void; danger?: boolean; disabled?: boolean } | "separator";

/** Medusa `DropdownMenu`: a list of actions at the bottom of the screen, opened by its trigger. */
export function DropdownMenu({ trigger, label, items }: { trigger: ReactNode; label: string; items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Touchable onPress={() => setOpen(true)} label={label}>{trigger}</Touchable>
      <Overlay visible={open} onClose={() => setOpen(false)} placement="bottom">
        <Box py="xs">
          {items.map((it, i) =>
            it === "separator" ? (
              <Divider key={i} />
            ) : (
              <Touchable key={i} onPress={() => { setOpen(false); it.onPress(); }} label={it.label} disabled={it.disabled} direction="row" align="center" gap="md" px="lg" py="md" touch hit={false}>
                {it.icon ? <Icon name={it.icon} size="md" tone={it.danger ? "danger" : "muted"} /> : null}
                <Text variant="bodySmall" tone={it.danger ? "danger" : "default"}>{it.label}</Text>
              </Touchable>
            ),
          )}
        </Box>
      </Overlay>
    </>
  );
}

export type CommandItem = { id: string; label: string; icon?: IconName; hint?: string; onSelect: () => void };

/** Medusa `Command`: a search box over a list of actions; typing narrows the list. */
export function Command({ open, onOpenChange, items, placeholder = "Search commands" }: { open: boolean; onOpenChange: (open: boolean) => void; items: readonly CommandItem[]; placeholder?: string }) {
  const [query, setQuery] = useState("");
  const shown = items.filter((i) => i.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Overlay visible={open} onClose={() => onOpenChange(false)}>
      <Box p="md" gap="sm">
        <SearchBar value={query} onChangeText={setQuery} placeholder={placeholder} />
        {shown.length === 0 ? <Box p="lg" align="center"><Text variant="bodySmall" tone="muted">No results</Text></Box> : null}
        {shown.map((it) => (
          <Touchable key={it.id} onPress={() => { onOpenChange(false); setQuery(""); it.onSelect(); }} label={it.label} direction="row" align="center" gap="md" px="md" py="sm" radius="lg" touch hit={false}>
            {it.icon ? <Icon name={it.icon} size="md" tone="muted" /> : null}
            <Box grow>
              <Text variant="bodySmall">{it.label}</Text>
            </Box>
            {it.hint ? <Text variant="caption" tone="subtle">{it.hint}</Text> : null}
          </Touchable>
        ))}
      </Box>
    </Overlay>
  );
}

export type CommandBarAction = { label: string; onPress: () => void };

/** Medusa `CommandBar`: a dark bar with the number of chosen rows and the actions for them. Put it at the end of the page. */
export function CommandBar({ count, actions, onClear }: { count: number; actions: readonly CommandBarAction[]; onClear?: () => void }) {
  if (count === 0) return null;
  return (
    <Row bg="neutral-solid" radius="2xl" shadow="overlay" px="lg" py="sm" gap="md" justify="between" accessibilityRole="toolbar">
      <Text variant="compactStrong" tone="on-neutral-solid">{count} selected</Text>
      <Row gap="md">
        {actions.map((a) => (
          <Touchable key={a.label} onPress={a.onPress} label={a.label} touch hit={false} justify="center">
            <Text variant="compactStrong" tone="on-neutral-solid">{a.label}</Text>
          </Touchable>
        ))}
        {onClear ? <IconButton icon="close" label="Clear selection" variant="ghost" onPress={onClear} /> : null}
      </Row>
    </Row>
  );
}

export type ToastVariant = "info" | "success" | "warning" | "error";
export type ToastSpec = { title: string; description?: string; variant?: ToastVariant; seconds?: number };
type Live = ToastSpec & { id: number };

const TOAST_ICON: Record<ToastVariant, IconName> = { info: "information-outline", success: "check-circle-outline", warning: "alert-outline", error: "alert-circle-outline" };
const TOAST_TONE = { info: "info", success: "success", warning: "warning", error: "danger" } as const;

/** Medusa `Toast`: one message with an icon, a title and a line of explanation. */
export function Toast({ title, description, variant = "info", onDismiss }: ToastSpec & { onDismiss?: () => void }) {
  const tone = TOAST_TONE[variant];
  return (
    <Row bg="raised" radius="2xl" shadow="overlay" p="md" gap="md" align="start" accessibilityRole="alert">
      <Icon name={TOAST_ICON[variant]} size="lg" tone={tone} />
      <Box grow gap="2xs">
        <Text variant="compactStrong">{title}</Text>
        {description ? <Text variant="compact" tone="muted">{description}</Text> : null}
      </Box>
      {onDismiss ? <IconButton icon="close" label="Dismiss" variant="ghost" onPress={onDismiss} /> : null}
    </Row>
  );
}

const ToastContext = createContext<((spec: ToastSpec) => void) | null>(null);

/** Medusa `Toaster` and `toast()`: wrap the app once; `useToast()` returns the function that shows a message. */
export function ToastProvider({ children, seconds = 4 }: { children: ReactNode; seconds?: number }) {
  const [live, setLive] = useState<Live[]>([]);
  const next = useRef(0);
  const show = useCallback((spec: ToastSpec) => setLive((l) => [...l, { ...spec, id: next.current++ }]), []);
  const dismiss = useCallback((id: number) => setLive((l) => l.filter((t) => t.id !== id)), []);
  useEffect(() => {
    if (live.length === 0) return;
    const first = live[0];
    const t = setTimeout(() => dismiss(first.id), (first.seconds ?? seconds) * 1000);
    return () => clearTimeout(t);
  }, [live, seconds, dismiss]);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <Box p="lg" gap="sm">
          {live.map((t) => <Toast key={t.id} {...t} onDismiss={() => dismiss(t.id)} />)}
        </Box>
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): (spec: ToastSpec) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a ToastProvider above it");
  return show;
}
