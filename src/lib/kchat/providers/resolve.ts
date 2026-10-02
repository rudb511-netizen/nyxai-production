import { fullTrackUrl, playbackTypeOf, type MusicTrack } from "../music.ts";
import type { MusicProviderAdapter } from "./types.ts";

export function adapterFromTrack(adapter: Pick<MusicProviderAdapter, "getTrack">): Pick<
  MusicProviderAdapter,
  "getStreamUrl" | "getDownloadUrl" | "getArtwork" | "getArtist" | "getAlbum"
> {
  return {
    async getStreamUrl(trackId) {
      const track = await adapter.getTrack(trackId);
      if (!track || playbackTypeOf(track) !== "FULL_TRACK") return null;
      return fullTrackUrl(track);
    },
    async getDownloadUrl(trackId) {
      const track = await adapter.getTrack(trackId);
      if (!track?.downloadable || !track.downloadUrl) return null;
      return track.downloadUrl;
    },
    async getArtwork(trackId) {
      return (await adapter.getTrack(trackId))?.artworkUrl ?? null;
    },
    async getArtist(trackId) {
      return (await adapter.getTrack(trackId))?.artist ?? null;
    },
    async getAlbum(trackId) {
      return (await adapter.getTrack(trackId))?.album ?? null;
    },
  };
}

export function oneTrack(tracks: MusicTrack[]): MusicTrack | null {
  return tracks[0] ?? null;
}
