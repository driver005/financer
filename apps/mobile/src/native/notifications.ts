import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type DueReminder = { name: string; nextDate: string; amountCents: number };

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** Local, on-device due-date reminders. Nothing is sent anywhere. */
export async function scheduleDueNotifications(reminders: DueReminder[]): Promise<void> {
  if (Platform.OS === "web") return;
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const reminder of reminders) {
    const at = new Date(`${reminder.nextDate}T09:00:00`).getTime();
    const seconds = Math.max(60, Math.floor((at - Date.now()) / 1000));
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${reminder.name} is due`,
        body: `Due on ${reminder.nextDate}. Open Pantry to review it.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, repeats: false },
    });
  }
}
