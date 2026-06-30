import { createBrowserRouter } from "react-router-dom";
import DrawingHandTracking from "./components/drawing-hand-tracking";
import PianoHandTracking from "./components/piano-hand-tracking";
import PuzzleHandTracking from "./components/puzzle-hand-tracking";
import Menu from "./menu";
import RunHandTracking from "./components/run-hand-tracking";
import SteamTracking from "./components/steam-tracking";
import Tracking from "./components/tracking";
import MoodTracking from "./components/mood-tracking";

export const router = createBrowserRouter([
  { path: "/", element: <Menu /> },
  { path: "/tracker", element: <Tracking /> },
  { path: "/mood", element: <MoodTracking /> },
  { path: "/drawing", element: <DrawingHandTracking /> },
  { path: "/piano", element: <PianoHandTracking /> },
  { path: "/puzzle", element: <PuzzleHandTracking /> },
  { path: "/runner", element: <RunHandTracking /> },
  { path: "/steam", element: <SteamTracking /> },
]);
