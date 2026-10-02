import { encode, renderSVG } from "uqr";

export function qrSvg(value: string, pixel = 192): string {
  const text = value.trim().slice(0, 1024);
  if (!text) throw new Error("Nothing to encode.");
  encode(text);
  return renderSVG(text, {
    pixelSize: Math.max(2, Math.round(pixel / 32)),
    whiteColor: "#ffffff",
    blackColor: "#0b1220",
  });
}

export function inviteJoinPath(token: string): string {
  return `/join/${token.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
}
