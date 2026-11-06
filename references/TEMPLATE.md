# Design Update Template

Copy the block below, fill it in, and send it to Claude. Leave a field as `?`
if unknown — it will be estimated from the photos and flagged as an estimate.

```
DESIGN UPDATE — <design name, e.g. "Body Bolt Star">
Model id: <e.g. body-bolt-star, or "new">
Reference photos: references/designs/<file1>.jpg, <file2>.jpg

MEASUREMENTS (mm, from calipers; write "?" if unknown)
- Thread: M__ × pitch __        (or self-tapping: ST__ )
- Length under head: __
- Threaded length: __           (full / partial)
- Head type: 12-point CNC / conical flange / button / other: __
- Flange diameter: __   Flange edge thickness: __
- Head total height (flange underside → top): __
- Head across flats / points (12-point only): __ / __
- Top flat diameter (conical heads): __
- Torx size: T__  Recess depth: __
- Tip: chamfered / pointed (point length __)

DESIGN DETAILS
- Grooves/milling on head: none / star / other (count __, describe)
- Dimples: count __, position __
- Anything unusual: __

FIX REQUEST (only what's wrong now)
- "<part> looks <too X / missing Y>" — e.g. "star grooves too shallow, should reach rim"

FINISH (optional)
- Color: <name>  Reference: references/finishes/<file>.jpg
```

## Quick version

```
body-bolt-star: M6×16, flange Ø14, head height 5, T30.
Photos: references/designs/body-bolt-star-*.jpg. Fix: grooves too shallow.
```

## Photo checklist

1. **Side view** — lying flat beside a ruler or caliper (gives proportions).
2. **Top view** — straight down on the head (Torx, grooves, dimples).
3. **3/4 angle** — shows head profile and groove depth.
4. Plain white background, even light, no watermark over the part.
5. Name files `<model-id>-side.jpg`, `<model-id>-top.jpg`, `<model-id>-angle.jpg`.

## Current model ids

| Group          | Model ids                          |
|----------------|------------------------------------|
| CNC Head Bolts | `cnc-m6`, `cnc-m8`, `cnc-m10`      |
| Body Bolts     | `body-bolt`, `body-bolt-star`      |
| Body Screws    | `body-screw`, `body-screw-star`    |

Models are defined in `scripts/generate-models.mjs`, listed in
`src/utils/constants.ts`, and rebuilt with `npm run generate:models`.
