/**
 * Settings route — config management.
 */

import { Settings } from "@/components/Settings.js";
import { useRootContext } from "./root.js";

export default function SettingsPage() {
  const { configHook } = useRootContext();

  if (configHook.data === null) return null;

  return (
    <Settings
      config={configHook.data}
      saving={configHook.saving}
      saveMessage={configHook.saveMessage}
      onSave={configHook.save}
    />
  );
}
