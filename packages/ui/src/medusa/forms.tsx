import { createContext, type ReactNode, useContext, useState } from "react";
import { TextInput } from "react-native";

import { Box, Row } from "../primitives/Box";
import { Icon } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { fontFamilyWeb, fontSize, lineHeight } from "../constants/typography";
import { size } from "../constants/sizes";
import { OptionList, type Option } from "../components/OptionList";
import { TextField, type TextFieldProps } from "../components/TextField";
import { Sheet } from "../layout/Sheet";
import { useTheme } from "../theme/ThemeProvider";

/** Medusa `Textarea`: a text field of several lines. */
export function Textarea(props: Omit<TextFieldProps, "multiline">) {
  return <TextField {...props} multiline />;
}

/** Medusa `CurrencyInput`: an amount with its currency code at the end and a number keyboard. */
export function CurrencyInput({ code, ...props }: Omit<TextFieldProps, "right" | "keyboardType"> & { code: string }) {
  return <TextField {...props} keyboardType="decimal-pad" right={<Text variant="label" tone="muted">{code.toUpperCase()}</Text>} />;
}

const RadioContext = createContext<{ value: string; onChange: (v: string) => void } | null>(null);

/** Medusa `RadioGroup` with `RadioGroup.Item`. */
export function RadioGroup({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) {
  return (
    <RadioContext.Provider value={{ value, onChange: onValueChange }}>
      <Box gap="sm" accessibilityRole="radiogroup">{children}</Box>
    </RadioContext.Provider>
  );
}

function RadioItem({ value, label, description, disabled }: { value: string; label: string; description?: string; disabled?: boolean }) {
  const group = useContext(RadioContext);
  const on = group?.value === value;
  return (
    <Touchable onPress={() => group?.onChange(value)} label={label} role="radio" selected={on} disabled={disabled} direction="row" align="start" gap="md" hit={false} touch>
      <Box dim="icon-md" radius="full" border="thick" borderTone={on ? "accent" : "strong"} align="center" justify="center">
        {on ? <Box dim="icon-xs" radius="full" bg="accent-solid" /> : null}
      </Box>
      <Box grow gap="2xs">
        <Text variant="label">{label}</Text>
        {description ? <Text variant="compact" tone="muted">{description}</Text> : null}
      </Box>
    </Touchable>
  );
}
RadioGroup.Item = RadioItem;

/** Medusa `Select`: a field that shows the chosen option and opens the options in a sheet. */
export function Select<T extends string>({ value, onValueChange, options, placeholder = "Select", label, disabled }: { value?: T; onValueChange: (v: T) => void; options: readonly Option<T>[]; placeholder?: string; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  return (
    <Box gap="xs">
      {label ? <Text variant="label">{label}</Text> : null}
      <Touchable onPress={() => setOpen(true)} label={label ?? placeholder} disabled={disabled} direction="row" align="center" gap="sm" px="md" control="sm" bg="field" radius="lg" border="hairline" borderTone="default" hit={false}>
        <Box grow>
          <Text variant="bodySmall" tone={chosen ? "default" : "subtle"} numberOfLines={1}>{chosen?.label ?? placeholder}</Text>
        </Box>
        <Icon name="chevron-down" size="md" tone="muted" />
      </Touchable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? placeholder}>
        <OptionList options={options} value={(value ?? "") as T} onChange={(v) => { onValueChange(v); setOpen(false); }} />
      </Sheet>
    </Box>
  );
}

/** Medusa `OTPInput`: one box per digit, typed into a hidden field. */
export function OTPInput({ length = 6, value, onChange, onComplete }: { length?: number; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void }) {
  const [focused, setFocused] = useState(false);
  const { colors } = useTheme();
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const active = Math.min(value.length, length - 1);
  return (
    <Box accessibilityRole="none">
      <Row gap="sm">
        {digits.map((d, i) => (
          <Box key={i} equal control="lg" radius="lg" bg="field" border={focused && i === active ? "thick" : "hairline"} borderTone={focused && i === active ? "focus" : "default"} align="center" justify="center">
            <Text variant="title">{d}</Text>
          </Box>
        ))}
      </Row>
      <TextInput
        value={value}
        onChangeText={(t) => {
          const next = t.replace(/\D/g, "").slice(0, length);
          onChange(next);
          if (next.length === length) onComplete?.(next);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        maxLength={length}
        caretHidden
        accessibilityLabel="Code"
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, color: colors.text.default, fontSize: fontSize.base, lineHeight: lineHeight.base, fontFamily: fontFamilyWeb, minHeight: size.control.lg }}
      />
    </Box>
  );
}
