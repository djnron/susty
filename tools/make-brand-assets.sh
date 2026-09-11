#!/bin/sh
# Regenerate og.png, favicon.png and apple-touch-icon.png from tools/brand/*.svg.
#
#   sh tools/make-brand-assets.sh
#
# macOS only: it uses qlmanage (QuickLook) to rasterise, because the machine has
# no rsvg-convert/ImageMagick and the project has no dependencies to add one.
#
# qlmanage letterboxes a non-square SVG at a scale it picks itself, so og.svg is
# authored as a 1200x1200 canvas with the real 1200x630 card in the middle band.
# Rendering is then 1:1 and `sips -c 630 1200` crops exactly that band back out.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

qlmanage -t -s 1200 -o "$tmp" "$root/tools/brand/og.svg" >/dev/null 2>&1
sips -c 630 1200 "$tmp/og.svg.png" --out "$root/og.png" >/dev/null

qlmanage -t -s 512 -o "$tmp" "$root/tools/brand/icon.svg" >/dev/null 2>&1
sips -Z 180 "$tmp/icon.svg.png" --out "$root/apple-touch-icon.png" >/dev/null
sips -Z 64  "$tmp/icon.svg.png" --out "$root/favicon.png" >/dev/null

for f in og.png apple-touch-icon.png favicon.png; do
  printf '%-22s %s  %s bytes\n' "$f" \
    "$(sips -g pixelWidth -g pixelHeight "$root/$f" | awk '/pixel/{printf "%s", $2" "}')" \
    "$(wc -c < "$root/$f" | tr -d ' ')"
done
