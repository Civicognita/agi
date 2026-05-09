# PAx-primitive audit (s142 t557)

Inventory of hand-rolled UI surfaces in `ui/dashboard/src/` that should
migrate to `@particle-academy/*` primitives. Each entry lists what's
hand-rolled, which PAx package would replace it, and whether the
follow-up is a local refactor or an upstream-issue file.

Per CLAUDE.md § 1.5: never permanently hand-roll around a missing PAx
primitive. If the primitive is missing, file an issue against the
relevant `Particle-Academy/<repo>` and tag a tynn story under the PAx
domain. Document temporary workarounds with the issue link.

---

## 1. Modal-shaped overlays (`fixed inset-0`)

7 files manually render full-screen overlay backdrops + modal containers
instead of using PAx Modal:

| File | Surface | Replace with | Action |
|---|---|---|---|
| `components/StackPicker.tsx` | Stack-attach picker (201 lines) | `@particle-academy/react-fancy` Modal | Refactor — t559 |
| `components/MagicAppModal.tsx` | MApp viewer launcher (165 lines) | PAx Modal + InertScreen for the iframe content | Refactor — t559 |
| `components/ProjectPickerDialog.tsx` | Project switch (90 lines) | PAx Modal | Refactor — t559 |
| `components/WhoDBFlyout.tsx` | DB browser flyout | PAx Flyout/Sheet (right-side variant) | Refactor — t559 |
| `components/MAppEditor.tsx` | Magic-app editor full-screen | PAx Screen primitive (when fancy-screens lands) | File upstream issue if no Screen variant fits |
| `components/ui/flyout-panel.tsx` | Generic flyout adapter | Already an adapter — verify it wraps PAx Flyout, not div+css | Audit + adapt |
| `routes/root.tsx` | Header chat-aside flyout | Same as flyout-panel — verify wrapping | Audit + adapt |

**Common gap**: focus trap, body-scroll lock, ARIA `role="dialog"` /
`aria-modal="true"`, ESC-to-close — all of these are free with PAx
Modal but absent from hand-rolled overlays. **Real bug surface**:
keyboard users can tab out of an open modal into the underlying
dashboard.

---

## 2. Hand-rolled inline SVG icons

5 files declare `<svg>` paths directly instead of pulling from
`@particle-academy/react-fancy` Icon:

| File | Icon count | Replace with |
|---|---|---|
| `components/ProfileCard.tsx` | 5 | `react-fancy` Icon (with `name`) |
| `components/WorkerFlyout.tsx` | 1 | Icon |
| `components/WhoDBFlyout.tsx` | 1 | Icon |
| `components/NotificationBell.tsx` | 1 | Icon |
| `components/ActiveDownloads.tsx` | 1 | Icon |

Plus `routes/root.tsx` which embeds the help-button icon (cycle 249
shipped resolveHelpContext but kept the inline SVG).

**Hand-rolled icons** lose: themed color via design tokens, sized
consistency, reduced bundle (one icon font vs N inline paths). Action:
header chrome icon refactor — t558.

---

## 3. Form inputs

10+ components use raw `<input>` / `<select>` / `<textarea>`:

```
WorkerFlyout / MachineAdmin / Projects / NotesPanel / ChatFlyout
PrimeSettings / ProjectLogViewer / ProjectDetail / MAppFormRenderer
ReportList
```

Most should route through `components/ui/input.tsx` and
`components/ui/select.tsx` (which are local adapters; verify those wrap
PAx Field/Input/Select rather than just styling raw HTML controls).

**Action**: form-input sweep — t561. Discrete fix per file once the
local adapters are confirmed PAx-backed.

---

## 4. Per-page chrome consistency

Cards and headings render with ad-hoc Tailwind across routes. Roughly 4+
routes use `className="...rounded-xl bg-card..."` directly instead of the
local `Card` adapter. Headings vary (`<h1>`, `<h2>`, `<div>` styled as
heading) instead of a consistent `Heading` primitive.

**Action**: per-page chrome consistency — t560. Audit one route at a
time; refactor when the surface gets touched for other reasons rather
than as a dedicated sweep PR (avoids touching every route in a single
mega-PR).

---

## 5. Existing PAx adoption (good signal)

These files already pull from PAx — use as reference for refactor shape:

- `routes/resources.tsx` — uses `react-fancy` for layout primitives.
- `routes/pax.tsx` — meta-page; demos all 6 packages.
- `components/Projects.tsx` — Card + Modal + form components.
- `components/WidgetRenderer.tsx` — chart + canvas via fancy-echarts/3d.
- `components/MAppEditor.tsx` — fancy-code editor.
- `components/ProjectDetail.tsx` — partial; the chat-aside breadcrumb
  added in cycle 236 is hand-rolled and tracked as Wish #18.

---

## 6. Currently-deferred items

Items where the right PAx primitive may not exist yet:

- **Toast/notification stack**: `NotificationBell.tsx` shows a list; the
  permanent toast surface (cycle 162 spec) needs PAx Toast. **File
  upstream issue against react-fancy if no Toast primitive is present.**
- **Kanban**: s139 (PM-Lite kanban) needs a Kanban primitive. PAx
  packages have a 2D canvas (fancy-3d) but not a board-shaped Kanban
  layout component. **File upstream issue against react-fancy.**
- **Universal help Support Canvas** (s137 t531): doc-tree + reader
  primitives exist in fancy-code; combining them into a Support Canvas
  shape is a local component, not a missing PAx primitive.

---

## Process

1. Pick a surface from the table above.
2. Check the relevant PAx package's exports for a fitting primitive.
3. If primitive exists: refactor (preserve behavior, add tests). Use
   the local `components/ui/<name>.tsx` adapter where present so the
   refactor stays one-file.
4. If primitive missing: file an issue against `Particle-Academy/<repo>`
   describing the use case + the gap. Tag a tynn story under PAx domain
   (slug: `pax`). Document the workaround inline with the issue link.
5. Never permanently hand-roll. Workarounds must reference the upstream
   issue.

---

## Audit summary

- 7 modal/flyout surfaces — refactor to PAx Modal/Flyout
- 5 components with hand-rolled icons — refactor to PAx Icon (~9 icons total)
- 10+ form-input surfaces — verify local adapters wrap PAx, then sweep
- ~4 routes with ad-hoc Card/Heading — case-by-case
- 3 surfaces blocked by missing PAx primitives (Toast, Kanban) — file upstream

Estimated migrated surface count after the s142 sweep finishes:
**26+ refactors** spread across t558-t561, plus 2-3 upstream issues.

---

_Audit conducted 2026-05-09 in cycle 250 (s142 t557). Re-run when s142
sub-tasks ship to track convergence._
