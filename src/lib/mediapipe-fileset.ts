import { FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_PATH = "/mediapipe/tasks-vision/wasm";

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null =
  null;

export function getSharedFileset() {
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH);
  }
  return filesetPromise;
}
