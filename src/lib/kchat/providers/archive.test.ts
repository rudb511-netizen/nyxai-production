import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canDownload, canPlay, playbackTypeOf, preferAuthorizedSource, parseItunesSearch } from "../music.ts";
import { archiveLicense, archiveSearchTerm, parseArchiveMetadata, pickArchiveAudio, safeArchiveId } from "./archive.ts";
import { DISABLED_PROVIDER_CAPABILITIES } from "./capabilities.ts";
import { providerCapabilities } from "./search.ts";

describe("internet archive open licenses", () => {
  it("keeps public-domain and CC BY files and drops NC, ND, and unlabeled items", () => {
    assert.equal(archiveLicense("http://creativecommons.org/licenses/publicdomain/").download, true);
    assert.equal(archiveLicense("https://creativecommons.org/publicdomain/zero/1.0/").name.includes("CC0") || archiveLicense("https://creativecommons.org/publicdomain/zero/1.0/").name.includes("Public"), true);
    assert.equal(archiveLicense("https://creativecommons.org/licenses/by/4.0/").download, true);
    assert.equal(archiveLicense("https://creativecommons.org/licenses/by-sa/4.0/").attribution, "Attribution required");
    assert.equal(archiveLicense("https://creativecommons.org/licenses/by-nc-nd/3.0/").stream, false);
    assert.equal(archiveLicense("https://creativecommons.org/licenses/by-nc/3.0/").stream, false);
    assert.equal(archiveLicense("https://example.com/license").stream, false);
    assert.equal(archiveLicense(null).stream, false);
    assert.equal(archiveSearchTerm("%%%"), "");
    assert.equal(archiveSearchTerm("Blinding Lights"), "Blinding Lights");
  });

  it("parses a real Archive metadata shape as a full downloadable file and skips the short derivative", () => {
    const picked = pickArchiveAudio([
      { name: "ambient_64kb.mp3", format: "64Kbps MP3", size: "4020267", length: "08:22", source: "derivative" },
      { name: "clip_preview.mp3", format: "VBR MP3", size: "200000", length: "12.0", source: "original" },
      { name: "ambient.mp3", format: "VBR MP3", size: "8023171", length: "501.45", source: "original" },
    ]);
    assert.equal(picked?.name, "ambient.mp3");
    assert.equal(picked && picked.durationMs && picked.durationMs > 45_000, true);
    const track = parseArchiveMetadata({
      metadata: {
        identifier: "ambient_151",
        title: "ambient",
        creator: "mind theatre",
        licenseurl: "http://creativecommons.org/licenses/publicdomain/",
        mediatype: "audio",
      },
      files: [
        { name: "ambient.mp3", format: "VBR MP3", size: "8023171", length: "501.45", source: "original" },
      ],
    });
    assert.ok(track);
    assert.equal(track?.provider, "archive");
    assert.equal(playbackTypeOf(track!), "FULL_TRACK");
    assert.equal(canPlay(track!), true);
    assert.equal(canDownload(track!), true);
    assert.equal(track?.audioUrl, "https://archive.org/download/ambient_151/ambient.mp3");
    assert.equal(track?.previewUrl, null);
    assert.equal(safeArchiveId("../etc/passwd"), null);
    const blocked = parseArchiveMetadata({
      metadata: {
        identifier: "jamendo-619041",
        title: "Ambient Synthetic Music",
        creator: "Bobby Cole",
        licenseurl: "http://creativecommons.org/licenses/by-nc-nd/3.0/",
      },
      files: [{ name: "song.mp3", format: "VBR MP3", size: "4000000", length: "180", source: "original" }],
    });
    assert.equal(blocked, null);
    const nightcore = parseArchiveMetadata({
      metadata: {
        identifier: "nightcore-blinding-lights-the-weeknd",
        title: "nightcore blinding lights",
        creator: "uploader",
        licenseurl: "http://creativecommons.org/publicdomain/zero/1.0/",
        collection: ["opensource_audio"],
      },
      files: [{ name: "song.mp3", format: "VBR MP3", size: "4000000", length: "180", source: "original" }],
    });
    assert.equal(nightcore, null);
    const fringe = parseArchiveMetadata({
      metadata: {
        identifier: "dying-lights-blinding-lights-parody",
        title: "Dying Lights",
        creator: "uploader",
        licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/",
        collection: ["fringe", "deemphasize"],
      },
      files: [{ name: "song.mp3", format: "VBR MP3", size: "4000000", length: "180", source: "original" }],
    });
    assert.equal(fringe, null);
  });
});

describe("provider capabilities", () => {
  it("does not enable providers whose terms forbid raw audio", () => {
    const disabled = Object.fromEntries(DISABLED_PROVIDER_CAPABILITIES.map((item) => [item.provider, item]));
    assert.equal(disabled.youtube?.downloadSupported, false);
    assert.equal(disabled.youtube?.enabled, false);
    assert.equal(disabled.soundcloud?.enabled, false);
    assert.equal(disabled.freemusicarchive?.searchSupported, false);
    assert.equal(disabled.spotify?.fullTrackPlaybackSupported, false);
    assert.equal(disabled["apple-musickit"]?.fullTrackPlaybackSupported, false);
    const live = providerCapabilities().filter((item) => item.enabled).map((item) => item.provider);
    assert.ok(live.includes("audius"));
    assert.ok(live.includes("archive"));
    assert.equal(live.includes("youtube"), false);
    assert.equal(live.includes("spotify"), false);
  });

  it("prefers a downloadable full file over a stream-only full file of the same song", () => {
    const preview = parseItunesSearch({
      results: [{ trackId: 1, trackName: "Ambient", artistName: "mind theatre", previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a" }],
    })[0];
    const streamOnly = parseArchiveMetadata({
      metadata: { identifier: "streamonly1", title: "Ambient", creator: "mind theatre", licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/" },
      files: [{ name: "a.mp3", format: "VBR MP3", size: "2000000", length: "120", source: "original" }],
    });
    assert.equal(streamOnly, null);
    const downloadable = parseArchiveMetadata({
      metadata: { identifier: "ambient_151", title: "Ambient", creator: "mind theatre", licenseurl: "http://creativecommons.org/licenses/publicdomain/" },
      files: [{ name: "ambient.mp3", format: "VBR MP3", size: "8023171", length: "501.45", source: "original" }],
    });
    const ranked = preferAuthorizedSource([preview!, downloadable!]);
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.provider, "archive");
    assert.equal(canDownload(ranked[0]!), true);
    assert.equal(ranked[0]?.alternates?.length ?? 0, 0);
  });
});
