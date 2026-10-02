import { parseAudiusTracks, playbackTypeOf, type MusicTrack } from "../music.ts";
import { providerFetch } from "./health.ts";
import { adapterFromTrack, oneTrack } from "./resolve.ts";
import type { MusicProviderAdapter } from "./types.ts";

const API = "https://discoveryprovider.audius.co/v1";

async function audiusPath(path: string, trackId?: string): Promise<MusicTrack[]> {
  const join = path.includes("?") ? "&" : "?";
  const json = await providerFetch("audius", `${API}${path}${join}app_name=NYX`, 8000, trackId);
  return parseAudiusTracks(json);
}

const methods = {
  async searchTracks(query: string) {
    const term = query.trim().slice(0, 80);
    if (term.length < 2) return [];
    return audiusPath(`/tracks/search?query=${encodeURIComponent(term)}&limit=12`);
  },
  trending() {
    return audiusPath("/tracks/trending?limit=12");
  },
  getTrack(trackId: string) {
    return audiusPath(`/tracks/${encodeURIComponent(trackId)}`, trackId).then(oneTrack);
  },
};

export const audiusProvider: MusicProviderAdapter = {
  id: "audius",
  capabilities: {
    provider: "audius",
    enabled: true,
    searchSupported: true,
    metadataSupported: true,
    fullTrackPlaybackSupported: true,
    previewSupported: false,
    officialPlayerSupported: true,
    downloadSupported: true,
    commercialUseAllowed: "per-track",
    streamingRestrictions:
      "NYX uses the official /v1/tracks/{id}/stream endpoint only when Audius marks the track streamable and not stream-gated. Gated or paid tracks open the official embed. NYX does not extract that audio.",
    downloadRestrictions:
      "Download uses the official /download endpoint only when is_downloadable is true and the download is not gated or follow-restricted.",
    attributionRequired: true,
    authenticationRequired: false,
    apiRateLimit: "Discovery nodes rate-limit anonymous apps. NYX backs off on HTTP 429 and opens a short circuit after repeated failures.",
    territoryRestrictions: "Some tracks are geoblocked by the content node. NYX does not bypass that.",
    licenseInformation: "Rights stay with the artist. Audius grants API apps a stream, and a download only when the artist enabled it.",
    officialDocumentationUrl: "https://docs.audius.org/developers/api",
    credentials: [],
  },
  ...methods,
  ...adapterFromTrack(methods),
};

export function audiusTrackPlayable(track: MusicTrack | null): track is MusicTrack {
  return Boolean(track && (playbackTypeOf(track) === "FULL_TRACK" || playbackTypeOf(track) === "OFFICIAL_PLAYER"));
}
