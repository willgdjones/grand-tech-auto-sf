# City radio

The `radio` flag gates `createRadio` in `web/src/audio/radio.ts`. Controls live in
Game options: station, Play/Pause, mute and volume. Main reads its state for the
HUD station name and DJ ticker. Copy comes directly from
`shared/content/radio.ts`: KVC Radio, Lo-fi Hayes Valley and BART Delays FM.
The ticker uses original fictional DJ scripts; no voice service is configured.

The player must press Play. Startup creates no media request, and a saved station
does not autoplay on reload. Station, volume and mute preferences are stored
locally where storage is available. Hidden tabs pause the media and ticker;
returning resumes only previously started playback. A failed media request or
browser playback rejection leaves an explicit retry control. Disposal pauses,
unloads and removes the audio player and visibility listener.

## Original CC0 loops

All three instrumental loops are original synthesized compositions, with no
third-party samples, voices or lyrics. The source is
`tools/audio/build-radio.py`; the CC0 dedication is shipped at
`web/public/audio/radio/LICENSE.txt`. This dedication covers these loops and
their synthesis source, not unrelated assets or station scripts.

| Station | Track | Tempo | Loop | MP3 bytes |
| --- | --- | ---: | ---: | ---: |
| KVC Radio | Seed Round Shuffle | 112 BPM | 17.143 s | 137,901 |
| Lo-fi Hayes Valley | Soft Launch Afternoon | 76 BPM | 25.263 s | 202,797 |
| BART Delays FM | Next Train in Two | 120 BPM | 16.000 s | 128,685 |

The arrangement uses synthesized keys, bass, drums and a circular delay so tails
carry across the seam. The mixes have 2.85 dB of peak headroom before encoding.
Lo-fi uses a slower swung rhythm; BART uses higher bell-like keys and a regular
platform beat. All 469,383 encoded bytes are lazy media assets. Only the selected
station loads on first Play. Each is far below the individual asset cap.

Rebuild with `nice -n 10 python3 tools/audio/build-radio.py` (NumPy and FFmpeg with
libmp3lame required). Temporary PCM files are removed after encoding; public files
contain only the three MP3s and their licence.

## Verification

`node tools/radio-smoke.mjs` uses the real running local game, native media
decoding and actual Play clicks. It checks lazy requests, all three stations,
volume/mute, ticker, hidden-tab pause/resume, saved preferences without autoplay
and phone bounds. It does not claim an auditory/device or production gate.
Its report and screenshots go to `artifacts/radio/game/`.

Local acceptance on 2026-10-03 combines two recorded scopes:

- The real game in `artifacts/founder-path/2026-10-03T0934/` passed actual
  Play/Pause, station switching, mute reflected on the HUD, and the reviewed
  390-pixel Game options layout. That broader journey later failed during a
  taxi ride after losing its native server connection; it is not a passed
  whole-game or deployment gate.
- `node tools/radio-media-smoke.mjs` passed at 09:59 UTC using the actual radio
  and HUD modules, native media and original assets in an explicit small
  component fixture. `artifacts/radio/media/report.json` records all three
  playing decoders, a natural loop wrap, real-time DJ change, station/HUD
  changes, keyboard volume, mute, actual hidden-tab pause and return, persisted
  settings without reload autoplay, disposal and zero console errors. Its
  desktop and 390-pixel images were reviewed.

Both scripts use an owned temporary Chromium profile and the documented
`connectOverCDP({noDefaults:true})` option. This prevents Playwright from forcing
every page to stay focused. Real tab selection then drives visibility; no
document visibility, media state or clock is replaced. Earlier failed harness
reports are retained beside the passing media report. Source strict checks,
the common game bundle and MP3 decode checks also passed. This evidence closes
gtasf-8kbq.2; auditory, physical-device and later production checks stay separate.
