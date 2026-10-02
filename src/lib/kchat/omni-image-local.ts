/** Prompt-driven SVG scenes when live Imagine is unavailable. Always returns a real image data URL. */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pick<T>(h: number, arr: T[], salt = 0): T {
  return arr[(h + salt) % arr.length]!;
}

function sizeFor(aspect: string): { w: number; h: number } {
  if (aspect === "16:9") return { w: 1280, h: 720 };
  if (aspect === "9:16") return { w: 720, h: 1280 };
  if (aspect === "4:3") return { w: 1024, h: 768 };
  if (aspect === "3:4") return { w: 768, h: 1024 };
  return { w: 1024, h: 1024 };
}

function palettes(h: number) {
  const sets = [
    ["#0b1220", "#1e3a5f", "#f97316", "#fde68a", "#e2e8f0"],
    ["#1a0b16", "#4c1d95", "#ec4899", "#fbcfe8", "#f5f3ff"],
    ["#052e16", "#14532d", "#22c55e", "#bbf7d0", "#ecfdf5"],
    ["#111827", "#1e293b", "#38bdf8", "#7dd3fc", "#e0f2fe"],
    ["#1c1917", "#7c2d12", "#f59e0b", "#fed7aa", "#fff7ed"],
    ["#0c1222", "#1e1b4b", "#6366f1", "#c4b5fd", "#eef2ff"],
  ];
  return pick(h, sets);
}

function subject(prompt: string): string {
  const q = prompt.toLowerCase();
  if (/\b(car|vehicle|sedan|sports car|truck)\b/.test(q)) return "car";
  if (/\b(cat|kitten)\b/.test(q)) return "cat";
  if (/\b(dog|puppy)\b/.test(q)) return "dog";
  if (/\b(city|street|skyline|building)\b/.test(q)) return "city";
  if (/\b(sunset|sunrise|horizon|dusk)\b/.test(q)) return "sunset";
  if (/\b(ocean|sea|beach|wave)\b/.test(q)) return "ocean";
  if (/\b(mountain|forest|tree|landscape)\b/.test(q)) return "land";
  if (/\b(flower|garden|rose)\b/.test(q)) return "flower";
  if (/\b(moon|planet|space|galaxy|star)\b/.test(q)) return "space";
  if (/\b(portrait|person|face|human)\b/.test(q)) return "portrait";
  return "abstract";
}

function scene(kind: string, w: number, h: number, p: string[], hv: number): string {
  const [bg, mid, acc, lite, ink] = p;
  if (kind === "car") {
    const y = h * 0.62;
    return `
      <rect width="${w}" height="${h}" fill="${bg}"/>
      <rect y="${h * 0.55}" width="${w}" height="${h * 0.45}" fill="${mid}"/>
      <polygon points="0,${h * 0.55} ${w},${h * 0.48} ${w},${h} 0,${h}" fill="${mid}" opacity="0.9"/>
      <rect x="${w * 0.18}" y="${y - 70}" width="${w * 0.64}" height="70" rx="18" fill="${acc}"/>
      <polygon points="${w * 0.32},${y - 70} ${w * 0.4},${y - 128} ${w * 0.62},${y - 128} ${w * 0.72},${y - 70}" fill="${lite}"/>
      <circle cx="${w * 0.32}" cy="${y + 8}" r="38" fill="#111"/><circle cx="${w * 0.32}" cy="${y + 8}" r="16" fill="${lite}"/>
      <circle cx="${w * 0.68}" cy="${y + 8}" r="38" fill="#111"/><circle cx="${w * 0.68}" cy="${y + 8}" r="16" fill="${lite}"/>
      <rect x="${w * 0.78}" y="${y - 48}" width="28" height="14" rx="4" fill="${lite}"/>`;
  }
  if (kind === "sunset") {
    return `
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${mid}"/><stop offset="0.55" stop-color="${acc}"/><stop offset="1" stop-color="${lite}"/>
      </linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#sky)"/>
      <circle cx="${w * 0.7}" cy="${h * 0.42}" r="${Math.min(w, h) * 0.16}" fill="${lite}"/>
      <rect y="${h * 0.58}" width="${w}" height="${h * 0.42}" fill="${bg}"/>`;
  }
  if (kind === "city") {
    const blocks = Array.from({ length: 9 }, (_, i) => {
      const x = (i / 9) * w;
      const bh = 80 + ((hv >> i) % 280);
      return `<rect x="${x + 6}" y="${h * 0.7 - bh}" width="${w / 9 - 12}" height="${bh}" fill="${i % 2 ? acc : mid}"/>`;
    }).join("");
    return `<rect width="${w}" height="${h}" fill="${bg}"/>${blocks}<rect y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="${mid}"/>`;
  }
  if (kind === "ocean") {
    return `
      <rect width="${w}" height="${h * 0.46}" fill="${lite}"/>
      <rect y="${h * 0.46}" width="${w}" height="${h * 0.54}" fill="${mid}"/>
      <ellipse cx="${w * 0.2}" cy="${h * 0.46}" rx="${w * 0.18}" ry="18" fill="${acc}" opacity="0.7"/>
      <ellipse cx="${w * 0.7}" cy="${h * 0.52}" rx="${w * 0.28}" ry="22" fill="${acc}" opacity="0.55"/>`;
  }
  if (kind === "cat" || kind === "dog") {
    const cx = w / 2;
    const cy = h / 2;
    return `
      <rect width="${w}" height="${h}" fill="${bg}"/>
      <circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) * 0.22}" fill="${acc}"/>
      <circle cx="${cx - 70}" cy="${cy - 90}" r="48" fill="${acc}"/>
      <circle cx="${cx + 70}" cy="${cy - 90}" r="48" fill="${acc}"/>
      <circle cx="${cx - 40}" cy="${cy - 10}" r="12" fill="${bg}"/>
      <circle cx="${cx + 40}" cy="${cy - 10}" r="12" fill="${bg}"/>
      <ellipse cx="${cx}" cy="${cy + 28}" rx="22" ry="14" fill="${lite}"/>`;
  }
  if (kind === "space") {
    const stars = Array.from({ length: 40 }, (_, i) => {
      const x = (hash(String(hv + i)) % w);
      const y = (hash(String(hv + i * 17)) % h);
      return `<circle cx="${x}" cy="${y}" r="${1 + (i % 3)}" fill="${lite}"/>`;
    }).join("");
    return `<rect width="${w}" height="${h}" fill="${bg}"/>${stars}<circle cx="${w * 0.7}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.14}" fill="${acc}"/>`;
  }
  if (kind === "portrait") {
    return `
      <rect width="${w}" height="${h}" fill="${bg}"/>
      <circle cx="${w / 2}" cy="${h * 0.38}" r="${Math.min(w, h) * 0.16}" fill="${lite}"/>
      <ellipse cx="${w / 2}" cy="${h * 0.78}" rx="${Math.min(w, h) * 0.28}" ry="${h * 0.28}" fill="${acc}"/>`;
  }
  if (kind === "flower") {
    const cx = w / 2;
    const cy = h / 2;
    const petals = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      const x = cx + Math.cos(a) * 120;
      const y = cy + Math.sin(a) * 120;
      return `<ellipse cx="${x}" cy="${y}" rx="70" ry="36" transform="rotate(${(a * 180) / Math.PI} ${x} ${y})" fill="${acc}"/>`;
    }).join("");
    return `<rect width="${w}" height="${h}" fill="${bg}"/>${petals}<circle cx="${cx}" cy="${cy}" r="48" fill="${lite}"/>`;
  }
  if (kind === "land") {
    return `
      <rect width="${w}" height="${h}" fill="${lite}"/>
      <polygon points="0,${h} ${w * 0.35},${h * 0.38} ${w * 0.7},${h}" fill="${mid}"/>
      <polygon points="${w * 0.4},${h} ${w * 0.72},${h * 0.3} ${w},${h}" fill="${acc}"/>
      <rect y="${h * 0.72}" width="${w}" height="${h * 0.28}" fill="${bg}"/>`;
  }
  const blobs = Array.from({ length: 6 }, (_, i) => {
    const x = (hash(String(hv + i * 3)) % w);
    const y = (hash(String(hv + i * 11)) % h);
    const r = 80 + (hash(String(hv + i)) % 160);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? acc : mid}" opacity="0.85"/>`;
  }).join("");
  return `<rect width="${w}" height="${h}" fill="${bg}"/>${blobs}`;
}

export function renderLocalImage(prompt: string, aspect = "1:1"): string {
  const { w, h } = sizeFor(aspect);
  const hv = hash(prompt.toLowerCase());
  const p = palettes(hv);
  const kind = subject(prompt);
  const ink = p[4];
  const caption = prompt.replace(/\s+/g, " ").trim().slice(0, 64);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${scene(kind, w, h, p, hv)}
  <rect x="24" y="${h - 72}" width="${Math.min(w - 48, 12 * caption.length + 32)}" height="40" rx="12" fill="#00000066"/>
  <text x="40" y="${h - 46}" fill="${ink}" font-size="18" font-family="Outfit, system-ui, sans-serif">${escapeXml(caption)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
