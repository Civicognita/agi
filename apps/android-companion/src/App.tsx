/**
 * Aionima Companion — Android App Entry Point (Task #217)
 *
 * Shared React Native codebase with iOS companion.
 * Android-specific: FCM push, foreground service, scoped storage (API 30+).
 *
 * Screens:
 *   - Chat: Send/receive messages with the agent
 *   - Impact: Read-only impact dashboard view
 *   - Settings: Pairing, entity management, push preferences
 */

import React, { useEffect, useState } from "react";
import { Text, View, StyleSheet, Platform, AppState } from "react-native";
import type { AppStateStatus } from "react-native";
import { registerPushNotifications } from "./notifications.js";
import { GatewayClient } from "./gateway-client.js";

export default function App(): React.JSX.Element {
  const [connected, setConnected] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    // Register FCM push notifications on Android
    if (Platform.OS === "android") {
      registerPushNotifications()
        .then((token) => {
          if (token) setPushEnabled(true);
        })
        .catch(() => {
          // Push not available — non-fatal
        });
    }

    // Handle app state changes for foreground service management
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        if (state === "background") {
          // Android: start foreground service to maintain WS connection
        }
      },
    );

    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Aionima Companion</Text>
      <Text style={styles.subtitle}>
        Connect to your gateway to get started.
      </Text>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Gateway:</Text>
        <Text style={[styles.statusValue, connected ? styles.online : styles.offline]}>
          {connected ? "Connected" : "Disconnected"}
        </Text>
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Push:</Text>
        <Text style={[styles.statusValue, pushEnabled ? styles.online : styles.offline]}>
          {pushEnabled ? "Enabled" : "Disabled"}
        </Text>
      </View>
    </View>
  );
}

// Suppress unused variable warnings — will be used in full screen implementation
void GatewayClient;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1e1e2e",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#cba6f7",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: "#a6adc8",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
  },
  statusRow: {
    flexDirection: "row",
    marginVertical: 4,
  },
  statusLabel: {
    color: "#a6adc8",
    fontSize: 13,
    marginRight: 8,
  },
  statusValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  online: {
    color: "#a6e3a1",
  },
  offline: {
    color: "#f38ba8",
  },
});
