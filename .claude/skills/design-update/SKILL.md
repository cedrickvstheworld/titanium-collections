---
name: design-update
description: Update or add a titanium fastener 3D model (bolt/screw) from reference photos and caliper measurements, following references/TEMPLATE.md. Use when the user sends a "DESIGN UPDATE" block, asks to fix a model's shape/dimensions, or adds new sample photos under references/designs.
argument-hint: "[model-id or filled-in template]"
---

# Design update

Turn a filled-in `references/TEMPLATE.md` block (or a loose request) into an
accurate change to the generated fastener models.

## 1. Gather input

- Parse the user's block: model id, photos, measurements, design details, fix request, finish.
- If the user invoked this with no details, show them the template from
  `references/TEMPLATE.md` (the fenced block) and stop — let them fill it in.
- Missing fields are fine: estimate them from the photos, but **list every
  estimated value** in the final report so the user can correct it.
- Only ask a question if the model id is ambiguous or the fix request conflicts
  with the measurements.

## 2. Look at the references

- Read every photo the user names (Read tool on `references/designs/*.jpg`,
  `references/finishes/*.jpg`). If none named, look for files starting with the
  model id.
- Note: head profile, flange shape, groove/dimple count and sweep direction,
  Torx size relative to head, thread pitch relative to diameter, tip shape,
  plain-shank length.
- Use a ruler/caliper in the photo, or the known thread size, as the scale.

## 3. Map to generator parameters

All geometry lives in `scripts/generate-models.mjs`. **Units are cm: divide mm by 10.**

| Template field | Where it goes |
|---|---|
| Thread M__ × pitch | `machineShank({ d, pitch })` — d = M/10, pitch = mm/10 |
| Self-tapping ST__ | `tappingShank({ d, coreR, pitch, tipLen })` — coreR ≈ 0.35·d |
| Length under head | model `length` |
| Threaded length | `threadLength` (full thread ≈ length − 1 pitch) |
| 12-point CNC head | `cncHead(k)`, k = d / 0.8; edit inside for flange/lobe/flute/height |
| Conical flange head | `conicalHead({ flangeR, edgeH, coneBaseR, topR, height })` |
| Flange Ø | `flangeR` = Ø / 20 |
| Head height | `height` |
| Top flat Ø | `topR` = Ø / 20 |
| Grooves / dimples | `star: true`, groove/dimple math inside `conicalHead` |
| Torx T__ | `torx: { rOut, rIn, depth, cone }` — rOut = A/20, rIn ≈ 0.72·rOut (T25 A=4.4, T30 5.5, T40 6.6, T45 7.8, T50 8.8 mm) |
| Burnt behaviour | `burnt: "height"` (tall heads) or `"radial"` (flat heads), `tipZone` |

- Existing model: change its entry in `MODELS` (or the factory it uses). Keep
  the change minimal and scoped to that model — don't alter shared factories
  in a way that shifts other models unless the user asked.
- New model: add a `MODELS` entry (or a new factory/head builder), then add a
  matching entry in `DESIGNS` in `src/utils/constants.ts` (id, group, name, detail).
  A new group also goes in `DESIGN_GROUPS` and the `DesignGroup` type.
- Finish changes go in `FINISHES` / `BURNT_PALETTE` in `src/utils/constants.ts`.
- Ring-stack rule: each ring is one radius per angle at one height, so every
  feature must be expressible as radius(θ) at height y. Undercuts that fold
  back on themselves are not possible — approximate them.

## 4. Build and verify

```bash
npm run generate:models   # must print "watertight" for every model
npx tsc --noEmit && npm run lint
```

- For head details (grooves, Torx, flutes) render top-down previews:
  `PREVIEW_DIR=<scratchpad>/prev npm run generate:models` → `<id>-top.png`.
- Read the regenerated thumbnail `public/thumbs/<id>.png` and compare it with
  the reference photo side by side. Iterate (max ~3 rounds) until the
  silhouette, head profile and features match.
- Check the compressed size printed by `du` stays reasonable (< ~600 KB per
  model); raise ring step or lower `segments` if not.

## 5. Report

Keep it short:
- What changed, per model (old → new key dimensions in mm).
- **Estimated values** (anything the user left as `?`).
- Anything that couldn't be matched exactly and why.
- Remind them to check it in `npm run dev`.
