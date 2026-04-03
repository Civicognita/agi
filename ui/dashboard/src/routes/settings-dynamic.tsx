/**
 * Settings > Dynamic — renders a plugin-registered settings page by :pageId.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { useSettingsContext } from "./settings-layout.js";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar.js";
import { PluginSettingsRenderer } from "@/components/settings/PluginSettingsRenderer.js";
import type { AionimaConfig } from "../types.js";

export default function SettingsDynamicPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const { configHook, pluginPages } = useSettingsContext();
  const [draft, setDraft] = useState<AionimaConfig>(configHook.data ?? ({} as AionimaConfig));
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (configHook.data) {
      setDraft(configHook.data);
      setDirty(false);
    }
  }, [configHook.data]);

  const update = useCallback((fn: (prev: AionimaConfig) => AionimaConfig) => {
    setDraft((prev) => {
      const next = fn(prev);
      setDirty(true);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      await configHook.save(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }, [draft, configHook]);

  const page = pluginPages.find((p) => p.id === pageId);

  if (!configHook.data) return null;

  if (!page) {
    return (
      <div className="text-sm text-muted-foreground">
        Settings page not found: {pageId}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{page.label}</h2>
        {page.description && (
          <p className="text-sm text-muted-foreground mt-1">{page.description}</p>
        )}
      </div>
      <SettingsSaveBar
        dirty={dirty}
        saving={configHook.saving}
        saveMessage={configHook.saveMessage}
        saveError={saveError}
        onSave={() => void handleSave()}
      />
      <PluginSettingsRenderer pluginId={page.pluginId} sections={page.sections} config={draft} update={update} />
    </div>
  );
}
