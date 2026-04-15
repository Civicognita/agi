# Crash Recovery & Safemode

The gateway owns the full dependency chain — PostgreSQL (ID service), the
`aionima-id.service` systemd unit, project containers, and HF model
containers. When any of those drift or the machine itself crashes, the
gateway detects it and recovers on its own. **You should never have to run
`podman start`, `systemctl start`, or similar by hand.**

## What the gateway does on every boot

1. **Reads a shutdown marker** at `~/.agi/shutdown-state.json` that the
   previous run wrote when it exited gracefully.
2. **Starts PostgreSQL and the ID service** regardless of how it exited.
   AGI's own databases live in that Postgres instance, so it must be up.
3. **If the marker exists** (clean boot): restarts project + model
   containers listed in the marker, then deletes the marker and continues.
4. **If the marker is missing** (crash): enters **safemode**.

## Safemode

Safemode is how the gateway surfaces "I'm up, but something broke and I
don't know what yet."

- The dashboard loads normally, but **every frontend route redirects to
  `/admin`** until you exit safemode.
- The **Admin Dashboard** shows a red `SAFEMODE` callout with a summary,
  the investigation status, and buttons to view the incident report or
  click **Recover now**.
- **Mutation API endpoints** (POST/PUT/DELETE) return `503 safemode_active`
  until recovery runs. Read-only APIs and admin APIs stay available.
- **Auto-starts are skipped** (HF model auto-start in particular) so a
  crashing model can't re-trigger whatever broke us last time.

### The investigator

As soon as safemode is entered, the **SafemodeInvestigator** runs as a
background task:

1. Collects evidence: `journalctl -u aionima`, `journalctl -u aionima-id`,
   `podman ps -a`, postgres container logs, tail of the gateway log,
   `dmesg`, and disk-free output.
2. Classifies the incident heuristically (postgres unreachable, OOM, disk
   full, ID service failed, container runtime failure, or unknown).
3. If a small local model (default `HuggingFaceTB/SmolLM2-360M-Instruct`)
   is running, Aion adds a narrative analysis section.
4. Writes a markdown report to `~/.agi/incidents/<timestamp>.md` and emits
   a notification.

The investigator always writes a report, even if the local model isn't
installed yet — the heuristic template is self-sufficient.

### Exiting safemode

Click **Recover now** (or run `agi safemode exit`). This will:

1. Ensure `aionima-id-postgres` and `aionima-id.service` are up.
2. Start any managed containers (`label=aionima.managed=true`) still in
   `Created` / `Exited` state.
3. Restart HF model containers tracked in `~/.agi/model-containers.json`.
4. Clear the safemode flag.

The whole flow is one click. There are no manual commands to run.

## CLI

```bash
agi safemode          # show safemode status (JSON)
agi safemode exit     # run recovery + clear safemode
agi incidents         # list recent incident reports
agi incidents view <id>   # show one report's markdown
```

## Files

| Path | Purpose |
|---|---|
| `~/.agi/shutdown-state.json` | Written by graceful shutdown; consumed on next boot |
| `~/.agi/incidents/` | One markdown report per incident |
| `~/.agi/model-containers.json` | Heartbeat for HF model containers (used during recovery) |

## Troubleshooting

- **Safemode keeps re-appearing after recovery.** Either the gateway is
  crashing on start (check `agi logs`) or the machine rebooted between
  graceful exits. Both are normal — each boot after a crash surfaces
  safemode until you acknowledge it.
- **"Recover now" fails.** The incident report under **View report** will
  name the blocking subsystem. If Postgres itself is broken (e.g. disk
  full), fix that first and try again.
- **The local model isn't running so the report has no Aion narrative.**
  That's fine — the heuristic template covers every currently-classified
  incident type. Install SmolLM2-360M from the HF Marketplace if you want
  the narrative section.
