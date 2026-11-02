# Wee Sports sound credits

The game serves these files locally. There are no runtime requests to Freesound,
OpenGameArt, an audio CDN, or an AI service. Sources and licenses were checked on
2026-11-02. Imported audio came from the publicly available high-quality previews
or the author's downloadable archive, rather than the original uncompressed
Freesound downloads, which require an account.

| Local files                               | Source and author                                                                                                                                                                   | License                                                       | Changes                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tennis/hit.wav`, `tennis/serve.wav`      | [Tennis-Ball-Hit](https://freesound.org/people/kletton97/sounds/710041/) by **kletton97**                                                                                           | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Extracted the racket impact at approximately 0.4–0.75 seconds, removed leading quiet audio, mixed to mono, resampled, normalized, and faded the tail. Serve uses the same impact.                                                                                                          |
| `tennis/bounce.wav`                       | [15 Tennis ball - Ground.wav](https://freesound.org/people/14GPanskaValaChristoffer/sounds/420173/) by **14GPanskaValaChristoffer**                                                 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)     | Extracted one ground bounce at approximately 1.4–1.8 seconds, removed leading quiet audio, mixed to mono, resampled, normalized, and faded the tail.                                                                                                                                       |
| `bowling/pin.wav`                         | [bowling pins stereo.aif](https://freesound.org/people/Bruce%20Burbank/sounds/151204/) by **Bruce Burbank**                                                                         | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Extracted one impact at approximately 0.15–0.65 seconds, removed leading quiet audio, mixed to mono, resampled, normalized, and faded the tail. The author recorded two bowling pins being knocked together.                                                                               |
| `bowling/release.wav`, `bowling/roll.wav` | [Bowling Ball Rolling](https://opengameart.org/content/bowling-ball-rolling) by **qubodup** ([source archive](https://opengameart.org/sites/default/files/qubodup-bowling-roll.7z)) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | The release uses the initial 0.3-second impact; the rolling bed uses 0.3–4.05 seconds with an 80 ms loop crossfade, mono conversion, resampling and normalization. This is designed foley made from a marble recording and possibly a wooden-door knock, not an on-lane bowling recording. |

All remaining WAV files are original, procedurally synthesized notification
chimes created for this project using `scripts/generate-sounds.py`. They are
neither recordings of athletes/crowds nor imitations of an existing game's audio.
They contain no third-party samples or melodies. Their source code is included
so the team can regenerate and modify them.

Keep this credit file with distributions of the sound pack. The attribution for
the tennis bounce and the link to its CC BY 4.0 license must remain available.
The named authors do not endorse Wee Sports.
