/**
 * Wings from downloaded 3D models (.glb files in src/assets/wings/).
 *
 * Any .glb dropped in that folder shows up in the picker. A model is one
 * static mesh of both wings, so to flap it we fit it to the body frame
 * (1 unit = shoulder width; X to screen-right, Y up the spine, Z towards
 * the camera), then draw it twice — each copy clipped to one half
 * and hinged at the spine.
 */
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

const deg = THREE.MathUtils.degToRad;

export interface WingRig {
  id: string;
  group: THREE.Group;
  /** Where the wing roots sit, in shoulder widths from the shoulder line. */
  rootY: number;
  rootZ: number;
  /**
   * Pose both wings.
   * @param beat  flap angle in radians (grows with time × flap speed)
   * @param drag  0..1, the body moving fast → wings fold back
   * @param heave −1..1, the body moving up (+) or down → wings lag behind
   */
  update(beat: number, drag: number, heave: number): void;
  setOpacity(a: number): void;
  dispose(): void;
}

interface ModelMeta {
  label?: string;
  /** Wing span in shoulder widths. */
  span?: number;
  /** Height of the attachment point: 0 = bottom of the model, 1 = top. */
  anchorY?: number;
  /** Extra turn around the vertical axis (degrees) if the model faces
   *  the wrong way. */
  yaw?: number;
  flapSpeed?: number;
  /** How far the wings fold back on each flap (degrees). */
  flapDeg?: number;
  /** How far they beat up and down (degrees each way). */
  beatDeg?: number;
  accent?: string;
  /** Attribution required by the model's license. */
  credit?: string;
}

/** Per-file tuning, keyed by file name without extension (lower case). */
const META: Record<string, ModelMeta> = {
  "angel-wings": {
    label: "นางฟ้า",
    span: 4.2,
    anchorY: 0.62,
    flapSpeed: 2.0,
    flapDeg: 15.0,
    beatDeg: 9.6,
    accent: "#ffffff",
    credit: "Angel-wings — Nobby76 (CC BY 4.0)",
  },
  butterfly_wings: {
    label: "ผีเสื้อ",
    span: 3.8,
    anchorY: 0.5,
    flapSpeed: 3.4,
    flapDeg: 30.0,
    beatDeg: 2.4,
    accent: "#3fb8ff",
    credit: "Butterfly wings — Spider man (CC BY 4.0)",
  },
  fairy_wings_summer: {
    label: "แฟรี่",
    span: 4.2,
    anchorY: 0.45,
    flapSpeed: 8.2,
    flapDeg: 16.0,
    beatDeg: 3.0,
    accent: "#ff9be8",
    credit: "Fairy Wings (Summer) — Ace-Jane (CC BY 4.0)",
  },
  mecha_wings: {
    label: "เมคา",
    span: 4.6,
    anchorY: 0.55,
    flapSpeed: 1.7,
    flapDeg: 11.0,
    beatDeg: 7.2,
    accent: "#9fb4c8",
    credit: "Mecha Wings~ — ZethroLix (CC BY 4.0)",
  },
  robo_wings: {
    label: "โรโบ",
    span: 4.4,
    anchorY: 0.5,
    flapSpeed: 2.0,
    flapDeg: 13.0,
    beatDeg: 7.8,
    accent: "#6fd0ff",
    credit: "Robo Wings — Muhammad Fayyaz Baig",
  },
  wings_of_the_void: {
    label: "วอยด์",
    span: 4.4,
    anchorY: 0.5,
    flapSpeed: 1.7,
    flapDeg: 13.0,
    beatDeg: 7.8,
    accent: "#d8d8e8",
    credit: "Wings of the Void — Evolvetic (CC BY 4.0)",
  },
};

export interface WingModel extends Required<Omit<ModelMeta, "credit">> {
  key: string;
  url: string;
  credit: string | null;
}

const files = import.meta.glob("../assets/wings/*.glb", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const WING_MODELS: WingModel[] = Object.keys(files)
  .sort()
  .map((path) => {
    const key = path
      .split("/")
      .pop()!
      .replace(/\.glb$/i, "")
      .toLowerCase();
    const m = META[key] ?? {};
    return {
      key,
      url: files[path],
      label: m.label ?? key,
      span: m.span ?? 4.4,
      anchorY: m.anchorY ?? 0.5,
      yaw: m.yaw ?? 0,
      flapSpeed: m.flapSpeed ?? 1.8,
      flapDeg: m.flapDeg ?? 30,
      beatDeg: m.beatDeg ?? 14,
      accent: m.accent ?? "#ffffff",
      credit: m.credit ?? null,
    };
  });

export const WING_CREDITS = WING_MODELS.map((m) => m.credit)
  .filter(Boolean)
  .join(" · ");

interface Part {
  /** [right half, left half]. */
  geo: [THREE.BufferGeometry, THREE.BufferGeometry];
  material: THREE.Material;
}

const KEEP = ["position", "normal", "uv", "color"];
const cache = new Map<string, Promise<Part[]>>();
/** Per model: depth in front of its centre (shoulder widths). */
const front = new Map<string, number>();

function load(model: WingModel): Promise<Part[]> {
  let p = cache.get(model.key);
  if (!p) {
    p = new GLTFLoader().loadAsync(model.url).then(async (gltf) => {
      await restoreSpecGloss(gltf);
      gltf.scene.updateMatrixWorld(true);
      const raw: { geo: THREE.BufferGeometry; material: THREE.Material }[] = [];
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        let geo = mesh.geometry.clone();
        for (const name of Object.keys(geo.attributes))
          if (!KEEP.includes(name)) geo.deleteAttribute(name);
        geo.morphAttributes = {};
        geo.applyMatrix4(mesh.matrixWorld);
        if (geo.index) geo = geo.toNonIndexed();
        const material = Array.isArray(mesh.material)
          ? mesh.material[0]
          : mesh.material;
        raw.push({ geo, material });
      });

      const box = new THREE.Box3();
      const measure = () => {
        box.makeEmpty();
        for (const r of raw) {
          r.geo.computeBoundingBox();
          box.union(r.geo.boundingBox!);
        }
        return box.getSize(new THREE.Vector3());
      };
      // Face the camera: the span goes along X.
      let size = measure();
      const turn = deg(model.yaw) + (size.z > size.x ? Math.PI / 2 : 0);
      if (turn) {
        const m = new THREE.Matrix4().makeRotationY(turn);
        for (const r of raw) r.geo.applyMatrix4(m);
        size = measure();
      }
      // Attachment point → origin; span → model.span shoulder widths.
      const s = model.span / (size.x || 1);
      const fit = new THREE.Matrix4()
        .makeScale(s, s, s)
        .multiply(
          new THREE.Matrix4().makeTranslation(
            -(box.min.x + box.max.x) / 2,
            -(box.min.y + size.y * model.anchorY),
            -(box.min.z + box.max.z) / 2,
          ),
        );
      for (const r of raw) r.geo.applyMatrix4(fit);
      // Some models are folded far back (deep V shapes). Seen from in
      // front through a real lens that reads as lopsided, so keep every
      // model fairly flat behind the back.
      let depth = size.z * s;
      const maxDepth = model.span * 0.14;
      if (depth > maxDepth) {
        const flat = new THREE.Matrix4().makeScale(1, 1, maxDepth / depth);
        for (const r of raw) r.geo.applyMatrix4(flat);
        depth = maxDepth;
      }
      // how far the model reaches in front of its centre
      front.set(model.key, depth / 2);

      return raw.map(({ geo, material }) => ({
        geo: [half(geo, 1), half(geo, -1)] as Part["geo"],
        material,
      }));
    });
    cache.set(model.key, p);
  }
  return p;
}

/** three.js dropped the old "specular-glossiness" material format, so
 *  such models load without their picture. Put the colour texture back. */
async function restoreSpecGloss(gltf: GLTF) {
  const defs = (gltf.parser.json.materials ?? []) as {
    name?: string;
    extensions?: Record<
      string,
      { diffuseTexture?: { index: number }; diffuseFactor?: number[] }
    >;
  }[];
  for (const def of defs) {
    const ext = def.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (!ext) continue;
    const tex = ext.diffuseTexture
      ? ((await gltf.parser.getDependency(
          "texture",
          ext.diffuseTexture.index,
        )) as THREE.Texture)
      : null;
    if (tex) tex.colorSpace = THREE.SRGBColorSpace;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of list) {
        if (m.name !== (def.name ?? "")) continue;
        const std = m as THREE.MeshStandardMaterial;
        if (tex) std.map = tex;
        if (ext.diffuseFactor) {
          std.color.fromArray(ext.diffuseFactor);
          std.opacity = ext.diffuseFactor[3] ?? 1;
        }
        std.metalness = 0;
        std.roughness = 0.7;
        std.needsUpdate = true;
      }
    });
  }
}

/** Triangles on one side of x = 0 (ones crossing it are kept in both
 *  halves; the clip plane trims them). */
function half(src: THREE.BufferGeometry, sign: 1 | -1) {
  const pos = src.attributes.position;
  const keep: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const a = pos.getX(i) * sign;
    const b = pos.getX(i + 1) * sign;
    const c = pos.getX(i + 2) * sign;
    if (Math.max(a, b, c) > 0) keep.push(i);
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const attr = src.attributes[name];
    const n = attr.itemSize;
    const from = attr.array;
    const to = new Float32Array(keep.length * 3 * n);
    keep.forEach((i, k) => {
      for (let j = 0; j < 3 * n; j++) to[k * 3 * n + j] = from[i * n + j];
    });
    if (attr.normalized && !(from instanceof Float32Array)) {
      // normalised integers (e.g. 8-bit colours) → floats
      const max = from instanceof Uint16Array ? 65535 : 255;
      for (let j = 0; j < to.length; j++) to[j] /= max;
    }
    out.setAttribute(name, new THREE.BufferAttribute(to, n));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

/**
 * Makes a wing material bend like a real wing: the outer part follows the
 * shoulder's beat a moment late (a wave running out to the tip), and the
 * feathers near the body sit in shadow.
 */
function bendable(
  mat: THREE.Material,
  uniforms: { uBeat: { value: number } },
  sign: 1 | -1,
  model: WingModel,
) {
  const half = model.span / 2;
  const amp = deg(model.beatDeg) * 0.9;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBeat = uniforms.uBeat;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uBeat;
varying float vSpan;
mat3 wingBend(float u) {
  // extra rotation of this slice relative to the shoulder (wave lag)
  float a = ${(sign * amp).toFixed(4)} * u * u * (sin(uBeat - u * 1.4) - sin(uBeat));
  // feathers droop and fold back a touch further out
  float b = ${(sign * 0.18).toFixed(4)} * u * u * (0.6 - 0.4 * cos(uBeat - u));
  float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
  mat3 rz = mat3(ca, sa, 0.0, -sa, ca, 0.0, 0.0, 0.0, 1.0);
  mat3 ry = mat3(cb, 0.0, -sb, 0.0, 1.0, 0.0, sb, 0.0, cb);
  return ry * rz;
}`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
vSpan = clamp(abs(position.x) / ${half.toFixed(4)}, 0.0, 1.0);
mat3 bendM = wingBend(vSpan);
objectNormal = bendM * objectNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
transformed = bendM * transformed;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSpan;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
// shade where the wing meets the back
diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 0.28, vSpan));`,
      );
  };
  mat.customProgramCacheKey = () => `wing:${sign}:${model.key}`;
}

export function buildModelRig(model: WingModel): WingRig {
  const group = new THREE.Group();
  const sides = ([1, -1] as const).map((sign) => {
    const root = new THREE.Group();
    root.position.set(0, -0.15, -0.16);
    const hinge = new THREE.Group();
    hinge.rotation.order = "YZX";
    root.add(hinge);
    group.add(root);
    return {
      hinge,
      sign,
      plane: new THREE.Plane(),
      uniforms: { uBeat: { value: 0 } },
    };
  });
  const mats: {
    mat: THREE.Material;
    opacity: number;
    clear: boolean;
    fading: boolean | null;
  }[] = [];
  let disposed = false;
  let alpha = 1;

  // Feathers keep the model's own soft transparency (as authored).
  const applyOpacity = () => {
    for (const m of mats) {
      const fading = alpha < 0.999;
      const clear = m.clear || fading;
      if (m.fading !== clear) {
        m.fading = clear;
        m.mat.transparent = clear;
        m.mat.needsUpdate = true;
      }
      m.mat.opacity = m.opacity * alpha;
    }
  };

  load(model)
    .then((parts) => {
      if (disposed) return;
      // Sit the whole model behind the back: nothing may poke out in
      // front of the body (the hinge stays at the model's centre).
      for (const side of sides)
        side.hinge.parent!.position.z = rig.rootZ =
          -0.12 - (front.get(model.key) ?? 0);
      for (const part of parts) {
        sides.forEach((side, i) => {
          const mat = part.material.clone();
          mat.side = THREE.DoubleSide;
          mat.clippingPlanes = [side.plane];
          bendable(mat, side.uniforms, side.sign, model);
          mats.push({
            mat,
            opacity: mat.opacity,
            clear: mat.transparent,
            fading: null,
          });
          const mesh = new THREE.Mesh(part.geo[i], mat);
          // bent vertices can leave the original bounds
          mesh.frustumCulled = false;
          side.hinge.add(mesh);
        });
      }
      applyOpacity();
    })
    .catch((err) => console.error(`โหลดปีก ${model.key} ไม่ได้:`, err));

  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();
  const rig: WingRig = {
    id: model.key,
    group,
    rootY: -0.15,
    rootZ: -0.12,
    update(beat, drag, heave) {
      // Real wings beat down fast and recover slowly.
      const t = beat + 0.35 * Math.cos(beat);
      const phase = Math.sin(t);
      for (const { hinge, sign, uniforms } of sides) {
        uniforms.uBeat.value = t;
        // Up/down beat, folding back on the downstroke; moving the body
        // folds them back (drag) and makes them trail (heave).
        hinge.rotation.z = sign * (phase * deg(model.beatDeg) - heave * deg(9));
        hinge.rotation.y =
          sign *
          (deg(8) + (0.5 - 0.5 * phase) * deg(model.flapDeg) + drag * deg(14));
      }
      group.updateMatrixWorld(true);
      for (const { hinge, sign, plane } of sides) {
        normal.set(sign, 0, 0).transformDirection(hinge.matrixWorld);
        point.setFromMatrixPosition(hinge.matrixWorld);
        plane.setFromNormalAndCoplanarPoint(normal, point);
        plane.constant += 0.5; // let the halves meet without a gap
      }
    },
    setOpacity(a) {
      alpha = a;
      applyOpacity();
    },
    dispose() {
      disposed = true;
      for (const m of mats) m.mat.dispose();
    },
  };
  return rig;
}

/** Small pictures of each model for the picker. */
export async function renderModelIcons(
  models: WingModel[],
  size = 96,
): Promise<(HTMLCanvasElement | null)[]> {
  if (models.length === 0) return [];
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  const out: (HTMLCanvasElement | null)[] = [];
  for (const model of models) {
    try {
      const parts = await load(model);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(0.3, 0.6, 1);
      scene.add(sun);
      const pair = new THREE.Group();
      for (const part of parts) {
        const mat = part.material.clone();
        mat.side = THREE.DoubleSide;
        pair.add(new THREE.Mesh(part.geo[0], mat));
        pair.add(new THREE.Mesh(part.geo[1], mat));
      }
      scene.add(pair);
      const box = new THREE.Box3().setFromObject(pair);
      const c = box.getCenter(new THREE.Vector3());
      const sz = box.getSize(new THREE.Vector3());
      const r = (Math.max(sz.x, sz.y) / 2) * 1.05;
      const cam = new THREE.OrthographicCamera(-r, r, r, -r, -100, 100);
      cam.position.set(c.x, c.y, 50);
      renderer.render(scene, cam);
      const icon = document.createElement("canvas");
      icon.width = size;
      icon.height = size;
      icon.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
      out.push(icon);
      pair.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) (m.material as THREE.Material).dispose();
      });
    } catch {
      out.push(null);
    }
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
