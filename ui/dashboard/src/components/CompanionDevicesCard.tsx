/**
 * CompanionDevicesCard — pair + manage companion devices (gateway ↔ desktop /
 * mobile, e.g. Genie). The owner generates a 6-digit code here and reads it out
 * to the device; the device submits it to receive a per-device session token.
 *
 * Response to Civicognita/agi#178 Q5.2a — pairing lives in AGI (Local-ID is
 * deprecated). Backed by the existing CompanionPairingService.
 */

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCompanionDevices, useGeneratePairCode, useRevokeCompanionDevice } from "../hooks.js";

export function CompanionDevicesCard() {
  const { data: devices } = useCompanionDevices();
  const generate = useGeneratePairCode();
  const revoke = useRevokeCompanionDevice();
  const code = generate.data;

  return (
    <Card className="p-4 space-y-3" data-testid="companion-devices-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Companion devices</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Pair a desktop or mobile companion (e.g. Genie) on your LAN. Generate a code, then enter
            it in the device.
          </p>
        </div>
        <Button
          size="sm"
          className="text-[11px] h-7 shrink-0"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
          data-testid="companion-generate-code"
        >
          {generate.isPending ? "Generating…" : "Pair a device"}
        </Button>
      </div>

      {generate.isError && (
        <p className="text-[11px] text-red">
          {generate.error instanceof Error ? generate.error.message : "Could not generate a code"}
        </p>
      )}

      {code && (
        <div
          className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-3 text-center"
          data-testid="companion-pair-code"
        >
          <div className="text-2xl font-mono font-bold tracking-[0.3em] text-primary">{code.code}</div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Enter this in the device. Expires {new Date(code.expiresAt).toLocaleTimeString()}.
          </p>
        </div>
      )}

      <div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Paired devices ({devices?.length ?? 0})
        </span>
        {!devices || devices.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic mt-1">No devices paired yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface0/40 px-3 py-2"
                data-testid={`companion-device-${d.id}`}
              >
                <div className="min-w-0">
                  <span className="text-[12px] text-foreground font-medium">{d.deviceName}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{d.platform}</span>
                  {d.status === "revoked" && (
                    <span className="text-[10px] text-red ml-2">revoked</span>
                  )}
                </div>
                {d.status === "active" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[11px] h-6 shrink-0"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(d.id)}
                    data-testid={`companion-revoke-${d.id}`}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
