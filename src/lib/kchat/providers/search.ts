import { playbackTypeOf, type MusicProvider, type MusicTrack } from "../music.ts";
import { appleProvider } from "./apple.ts";
import { archiveProvider } from "./archive.ts";
import { audiusProvider } from "./audius.ts";
import { DISABLED_PROVIDER_CAPABILITIES } from "./capabilities.ts";
import { providerAvailable, providerFailureMessage } from "./health.ts";
import { jamendoClientId, jamendoProvider } from "./jamendo.ts";
import type { MusicProviderAdapter, ProviderCapabilities } from "./types.ts";

export const ACTIVE_PROVIDERS: MusicProviderAdapter[] = [audiusProvider, jamendoProvider, archiveProvider, appleProvider];

export function providerCapabilities(): ProviderCapabilities[] {
  return [...ACTIVE_PROVIDERS.map((provider) => provider.capabilities), ...DISABLED_PROVIDER_CAPABILITIES];
}

export type ProviderSearchResult = {
  tracks: MusicTrack[];
  warnings: string[];
};

async function runProvider(provider: MusicProviderAdapter, query: string): Promise<MusicTrack[]> {
  if (!provider.capabilities.enabled && provider.id === "jamendo" && !jamendoClientId()) return [];
  if (!providerAvailable(provider.id)) {
    throw new Error(`${provider.capabilities.provider} is temporarily paused after repeated failures.`);
  }
  return query.trim() ? provider.searchTracks(query) : provider.trending();
}

/** Ask every enabled provider at once. One failure does not cancel the others. */
export async function searchExternalProviders(query: string): Promise<ProviderSearchResult> {
  const settled = await Promise.allSettled(ACTIVE_PROVIDERS.map((provider) => runProvider(provider, query)));
  const tracks: MusicTrack[] = [];
  const warnings: string[] = [];
  settled.forEach((result, index) => {
    const provider = ACTIVE_PROVIDERS[index];
    if (!provider) return;
    if (result.status === "fulfilled") {
      tracks.push(...result.value);
      return;
    }
    if (provider.id === "jamendo" && !jamendoClientId()) return;
    warnings.push(providerFailureMessage(provider.capabilities.provider, result.reason));
  });
  return { tracks, warnings };
}

export async function searchOneProvider(provider: MusicProvider, query: string): Promise<MusicTrack[]> {
  const adapter = ACTIVE_PROVIDERS.find((item) => item.id === provider);
  if (!adapter) return [];
  return adapter.searchTracks(query);
}

export async function getProviderTrack(provider: MusicProvider, trackId: string): Promise<MusicTrack | null> {
  const adapter = ACTIVE_PROVIDERS.find((item) => item.id === provider);
  if (!adapter) return null;
  return adapter.getTrack(trackId);
}

export function fullTrackFailureMessage(warnings: string[]): string {
  if (!warnings.length) return "No full-track stream is available for this song.";
  return warnings[0] || "No full-track stream is available for this song.";
}

export function playableProviderCount(tracks: MusicTrack[]): number {
  return tracks.filter((track) => playbackTypeOf(track) === "FULL_TRACK").length;
}
