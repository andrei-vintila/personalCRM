#!/bin/bash
# Creates a self-signed "PRM Local Signing" code-signing certificate in the login keychain.
# install.sh signs with it, so the app's identity stays the same across rebuilds and
# macOS keeps its Full Disk Access and Keychain permissions. Only trusted on this Mac.
set -euo pipefail
NAME="PRM Local Signing"
if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "\"$NAME\" already exists."
  exit 0
fi
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
umask 077
cat > "$dir/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$dir/cert.cnf" -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
pass=$(openssl rand -hex 16)
# SHA1/3DES: the PKCS#12 encryption `security import` accepts.
openssl pkcs12 -export -inkey "$dir/key.pem" -in "$dir/cert.pem" -name "$NAME" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -passout "pass:$pass" -out "$dir/prm.p12"
security import "$dir/prm.p12" -k ~/Library/Keychains/login.keychain-db -P "$pass" -T /usr/bin/codesign
echo "Created \"$NAME\". Run ./install.sh to sign and install PRM with it."
