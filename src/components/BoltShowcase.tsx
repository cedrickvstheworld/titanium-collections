"use client";

import { Suspense, useCallback, useMemo, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Canvas, useFrame } from "@react-three/fiber";
import { Center, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  MathUtils,
  Vector3,
  type Mesh,
  type MeshPhysicalMaterial,
} from "three";
import {
  asset,
  BRAND,
  DEFAULT_DESIGN,
  DEFAULT_FINISH,
  DESIGN_GROUPS,
  DESIGNS,
  FINISHES,
  MODEL_DISPLAY_SIZE,
  modelUrl,
  thumbUrl,
  type Design,
  type Finish,
} from "@/utils/constants";
import { burntColors, type FastenerMeta } from "@/utils/burnt";
import ThemeToggle from "@/components/ThemeToggle";
import BgColorPicker from "@/components/BgColorPicker";

// Load a (meshopt-compressed, quantized) model and bake it into a plain
// float geometry in real-world units, with the burnt gradient as vertex colors.
function useFastener(design: Design) {
  const { scene } = useGLTF(modelUrl(design));
  return useMemo(() => {
    let mesh: Mesh | undefined;
    scene.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    });
    if (!mesh) throw new Error(`No mesh in ${design.id}`);
    scene.updateMatrixWorld(true);

    const src = mesh.geometry.getAttribute("position");
    const positions = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      positions[i * 3] = src.getX(i);
      positions[i * 3 + 1] = src.getY(i);
      positions[i * 3 + 2] = src.getZ(i);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setIndex(mesh.geometry.getIndex());
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeVertexNormals(); // smoother than the 8-bit quantized normals
    geometry.setAttribute("color", burntColors(geometry, mesh.userData as FastenerMeta));
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new Vector3());
    const scale = MODEL_DISPLAY_SIZE / Math.max(size.x, size.y, size.z);
    return { geometry, scale };
  }, [scene, design.id]);
}

function Fastener({ design, finish }: { design: Design; finish: Finish }) {
  const { geometry, scale } = useFastener(design);
  const material = useRef<MeshPhysicalMaterial>(null);
  const target = useRef(new Color());
  // start from the finish active at mount so switching designs doesn't flash
  const [initial] = useState(finish);
  const burntMix = useRef({ value: initial.burnt ? 1 : 0 });

  // blend the vertex-color gradient in/out via a shader uniform
  const onBeforeCompile = useCallback(
    (shader: { uniforms: Record<string, unknown>; vertexShader: string }) => {
      shader.uniforms.uBurnt = burntMix.current;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uBurnt;")
        .replace(
          "#include <color_vertex>",
          "#include <color_vertex>\nvColor.rgb = mix(vec3(1.0), vColor.rgb, uBurnt);",
        );
    },
    [],
  );

  // ease toward the selected finish instead of snapping
  useFrame((_, delta) => {
    const m = material.current;
    if (!m) return;
    const k = 1 - Math.exp(-delta * 8);
    m.color.lerp(target.current.set(finish.color), k);
    m.iridescence = MathUtils.lerp(m.iridescence, finish.iridescence, k);
    burntMix.current.value = MathUtils.lerp(burntMix.current.value, finish.burnt ? 1 : 0, k);
  });

  return (
    <Center>
      <mesh geometry={geometry} scale={scale} rotation={[0, 0, Math.PI / 14]}>
        <meshPhysicalMaterial
          ref={material}
          vertexColors
          onBeforeCompile={onBeforeCompile}
          color={initial.color}
          metalness={1}
          roughness={0.28}
          iridescence={initial.iridescence}
          iridescenceIOR={1.8}
          iridescenceThicknessRange={[250, 600]}
          clearcoat={0.3}
          clearcoatRoughness={0.2}
        />
      </mesh>
    </Center>
  );
}

// Studio lighting built from light panels — no HDRI download needed.
function StudioLights() {
  return (
    <Environment resolution={256}>
      <Lightformer form="rect" intensity={4} position={[0, 5, -6]} scale={[10, 3, 1]} />
      <Lightformer form="rect" intensity={2.5} position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
      <Lightformer form="rect" intensity={2.5} position={[6, 1, 2]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
      <Lightformer form="ring" intensity={1.5} position={[0, 0, 6]} scale={4} />
    </Environment>
  );
}

// Layout: on phones (< sm) the page is a column — header, 3D view, then a
// bottom panel with a horizontal design strip and the color row. From sm up,
// the 3D view fills the screen and the controls float in the corners.
// `sm:contents` lets the mobile wrappers dissolve so children can be
// positioned absolutely against the page on larger screens.

function DesignPicker({
  selected,
  onSelect,
}: {
  selected: Design;
  onSelect: (d: Design) => void;
}) {
  return (
    <nav
      aria-label="Available designs"
      className="sm:absolute sm:top-6 sm:left-6 sm:max-h-[calc(100dvh-8rem)] sm:overflow-y-auto sm:pr-1"
    >
      <p className="mb-2 text-[10px] font-medium tracking-[0.18em] text-foreground/50 uppercase sm:mb-3 sm:text-[11px]">
        Featured designs
      </p>
      <div
        role="radiogroup"
        aria-label="Design"
        className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-col sm:gap-4 sm:scroll-px-0 sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {DESIGN_GROUPS.map((group) => (
          <div key={group} className="contents sm:block">
            <p className="hidden text-[10px] tracking-[0.14em] text-foreground/35 uppercase sm:mb-1.5 sm:block">
              {group}
            </p>
            <div className="contents sm:flex sm:flex-col sm:gap-1.5">
              {DESIGNS.filter((d) => d.group === group).map((d) => {
                const active = d.id === selected.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onSelect(d)}
                    className={`flex shrink-0 snap-start cursor-pointer items-center gap-2 rounded-xl border p-1.5 pr-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground sm:w-52 sm:gap-2.5 sm:pr-1.5 ${
                      active
                        ? "border-foreground/70 bg-foreground/10"
                        : "border-foreground/10 hover:border-foreground/25 hover:bg-foreground/5"
                    }`}
                  >
                    <Image
                      src={thumbUrl(d)}
                      alt=""
                      width={40}
                      height={40}
                      className="size-9 shrink-0 rounded-lg bg-black/20 sm:size-10"
                    />
                    <span className="truncate text-xs font-medium whitespace-nowrap text-foreground sm:text-sm">
                      {d.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function FinishPicker({
  selected,
  onSelect,
}: {
  selected: Finish;
  onSelect: (f: Finish) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Anodization color"
      className="flex justify-center gap-2 sm:absolute sm:right-6 sm:bottom-6 sm:flex-col"
    >
      {FINISHES.map((f) => {
        const active = f.name === selected.name;
        return (
          <button
            key={f.name}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={f.name}
            onClick={() => onSelect(f)}
            className="group relative cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <span
              style={{ background: f.swatch }}
              className={`block size-8 rounded-lg transition-transform duration-150 group-hover:scale-110 sm:size-9 ${
                active ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background" : "ring-1 ring-foreground/15"
              }`}
            />
            {/* name label: white bold text on a solid dark pill — above the
                swatch on phones, to its left on larger screens */}
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 rounded-md bg-black px-2.5 py-1 text-xs font-bold whitespace-nowrap text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 sm:top-1/2 sm:right-full sm:bottom-auto sm:left-auto sm:mr-3 sm:mb-0 sm:translate-x-0 sm:-translate-y-1/2"
            >
              {f.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BrandMark() {
  return (
    <div className="min-w-0 select-none sm:pointer-events-none sm:absolute sm:bottom-6 sm:left-6">
      {/* phones: smaller type that may wrap onto two lines instead of being clipped
          by the toggle + Shopee buttons; one line from sm up */}
      <h1 className="font-brand text-[11px] leading-tight tracking-[0.06em] text-foreground uppercase sm:truncate sm:text-xl sm:leading-none sm:tracking-[0.12em]">
        {BRAND.name}
      </h1>
      <p className="mt-1.5 hidden text-[11px] tracking-[0.2em] text-foreground/45 uppercase sm:mt-2 sm:block">
        {BRAND.tagline}
      </p>
    </div>
  );
}

function ShopeeLink() {
  return (
    <a
      href={BRAND.shopeeUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Visit ${BRAND.name} on Shopee (opens in a new tab)`}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background shadow-lg transition hover:scale-[1.03] hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:gap-2 sm:px-3.5 sm:py-2 sm:text-sm"
    >
      <Image src={asset(BRAND.shopeeIcon)} alt="" width={18} height={20} className="h-4 w-auto sm:h-5" />
      <span>Shopee</span>
    </a>
  );
}

export default function BoltShowcase() {
  const [finish, setFinish] = useState<Finish>(DEFAULT_FINISH);
  const [design, setDesign] = useState<Design>(DEFAULT_DESIGN);
  const [, startTransition] = useTransition();

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden sm:block">
      <header className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:contents">
        <BrandMark />
        {/* z-10: on desktop the full-screen canvas wrapper comes later in the DOM
            and would otherwise sit on top and swallow clicks on these controls */}
        <div className="z-10 flex items-center gap-2 sm:absolute sm:top-6 sm:right-6 sm:gap-3">
          <BgColorPicker />
          <ThemeToggle />
          <ShopeeLink />
        </div>
      </header>

      <div className="relative min-h-0 flex-1 sm:absolute sm:inset-0">
        <Canvas
          camera={{ position: [0, 0.5, 9], fov: 35 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          className="touch-none"
        >
          <Suspense fallback={null}>
            <Fastener key={design.id} design={design} finish={finish} />
            <StudioLights />
          </Suspense>
          <OrbitControls
            enablePan={false}
            minDistance={5}
            maxDistance={14}
            autoRotate
            autoRotateSpeed={1.2}
            enableDamping
          />
        </Canvas>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:contents">
        {/* transition keeps the current model on screen while the next one loads */}
        <DesignPicker selected={design} onSelect={(d) => startTransition(() => setDesign(d))} />
        <FinishPicker selected={finish} onSelect={setFinish} />
      </div>
    </div>
  );
}

for (const d of DESIGNS) useGLTF.preload(modelUrl(d));
