#!/usr/bin/env bash
# Renders the three submission files to PDF.
#
# Markdown is the wrong upload format for this submission: the screenshots are
# relative links, so uploading the .md file alone delivers three broken images
# and the evidence that the tool actually runs is exactly what goes missing.
#
# pandoc embeds every image as a base64 data URI, so the intermediate HTML is a
# single self-contained file, and Chrome prints it. Nothing is fetched at print
# time, which is why this works with no network and no missing assets.
#
# Run: npm run build:pdf

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/submission/pdf"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME"; exit 1; }
command -v pandoc >/dev/null || { echo "pandoc not installed"; exit 1; }

mkdir -p "$OUT"

CSS="$OUT/.print.css"
cat > "$CSS" <<'EOF'
body {
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: #111;
  max-width: none;
  margin: 0;
}
h1 { font-size: 20pt; margin: 0 0 4pt; }
h2 { font-size: 14pt; margin: 20pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 3pt; }
h3 { font-size: 11.5pt; margin: 14pt 0 4pt; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; }
th, td { border: 1px solid #ccc; padding: 5pt 7pt; text-align: left; vertical-align: top; }
th { background: #f4f4f4; }
code { font-size: 9pt; background: #f4f4f4; padding: 1pt 3pt; border-radius: 2pt; }
pre { background: #f7f7f7; padding: 8pt; border-radius: 3pt; overflow-x: auto; }
pre code { background: none; padding: 0; }
img {
  max-width: 100%;
  /* Capped so a tall full-page screenshot fits on the same printed page as the
     heading that introduces it. Without this the heading is stranded alone on
     a near-empty page while the image starts the next one. */
  max-height: 20.5cm;
  object-fit: contain;
  border: 1px solid #ddd;
  border-radius: 3pt;
  margin: 6pt 0;
  display: block;
}
blockquote {
  border-left: 3px solid #bbb;
  margin: 8pt 0;
  padding: 2pt 0 2pt 10pt;
  color: #444;
}
/* Keep a heading with the text under it, and never split a table row. */
h1, h2, h3 { break-after: avoid; }
table, img, pre { break-inside: avoid; }
tr { break-inside: avoid; }
EOF

# --embed-resources is the current flag; --self-contained is the old name.
if pandoc --help 2>&1 | grep -q -- '--embed-resources'; then
  EMBED="--embed-resources"
else
  EMBED="--self-contained"
fi

for md in submission/1-tool.md submission/2-failure-mode-map.md submission/3-tradeoffs-table.md; do
  name="$(basename "$md" .md)"
  html="$OUT/.$name.html"

  # --resource-path lets pandoc resolve ../docs/screenshots/... from repo root.
  pandoc "$md" \
    --standalone $EMBED \
    --css "$CSS" \
    --resource-path="$ROOT:$ROOT/submission" \
    --metadata title="" \
    -o "$html"

  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$OUT/$name.pdf" "file://$html" 2>/dev/null

  rm -f "$html"
  echo "wrote submission/pdf/$name.pdf"
done

rm -f "$CSS"
