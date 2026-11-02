import type { ReactNode } from "react";

import { Card, Section, Viewport, type Device } from "@financer/ui";

export type StoryDef = { id: string; title: string; note?: string; render: () => ReactNode };

/** One component on show: a title, what it is for, and the live thing in a frame. */
export function Story({ story, device }: { story: StoryDef; device: Device | "window" }) {
  return (
    <Section title={story.title} description={story.note}>
      <Card variant="flat" gap="lg">
        <Viewport device={device}>{story.render()}</Viewport>
      </Card>
    </Section>
  );
}
