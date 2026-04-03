/**
 * SettingsSaveBar — save button + status indicator for settings pages.
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface SettingsSaveBarProps {
  dirty: boolean;
  saving: boolean;
  saveMessage: string | null;
  saveError: string | null;
  onSave: () => void;
}

export function SettingsSaveBar({ dirty, saving, saveMessage, saveError, onSave }: SettingsSaveBarProps) {
  return (
    <Card className="flex-row items-center gap-3 p-3 px-4 mb-6">
      <Button
        onClick={onSave}
        disabled={saving || !dirty}
        variant={dirty ? "default" : "secondary"}
      >
        {saving ? "Saving..." : "Save Config"}
      </Button>
      {dirty && (
        <span className="text-[13px] text-yellow">Unsaved changes</span>
      )}
      {!dirty && saveMessage !== null && (
        <span className="text-[13px] text-green">{saveMessage}</span>
      )}
      {saveError !== null && (
        <span className="text-[13px] text-red">{saveError}</span>
      )}
    </Card>
  );
}
