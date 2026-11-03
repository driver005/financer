import { type ReactNode, useState } from "react";
import { Platform, TextInput, type TextInputProps } from "react-native";

import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { fontFamilyWeb, fontSize, lineHeight } from "../constants/typography";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";
import { IconButton } from "./Button";

export type TextFieldProps = {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  helper?: string;
  /** An error message; also turns the border red. */
  error?: string;
  icon?: IconName;
  multiline?: boolean;
  secure?: boolean;
  keyboardType?: TextInputProps["keyboardType"];
  returnKeyType?: TextInputProps["returnKeyType"];
  onSubmit?: () => void;
  /** Show a clear button while there is text. */
  clearable?: boolean;
  /** `primary` is white with a soft shadow (on the page), `secondary` a grey fill (inside cards). */
  variant?: "primary" | "secondary";
  autoFocus?: boolean;
  capitalize?: boolean | "words" | "characters";
  /** Something at the end of the field (a unit, a button). */
  right?: ReactNode;
  /** Do not let the keyboard fix the text (codes, IBANs, names of files). */
  autoCorrect?: boolean;
  editable?: boolean;
  /** Called when the field is left (to show a problem only after the person was there). */
  onBlur?: () => void;
  maxLength?: number;
  testID?: string;
};

export function TextField({
  label, value, onChangeText, placeholder, helper, error, icon, multiline, secure, keyboardType, returnKeyType, onSubmit,
  clearable, variant = "secondary", autoFocus, capitalize, right, autoCorrect = false, editable = true, onBlur, maxLength, testID,
}: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Box gap="xs">
      {label ? <Text variant="label" tone="muted">{label}</Text> : null}
      <Row
        gap="sm"
        px="md"
        bg={variant === "primary" ? "field" : "sunken"}
        radius="field"
        align={multiline ? "start" : "center"}
        control="md"
        // HeroUI: no outline at rest; the accent colour on focus, red on error (the border is always
        // there, transparent, so the field does not jump when it appears)
        border="thick"
        borderTone={error ? "danger" : focused ? "focus" : "clear"}
        shadow={variant === "primary" ? "field" : undefined}
      >
        {icon ? <Icon name={icon} size="md" tone="muted" /> : null}
        <Box grow>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={colors.text.muted}
            multiline={multiline}
            secureTextEntry={secure}
            keyboardType={keyboardType}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmit}
            autoFocus={autoFocus}
            autoCapitalize={capitalize === "words" ? "words" : capitalize === "characters" ? "characters" : capitalize ? "sentences" : "none"}
            autoCorrect={autoCorrect}
            editable={editable}
            maxLength={maxLength}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
            }}
            accessibilityLabel={label ?? placeholder}
            testID={testID}
            style={[
              {
                color: colors.text.default,
                fontSize: fontSize.base,
                lineHeight: lineHeight.base,
                paddingVertical: multiline ? space.md : space.none,
                minHeight: multiline ? size.control.lg * 3 : size.control.sm,
                textAlignVertical: multiline ? "top" : "center",
              },
              // the border of the row shows the focus; the browser's own outline would double it
              Platform.OS === "web" ? { fontFamily: fontFamilyWeb, outlineStyle: "none" as never } : null,
            ]}
          />
        </Box>
        {right}
        {clearable && value ? <IconButton icon="close-circle" label="Clear" size="sm" onPress={() => onChangeText("")} /> : null}
      </Row>
      {error ? <Text variant="caption" tone="danger">{error}</Text> : helper ? <Text variant="caption" tone="subtle">{helper}</Text> : null}
    </Box>
  );
}

/** The search box: a pill with a magnifier, a clear button and the keyboard's search key. */
export function SearchBar({ value, onChangeText, onSubmit, placeholder = "Search", testID }: { value: string; onChangeText: (t: string) => void; onSubmit?: () => void; placeholder?: string; testID?: string }) {
  return <TextField value={value} onChangeText={onChangeText} onSubmit={onSubmit} placeholder={placeholder} icon="magnify" clearable variant="primary" returnKeyType="search" testID={testID} />;
}
