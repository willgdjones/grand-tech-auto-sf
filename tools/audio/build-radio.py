#!/usr/bin/env python3
"""Render original, deterministic CC0 station loops. No samples or provider calls.
Requires numpy and ffmpeg; writes only the three declared MP3 assets.
"""
from pathlib import Path
import math
import subprocess
import tempfile
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'web/public/audio/radio'
RATE = 24000
OUT.mkdir(parents=True, exist_ok=True)


def render(station, bpm, seed, mood):
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    length = round(32 * beat * RATE)
    mix = np.zeros((length, 2), dtype=np.float64)

    def add(at, sound, volume, pan=0):
        indices = (round(at * RATE) + np.arange(len(sound))) % length
        angle = (pan + 1) * math.pi / 4
        np.add.at(mix[:, 0], indices, sound * volume * math.cos(angle))
        np.add.at(mix[:, 1], indices, sound * volume * math.sin(angle))

    def note(midi, duration, tone='keys'):
        t = np.arange(round(duration * RATE)) / RATE
        hz = 440 * 2 ** ((midi - 69) / 12)
        if tone == 'bass':
            signal = np.sin(2 * math.pi * hz * t) + .22 * np.sin(4 * math.pi * hz * t)
            env = np.minimum(t / .012, 1) * np.exp(-t * 3.5) * np.minimum((duration - t) / .05, 1)
        else:
            signal = np.sin(2 * math.pi * hz * t) + .28 * np.sin(4 * math.pi * hz * t) * np.exp(-t * 6)
            signal += .12 * np.sin(6 * math.pi * hz * t) * np.exp(-t * 9)
            env = np.minimum(t / .018, 1) * np.exp(-t * (1.3 if mood == 'lofi' else 2.4)) * np.minimum((duration - t) / .08, 1)
        return signal * env

    chords = [(57, 60, 64, 67), (53, 57, 60, 64), (48, 52, 55, 59), (55, 59, 62, 64)]
    for bar in range(8):
        chord = chords[bar // 2]
        start = bar * 4 * beat
        for i, key in enumerate(chord):
            add(start + i * .018, note(key, beat * 3.7), .11, (i - 1.5) / 3)
            if bar % 2 == 1:
                add(start + beat * 2.5, note(key + 12, beat * 1.3), .038, (1.5 - i) / 3)
        for step in [0, 1.5, 2.5, 3.5]:
            add(start + step * beat, note(chord[0] - 12, beat * .7, 'bass'), .30)
        for step, degree in enumerate([2, 3, 1, 2, 0, 1, 3, 2]):
            if mood == 'lofi' and step % 3 == 0:
                continue
            at = start + (step * .5 + (.06 if step % 2 and mood == 'lofi' else 0)) * beat
            key = chord[degree] + (24 if mood == 'bart' else 12)
            add(at, note(key, beat * .75), .057 if mood == 'lofi' else .078, math.sin(step) * .5)
        for step in [0, 2, 2.75] if mood != 'bart' else [0, 1, 2, 3]:
            t = np.arange(round(.30 * RATE)) / RATE
            kick = np.sin(2 * math.pi * (48 * t + 11 * (1 - np.exp(-t * 25)))) * np.exp(-t * 15)
            add(start + step * beat, kick, .36)
        for step in [1, 3]:
            t = np.arange(round(.17 * RATE)) / RATE
            noise = rng.uniform(-1, 1, len(t))
            snare = (noise - np.roll(noise, 1)) * .3 + np.sin(2 * math.pi * 180 * t) * .18
            add(start + step * beat, snare * np.exp(-t * 24) * np.minimum(t / .002, 1), .22, .12)
        for step in range(8):
            t = np.arange(round(.07 * RATE)) / RATE
            noise = rng.uniform(-1, 1, len(t)); hat = (noise - np.roll(noise, 1)) * np.exp(-t * 65)
            add(start + (step / 2 + (.06 if step % 2 and mood == 'lofi' else 0)) * beat, hat, .035 if step % 2 else .05, -.35)
    # Circular delay preserves tails at the loop seam. Soft limiting leaves headroom.
    mix += np.roll(mix, round(beat * .75 * RATE), axis=0)[:, ::-1] * .12
    mix = np.tanh(mix * 1.2)
    mix *= .72 / max(1e-6, np.max(np.abs(mix)))
    pcm = (mix * 32767).astype('<i2')
    with tempfile.TemporaryDirectory(prefix='gtasf-radio-') as temporary:
        source = Path(temporary) / 'loop.wav'
        with wave.open(str(source), 'wb') as target:
            target.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
            target.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source), '-c:a', 'libmp3lame', '-b:a', '64k', '-map_metadata', '-1', str(OUT / f'{station}.mp3')], check=True)
    print(f'{station}: {length / RATE:.3f}s, {(OUT / (station + ".mp3")).stat().st_size} bytes, peak -2.85 dBFS')


render('kvc-radio', 112, 10, 'kvc')
render('lofi-hayes-valley', 76, 22, 'lofi')
render('bart-delays-fm', 120, 39, 'bart')
