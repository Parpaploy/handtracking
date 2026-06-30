export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface LandmarkConnection {
  start: number;
  end: number;
}

export interface HandResults {
  image: CanvasImageSource;
  multiHandLandmarks?: Landmark[][];
}

export interface HandsInstance {
  setOptions: (opts: object) => void;
  onResults: (cb: (results: HandResults) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close: () => Promise<void>;
}

export type HandsConstructor = new (config: {
  locateFile: (f: string) => string;
}) => HandsInstance;

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface LandmarkConnection {
  start: number;
  end: number;
}

export interface HandResults {
  image: CanvasImageSource;
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: Handedness[];
}

export interface Handedness {
  label: "Left" | "Right";
  score: number;
}

export type DrawMode = "draw" | "erase" | "idle";

export interface CanvasRenderingContext2DWithRoundRect extends CanvasRenderingContext2D {
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | number[],
  ): void;
}

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandResult {
  label: "Left" | "Right";
  score: number;
}

export interface newHandResults {
  image: HTMLVideoElement | HTMLCanvasElement;
  multiHandLandmarks: Landmark[][];
  multiHandedness: HandResult[];
}

export interface HandsOptions {
  maxNumHands: number;
  modelComplexity: number;
  minDetectionConfidence: number;
  minTrackingConfidence: number;
}

export interface newHandsInstance {
  setOptions(opts: HandsOptions): void;
  onResults(cb: (r: HandResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): Promise<void>;
}

export interface DragState {
  tileIdx: number;
  startX: number;
  startY: number;
  axis: "h" | "v" | null;
  committed: boolean;
}

export interface RunnerOverlayProps {
  runnerPosRef: React.RefObject<number>;
  runnerWonRef: React.RefObject<boolean>;
  runnerSpeedRef: React.RefObject<number>;
  width: number;
  height: number;
}

export interface HandednessInfo {
  label: "Left" | "Right";
}
export interface HandResultsLocal {
  image: CanvasImageSource;
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: HandednessInfo[];
}
export interface HandsConstructorLocal {
  new (config: { locateFile: (file: string) => string }): {
    setOptions: (opts: Record<string, unknown>) => void;
    onResults: (cb: (results: HandResultsLocal) => void) => void;
    send: (input: { image: HTMLVideoElement }) => Promise<void>;
    close: () => Promise<void>;
  };
}
export interface FaceResultsLocal {
  multiFaceLandmarks?: Landmark[][];
}
export interface FaceMeshConstructorLocal {
  new (config: { locateFile: (file: string) => string }): {
    setOptions: (opts: Record<string, unknown>) => void;
    onResults: (cb: (results: FaceResultsLocal) => void) => void;
    send: (input: { image: HTMLVideoElement }) => Promise<void>;
    close: () => Promise<void>;
  };
}

export interface DetectedObject {
  bbox: [number, number, number, number];
  class: string;
  score: number;
}

export interface CocoSsdModel {
  detect: (input: HTMLVideoElement) => Promise<DetectedObject[]>;
}

export interface CocoSsdLoadConfig {
  base?: "lite_mobilenet_v2" | "mobilenet_v1" | "mobilenet_v2";
}

export interface CocoSsdNamespace {
  load: (config?: CocoSsdLoadConfig) => Promise<CocoSsdModel>;
}

export interface TfNamespace {
  setBackend: (name: string) => Promise<boolean>;
  ready: () => Promise<void>;
}

export interface TrackedObject {
  id: number;
  bbox: [number, number, number, number];
  class: string;
  score: number;
  missedFrames: number;
  smoothedBbox: [number, number, number, number];
}
