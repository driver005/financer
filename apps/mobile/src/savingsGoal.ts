import { getSecret, setSecret } from "@/api/storage";

const KEY = "financer.savings.goal";

/**
 * The amount (cents) to put aside per budget period, for the "Savings goal reached" badge. It
 * is a setting of this device, not a game score: the badge itself is derived from the bookings.
 * 0 means no goal.
 */
export async function getSavingsGoal(): Promise<number> {
  try {
    const cents = Number(await getSecret(KEY));
    return Number.isInteger(cents) && cents > 0 ? cents : 0;
  } catch {
    return 0;
  }
}

export async function setSavingsGoal(cents: number): Promise<void> {
  await setSecret(KEY, String(Math.max(0, Math.trunc(cents))));
}
