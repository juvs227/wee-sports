#!/usr/bin/env python3
"""Rebuild original notification cues without playing audio or using dependencies.

Optional --source-dir imports the licensed source files listed in docs/sound.md.
That option uses ffmpeg only for decoding; it never downloads or plays anything.
"""
import argparse
import array
import math
from pathlib import Path
import struct
import subprocess
import wave

RATE = 24000
ROOT = Path(__file__).resolve().parents[1] / 'public' / 'sounds'


def save(path, samples, peak=0.72):
    path.parent.mkdir(parents=True, exist_ok=True)
    maximum = max(abs(value) for value in samples) or 1
    scale = peak / maximum
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, RATE, len(samples), 'NONE', 'not compressed'))
        output.writeframes(b''.join(struct.pack('<h', round(value * scale * 32767))
                                   for value in samples))


def chime(notes, spacing=0.12, decay=0.25):
    length = (len(notes) - 1) * spacing + decay
    result = [0.0] * round(length * RATE)
    for index, frequency in enumerate(notes):
        start = round(index * spacing * RATE)
        for sample in range(round(decay * RATE)):
            t = sample / RATE
            # A soft attack and finite tail avoid abrupt waveform discontinuities.
            attack = min(1, t / 0.008)
            tail = max(0, 1 - t / decay) ** 2
            value = math.sin(2 * math.pi * frequency * t)
            value += 0.18 * math.sin(2 * math.pi * frequency * 2 * t)
            result[start + sample] += value * attack * tail
    return result


def generate_cues():
    cues = {
        'tennis/point.wav': ([523.25, 659.25], 0.10, 0.2),
        'tennis/game.wav': ([523.25, 659.25, 783.99], 0.12, 0.25),
        'tennis/set.wav': ([392, 523.25, 659.25, 783.99], 0.13, 0.3),
        'tennis/match.wav': ([523.25, 659.25, 783.99, 1046.5], 0.16, 0.38),
        'bowling/gutter.wav': ([293.66, 220], 0.12, 0.2),
        'bowling/strike.wav': ([392, 523.25, 659.25, 1046.5], 0.10, 0.32),
        'bowling/spare.wav': ([440, 554.37, 739.99], 0.12, 0.28),
        'bowling/result.wav': ([392, 523.25], 0.10, 0.22),
        'bowling/match.wav': ([392, 523.25, 659.25, 783.99], 0.16, 0.38),
    }
    for name, (notes, spacing, decay) in cues.items():
        save(ROOT / name, chime(notes, spacing, decay))


def decode(path):
    raw = subprocess.check_output([
        'ffmpeg', '-v', 'error', '-i', str(path), '-f', 's16le',
        '-ac', '1', '-ar', str(RATE), 'pipe:1',
    ])
    return [value / 32768 for value in array.array('h', raw)]


def impact(samples, start, end):
    segment = samples[round(start * RATE):round(end * RATE)]
    threshold = max(abs(value) for value in segment) * 0.07
    first = next(i for i, value in enumerate(segment) if abs(value) >= threshold)
    segment = segment[max(0, first - 24):]
    # Retain a millisecond before the attack; remove idle recording latency.
    for i in range(min(12, len(segment))):
        segment[i] *= i / 12
    fade = min(round(0.025 * RATE), len(segment))
    for i in range(fade):
        segment[-fade + i] *= 1 - i / fade
    return segment


def import_recordings(source):
    hit = impact(decode(source / 'wee-tennis-hit.mp3'), 0.4, 0.75)
    save(ROOT / 'tennis/hit.wav', hit)
    save(ROOT / 'tennis/serve.wav', hit)
    save(ROOT / 'tennis/bounce.wav', impact(decode(source / 'wee-tennis-bounce.mp3'), 1.4, 1.8))
    save(ROOT / 'bowling/pin.wav', impact(decode(source / 'wee-pin.mp3'), 0.15, 0.65))
    rolling = decode(source / 'wee-bowling-source/qubodup-bowling-roll/qubodup-bowling_roll-nofadeout.ogg')
    save(ROOT / 'bowling/release.wav', impact(rolling, 0, 0.3))
    bed = rolling[round(0.3 * RATE):round(4.05 * RATE)]
    # Overlap the tail and head so a looping source has no hard seam.
    crossfade = round(0.08 * RATE)
    middle = bed[crossfade:-crossfade]
    seam = [bed[-crossfade + i] * (1 - i / crossfade) + bed[i] * i / crossfade
            for i in range(crossfade)]
    save(ROOT / 'bowling/roll.wav', middle + seam, peak=0.62)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path)
    args = parser.parse_args()
    generate_cues()
    if args.source_dir:
        import_recordings(args.source_dir)
    print('Wrote local WAV files; no audio was played.')
