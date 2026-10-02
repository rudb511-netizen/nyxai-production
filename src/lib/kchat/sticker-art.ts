/** NYX sticker raster: designed SVG cards — not emoji-as-message. */

export type ArtTone = {
  bg: string;
  fg: string;
  ink: string;
  accent: string;
};

const TONES: ArtTone[] = [
  { bg: "#1a1424", fg: "#f4efe6", ink: "#f4efe6", accent: "#e8b86d" },
  { bg: "#14181f", fg: "#e8eef6", ink: "#e8eef6", accent: "#7ec8e3" },
  { bg: "#1c1214", fg: "#f7e8ea", ink: "#f7e8ea", accent: "#e45d6b" },
  { bg: "#121a16", fg: "#e7f4ea", ink: "#e7f4ea", accent: "#6dcaa0" },
  { bg: "#1a1610", fg: "#f6eedc", ink: "#f6eedc", accent: "#d9a441" },
  { bg: "#16111c", fg: "#efe6f7", ink: "#efe6f7", accent: "#c79be8" },
  { bg: "#101418", fg: "#e6eef4", ink: "#e6eef4", accent: "#8aa4c8" },
  { bg: "#1c1410", fg: "#f6e6d8", ink: "#f6e6d8", accent: "#e0895a" },
];

export function toneFor(seed: string): ArtTone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length]!;
}

function wrap(text: string, max = 14): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function iconMarkup(name: string, accent: string, ink: string): string {
  const n = name.toLowerCase();
  if (/laugh|lol|lmao|funny|breathe|crying laughing/.test(n)) {
    return `<circle cx="96" cy="70" r="28" fill="${accent}"/><path d="M82 66c3 10 25 10 28 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/><circle cx="86" cy="60" r="3.2" fill="${ink}"/><circle cx="106" cy="60" r="3.2" fill="${ink}"/>`;
  }
  if (/cry|sad|sorry|forgive|fault|messed/.test(n)) {
    return `<circle cx="96" cy="70" r="28" fill="${accent}"/><path d="M84 78c8-8 16-8 24 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/><circle cx="86" cy="62" r="3" fill="${ink}"/><circle cx="106" cy="62" r="3" fill="${ink}"/><path d="M82 58l-6 10M110 58l6 10" stroke="${accent}" stroke-width="3" opacity=".8"/>`;
  }
  if (/shock|surpris|mind blown|speechless|what|huh|wait what|scared/.test(n)) {
    return `<circle cx="96" cy="70" r="28" fill="${accent}"/><ellipse cx="96" cy="80" rx="6" ry="8" fill="${ink}"/><circle cx="85" cy="60" r="4" fill="${ink}"/><circle cx="107" cy="60" r="4" fill="${ink}"/>`;
  }
  if (/angry|annoyed|disgust|hell no|stop|never|wrong/.test(n)) {
    return `<circle cx="96" cy="70" r="28" fill="${accent}"/><path d="M80 56l14 8M112 56l-14 8" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/><path d="M84 82c8-6 16-6 24 0" fill="none" stroke="${ink}" stroke-width="3.5"/>`;
  }
  if (/love|heart|kiss|romance|mine|forever|blush|cute|beautiful|handsome|gorgeous/.test(n)) {
    return `<path d="M96 96c-18-12-28-24-28-36a16 16 0 0 1 28-10 16 16 0 0 1 28 10c0 12-10 24-28 36z" fill="${accent}"/>`;
  }
  if (/hug|hold|cuddle|arm/.test(n)) {
    return `<circle cx="80" cy="68" r="16" fill="${accent}"/><circle cx="112" cy="68" r="16" fill="${ink}" opacity=".85"/><path d="M64 88c16 12 48 12 64 0" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round"/>`;
  }
  if (/night|moon|midnight|dream|sleep|good night/.test(n)) {
    return `<path d="M112 52a22 22 0 1 1-18 36 26 26 0 1 0 18-36z" fill="${accent}"/>`;
  }
  if (/sun|morning|day/.test(n)) {
    return `<circle cx="96" cy="70" r="16" fill="${accent}"/><g stroke="${accent}" stroke-width="3" stroke-linecap="round"><path d="M96 44v-8M96 104v8M70 70h-8M130 70h8M76 50l-6-6M122 90l6 6M122 50l6-6M76 90l-6 6"/></g>`;
  }
  if (/hello|hi|hey|wave|welcome|bye|goodbye/.test(n)) {
    return `<path d="M78 92c0-22 8-40 16-40 4 0 6 6 6 14 8-16 14-14 16-6 10-12 18-6 16 8 0 18-10 40-26 40H84z" fill="${accent}"/>`;
  }
  if (/yes|ok|sure|agree|true|facts|correct|approved|deal|exactly|definitely|absolutely/.test(n)) {
    return `<circle cx="96" cy="72" r="26" fill="${accent}"/><path d="M82 72l10 10 20-22" fill="none" stroke="${ink}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (/no|nope|not |never|nah|forget|disagree/.test(n)) {
    return `<circle cx="96" cy="72" r="26" fill="${accent}"/><path d="M84 60l24 24M108 60 84 84" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`;
  }
  if (/food|eat|hungry|pizza|burger|chicken|rice|noodle|cake|coffee|tea|yummy|delicious/.test(n)) {
    return `<path d="M70 78h52l-6 22H76z" fill="${accent}"/><ellipse cx="96" cy="74" rx="30" ry="10" fill="${ink}" opacity=".9"/>`;
  }
  if (/money|pay|cash|broke|rich|payday|expensive|payment/.test(n)) {
    return `<rect x="70" y="54" width="52" height="36" rx="6" fill="${accent}"/><text x="96" y="78" text-anchor="middle" font-size="22" font-weight="700" fill="${ink}">₦</text>`;
  }
  if (/cat|kitten/.test(n)) {
    return `<path d="M70 88c0-22 12-34 26-34s26 12 26 34z" fill="${accent}"/><path d="M74 58l-8-16 16 10M118 58l8-16-16 10" fill="${accent}"/><circle cx="88" cy="74" r="3" fill="${ink}"/><circle cx="104" cy="74" r="3" fill="${ink}"/>`;
  }
  if (/dog|pupp/.test(n)) {
    return `<ellipse cx="96" cy="78" rx="26" ry="20" fill="${accent}"/><ellipse cx="70" cy="70" rx="10" ry="14" fill="${accent}"/><ellipse cx="122" cy="70" rx="10" ry="14" fill="${accent}"/><circle cx="88" cy="76" r="3" fill="${ink}"/><circle cx="104" cy="76" r="3" fill="${ink}"/>`;
  }
  if (/game|gg|victory|level|noob|pro|afk|boss|player|mission/.test(n)) {
    return `<rect x="68" y="58" width="56" height="32" rx="10" fill="${accent}"/><circle cx="82" cy="74" r="5" fill="${ink}"/><circle cx="110" cy="68" r="3" fill="${ink}"/><circle cx="118" cy="76" r="3" fill="${ink}"/>`;
  }
  if (/work|busy|meeting|school|study|exam|homework|deadline|class/.test(n)) {
    return `<rect x="72" y="58" width="48" height="36" rx="4" fill="${accent}"/><path d="M72 66h48" stroke="${ink}" stroke-width="3"/><rect x="84" y="50" width="24" height="10" rx="2" fill="${accent}"/>`;
  }
  if (/party|celebrat|congrats|birthday|cheer|winner|success/.test(n)) {
    return `<path d="M96 48l8 20h20l-16 12 6 20-18-12-18 12 6-20-16-12h20z" fill="${accent}"/>`;
  }
  if (/thank|appreciate|bless|respect/.test(n)) {
    return `<path d="M96 44 84 72h24z" fill="${accent}"/><circle cx="96" cy="86" r="10" fill="${accent}"/>`;
  }
  if (/phone|call|text me/.test(n)) {
    return `<rect x="82" y="48" width="28" height="48" rx="6" fill="${accent}"/><circle cx="96" cy="88" r="3" fill="${ink}"/>`;
  }
  if (/online|offline|status|busy|sleeping/.test(n)) {
    return `<circle cx="96" cy="72" r="22" fill="${accent}"/><circle cx="96" cy="72" r="10" fill="${ink}"/>`;
  }
  if (/dark|danger|forbidden|toxic|obsess|shadow|secret/.test(n)) {
    return `<path d="M96 44 68 96h56z" fill="${accent}"/><circle cx="96" cy="78" r="6" fill="${ink}"/>`;
  }
  if (/flower|gift/.test(n)) {
    return `<circle cx="96" cy="64" r="10" fill="${accent}"/><circle cx="82" cy="72" r="8" fill="${accent}"/><circle cx="110" cy="72" r="8" fill="${accent}"/><circle cx="90" cy="84" r="8" fill="${accent}"/><circle cx="102" cy="84" r="8" fill="${accent}"/>`;
  }
  if (/fire|hot|crazy/.test(n)) {
    return `<path d="M96 44s10 16 10 28a16 16 0 1 1-32 0c0-8 8-18 12-28 4 8 8 12 10 0z" fill="${accent}"/>`;
  }
  if (/think|hmm|confused|why|maybe/.test(n)) {
    return `<circle cx="96" cy="68" r="26" fill="${accent}"/><path d="M88 80c4 8 12 8 16 0" fill="none" stroke="${ink}" stroke-width="3"/><circle cx="86" cy="62" r="3" fill="${ink}"/><circle cx="106" cy="62" r="3" fill="${ink}"/><circle cx="122" cy="48" r="4" fill="${accent}"/><circle cx="130" cy="40" r="2.5" fill="${accent}"/>`;
  }
  if (/animal|bear|panda|monkey|rabbit|fox|lion|tiger|penguin|elephant|koala|frog|bird|hamster/.test(n)) {
    return `<circle cx="96" cy="74" r="24" fill="${accent}"/><circle cx="78" cy="56" r="8" fill="${accent}"/><circle cx="114" cy="56" r="8" fill="${accent}"/><circle cx="88" cy="74" r="3" fill="${ink}"/><circle cx="104" cy="74" r="3" fill="${ink}"/>`;
  }
  if (/how far|abeg|wahala|omo|wetin|na lie|dey/.test(n)) {
    return `<circle cx="96" cy="70" r="28" fill="${accent}"/><path d="M82 66c3 12 25 12 28 0" fill="none" stroke="${ink}" stroke-width="4"/><path d="M80 56h10M102 56h10" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
  }
  if (/motivat|strong|believe|focus|push|win|got this|keep going/.test(n)) {
    return `<path d="M96 46 72 90h48z" fill="${accent}"/><path d="M96 62v18" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>`;
  }
  if (/couple|date|dinner|sunset|dance|walk|flower/.test(n)) {
    return `<circle cx="84" cy="66" r="14" fill="${accent}"/><circle cx="108" cy="66" r="14" fill="${ink}" opacity=".85"/><path d="M74 88c14 14 30 14 44 0" fill="none" stroke="${accent}" stroke-width="5"/>`;
  }
  return `<circle cx="96" cy="72" r="26" fill="${accent}"/><circle cx="96" cy="72" r="10" fill="${ink}" opacity=".35"/>`;
}

export function phraseStickerSvg(name: string, opts?: { animated?: boolean; seed?: string }): string {
  const tone = toneFor(opts?.seed ?? name);
  const lines = wrap(name, 13);
  const font = lines.some((l) => l.length > 11) ? 13 : lines.length > 2 ? 14 : 16;
  const startY = 148 - (lines.length - 1) * 18;
  const text = lines
    .map(
      (line, i) =>
        `<text x="96" y="${startY + i * 18}" text-anchor="middle" font-family="Outfit, system-ui, sans-serif" font-size="${font}" font-weight="700" fill="${tone.fg}">${escapeXml(line)}</text>`,
    )
    .join("");
  const bounce = opts?.animated
    ? `<animateTransform attributeName="transform" type="translate" values="0 0; 0 -4; 0 0" dur="1.4s" repeatCount="indefinite"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <rect width="192" height="192" rx="40" fill="${tone.bg}"/>
  <rect x="10" y="10" width="172" height="172" rx="32" fill="none" stroke="${tone.accent}" stroke-width="2" opacity=".35"/>
  <g>${bounce}${iconMarkup(name, tone.accent, tone.bg)}</g>
  ${text}
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

export function stickerSlug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 42);
  return s || "sticker";
}
