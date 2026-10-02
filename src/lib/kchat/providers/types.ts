import type { MusicProvider, MusicTrack } from "../music.ts";

/** What the provider's current terms actually allow. Disabled providers are never called. */
export type ProviderCapabilities = {
  provider: string;
  enabled: boolean;
  disabledReason?: string;
  searchSupported: boolean;
  metadataSupported: boolean;
  fullTrackPlaybackSupported: boolean;
  previewSupported: boolean;
  officialPlayerSupported: boolean;
  downloadSupported: boolean;
  commercialUseAllowed: boolean | "per-track";
  streamingRestrictions: string;
  downloadRestrictions: string;
  attributionRequired: boolean;
  authenticationRequired: boolean;
  apiRateLimit: string;
  territoryRestrictions: string;
  licenseInformation: string;
  officialDocumentationUrl: string;
  credentials: string[];
};

export type MusicProviderAdapter = {
  id: MusicProvider;
  capabilities: ProviderCapabilities;
  searchTracks(query: string): Promise<MusicTrack[]>;
  trending(): Promise<MusicTrack[]>;
  getTrack(trackId: string): Promise<MusicTrack | null>;
  getStreamUrl(trackId: string): Promise<string | null>;
  getDownloadUrl(trackId: string): Promise<string | null>;
  getArtwork(trackId: string): Promise<string | null>;
  getArtist(trackId: string): Promise<string | null>;
  getAlbum(trackId: string): Promise<string | null>;
};
