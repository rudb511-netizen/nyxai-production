/** Per-user chat appearance. Colors, fonts, wallpapers, disappearing timers. */

export const CHAT_COLORS = [
  { id: "nyx-blue", label: "NYX Blue", hex: "#3d7dff" },
  { id: "purple", label: "Purple", hex: "#8b5cf6" },
  { id: "pink", label: "Pink", hex: "#ec4899" },
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "orange", label: "Orange", hex: "#f97316" },
  { id: "gold", label: "Gold", hex: "#eab308" },
  { id: "green", label: "Green", hex: "#22c55e" },
  { id: "emerald", label: "Emerald", hex: "#10b981" },
  { id: "cyan", label: "Cyan", hex: "#06b6d4" },
  { id: "sky", label: "Sky", hex: "#0ea5e9" },
  { id: "indigo", label: "Indigo", hex: "#6366f1" },
  { id: "violet", label: "Violet", hex: "#7c3aed" },
  { id: "magenta", label: "Magenta", hex: "#d946ef" },
  { id: "rose", label: "Rose", hex: "#f43f5e" },
  { id: "crimson", label: "Crimson", hex: "#be123c" },
  { id: "teal", label: "Teal", hex: "#14b8a6" },
  { id: "midnight", label: "Midnight", hex: "#1e293b" },
  { id: "silver", label: "Silver", hex: "#94a3b8" },
  { id: "graphite", label: "Graphite", hex: "#475569" },
  { id: "aurora", label: "Aurora", hex: "#34d399" },
] as const;

export type ChatColorId = (typeof CHAT_COLORS)[number]["id"];

export const CHAT_FONTS = [
  { id: "outfit", label: "Standard", family: '"Outfit", ui-sans-serif, system-ui, sans-serif' },
  { id: "system", label: "System", family: "system-ui, -apple-system, sans-serif" },
  { id: "inter", label: "Modern", family: '"Inter", ui-sans-serif, sans-serif' },
  { id: "georgia", label: "Elegant", family: 'Georgia, "Times New Roman", serif' },
  { id: "rounded", label: "Rounded", family: 'ui-rounded, "Hiragino Maru Gothic ProN", system-ui, sans-serif' },
  { id: "space", label: "Futuristic", family: '"Space Grotesk", ui-sans-serif, sans-serif' },
  { id: "cursive", label: "Handwritten", family: '"Segoe Script", "Comic Sans MS", cursive' },
  { id: "serif", label: "Serif", family: 'ui-serif, Palatino, Georgia, serif' },
  { id: "display", label: "Display", family: '"Playfair Display", Georgia, serif' },
  { id: "mono", label: "Mono", family: 'ui-monospace, "SF Mono", Menlo, monospace' },
  { id: "narrow", label: "Narrow", family: '"Arial Narrow", Helvetica, sans-serif' },
  { id: "condensed", label: "Condensed", family: '"Arial Condensed", Helvetica, sans-serif' },
  { id: "news", label: "News", family: '"Times New Roman", Times, serif' },
  { id: "book", label: "Book", family: "Palatino, Palatino Linotype, serif" },
  { id: "clean", label: "Clean", family: "Avenir, 'Nunito Sans', sans-serif" },
  { id: "soft", label: "Soft", family: '"Trebuchet MS", sans-serif' },
  { id: "tech", label: "Tech", family: '"Eurostile", "Arial Black", sans-serif' },
  { id: "italic", label: "Italic", family: 'Georgia, serif' },
  { id: "bold", label: "Bold", family: '"Outfit", sans-serif' },
  { id: "light", label: "Light", family: '"Outfit", sans-serif' },
  { id: "classic", label: "Classic", family: "Garamond, Georgia, serif" },
  { id: "poster", label: "Poster", family: '"Impact", "Arial Black", sans-serif' },
  { id: "script", label: "Script", family: '"Brush Script MT", cursive' },
  { id: "type", label: "Typewriter", family: '"Courier New", Courier, monospace' },
  { id: "humanist", label: "Humanist", family: "Optima, Candara, sans-serif" },
  { id: "grotesk", label: "Grotesk", family: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: "slab", label: "Slab", family: '"Rockwell", "Courier New", serif' },
  { id: "didone", label: "Didone", family: '"Didot", "Bodoni MT", serif' },
  { id: "pixel", label: "Pixel", family: '"Press Start 2P", ui-monospace, monospace' },
  { id: "nyx", label: "NYX", family: '"Outfit", ui-sans-serif, system-ui, sans-serif' },
] as const;

export type ChatFontId = (typeof CHAT_FONTS)[number]["id"];

export const CHAT_THEMES = [
  { id: "nyx", label: "NYX", bubble: "solid" },
  { id: "glass", label: "Glass", bubble: "glass" },
  { id: "ink", label: "Ink", bubble: "ink" },
  { id: "soft", label: "Soft", bubble: "soft" },
] as const;

export const CHAT_WALLPAPERS = [
  { id: "void", label: "Void", category: "NYX", css: "radial-gradient(circle at 20% 20%, #1b2438, #07090f 70%)" },
  { id: "ember", label: "Ember", category: "NYX", css: "radial-gradient(circle at 80% 0%, #3a1d12, #07090f 65%)" },
  { id: "signal", label: "Signal", category: "NYX", css: "linear-gradient(160deg, #10141c, #0a1624 60%, #071018)" },
  { id: "aurora-w", label: "Aurora", category: "Abstract", css: "linear-gradient(135deg, #06221c, #12304a 50%, #1a1030)" },
  { id: "prism", label: "Prism", category: "Abstract", css: "conic-gradient(from 210deg at 30% 20%, #142032, #2a1840, #102028)" },
  { id: "inkwell", label: "Inkwell", category: "Dark", css: "linear-gradient(#0b0d12, #12151c)" },
  { id: "obsidian", label: "Obsidian", category: "Dark", css: "radial-gradient(circle at 50% 120%, #1c222c, #050608)" },
  { id: "neon-grid", label: "Neon grid", category: "Neon", css: "linear-gradient(#081018, #0c1a24), repeating-linear-gradient(0deg, transparent 0 31px, rgba(126,224,255,.08) 32px)" },
  { id: "laser", label: "Laser", category: "Neon", css: "linear-gradient(180deg, #14081a, #081018)" },
  { id: "canopy", label: "Canopy", category: "Nature", css: "linear-gradient(180deg, #0e1c14, #162418 55%, #0a120e)" },
  { id: "dune", label: "Dune", category: "Nature", css: "linear-gradient(180deg, #2a1c10, #3a2814 40%, #120c08)" },
  { id: "mist", label: "Mist", category: "Minimal", css: "linear-gradient(#141820, #1a1f28)" },
  { id: "paper", label: "Paper", category: "Minimal", css: "linear-gradient(#1c1e22, #22262c)" },
  { id: "fade", label: "Fade", category: "Gradient", css: "linear-gradient(160deg, #1a1024, #102028, #10141c)" },
  { id: "horizon", label: "Horizon", category: "Gradient", css: "linear-gradient(#1a1030, #241018)" },
  { id: "orbit", label: "Orbit", category: "Space", css: "radial-gradient(circle at 70% 10%, #2a3a68, #07090f 55%)" },
  { id: "nova", label: "Nova", category: "Space", css: "radial-gradient(circle at 20% 80%, #402060, #07090f 60%)" },
  { id: "gilt", label: "Gilt", category: "Luxury", css: "linear-gradient(160deg, #24180c, #120e0a)" },
  { id: "velvet", label: "Velvet", category: "Luxury", css: "radial-gradient(circle at 50% 0%, #2a1020, #0c0810)" },
  { id: "hatch", label: "Hatch", category: "Patterns", css: "repeating-linear-gradient(135deg, #10141c 0 10px, #141820 10px 20px)" },
] as const;

export const DISAPPEAR_OPTIONS = [
  { id: 0, label: "Off" },
  { id: 30, label: "30 seconds" },
  { id: 60, label: "1 minute" },
  { id: 300, label: "5 minutes" },
  { id: 600, label: "10 minutes" },
  { id: 3600, label: "1 hour" },
  { id: 21600, label: "6 hours" },
  { id: 43200, label: "12 hours" },
  { id: 86400, label: "24 hours" },
  { id: 172800, label: "2 days" },
  { id: 604800, label: "7 days" },
  { id: 2592000, label: "30 days" },
] as const;

export const REMINDER_INTERVAL_MS = 20 * 60_000;
export const REMINDER_MAX = 3;

export type ChatCustomization = {
  conversationId: string;
  themeId: string;
  chatColor: string;
  wallpaperType: "builtin" | "gallery" | "none";
  wallpaperKey: string | null;
  wallpaperUrl: string | null;
  fontId: string;
  disappearingEnabled: boolean;
  disappearingDurationSec: number;
  remindersEnabled: boolean;
};

export const DEFAULT_CHAT_CUSTOM: Omit<ChatCustomization, "conversationId"> = {
  themeId: "nyx",
  chatColor: "nyx-blue",
  wallpaperType: "builtin",
  wallpaperKey: "void",
  wallpaperUrl: null,
  fontId: "outfit",
  disappearingEnabled: false,
  disappearingDurationSec: 0,
  remindersEnabled: true,
};

export function colorHex(id: string): string {
  return CHAT_COLORS.find((c) => c.id === id)?.hex ?? CHAT_COLORS[0].hex;
}

export function fontFamily(id: string): string {
  return CHAT_FONTS.find((f) => f.id === id)?.family ?? CHAT_FONTS[0].family;
}

export function wallpaperCss(key: string | null | undefined): string {
  return CHAT_WALLPAPERS.find((w) => w.id === key)?.css ?? CHAT_WALLPAPERS[0].css;
}

export function disappearLabel(sec: number): string {
  return DISAPPEAR_OPTIONS.find((o) => o.id === sec)?.label ?? `${sec}s`;
}
