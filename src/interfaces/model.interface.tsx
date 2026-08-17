export interface PudtanRunnerProps {
  runnerPosRef: React.RefObject<number>;
  runnerWonRef: React.RefObject<boolean>;
  runnerSpeedRef: React.RefObject<number>;
  canvasWidth: number;
  canvasHeight: number;
}

export type ModelSettings = {
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

  lightingPreset: string;
  ambientIntensity: number;
  directionalIntensity: number;
  environmentIntensity: number;

  minCutoff: number;
  beta: number;

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

  rotX: number;
  rotY: number;
  rotZ: number;
  posX: number;
  posY: number;
  posZ: number;
  scale: number;

  camX: number;
  camY: number;
  camZ: number;
  fov: number;
};

export type EnvPreset =
  | "city"
  | "sunset"
  | "dawn"
  | "night"
  | "warehouse"
  | "forest"
  | "apartment"
  | "studio"
  | "park"
  | "lobby";

export type BlendshapeMap = Record<string, number>;

export interface HeadRotation {
  x: number;
  y: number;
  z: number;
}
