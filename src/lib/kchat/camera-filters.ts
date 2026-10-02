/** 30 live CSS filters applied to the camera preview and baked into captures. */

export type NyxFilter = { id: string; label: string; css: string };

export const NYX_FILTERS: readonly NyxFilter[] = [
  { id: "none", label: "Original", css: "none" },
  { id: "glow", label: "NYX Glow", css: "saturate(1.35) brightness(1.08) contrast(1.08)" },
  { id: "midnight", label: "Midnight", css: "brightness(0.82) contrast(1.25) saturate(0.7) hue-rotate(210deg)" },
  { id: "warm", label: "Warm", css: "sepia(0.28) saturate(1.2) brightness(1.06)" },
  { id: "cool", label: "Cool", css: "hue-rotate(195deg) saturate(1.1) brightness(1.04)" },
  { id: "golden", label: "Golden", css: "sepia(0.45) saturate(1.4) contrast(1.08) brightness(1.08)" },
  { id: "vintage", label: "Vintage", css: "sepia(0.55) contrast(0.95) saturate(0.85)" },
  { id: "cinematic", label: "Cinematic", css: "contrast(1.22) saturate(0.9) brightness(0.96)" },
  { id: "dream", label: "Dream", css: "blur(0.4px) brightness(1.1) saturate(1.15) contrast(0.92)" },
  { id: "neon", label: "Neon", css: "saturate(1.8) contrast(1.2) hue-rotate(280deg) brightness(1.05)" },
  { id: "rose", label: "Rose", css: "sepia(0.2) hue-rotate(-18deg) saturate(1.35) brightness(1.05)" },
  { id: "arctic", label: "Arctic", css: "saturate(0.35) brightness(1.14) contrast(1.08) hue-rotate(190deg)" },
  { id: "sunset", label: "Sunset", css: "sepia(0.35) hue-rotate(-28deg) saturate(1.45) contrast(1.1)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.28) brightness(0.95)" },
  { id: "vivid", label: "Vivid", css: "saturate(1.7) contrast(1.15)" },
  { id: "soft", label: "Soft", css: "brightness(1.08) contrast(0.92) saturate(1.05)" },
  { id: "contrast", label: "Contrast", css: "contrast(1.4) saturate(1.05)" },
  { id: "silver", label: "Silver", css: "grayscale(0.65) contrast(1.12) brightness(1.08)" },
  { id: "retro", label: "Retro", css: "sepia(0.4) contrast(1.15) saturate(1.2) hue-rotate(8deg)" },
  { id: "purple", label: "Purple", css: "hue-rotate(250deg) saturate(1.25) contrast(1.08)" },
  { id: "blue", label: "Blue", css: "hue-rotate(200deg) saturate(1.2) contrast(1.1)" },
  { id: "red", label: "Red", css: "hue-rotate(-15deg) saturate(1.5) contrast(1.12)" },
  { id: "emerald", label: "Emerald", css: "hue-rotate(90deg) saturate(1.25) contrast(1.08)" },
  { id: "night", label: "Night", css: "brightness(0.72) contrast(1.3) saturate(0.8)" },
  { id: "moonlight", label: "Moonlight", css: "grayscale(0.25) brightness(1.12) contrast(1.05) hue-rotate(210deg)" },
  { id: "aurora", label: "Aurora", css: "hue-rotate(120deg) saturate(1.45) brightness(1.05) contrast(1.08)" },
  { id: "film", label: "Film", css: "sepia(0.18) contrast(1.18) saturate(0.92)" },
  { id: "clean", label: "Clean", css: "contrast(1.06) saturate(1.04) brightness(1.04)" },
  { id: "deep", label: "Deep", css: "contrast(1.3) brightness(0.9) saturate(1.15)" },
  { id: "classic", label: "NYX Classic", css: "saturate(1.2) contrast(1.12) brightness(1.02) sepia(0.08)" },
] as const;

export type NyxFilterId = (typeof NYX_FILTERS)[number]["id"];

export function filterCss(id: string | null | undefined): string {
  return NYX_FILTERS.find((f) => f.id === id)?.css ?? "none";
}

export const CAMERA_DURATIONS = [
  { id: "10m", label: "10m", ms: 10 * 60_000 },
  { id: "60s", label: "60s", ms: 60_000 },
  { id: "15s", label: "15s", ms: 15_000 },
  { id: "photo", label: "PHOTO", ms: 0 },
  { id: "text", label: "TEXT", ms: 0 },
] as const;

export type CameraDurationId = (typeof CAMERA_DURATIONS)[number]["id"];

export const CAMERA_TIMERS = [0, 3, 5, 10] as const;
export type CameraLayout = "single" | "2" | "3" | "4";

export const CAMERA_LAYOUTS: { id: CameraLayout; label: string }[] = [
  { id: "single", label: "1" },
  { id: "2", label: "2" },
  { id: "3", label: "3" },
  { id: "4", label: "4" },
];
