
#!/bin/sh
set -eu

DEST="$HOME/.pi/agent/extensions"
NAME="machine-access.ts"
SRC="https://raw.githubusercontent.com/me-imfhd/pi-machine-access/main/machine-access.ts"

if [ ! -d "$DEST" ]; then
  if ! command -v pi >/dev/null 2>&1; then
    echo "pi not installed"
    exit 1
  fi
  echo "extensions folder not found: $DEST"
  exit 1
fi
if [ -f "$DEST/$NAME" ]; then
  echo "$NAME already exists"
  exit 0
fi
curl -fsSL "$SRC" -o "$DEST/$NAME"
echo "wrote $DEST/$NAME"