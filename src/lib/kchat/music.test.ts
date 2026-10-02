import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFallbackPreview,
  applyItunesLookup,
  audiusDownloadUrl,
  audiusStreamUrl,
  canDownload,
  canPlay,
  classifyProbe,
  contentDisposition,
  DOWNLOAD_NOT_ALLOWED,
  downloadBlockReason,
  filenameForTrack,
  formatDuration,
  FORMAT_UNSUPPORTED,
  FULL_DOWNLOAD_UNAVAILABLE,
  fullTrackUrl,
  isAbortPlay,
  isAutoplayBlock,
  isPreviewAudioUrl,
  ITUNES_PREVIEW_LICENSE,
  mediaErrorMessage,
  mimeForAudioUrl,
  parseAudiusTracks,
  parseItunesRss,
  parseItunesSearch,
  parseJamendoTracks,
  parseTrackKey,
  pickItunesPreview,
  preferAuthorizedSource,
  playbackTypeOf,
  playbackLabel,
  playbackSources,
  playableUrl,
  PLAYBACK_FAILED,
  PREVIEW_ONLY,
  TRACK_UNAVAILABLE,
} from "./music.ts";

describe("licensed music parsers", () => {
  it("parses iTunes Search songs and skips incomplete rows", () => {
    const tracks = parseItunesSearch({
      results: [
        {
          trackId: 123,
          trackName: "Helium",
          artistName: "Sia",
          collectionName: "1000 Forms of Fear",
          artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg",
          previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/helium.m4a",
          trackTimeMillis: 227000,
          primaryGenreName: "Pop",
        },
        { trackId: 1, trackName: "", artistName: "Nope" },
      ],
    });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].provider, "itunes");
    assert.equal(tracks[0].playback, "preview");
    assert.equal(tracks[0].playbackType, "PREVIEW");
    assert.equal(tracks[0].canStreamFull, false);
    assert.equal(tracks[0].fullTrackUrl ?? null, null);
    assert.equal(tracks[0].durationMs, null);
    assert.equal(tracks[0].downloadable, false);
    assert.equal(tracks[0].downloadUrl, null);
    assert.equal(canPlay(tracks[0]), true);
    assert.equal(playableUrl(tracks[0]), "https://audio-ssl.itunes.apple.com/itunes-assets/helium.m4a");
    assert.equal(canDownload(tracks[0]), false);
    assert.equal(downloadBlockReason(tracks[0]), FULL_DOWNLOAD_UNAVAILABLE);
    assert.equal(tracks[0].license, ITUNES_PREVIEW_LICENSE);
    assert.equal(playbackLabel(tracks[0]), "Preview");
    const official = parseItunesSearch({
      results: [
        {
          trackId: 1499378607,
          trackName: "Blinding Lights",
          artistName: "The Weeknd",
          previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/lights.m4a",
          trackViewUrl: "https://music.apple.com/us/album/after-hours/1499378615?i=1499378607",
          trackTimeMillis: 200000,
        },
      ],
    })[0];
    assert.equal(official.playbackType, "OFFICIAL_PLAYER");
    assert.equal(official.canStreamFull, false);
    assert.equal(official.previewUrl, null);
    assert.equal(official.audioUrl, null);
    assert.equal(official.durationMs, 200000);
    assert.equal(official.officialPlayerUrl, "https://embed.music.apple.com/us/album/1499378615?i=1499378607");
    assert.equal(playableUrl(official), null);
    assert.equal(canPlay(official), true);
    assert.equal(canDownload(official), false);
    assert.equal(playbackSources(official).length, 0);
    assert.equal(playbackLabel(official), "Official player");
  });

  it("fills missing RSS previews from iTunes lookup", () => {
    const rss = parseItunesRss({
      feed: {
        entry: {
          id: { attributes: { "im:id": "99" } },
          "im:name": { label: "Echo" },
          "im:artist": { label: "Nova" },
        },
      },
    });
    assert.equal(rss[0].previewUrl, null);
    assert.equal(rss[0].playback, "none");
    const filled = applyItunesLookup(rss, [
      {
        ...rss[0],
        previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/echo.m4a",
        playback: "preview",
        downloadable: false,
        downloadUrl: null,
        previewAvailable: true,
      },
    ]);
    assert.equal(filled[0].previewUrl, "https://audio-ssl.itunes.apple.com/itunes-assets/echo.m4a");
    assert.equal(filled[0].playback, "preview");
    assert.equal(playbackLabel(filled[0]), "Preview");
  });

  it("parses Jamendo tracks when a client id is configured", () => {
    const blocked = parseJamendoTracks({
      results: [{ id: "77", name: "Open Road", artist_name: "CC Band", audio: "https://jamendo.example/77.mp3", duration: 180 }],
    });
    assert.equal(blocked[0].id, "jamendo:77");
    assert.equal(blocked[0].durationMs, 180_000);
    assert.equal(blocked[0].playback, "full");
    assert.equal(blocked[0].audioUrl, "https://jamendo.example/77.mp3");
    assert.equal(blocked[0].downloadable, false);
    assert.equal(downloadBlockReason(blocked[0]), DOWNLOAD_NOT_ALLOWED);
    assert.equal(formatDuration(90_000), "1:30");
    const allowed = parseJamendoTracks({
      results: [
        {
          id: "78",
          name: "Open Road",
          artist_name: "CC Band",
          audio: "https://jamendo.example/78.mp3",
          audiodownload: "https://jamendo.example/78-dl.mp3",
          audiodownload_allowed: true,
          duration: 180,
        },
      ],
    });
    assert.equal(allowed[0].downloadable, true);
    assert.equal(allowed[0].downloadUrl, "https://jamendo.example/78-dl.mp3");
    assert.equal(playableUrl(allowed[0]), "https://jamendo.example/78.mp3");
    assert.equal(allowed[0].audioUrl, "https://jamendo.example/78.mp3");
    assert.equal(playbackLabel(allowed[0]), "Full track");
    assert.equal(canDownload(allowed[0]), true);
  });

  it("streams Audius in full and downloads only when the artist allows it", () => {
    const audius = parseAudiusTracks({
      data: [
        {
          id: "3EZbQxZ",
          title: "Live It Up",
          duration: 244,
          genre: "Electronic",
          artwork: { "480x480": "https://audius.example/art.jpg" },
          user: { name: "GORDO DJ" },
        },
      ],
    });
    assert.equal(audius.length, 1);
    assert.equal(audius[0].provider, "audius");
    assert.equal(audius[0].playbackType, "FULL_TRACK");
    assert.equal(audius[0].canStreamFull, true);
    assert.equal(audius[0].officialPlayerUrl ?? null, null);
    assert.equal(audius[0].durationMs, 244_000);
    assert.equal(audius[0].previewUrl, null);
    assert.equal(audius[0].audioUrl, audiusStreamUrl("3EZbQxZ"));
    assert.equal(audius[0].downloadable, false);
    assert.equal(audius[0].downloadUrl, null);
    assert.equal(canDownload(audius[0]), false);
    assert.equal(downloadBlockReason(audius[0]), DOWNLOAD_NOT_ALLOWED);
    assert.equal(fullTrackUrl(audius[0]), audius[0].audioUrl);
    assert.equal(canPlay(audius[0]), true);
    assert.equal(playbackSources(audius[0]).length, 1);
    assert.equal(playbackSources(audius[0])[0].src.includes("/stream"), true);
    const permitted = parseAudiusTracks({
      data: [
        {
          id: "ez7Az",
          title: "MONTAGEM KALI (Super Slowed)",
          duration: 123,
          is_downloadable: true,
          is_download_gated: false,
          user: { name: "Artist" },
        },
      ],
    });
    assert.equal(canDownload(permitted[0]), true);
    assert.equal(permitted[0].downloadUrl, audiusDownloadUrl("ez7Az"));
    assert.equal(permitted[0].downloadUrl?.includes("/download"), true);
    assert.equal(permitted[0].audioUrl?.includes("/stream"), true);
    assert.equal(filenameForTrack(permitted[0].title, permitted[0].downloadUrl || "", "audio/mpeg"), "MONTAGEM KALI (Super Slowed).mp3");
    assert.equal(contentDisposition("MONTAGEM KALI (Super Slowed).mp3").includes('filename="MONTAGEM KALI (Super Slowed).mp3"'), true);
    const downloadGated = parseAudiusTracks({
      data: [{ id: "dl1", title: "Stream Only Gate", duration: 90, is_downloadable: true, is_download_gated: true, is_streamable: true, user: { name: "A" } }],
    });
    assert.equal(downloadGated[0].playbackType, "FULL_TRACK");
    assert.equal(downloadGated[0].canStreamFull, true);
    assert.equal(canDownload(downloadGated[0]), false);
    const gated = parseAudiusTracks({
      data: [{ id: "YYEjJ", title: "Gated", duration: 90, is_downloadable: false, is_stream_gated: true, user: { name: "A" } }],
    });
    assert.equal(gated[0].downloadable, false);
    assert.equal(gated[0].playbackType, "OFFICIAL_PLAYER");
    assert.equal(gated[0].canStreamFull, false);
    assert.equal(gated[0].audioUrl, null);
    assert.equal(canPlay(gated[0]), true);
    assert.equal(playableUrl(gated[0]), null);
    const sameSong = preferAuthorizedSource([
      parseItunesSearch({
        results: [{ trackId: 9, trackName: "Live It Up", artistName: "GORDO DJ", previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a" }],
      })[0],
      audius[0],
    ]);
    assert.equal(sameSong.length, 1);
    assert.equal(sameSong[0].playbackType, "FULL_TRACK");
    assert.equal(sameSong[0].provider, "audius");
    assert.equal(canDownload(gated[0]), false);
    assert.equal(
      downloadBlockReason({ playback: "preview", downloadable: false, downloadUrl: null, provider: "itunes", audioUrl: null }),
      FULL_DOWNLOAD_UNAVAILABLE,
    );
    assert.equal(fullTrackUrl({ playback: "preview", previewUrl: "https://audio.example/clip.m4a", audioUrl: null, downloadUrl: null }), null);
    assert.equal(PREVIEW_ONLY.includes("preview only"), true);
  });
});

describe("playback error classification", () => {
  it("treats NotAllowedError as autoplay block, not a fatal media error", () => {
    const blocked = Object.assign(new Error("play() failed"), { name: "NotAllowedError" });
    const aborted = Object.assign(new Error("interrupted"), { name: "AbortError" });
    const network = Object.assign(new Error("fail"), { name: "NotSupportedError" });
    assert.equal(isAutoplayBlock(blocked), true);
    assert.equal(isAutoplayBlock(network), false);
    assert.equal(isAbortPlay(aborted), true);
    assert.equal(isAbortPlay(blocked), false);
    assert.equal(mediaErrorMessage(2), PLAYBACK_FAILED);
    assert.equal(mediaErrorMessage(4), FORMAT_UNSUPPORTED);
  });

  it("does not blame the codec when the preview URL is gone or blocked", () => {
    const m4a = "https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a";
    assert.equal(mimeForAudioUrl(m4a), "audio/mp4");
    assert.equal(mimeForAudioUrl("https://jamendo.example/a.mp3?token=1"), "audio/mpeg");
    assert.equal(classifyProbe(404, "audio/mpeg"), "unavailable");
    assert.equal(classifyProbe(403, "application/xml"), "unavailable");
    assert.equal(classifyProbe(200, "text/html"), "mismatch");
    assert.equal(classifyProbe(200, "audio/mp4"), "ok");
    assert.equal(mediaErrorMessage(4, { url: m4a, kind: "unavailable" }), TRACK_UNAVAILABLE);
    assert.equal(mediaErrorMessage(4, { url: m4a, kind: "network" }), TRACK_UNAVAILABLE);
    assert.equal(mediaErrorMessage(2, { kind: "network" }), TRACK_UNAVAILABLE);
  });

  it("lists mp3/m4a fallback sources without duplicating the same url", () => {
    const sources = playbackSources({
      playback: "full",
      previewUrl: "https://cdn.example/a.m4a",
      downloadUrl: "https://cdn.example/a.mp3",
    });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].src, "https://cdn.example/a.mp3");
    assert.equal(sources[0].type, "audio/mpeg");
    assert.equal(playbackSources({ playback: "preview", playbackType: "PREVIEW", previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a", downloadUrl: null }).length, 1);
    assert.equal(playbackSources({ playback: "preview", playbackType: "PREVIEW", previewUrl: "https://audio-ssl.itunes.apple.com/preview.m4a", audioUrl: "https://cdn.example/full.mp3", downloadUrl: null })[0].src.includes("itunes"), true);
    const full = playbackSources({
      playback: "full",
      audioUrl: "https://cdn.example/full.mp3",
      previewUrl: "https://cdn.example/preview.m4a",
      downloadUrl: "https://cdn.example/full.mp3",
    });
    assert.equal(full.length, 1);
    assert.equal(full[0].src, "https://cdn.example/full.mp3");
    assert.equal(filenameForTrack("Night Drive", "https://cdn.example/a.mp3", "audio/mpeg"), "Night Drive.mp3");
  });

  it("picks an https iTunes preview and ignores expired or non-https rows", () => {
    const url = pickItunesPreview(
      {
        results: [
          { trackId: 1, trackName: "Other", artistName: "Someone", previewUrl: "http://insecure.example/a.m4a" },
          {
            trackId: 2,
            trackName: "Helium",
            artistName: "Sia",
            previewUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/helium.m4a",
          },
        ],
      },
      "Sia",
      "Helium",
    );
    assert.equal(url, "https://audio-ssl.itunes.apple.com/itunes-assets/helium.m4a");
    assert.equal(isPreviewAudioUrl(url), true);
  });

  it("drops a dead full file instead of keeping it as a download", () => {
    const [track] = parseJamendoTracks({
      results: [
        {
          id: "9",
          name: "Gone",
          artist_name: "Band",
          audio: "https://cdn.example/dead.mp3",
          audiodownload: "https://cdn.example/dead.mp3",
          audiodownload_allowed: true,
          duration: 200,
        },
      ],
    });
    const next = applyFallbackPreview(track, "https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a", [
      "https://cdn.example/dead.mp3",
    ]);
    assert.equal(next.downloadUrl, null);
    assert.equal(next.downloadable, false);
    assert.equal(next.playback, "preview");
    assert.equal(fullTrackUrl(next), null);
    assert.equal(canDownload(next), false);
  });

  it("accepts catalog ids and rejects raw remote urls", () => {
    assert.deepEqual(parseTrackKey("audius:ez7Az"), { provider: "audius", providerTrackId: "ez7Az" });
    assert.deepEqual(parseTrackKey("audius%3Aez7Az"), { provider: "audius", providerTrackId: "ez7Az" });
    assert.equal(parseTrackKey("https://evil.example/file.mp3"), null);
    assert.deepEqual(parseTrackKey("jamendo:78"), { provider: "jamendo", providerTrackId: "78" });
    assert.equal(parseTrackKey("/download?url=https://some-random-site.com/file.mp3"), null);
    assert.equal(isPreviewAudioUrl("https://audio-ssl.itunes.apple.com/preview.m4a"), true);
    assert.equal(isPreviewAudioUrl(audiusDownloadUrl("ez7Az")), false);
    assert.equal(filenameForTrack("MONTAGEM KALI (Super Slowed)", "https://cdn.example/a", "audio/mpeg"), "MONTAGEM KALI (Super Slowed).mp3");
    assert.equal(filenameForTrack("bad/name", "https://cdn.example/a.wav", "audio/wav").includes("/"), false);
  });
});
