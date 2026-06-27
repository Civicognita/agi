/**
 * DiscordOwnerCard — set which Discord user is the Owner (#E0), i.e.
 * owner.channels.discord. The field already existed in Settings → Owner Channel
 * IDs, but the owner wanted it reachable from the Channels page (Wave 1d). This
 * is a self-contained control (reusable; the Wave-3 Channels redesign can
 * relocate it) that reads + writes the owner config via useConfig().
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Button } from "@/components/ui/button.js";
import { useConfig } from "@/hooks.js";

export function DiscordOwnerCard() {
  const cfg = useConfig();
  const current = cfg.data?.owner?.channels?.discord ?? "";
  const [val, setVal] = useState(current);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setVal(current);
  }, [current]);

  const dirty = val.trim() !== current;

  const save = async () => {
    if (!cfg.data) return;
    const owner = cfg.data.owner ?? { displayName: "", channels: {}, dmPolicy: "pairing" as const };
    await cfg.save({
      ...cfg.data,
      owner: { ...owner, channels: { ...owner.channels, discord: val.trim() || undefined } },
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card className="p-3 space-y-2" data-testid="discord-owner-card">
      <div>
        <span className="text-[13px] font-semibold text-foreground">Owner</span>
        <p className="text-[11px] text-muted-foreground">
          Which Discord user is you (the Owner, <span className="font-mono">#E0</span>). Messages from this
          account are treated as the owner. Find your ID in Discord with Developer Mode on → right-click your
          name → Copy User ID.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          className="font-mono text-xs flex-1"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Discord User ID, e.g. 123456789012345678"
          data-testid="discord-owner-input"
        />
        <Button size="sm" disabled={!dirty || cfg.saving} onClick={() => void save()} data-testid="discord-owner-save">
          {cfg.saving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>
    </Card>
  );
}
