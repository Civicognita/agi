/**
 * Aionima Companion — iOS App Entry Point
 *
 * NOT a standalone agent. This is a sensor + notification surface
 * that connects to the gateway via WebSocket.
 *
 * Screens:
 *   - Chat: Send/receive messages with the agent
 *   - Impact: Read-only impact dashboard view
 *   - Settings: Pairing, entity management, push preferences
 */

import React from "react";
import { Text, View, StyleSheet } from "react-native";

export default function App(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Aionima Companion</Text>
      <Text style={styles.subtitle}>Connect to your gateway to get started.</Text>
    </View>
  );
}

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
  },
});
