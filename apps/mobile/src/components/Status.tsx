import { useRouter } from "expo-router";
import { Button, EmptyState, MascotFace, Skeleton, Spinner, Stack, type Mood } from "@financer/ui";

/** The page is still loading. `rows` draws list-shaped placeholders instead of a spinner, so the layout does not jump. */
export function Loading({ rows }: { rows?: number }) {
  if (rows) {
    return (
      <Stack gap="md">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height="lg" radius="2xl" />
        ))}
      </Stack>
    );
  }
  return (
    <Stack align="center" py="3xl">
      <Spinner large />
    </Stack>
  );
}

/** Nothing here yet: the mascot, one sentence that says what is missing and why, and at most one action. */
export function Empty({ title, message, actionLabel, actionIcon, onAction, mood = "happy", card }: { title: string; message?: string; actionLabel?: string; actionIcon?: Parameters<typeof Button>[0]["icon"]; onAction?: () => void; mood?: Mood; card?: boolean }) {
  return (
    <EmptyState
      card={card}
      visual={<MascotFace mood={mood} big />}
      title={title}
      message={message}
      action={actionLabel && onAction ? <Button label={actionLabel} icon={actionIcon} onPress={onAction} /> : undefined}
    />
  );
}

/** Shown on every tab until the server URL and token are saved. */
export function NeedsSetup() {
  const router = useRouter();
  return (
    <Empty
      title="Connect to your server first"
      message="Enter the server address and API token in Settings and your numbers show up here."
      actionLabel="Open Settings"
      actionIcon="cog-outline"
      onAction={() => router.push("/settings")}
    />
  );
}
