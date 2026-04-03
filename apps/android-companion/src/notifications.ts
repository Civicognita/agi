/**
 * Android Push Notifications — FCM (Task #217)
 *
 * Handles Firebase Cloud Messaging registration and notification display.
 * Android-specific: notification channels (API 26+), foreground service notification.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Android notification channel for gateway messages. */
const CHANNEL_ID = "aionima-gateway";

/** Configure notification handler (show notifications while app is foregrounded). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register for push notifications via FCM.
 * Returns the Expo push token (wraps FCM device token).
 */
export async function registerPushNotifications(): Promise<string | null> {
  if (Platform.OS !== "android") return null;

  // Create notification channel for Android 8+ (API 26+)
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Gateway Messages",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#cba6f7",
    sound: "default",
  });

  // Request permission (Android 13+ / API 33+ requires runtime permission)
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return null;

  // Get Expo push token (backed by FCM on Android)
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: "aionima-companion-android",
  });

  return tokenData.data;
}

// ---------------------------------------------------------------------------
// Foreground Service Notification
// ---------------------------------------------------------------------------

/** Channel for the persistent foreground service notification. */
const FOREGROUND_CHANNEL_ID = "aionima-foreground";

/**
 * Create the foreground service notification channel.
 * Used when the app maintains a WebSocket connection in the background.
 */
export async function setupForegroundChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(FOREGROUND_CHANNEL_ID, {
    name: "Connection Status",
    importance: Notifications.AndroidImportance.LOW,
    vibrationPattern: undefined,
    sound: null,
  });
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

export type NotificationListener = (
  notification: Notifications.Notification,
) => void;

export type NotificationResponseListener = (
  response: Notifications.NotificationResponse,
) => void;

/** Subscribe to incoming notifications while app is running. */
export function addNotificationListener(
  handler: NotificationListener,
): Notifications.EventSubscription {
  return Notifications.addNotificationReceivedListener(handler);
}

/** Subscribe to notification tap/action events. */
export function addNotificationResponseListener(
  handler: NotificationResponseListener,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}
