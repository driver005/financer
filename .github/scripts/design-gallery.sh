#!/usr/bin/env bash
# Builds a browsable gallery of every screen (light and dark side by side) and reports how much each
# screen changed since the previous run, so a design change that was not meant shows up.
#   design-gallery.sh <new-screens-dir> <previous-screens-dir> <gallery.md>
# The previous directory may be empty or missing (first run): nothing is compared then.
set -uo pipefail
new="$1"; prev="$2"; out="$3"
changed_over="${CHANGED_OVER:-12}"   # percent of pixels, above this a screen is flagged

# Percent of pixels that differ between two pictures (status bar cut off: it shows the clock).
pct() { # pct <new> <old>
  local a="$1" b="$2" total diff
  [ -f "$b" ] || { echo "new"; return; }
  total=$(convert "$a" -chop 0x30 -format '%[fx:w*h]' info: 2>/dev/null) || { echo "?"; return; }
  diff=$(compare -metric AE -fuzz 8% <(convert "$a" -chop 0x30 png:-) <(convert "$b" -resize "$(identify -format '%wx%h!' "$a")" -chop 0x30 png:-) null: 2>&1 | grep -oE '^[0-9]+' | head -1)
  [ -n "$diff" ] || { echo "?"; return; }
  awk -v d="$diff" -v t="$total" 'BEGIN { printf "%.1f", 100 * d / t }'
}

screens=$(ls "$new" 2>/dev/null | sed -n 's/^light-\(.*\)\.png$/\1/p' | sort)
{
  echo "# Screens of the app"
  echo
  echo "Every screen on an Android emulator, light and dark, from the build of the latest run."
  echo "The table says how much of each picture changed since the run before; a screen above ${changed_over}% is marked **check**, because that is usually a layout change, not a text change."
  echo
  echo "| Screen | Light changed | Dark changed |"
  echo "| --- | ---: | ---: |"
  flagged=0
  for s in $screens; do
    l=$(pct "$new/light-$s.png" "$prev/light-$s.png"); d=$(pct "$new/dark-$s.png" "$prev/dark-$s.png")
    mark_l=""; mark_d=""
    case "$l" in new|"?") ;; *) awk -v v="$l" -v t="$changed_over" 'BEGIN{exit !(v>t)}' && { mark_l=" **check**"; flagged=$((flagged+1)); } ;; esac
    case "$d" in new|"?") ;; *) awk -v v="$d" -v t="$changed_over" 'BEGIN{exit !(v>t)}' && { mark_d=" **check**"; flagged=$((flagged+1)); } ;; esac
    suffix_l=$([ "$l" = new ] || [ "$l" = "?" ] && echo "" || echo "%"); suffix_d=$([ "$d" = new ] || [ "$d" = "?" ] && echo "" || echo "%")
    echo "| $s | ${l}${suffix_l}${mark_l} | ${d}${suffix_d}${mark_d} |"
  done
  echo
  echo "<table>"
  for s in $screens; do
    echo "<tr><td align=\"center\"><b>$s</b><br><img src=\"light-$s.png\" width=\"260\"></td><td align=\"center\"><b>$s (dark)</b><br><img src=\"dark-$s.png\" width=\"260\"></td></tr>"
  done
  echo "</table>"
} > "$out"
echo "gallery written to $out ($(echo "$screens" | wc -w) screens)"
