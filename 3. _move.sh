#!/usr/bin/env bash
set -euo pipefail

# Root that contains your lessons (relative to repo root)
BASE="level/N5"

# Set DRY_RUN=1 to preview without moving
DRY_RUN="${DRY_RUN:-0}"

move_one() {
  src="$1"
  dest="$2"
  destdir="$(dirname "$dest")"

  if [ ! -f "$src" ]; then
    echo "Skip (not found): $src"
    return 0
  fi

  mkdir -p "$destdir"

  if [ "$DRY_RUN" = "1" ]; then
    printf '[DRY] mv -f "%s" "%s"\n' "$src" "$dest"
  else
    mv -f "$src" "$dest"
    printf 'Moved: %s -> %s\n' "$src" "$dest"
  fi
}

# Guard
if [ ! -d "$BASE" ]; then
  echo "Error: $BASE not found. Run from the repo root."
  exit 1
fi

# Lessons 01..25
for i in $(seq -w 01 25); do
  src="$BASE/Vocab-Lesson-$i.csv"
  dest="$BASE/Lesson-$i/Vocabulary/Vocab-Lesson-$i.csv"
  move_one "$src" "$dest"
done

# Specials from your screenshot
move_one "$BASE/Vocab-Numbers.csv" "$BASE/Lesson-Numbers/Vocabulary/Vocab-Numbers.csv"
move_one "$BASE/Vocab-Phrases.csv" "$BASE/Lesson-Phrases/Vocabulary/Vocab-Phrases.csv"
move_one "$BASE/Vocab-Time.csv"   "$BASE/Lesson-Time/Vocabulary/Vocab-Time.csv"

echo "Done."
