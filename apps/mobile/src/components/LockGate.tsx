import React, { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Screen, Text, TextField } from "../ui/primitives";
import { getSetting } from "../db/database";
import { core } from "../rust/core";

export function LockGate({ children }: { children: ReactNode }) {
  const [hash, setHash] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    void getSetting("passcodeHash").then((value) => { setHash(value); setChecked(true); });
  }, []);

  if (!checked) return null;
  if (!hash || unlocked) return <>{children}</>;

  const unlock = () => {
    if (core.pinHash(pin) === hash) { setUnlocked(true); setPin(""); }
    else { setError(true); setPin(""); }
  };

  return (
    <Screen title="Locked" subtitle="Enter your passcode to open Pantry">
      <Card>
        <TextField label="Passcode" value={pin} onChangeText={setPin} keyboardType="number-pad" placeholder="4+ digits" />
        {error ? <Text color="danger">Wrong passcode. Try again.</Text> : null}
        <Button label="Unlock" icon="lock-open" onPress={unlock} disabled={!pin} />
      </Card>
    </Screen>
  );
}
