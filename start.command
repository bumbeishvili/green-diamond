#!/bin/bash
# Double-click to play: starts a local server and opens the game in your browser.
cd "$(dirname "$0")"
(sleep 1 && open "http://127.0.0.1:8765") &
python3 tools/serve.py 8765
