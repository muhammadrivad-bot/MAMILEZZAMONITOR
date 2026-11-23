#!/bin/bash
# Jalankan dashboard Mami Lezza + update berkala, lalu buka browser (macOS).
cd "$(dirname "$0")" || exit 1

echo "Menjalankan Mami Lezza Dashboard di http://localhost:3000"
python3 server.py &
SERVER_PID=$!

sleep 2
open http://localhost:3000

trap "kill $SERVER_PID 2>/dev/null" EXIT
wait $SERVER_PID
