import { useEffect, useState } from "react";
import { Text, TextInput } from "react-native";

import { Api } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, Screen, Title, useColors } from "@/components/ui";

export default function Settings() {
  const { config, save, clear } = useApi();
  const c = useColors();
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl);
      setToken(config.token);
    }
  }, [config]);

  const input = {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 8,
    padding: 10,
    color: c.text,
    marginTop: 4,
    marginBottom: 12,
  } as const;

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const api = new Api({ baseUrl: baseUrl.trim(), token: token.trim() });
      if (!(await api.health())) throw new Error("Server answered, but not as a Financer server");
      await api.transactions(); // needs the token
      await save({ baseUrl: baseUrl.trim(), token: token.trim() });
      setStatus("Connected. Settings saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Settings</Title>
      <Card>
        <Body bold>Server</Body>
        <Text style={{ color: c.muted, marginTop: 8 }}>Address (use https://)</Text>
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://financer.example.com"
          placeholderTextColor={c.muted}
          style={input}
        />
        <Text style={{ color: c.muted }}>API token</Text>
        <TextInput
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="FINANCER_API_TOKEN of your server"
          placeholderTextColor={c.muted}
          style={input}
        />
        <Button label={busy ? "Connecting…" : "Test and save"} onPress={test} disabled={busy || !baseUrl.trim() || !token.trim()} />
        {status ? <Text style={{ color: c.muted, marginTop: 10 }}>{status}</Text> : null}
      </Card>
      {config ? (
        <Button
          label="Forget this server"
          onPress={() => {
            void clear();
            setBaseUrl("");
            setToken("");
            setStatus(null);
          }}
        />
      ) : null}
    </Screen>
  );
}
