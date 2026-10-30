#!/usr/bin/env bash
# 一键构建安卓 APK（需要本机有 JDK 17+ 和 Android SDK）
# 用法: ./build-apk.sh [debug|release]
set -euo pipefail

cd "$(dirname "$0")"

TYPE="${1:-debug}"

echo "==> 打包网页资源"
npm run build

echo "==> 同步到安卓工程"
npx cap sync android

echo "==> 编译 APK（$TYPE）"
cd android
if [ "$TYPE" = "release" ]; then
  ./gradlew assembleRelease
  OUT="app/build/outputs/apk/release/app-release-unsigned.apk"
else
  ./gradlew assembleDebug
  OUT="app/build/outputs/apk/debug/app-debug.apk"
fi

echo ""
echo "完成: android/$OUT"
