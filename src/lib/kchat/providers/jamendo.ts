import { parseJamendoTracks, type MusicTrack } from "../music.ts";
import { providerFetch } from "./health.ts";
import { adapterFromTrack, oneTrack } from "./resolve.ts";
import type { MusicProviderAdapter } from "./types.ts";

const API = "https://api.jamendo.com/v3.0/tracks/";

export function jamendoClientId(): string | undefined {
  try {
    return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.JAMENDO_CLIENT_ID?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function jamendoQuery(params: Record<string, string>): Promise<MusicTrack[]> {
  const id = jamendoClientId();
  if (!id) return [];
  const query = new URLSearchParams({
    client_id: id,
    format: "json",
    include: "musicinfo",
    audioformat: "mp32",
    audiodlformat: "mp32",
    ...params,
  });
  const json = await providerFetch("jamendo", `${API}?${query.toString()}`);
  return parseJamendoTracks(json);
}

const methods = {
  searchTracks(query: string) {
    const term = query.trim().slice(0, 80);
    if (term.length < 2 || !jamendoClientId()) return Promise.resolve([]);
    return jamendoQuery({ limit: "12", search: term });
  },
  trending() {
    if (!jamendoClientId()) return Promise.resolve([]);
    return jamendoQuery({ limit: "12", order: "popularity_total" });
  },
  getTrack(trackId: string) {
    if (!jamendoClientId()) return Promise.resolve(null);
    return jamendoQuery({ limit: "1", id: trackId }).then(oneTrack);
  },
};

export const jamendoProvider: MusicProviderAdapter = {
  id: "jamendo",
  capabilities: {
    provider: "jamendo",
    enabled: Boolean(jamendoClientId()),
    disabledReason: jamendoClientId() ? undefined : "Set JAMENDO_CLIENT_ID to enable Jamendo. The client id is not committed.",
    searchSupported: true,
    metadataSupported: true,
    fullTrackPlaybackSupported: true,
    previewSupported: false,
    officialPlayerSupported: false,
    downloadSupported: true,
    commercialUseAllowed: "per-track",
    streamingRestrictions: "Full-file streaming is allowed for tracks returned by the Jamendo API. NYX does not clip them into previews.",
    downloadRestrictions: "Download is enabled only when the track's audiodownload_allowed flag is true.",
    attributionRequired: true,
    authenticationRequired: true,
    apiRateLimit: "Jamendo limits clients by the registered client_id. NYX retries once on 429.",
    territoryRestrictions: "Jamendo may hide tracks that are not licensed in a territory.",
    licenseInformation: "Tracks are Creative Commons or Jamendo commercial licenses. The API flag is the artist's download permission.",
    officialDocumentationUrl: "https://developer.jamendo.com/v3.0/docs",
    credentials: ["JAMENDO_CLIENT_ID"],
  },
  ...methods,
  ...adapterFromTrack(methods),
};
