#!/bin/sh
# يعيد بناء public/demo-api.js بعد أي تعديل في api/ أو lib/
cd "$(dirname "$0")/.." && npx --yes esbuild@0.24.0 demo/entry.js --bundle --format=iife --global-name=DEMO_API \
  --alias:node:crypto=./demo/crypto-shim.js --define:process.env={} --minify --outfile=public/demo-api.js
