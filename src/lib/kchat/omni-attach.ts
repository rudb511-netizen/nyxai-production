import { compressImage } from "./media-client";
import { extractFromArrayBuffer, type OmniAttachment } from "./omni-files";

const FILE_MAX = 8 * 1024 * 1024;

export async function attachmentsFromFiles(files: File[]): Promise<OmniAttachment[]> {
  const out: OmniAttachment[] = [];
  for (const f of files.slice(0, 6)) {
    if (f.size > FILE_MAX) throw new Error(`${f.name} is too large (max 8MB).`);
    if (f.type.startsWith("image/")) {
      const c = await compressImage(f, { maxEdge: 1024, quality: 0.78, maxBytes: 220_000 });
      out.push({
        name: f.name,
        mime: "image/jpeg",
        kind: "image",
        text: "",
        dataUrl: c.dataUrl,
        bytes: Math.round(c.dataUrl.length * 0.75),
      });
      continue;
    }
    const buf = await f.arrayBuffer();
    out.push(await extractFromArrayBuffer(f.name, f.type || "application/octet-stream", buf));
  }
  return out;
}
