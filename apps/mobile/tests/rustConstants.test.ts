import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BADGE_IDS, FREEZE_EVERY, LEVEL_XP, MAX_FREEZES, QUEST_XP, REPLAY_DAYS, STREAK_XP, badgeIds, rustConstants } from "../src/game";

// The few numbers and ids the screens read at import time are repeated in TypeScript; Rust is the source.
describe("the constants repeated from Rust", () => {
  it("are the ones Rust uses", () => {
    assert.deepEqual(rustConstants(), {
      questXp: QUEST_XP,
      streakXp: STREAK_XP,
      levelXp: LEVEL_XP,
      freezeEvery: FREEZE_EVERY,
      maxFreezes: MAX_FREEZES,
      replayDays: REPLAY_DAYS,
    });
    assert.deepEqual(badgeIds(), BADGE_IDS);
  });
});
