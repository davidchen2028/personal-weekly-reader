#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null; then
  echo '请先安装 Node.js 22 或更新版本。'
  read
  exit 1
fi
if [ ! -d node_modules ]; then npm install --cache /tmp/caixin-reader-npm-cache || exit 1; fi
if curl -fsS http://127.0.0.1:4317/api/status >/dev/null 2>&1; then
  open http://127.0.0.1:4317
  exit 0
fi
npm start &
reader_pid=$!
trap 'kill "$reader_pid" 2>/dev/null' EXIT INT TERM
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1:4317/api/status >/dev/null 2>&1; then
    open http://127.0.0.1:4317
    break
  fi
  sleep 1
done
wait "$reader_pid"
