import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { useControls } from "leva";
import { DEFAULT_ONE_EURO } from "../lib/one-euro";
import { useWebcam } from "../hooks/use-webcam";
import { AvatarFace } from "../components/avatar-face";
import { useFaceBlendshapes } from "../hooks/use-blendshapes";
import { usePoseLandmarks } from "../hooks/use-pose";
import { useHandLandmarks } from "../hooks/use-hands";
import { RYUMII_3D_MATCHER, type BoneMatcher } from "../lib/spring-bones";

// เพิ่มโมเดลใหม่ที่นี่ — key คือชื่อที่โชว์ใน dropdown ของ Leva
const MODELS: Record<
  string,
  {
    url: string;
    headBoneName?: string;
    /**
     * ARKit name -> ชื่อ morph target จริงของโมเดลนี้ (ถ้าไม่ตรงกันอัตโนมัติ)
     * ดูชื่อจริงได้จาก console log ตอนโหลดโมเดล (AvatarFace จะ log ให้เอง
     * ตอน dev — ดู useEffect แรกใน components/avatar-face.tsx)
     * เช่นโมเดลสาย VRM/VRoid มักใช้ "Fcl_EYE_Close_L" แทน "eyeBlinkLeft"
     */
    morphOverrides?: Record<string, string>;
    /**
     * ตัวจับ bone ฟิสิกส์ (ผม/กระโปรง/ผ้าคลุม/หมวก) ของโมเดลนี้ — ไม่ใส่
     * = ใช้ PHYS_MATCHER (default ใน AvatarFace) ซึ่งจับเฉพาะ bone ที่ชื่อ
     * ขึ้นต้น/มีคำว่า "PHYS" (แบบที่ Avatar V3 export มาจาก Blender)
     *
     * โมเดลที่ไม่มี prefix นี้ (เช่น Ryumii 3D) ต้องใส่ matcher อื่น ไม่งั้น
     * bindSpringBones จะเจอ 0 chain แล้วผม/กระโปรงจะไม่ขยับเลยแม้เปิด toggle
     * ไว้ก็ตาม — ดู console log "[AvatarFace] ผูก spring bone สำเร็จ" ตอน
     * โหลดโมเดลเพื่อยืนยันว่าจับ bone ได้ถูกตัวจริง
     */
    springBoneMatcher?: BoneMatcher;
  }
> = {
  "Avatar V3": {
    url: "/models/avatar-v3.glb",
    headBoneName: "DEF-spine006",
    // ไม่ต้องใส่ morphOverrides เพราะโมเดลนี้ใช้ชื่อ ARKit ตรงเป๊ะอยู่แล้ว
    // ไม่ต้องใส่ springBoneMatcher เพราะ bone ชื่อขึ้นต้นด้วย "PHYS" อยู่แล้ว
  },
  "Ryumii 3D": {
    url: "/models/Ryumii3D.glb",
    headBoneName: undefined,
    morphOverrides: {
      // ตา
      eyeBlinkLeft: "eye_closed.L",
      eyeBlinkRight: "eye_closed.R",
      eyeWideLeft: "eye_suprised.L",
      eyeWideRight: "eye_suprised.R",
      eyeSquintLeft: "eye_jitome.L",
      eyeSquintRight: "eye_jitome.R",

      // คิ้ว
      browInnerUp: "brow_komari", // คิ้วตกใจ/กังวล ยกมุมในขึ้น
      browOuterUpLeft: "brow_bikkuri.L", // คิ้วยกทั้งแถบ (surprise)
      browOuterUpRight: "brow_bikkuri.R",
      browDownLeft: "brow_serious.L", // คิ้วขมวด/หน้าจริงจัง
      browDownRight: "brow_serious.R",

      // ปาก
      jawOpen: "mth_open",
      mouthSmileLeft: "mth_happy",
      mouthSmileRight: "mth_happy", // โมเดลนี้ไม่มี mth_happy.L/.R แยก เลยชนกันได้ (ดูหมายเหตุด้านล่าง)
      mouthFrownLeft: "mth_frown",
      mouthFrownRight: "mth_frown",
      mouthPucker: "mth_U",
      mouthFunnel: "mth_O",
      cheekPuff: "extra_cheek",
      tongueOut: "mth_bero1",
    },
    // โมเดลนี้ไม่มี prefix "PHYS" บน bone ผม เลยใช้ matcher เฉพาะของ Ryumii
    // ที่เขียนจาก bone list จริงของโมเดลนี้ (ดู RYUMII_3D_MATCHER ใน
    // lib/spring-bones.ts) — จับเฉพาะเส้นผมจริง (Ahoge/HairFront/Twintail/
    // HairSide/HairBack.../HairKusege/HairRibbon...) ไม่จับ bone hub/root
    // ที่ควรอยู่นิ่ง ต่างจาก KEYWORD_MATCHER แบบเดิมที่จับกว้างเกินไปจน
    // หน้าโมเดลบิดเบี้ยว
    springBoneMatcher: RYUMII_3D_MATCHER,
  },
};

// ค่าที่ปรับได้ทั้งหมด — เก็บแยกต่างหากต่อโมเดล
type ModelSettings = {
  // Body Tracking
  bodyTracking: boolean;
  fingerTracking: boolean;
  mirror: boolean;
  swapSides: boolean;
  swapHandedness: boolean;
  rollStabilize: boolean;
  flipPalm: boolean;
  naturalRest: boolean;
  idleMotion: boolean;
  idleAmount: number;
  responsiveness: number;
  zDamp: number;
  minVisibility: number;
  // 1€ filter
  minCutoff: number;
  beta: number;
  // ฟิสิกส์ผม/ผ้า
  physics: boolean;
  hair: boolean;
  skirt: boolean;
  cape: boolean;
  hat: boolean;
  stiffnessScale: number;
  gravityScale: number;
  dragScale: number;
  windScale: number;
  collide: boolean;
  colliderScale: number;
  // Avatar Transform
  rotX: number;
  rotY: number;
  rotZ: number;
  posX: number;
  posY: number;
  posZ: number;
  scale: number;
  // Camera
  camX: number;
  camY: number;
  camZ: number;
  fov: number;
};

// ค่าเริ่มต้นของ "Avatar V3" — แก้ตรงนี้ได้เลยถ้าอยากเปลี่ยนค่าเริ่มต้นของโมเดลนี้
const AVATAR_V3_SETTINGS: ModelSettings = {
  bodyTracking: true,
  fingerTracking: true,
  mirror: true,
  swapSides: true,
  swapHandedness: false,
  rollStabilize: true,
  flipPalm: true,
  naturalRest: true,
  idleMotion: true,
  idleAmount: 1,
  responsiveness: 25,
  zDamp: 0.8,
  minVisibility: 0.5,
  minCutoff: 1,
  beta: 0.7,
  physics: true,
  hair: true,
  skirt: true,
  cape: true,
  hat: false,
  stiffnessScale: 1,
  gravityScale: 1,
  dragScale: 1,
  windScale: 1,
  collide: true,
  colliderScale: 1,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  posX: 0,
  posY: -3.2,
  posZ: 0,
  scale: 2.8,
  camX: 0,
  camY: 0,
  camZ: 5,
  fov: 30,
};

// ค่าเริ่มต้นของ "Ryumii 3D" — แก้ตรงนี้ได้เลยถ้าอยากเปลี่ยนค่าเริ่มต้นของโมเดลนี้
// (ตอนนี้ตั้งเหมือน Avatar V3 ไว้ก่อน ปรับตัวเลขที่ต้องการได้ตามใจ)
const RYUMII_3D_SETTINGS: ModelSettings = {
  bodyTracking: true,
  fingerTracking: true,
  mirror: true,
  swapSides: true,
  swapHandedness: false,
  rollStabilize: true,
  flipPalm: true,
  naturalRest: true,
  idleMotion: true,
  idleAmount: 1,
  responsiveness: 25,
  zDamp: 0.8,
  minVisibility: 0.5,
  minCutoff: 1,
  beta: 0.7,
  physics: true,
  hair: true,
  skirt: true,
  cape: true,
  hat: false,
  stiffnessScale: 1,
  gravityScale: 1,
  dragScale: 1,
  windScale: 1,
  collide: true,
  colliderScale: 1,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  posX: 0,
  posY: -1.7,
  posZ: 2.28,
  scale: 3,
  camX: 0,
  camY: 0,
  camZ: 5,
  fov: 30,
};

// map ชื่อโมเดล (key เดียวกับใน MODELS) -> ค่าเริ่มต้นของโมเดลนั้น
// เพิ่มโมเดลใหม่ -> เพิ่ม const ด้านบน แล้วมาแม็พที่นี่ด้วย
const MODEL_SETTINGS: Record<string, ModelSettings> = {
  "Avatar V3": AVATAR_V3_SETTINGS,
  "Ryumii 3D": RYUMII_3D_SETTINGS,
};

function getDefaults(model: string): ModelSettings {
  return MODEL_SETTINGS[model] ?? AVATAR_V3_SETTINGS;
}

export default function ModelTracking() {
  const videoRef = useRef<HTMLVideoElement>(null);
  useWebcam(videoRef);

  const { model } = useControls("Model", {
    model: {
      value: "Avatar V3",
      options: Object.keys(MODELS),
      label: "เลือกโมเดล",
    },
  });

  const {
    url: modelUrl,
    headBoneName,
    morphOverrides,
    springBoneMatcher,
  } = MODELS[model];

  // ค่า default ของโมเดลที่กำลังเลือกอยู่ตอนนี้ (ไม่มีการจำค่าที่เคยปรับไว้)
  const defaults = getDefaults(model);

  // NOTE: ค่า `value` ในสคีมาด้านล่างมีผลแค่ตอน "สร้าง" control ครั้งแรกเท่านั้น
  // Leva เก็บค่าไว้ใน store โดยอิงจาก path (ชื่อ folder + key) ซึ่งเหมือนเดิมทุกโมเดล
  // พอสลับโมเดล แม้ deps จะเปลี่ยนและ schema จะสร้างใหม่ Leva ก็จะไม่เขียนทับค่าที่มีอยู่แล้ว
  // ต้องบังคับ reset ด้วย setXxxControls(defaults) ใน useEffect ด้านล่างแทน
  const [
    {
      bodyTracking,
      fingerTracking,
      mirror,
      swapSides,
      swapHandedness,
      naturalRest,
      idleMotion,
      idleAmount,
      responsiveness,
      zDamp,
      rollStabilize,
      flipPalm,
      minVisibility,
    },
    setBodyControls,
  ] = useControls(
    "Body Tracking",
    () => ({
      bodyTracking: { value: defaults.bodyTracking, label: "เปิดจับร่างกาย" },
      fingerTracking: { value: defaults.fingerTracking, label: "เปิดจับนิ้ว" },
      mirror: { value: defaults.mirror, label: "กลับซ้ายขวา (mirror)" },
      swapSides: { value: defaults.swapSides, label: "สลับแขนซ้าย/ขวา" },
      swapHandedness: {
        value: defaults.swapHandedness,
        label: "สลับมือซ้าย/ขวา",
      },
      rollStabilize: { value: defaults.rollStabilize, label: "ล็อกการบิดแขน" },
      flipPalm: { value: defaults.flipPalm, label: "กลับด้านฝ่ามือ" },
      naturalRest: { value: defaults.naturalRest, label: "ท่าพักแขนลง" },
      idleMotion: { value: defaults.idleMotion, label: "โยกเบาๆ ตอนพัก" },
      idleAmount: {
        value: defaults.idleAmount,
        min: 0,
        max: 3,
        step: 0.05,
        label: "แรงโยก",
      },
      responsiveness: {
        value: defaults.responsiveness,
        min: 2,
        max: 60,
        step: 1,
        label: "ความไวตาม (1/วิ)",
      },
      zDamp: {
        value: defaults.zDamp,
        min: 0,
        max: 1,
        step: 0.05,
        label: "ลดความลึก Z",
      },
      minVisibility: {
        value: defaults.minVisibility,
        min: 0,
        max: 1,
        step: 0.05,
      },
    }),
    // deps: พอ model เปลี่ยน ให้ leva รีเซ็ตค่าตาม schema ด้านบนใหม่
    [model],
  );

  const [{ minCutoff, beta }, setFilterControls] = useControls(
    "กันสั่น (1€ filter)",
    () => ({
      minCutoff: {
        value: defaults.minCutoff,
        min: 0.1,
        max: 6,
        step: 0.05,
        label: "นิ่งตอนอยู่เฉย",
      },
      beta: {
        value: defaults.beta,
        min: 0,
        max: 4,
        step: 0.05,
        label: "ไวตอนขยับเร็ว",
      },
    }),
    [model],
  );

  const oneEuro = useMemo(
    () => ({ minCutoff, beta, dCutoff: DEFAULT_ONE_EURO.dCutoff }),
    [minCutoff, beta],
  );

  const { blendshapesRef, headRotationRef, ready, faceFound } =
    useFaceBlendshapes(videoRef, { filter: oneEuro });

  const [
    {
      physics,
      hair,
      skirt,
      cape,
      hat,
      stiffnessScale,
      gravityScale,
      dragScale,
      windScale,
      collide,
      colliderScale,
    },
    setPhysicsControls,
  ] = useControls(
    "ฟิสิกส์ผม/ผ้า",
    () => ({
      physics: { value: defaults.physics, label: "เปิดฟิสิกส์" },
      hair: { value: defaults.hair, label: "ผม + ผมหน้าม้า" },
      skirt: { value: defaults.skirt, label: "กระโปรง" },
      cape: { value: defaults.cape, label: "ผ้าคลุม" },
      hat: { value: defaults.hat, label: "หมวก" },
      stiffnessScale: {
        value: defaults.stiffnessScale,
        min: 0.1,
        max: 3,
        step: 0.05,
        label: "ความแข็ง",
      },
      gravityScale: {
        value: defaults.gravityScale,
        min: 0,
        max: 3,
        step: 0.05,
        label: "แรงโน้มถ่วง",
      },
      dragScale: {
        value: defaults.dragScale,
        min: 0.2,
        max: 2,
        step: 0.05,
        label: "หน่วง",
      },
      windScale: {
        value: defaults.windScale,
        min: 0,
        max: 4,
        step: 0.05,
        label: "ลม",
      },
      collide: { value: defaults.collide, label: "ชนกับตัว/ขา" },
      colliderScale: {
        value: defaults.colliderScale,
        min: 0.5,
        max: 2,
        step: 0.05,
        label: "ขนาดตัวชน",
      },
    }),
    [model],
  );

  const springOptions = useMemo(
    () => ({
      enabled: physics,
      groups: { hair, skirt, cape, hat },
      stiffnessScale,
      gravityScale,
      dragScale,
      windScale,
      collide,
      colliderScale,
    }),
    [
      physics,
      hair,
      skirt,
      cape,
      hat,
      stiffnessScale,
      gravityScale,
      dragScale,
      windScale,
      collide,
      colliderScale,
    ],
  );

  const {
    poseRef,
    ready: poseReady,
    poseFound,
  } = usePoseLandmarks(videoRef, bodyTracking, oneEuro);

  const {
    handsRef,
    ready: handsReady,
    handCount,
  } = useHandLandmarks(videoRef, fingerTracking, oneEuro);

  const [{ rotX, rotY, rotZ, posX, posY, posZ, scale }, setTransformControls] =
    useControls(
      "Avatar Transform",
      () => ({
        rotX: { value: defaults.rotX, min: -100, max: 100, step: 0.01 },
        rotY: { value: defaults.rotY, min: -100, max: 100, step: 0.01 },
        rotZ: { value: defaults.rotZ, min: -100, max: 100, step: 0.01 },
        posX: { value: defaults.posX, min: -150, max: 150, step: 0.01 },
        posY: { value: defaults.posY, min: -150, max: 150, step: 0.01 },
        posZ: { value: defaults.posZ, min: -150, max: 150, step: 0.01 },
        scale: { value: defaults.scale, min: 0.1, max: 3, step: 0.01 },
      }),
      [model],
    );

  const [{ camX, camY, camZ, fov }, setCameraControls] = useControls(
    "Camera",
    () => ({
      camX: { value: defaults.camX, min: -20, max: 20, step: 0.01 },
      camY: { value: defaults.camY, min: -20, max: 20, step: 0.01 },
      camZ: { value: defaults.camZ, min: 0.1, max: 30, step: 0.01 },
      fov: { value: defaults.fov, min: 10, max: 90, step: 1 },
    }),
    [model],
  );

  // Leva ไม่เขียนทับค่าที่มีอยู่แล้วใน store ตอนสลับโมเดล (ดูหมายเหตุด้านบน)
  // จึงต้องบังคับ set ค่ากลับเป็น default ของโมเดลใหม่เองตรงนี้ทุกครั้งที่ model เปลี่ยน
  useEffect(() => {
    const d = getDefaults(model);
    setBodyControls({
      bodyTracking: d.bodyTracking,
      fingerTracking: d.fingerTracking,
      mirror: d.mirror,
      swapSides: d.swapSides,
      swapHandedness: d.swapHandedness,
      rollStabilize: d.rollStabilize,
      flipPalm: d.flipPalm,
      naturalRest: d.naturalRest,
      idleMotion: d.idleMotion,
      idleAmount: d.idleAmount,
      responsiveness: d.responsiveness,
      zDamp: d.zDamp,
      minVisibility: d.minVisibility,
    });
    setFilterControls({
      minCutoff: d.minCutoff,
      beta: d.beta,
    });
    setPhysicsControls({
      physics: d.physics,
      hair: d.hair,
      skirt: d.skirt,
      cape: d.cape,
      hat: d.hat,
      stiffnessScale: d.stiffnessScale,
      gravityScale: d.gravityScale,
      dragScale: d.dragScale,
      windScale: d.windScale,
      collide: d.collide,
      colliderScale: d.colliderScale,
    });
    setTransformControls({
      rotX: d.rotX,
      rotY: d.rotY,
      rotZ: d.rotZ,
      posX: d.posX,
      posY: d.posY,
      posZ: d.posZ,
      scale: d.scale,
    });
    setCameraControls({
      camX: d.camX,
      camY: d.camY,
      camZ: d.camZ,
      fov: d.fov,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const faceStatus = ready
    ? faceFound
      ? "tracking..."
      : "ไม่พบใบหน้า"
    : "กำลังโหลดโมเดล...";

  const bodyStatus = !bodyTracking
    ? "ปิดอยู่"
    : poseReady
      ? poseFound
        ? "tracking..."
        : "ไม่พบร่างกาย"
      : "กำลังโหลดโมเดล...";

  const fingerStatus = !fingerTracking
    ? "ปิดอยู่"
    : handsReady
      ? handCount > 0
        ? `tracking... (${handCount} มือ)`
        : "ไม่พบมือ"
      : "กำลังโหลดโมเดล...";

  return (
    <div
      className="w-full h-screen bg-cover bg-center bg-no-repeat flex flex-col"
      style={{ backgroundImage: "url('/chihiro007.jpg')" }}
    >
      <div className="absolute top-4 left-4 z-10 text-white text-sm space-y-1">
        <p>ใบหน้า: {faceStatus}</p>
        <p>ร่างกาย: {bodyStatus}</p>
        <p>นิ้ว: {fingerStatus}</p>
      </div>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute bottom-4 right-4 w-40 h-auto rounded-lg border border-white/30 z-10"
        style={{ transform: "scaleX(-1)" }}
      />

      <div className="relative w-full h-full overflow-hidden">
        <Canvas camera={{ position: [camX, camY, camZ], fov }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[1, 2, 2]} intensity={1.2} />
          <Suspense fallback={null}>
            <AvatarFace
              // key เปลี่ยนทุกครั้งที่สลับโมเดล -> React unmount ของเก่าแล้ว
              // mount ใหม่ทั้งหมด กัน ref (rig/spring/head bone) ค้างจากโมเดลก่อนหน้า
              key={modelUrl}
              modelUrl={modelUrl}
              blendshapesRef={blendshapesRef}
              headRotationRef={headRotationRef}
              headBoneName={headBoneName}
              morphOverrides={morphOverrides}
              springBoneMatcher={springBoneMatcher}
              poseRef={poseRef}
              handsRef={handsRef}
              bodyTracking={bodyTracking}
              fingerTracking={fingerTracking}
              poseOptions={{
                mirror,
                swapSides,
                swapHandedness,
                rollStabilize,
                flipPalm,
                naturalRest,
                idleMotion,
                idleAmount,
                responsiveness,
                zDamp,
                minVisibility,
              }}
              springOptions={springOptions}
              transform={{
                rotation: [rotX, rotY, rotZ],
                position: [posX, posY, posZ],
                scale,
              }}
            />
            <Environment preset="city" />
          </Suspense>

          <OrbitControls makeDefault enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
