import { BufferAttribute, Color, MathUtils, type BufferGeometry } from "three";
import { BURNT_PALETTE } from "@/utils/constants";

// Landmarks baked into each model's glTF node extras by scripts/generate-models.mjs
export type FastenerMeta = {
  bearingY: number; // underside of the head
  topY: number; // top face of the head
  flangeR: number; // outer flange radius
  tipZone: number; // length of the heat-tinted tip
  burnt: "height" | "radial"; // tall CNC heads fade upward, flat body heads fade inward
};

const palette = BURNT_PALETTE.map(([h, c]) => [h, new Color(c)] as const);
const tmp = new Color();

function heatColor(h: number, out: Color) {
  let s = palette.length - 1;
  while (s > 0 && palette[s - 1][0] > h) s--;
  const [h0, c0] = palette[Math.max(0, s - 1)];
  const [h1, c1] = palette[s];
  return out.copy(c0).lerp(c1, h1 === h0 ? 0 : MathUtils.smoothstep(h, h0, h1));
}

// Per-vertex heat-tint colors in model units (tip at y = 0, axis = +Y).
export function burntColors(geometry: BufferGeometry, meta: FastenerMeta) {
  const pos = geometry.getAttribute("position");
  const out = new Float32Array(pos.count * 3);
  const headH = meta.topY - meta.bearingY;
  const neck = Math.min(0.3, 0.6 * headH); // straw band just under the head

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let h: number;
    if (y < meta.bearingY - 0.005) {
      const tip = 1 - MathUtils.smoothstep(y, 0, meta.tipZone);
      const toHead = MathUtils.clamp((y - (meta.bearingY - neck)) / neck, 0, 1) * 0.18;
      h = Math.max(tip, toHead);
    } else if (meta.burnt === "height") {
      h = 0.3 + 0.7 * MathUtils.clamp((y - meta.bearingY) / headH, 0, 1);
    } else {
      const q = 1 - Math.hypot(x, z) / meta.flangeR;
      h = 0.3 + 0.7 * MathUtils.clamp(q / 0.65, 0, 1);
    }
    heatColor(h, tmp).toArray(out, i * 3);
  }
  return new BufferAttribute(out, 3);
}
