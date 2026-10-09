#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export PATH="$JAVA_HOME/bin:$PATH"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
mkdir -p build/classes build/dex dist
"$BT/aapt2" compile --dir app/src/main/res -o build/resources.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest app/src/main/AndroidManifest.xml -A app/src/main/assets build/resources.zip
javac -source 8 -target 8 -encoding UTF-8 -classpath "$JAR" -d build/classes app/src/main/java/local/caixin/reader/*.java
jar cf build/classes.jar -C build/classes .
"$BT/d8" --lib "$JAR" --min-api 26 --output build/dex build/classes.jar
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q -u ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
KEYDIR="$HOME/Library/Application Support/CaixinReader/android-signing"
mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
if [ ! -f "$KEYDIR/release.jks" ]; then
 openssl rand -hex 24 > "$KEYDIR/password"; chmod 600 "$KEYDIR/password"
 keytool -genkeypair -keystore "$KEYDIR/release.jks" -storepass:file "$KEYDIR/password" -keypass:file "$KEYDIR/password" -alias reader -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Caixin Personal Reader, O=Personal Local App, C=CN'
 chmod 600 "$KEYDIR/release.jks"
fi
"$BT/apksigner" sign --ks "$KEYDIR/release.jks" --ks-key-alias reader --ks-pass "file:$KEYDIR/password" --out dist/weekly-fold-reader-2.0.1.apk build/aligned.apk
"$BT/apksigner" verify --verbose dist/weekly-fold-reader-2.0.1.apk
shasum -a 256 dist/weekly-fold-reader-2.0.1.apk > dist/SHA256SUMS
