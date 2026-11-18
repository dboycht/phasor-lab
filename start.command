#!/bin/bash
# Phasor Lab - macOS launcher.
#
# Double-click this file in Finder (or run ./start.command) to build the app if
# it is not built yet and serve it at http://localhost:4173/.
# ./start.command build forces a rebuild after you change the code.
#
# The Windows counterpart is start.bat; the two deliberately do the same job.
# Plain /bin/bash on purpose: a .command people double-click has to run on any
# Mac, and /bin/bash (3.2) is the one guarantee. Keep the syntax 3.2-compatible.

set -u
cd "$(dirname "$0")" || exit 1

PORT=4173
URL="http://localhost:${PORT}/"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found."
  echo "Please install the LTS build from https://nodejs.org and run this file again."
  read -r -p "Press Return to close this window..." _dummy
  exit 1
fi

# If something already answers on 4173 - another launcher window, or a dev
# server you left running - do not fight it for the port: just open it.
if curl -fsS --max-time 2 -o /dev/null "$URL" 2>/dev/null; then
  echo "Phasor Lab is already serving on $URL - opening it."
  echo "(No second copy was started. Close that window to stop the server.)"
  open "$URL"
  exit 0
fi

REBUILD=0
if [ "${1:-}" = "build" ]; then REBUILD=1; fi
if [ ! -d node_modules ]; then REBUILD=1; fi
if [ ! -f dist/index.html ]; then REBUILD=1; fi

if [ "$REBUILD" -eq 1 ]; then
  echo "[1/2] Installing dependencies, this needs the network once..."
  if ! npm install; then
    echo
    echo "Something went wrong - the messages above should say what."
    read -r -p "Press Return to close this window..." _dummy
    exit 1
  fi
  echo "[2/2] Building..."
  if ! npm run build; then
    echo
    echo "Something went wrong - the messages above should say what."
    read -r -p "Press Return to close this window..." _dummy
    exit 1
  fi
fi

echo
echo "Phasor Lab is starting at $URL"
echo "Keep this window open while you use it. Press Ctrl+C here to stop."
echo

npx vite preview --port "$PORT" --strictPort &
PREVIEW_PID=$!
trap 'kill "$PREVIEW_PID" 2>/dev/null; exit 0' INT TERM

# Open the browser only once the server really answers, so the first page load
# does not race the preview server.
i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS --max-time 1 -o /dev/null "$URL" 2>/dev/null; then break; fi
  i=$((i + 1))
  sleep 0.25
done
open "$URL"

wait "$PREVIEW_PID"
