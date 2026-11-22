#!/usr/bin/env bash
#
# Convert a screen recording into the 720×405 marketing GIF used by README / docs.
#
#   bash scripts/recording-to-gif.sh <input.mp4|input.mov> [output.gif]
#
# Default output: docs/assets/click-through-mode.gif
# Requires: ffmpeg on PATH.
#
# Record the source clip first (see promo/asset-guide.md → "Re-recording the
# click-through demo"), then run this. Keep the clip short (8–12s): a 15fps
# 720px GIF costs roughly 1 MB per second.
set -euo pipefail

in="${1:?usage: recording-to-gif.sh <input-video> [output.gif]}"
out="${2:-docs/assets/click-through-mode.gif}"
fps=15
width=720

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# GIF is limited to 256 colours, so derive a palette from the clip first.
ffmpeg -v error -i "$in" \
  -vf "fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff" \
  -y "$tmp/palette.png"

# Re-encode against that palette; bayer dithering keeps ink edges from banding.
ffmpeg -v error -i "$in" -i "$tmp/palette.png" \
  -lavfi "fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 -y "$out"

echo "wrote $out ($(du -h "$out" | cut -f1))"
