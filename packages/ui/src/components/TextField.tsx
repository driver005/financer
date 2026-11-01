import { useState } from "react";
import { Platform, TextInput, type TextInputProps } from "react-native";

import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { fontFamilyByWeight, fontFamilyWeb, fontSize, lineHeight } from "../constants/typography";
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
  /** The search box (same rounded field, with a magnifier). */
  pill?: boolean;
  autoFocus?: boolean;
  capitalize?: boolean;
  testID?: string;
};

export function TextField({
  label, value, onChangeText, placeholder, helper, error, icon, multiline, secure, keyboardType, returnKeyType, onSubmit,
  clearable, pill, autoFocus, capitalize, testID,
}: TextFieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Box gap="xs">
      {label ? <Text variant="label" tone="muted">{label}</Text> : null}
      <Row
        gap="sm"
        px="md"
        bg={error ? "danger-soft" : focused ? "info-soft" : "field"}
        radius="field"
        align={multiline ? "start" : "center"}
        control="md"
        border="thick"
        borderTone={error ? "danger" : focused ? "focus" : "default"}
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
            autoCapitalize={capitalize ? "sentences" : "none"}
            autoCorrect={false}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel={label ?? placeholder}
            testID={testID}
            style={[
              {
                color: colors.text.default,
                fontFamily: Platform.OS === "web" ? `${fontFamilyByWeight.medium}, ${fontFamilyWeb}` : fontFamilyByWeight.medium,
                fontSize: fontSize.base,
                lineHeight: lineHeight.base,
                paddingVertical: multiline ? space.md : space.none,
                minHeight: multiline ? size.control.lg * 3 : size.control.sm,
                textAlignVertical: multiline ? "top" : "center",
              },
              // the border of the row shows the focus; the browser's own outline would double it
              Platform.OS === "web" ? { outlineStyle: "none" as never } : null,
            ]}
          />
        </Box>
        {clearable && value ? <IconButton icon="close-circle" label="Clear" size="sm" onPress={() => onChangeText("")} /> : null}
      </Row>
      {error ? <Text variant="caption" tone="danger">{error}</Text> : helper ? <Text variant="caption" tone="subtle">{helper}</Text> : null}
    </Box>
  );
}

/** The search box: a pill with a magnifier, a clear button and the keyboard's search key. */
export function SearchBar({ value, onChangeText, onSubmit, placeholder = "Search", testID }: { value: string; onChangeText: (t: string) => void; onSubmit?: () => void; placeholder?: string; testID?: string }) {
  return <TextField value={value} onChangeText={onChangeText} onSubmit={onSubmit} placeholder={placeholder} icon="magnify" clearable pill returnKeyType="search" testID={testID} />;
}
