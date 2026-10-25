[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

# Stego Arena

Can one model find a message another model hid in a picture?

A hide-and-seek arena for image steganography, built on Pollinations. One model draws an SVG scene with a secret phrase hidden inside. The SVG is rasterized to PNG, metadata is stripped, and the image goes through a robustness gauntlet (JPEG re-encode, downscale, crop, brightness shift). A fresh vision model sees only the pixels and has to say whether anything is hidden and what it is.

**Live:** https://svirepyibambr.github.io/stego-arena/

## Why this is not just another stego tool

- **Raster-only.** The seeker never sees the SVG source, comments or metadata — only what a person could see.
- **Robustness gauntlet.** Payloads are scored after re-encoding and resizing, not on a pristine PNG.
- **Paired controls.** Every round can draw a second image with nothing hidden, so false alarms are measured, not assumed.
- **Adaptive rounds.** When a seeker misses, the hider gets the failure as feedback and re-encodes the same secret.
- **Code-judged scoring.** Exact / partial / wrong / missed, with a Levenshtein-based partial match; no LLM judging its own work.
- **Leaderboard + dataset.** Elo for hiders and seekers, per-pair win rates, JSON export of every round.

## Use

1. Open the page, paste a Pollinations key (`sk_…`) from https://enter.pollinations.ai/keys. The key stays in the tab.
2. Pick a hider model (draws the SVG) and a seeker model (must accept image input).
3. Enter a secret phrase, choose the gauntlet and the number of attempts, press **Run round**.
4. Watch the rasterized image, the seeker's JSON answer and the verdict. Export the dataset to reproduce the table.

There is no backend: all calls go from the browser to `gen.pollinations.ai` with the reader's own Pollen (BYOP).

## Notes

- The hider is asked to encode the phrase without an agreed scheme (object initials, positions, colors). A skilled hider may still use plain lettering; the gauntlet and controls keep the comparison honest.
- Image-input token pricing is provider-specific; the cost estimate is a lower bound.
- MIT.
