export function newId(prefix = "k"): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export function newRoomCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
