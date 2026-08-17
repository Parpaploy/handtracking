import { useEffect } from "react";
import { useControls } from "leva";
import type { ModelSettings } from "../interfaces/model.interface";
import { AVATAR_V3_SETTINGS, MODEL_SETTINGS } from "../constants/model.const";

function getDefaults(model: string): ModelSettings {
  return MODEL_SETTINGS[model] ?? AVATAR_V3_SETTINGS;
}

export function useLevaModelControls(modelNames: string[]) {
  const { model } = useControls("Model", {
    model: {
      value: modelNames[0] ?? "Ryumii 3D",
      options: modelNames,
      label: "เลือกโมเดล",
    },
  });

  const defaults = getDefaults(model);

  const [
    {
      lightingPreset,
      ambientIntensity,
      directionalIntensity,
      environmentIntensity,
    },
    setLightingControls,
  ] = useControls(
    "Lighting",
    () => ({
      lightingPreset: {
        value: defaults.lightingPreset,
        options: [
          "city",
          "sunset",
          "dawn",
          "night",
          "warehouse",
          "forest",
          "apartment",
          "studio",
          "park",
        ],
        label: "Preset แสง",
      },
      ambientIntensity: {
        value: defaults.ambientIntensity,
        min: 0,
        max: 3,
        step: 0.05,
        label: "แสงรอบทิศ (ambient)",
      },
      directionalIntensity: {
        value: defaults.directionalIntensity,
        min: 0,
        max: 3,
        step: 0.05,
        label: "แสงทิศทาง (directional)",
      },
      environmentIntensity: {
        value: defaults.environmentIntensity,
        min: 0,
        max: 3,
        step: 0.05,
        label: "แสง Environment (IBL)",
      },
    }),
    [model],
  );

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
    setLightingControls({
      lightingPreset: d.lightingPreset,
      ambientIntensity: d.ambientIntensity,
      directionalIntensity: d.directionalIntensity,
      environmentIntensity: d.environmentIntensity,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  return {
    model,

    bodyTracking,
    fingerTracking,
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

    lightingPreset,
    ambientIntensity,
    directionalIntensity,
    environmentIntensity,

    minCutoff,
    beta,

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

    rotX,
    rotY,
    rotZ,
    posX,
    posY,
    posZ,
    scale,

    camX,
    camY,
    camZ,
    fov,
  };
}
