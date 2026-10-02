import { applyItunesLookup, parseItunesRss, parseItunesSearch, type MusicTrack } from "../music.ts";
import { providerFetch } from "./health.ts";
import { adapterFromTrack, oneTrack } from "./resolve.ts";
import type { MusicProviderAdapter } from "./types.ts";

const SEARCH = "https://itunes.apple.com/search";
const RSS = "https://itunes.apple.com/us/rss/topsongs/limit=25/json";

async function lookup(ids: string[]): Promise<MusicTrack[]> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 25);
  if (!unique.length) return [];
  const json = await providerFetch("apple", `https://itunes.apple.com/lookup?id=${unique.map(encodeURIComponent).join(",")}&entity=song`);
  return parseItunesSearch(json);
}

const methods = {
  searchTracks(query: string) {
    const term = query.trim().slice(0, 80);
    if (term.length < 2) return Promise.resolve([]);
    return providerFetch("apple", `${SEARCH}?term=${encodeURIComponent(term)}&entity=song&media=music&limit=15`).then((json) =>
      parseItunesSearch(json),
    );
  },
  async trending() {
    const json = await providerFetch("apple", RSS);
    const rss = parseItunesRss(json);
    const missing = rss.filter((track) => !track.previewUrl && !track.officialPlayerUrl).map((track) => track.providerTrackId);
    if (!missing.length) return rss;
    try {
      return applyItunesLookup(rss, await lookup(missing));
    } catch {
      return rss;
    }
  },
  getTrack(trackId: string) {
    return lookup([trackId]).then(oneTrack);
  },
};

export const appleProvider: MusicProviderAdapter = {
  id: "itunes",
  capabilities: {
    provider: "itunes",
    enabled: true,
    searchSupported: true,
    metadataSupported: true,
    fullTrackPlaybackSupported: false,
    previewSupported: true,
    officialPlayerSupported: true,
    downloadSupported: false,
    commercialUseAllowed: false,
    streamingRestrictions:
      "The public iTunes Search API returns a 30-second preview file, not the song. When the result includes an Apple Music link, NYX opens Apple's official embed instead of pretending the preview is the full track. MusicKit is not integrated.",
    downloadRestrictions: "Apple preview files and Apple Music songs are never downloaded.",
    attributionRequired: true,
    authenticationRequired: false,
    apiRateLimit: "The Search API is unofficially about 20 calls per minute. NYX searches it once per user query and caches metadata.",
    territoryRestrictions: "Results follow the storefront in the catalog URL, usually the US chart for trending.",
    licenseInformation: "Previews are licensed for playback of the clip only. Full songs stay with Apple Music.",
    officialDocumentationUrl: "https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/",
    credentials: [],
  },
  ...methods,
  ...adapterFromTrack(methods),
};
