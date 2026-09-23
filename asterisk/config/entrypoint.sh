#!/bin/bash
# Render Asterisk config from environment, build the WebRTC peer set and
# generate a DTLS certificate, then start Asterisk in the foreground.
set -euo pipefail

SRC=/opt/phone
CONF=/etc/asterisk
CERTDIR=/var/lib/asterisk/phone-certs

: "${HTTP_PORT:=8089}"
: "${RTP_START:=10000}"
: "${RTP_END:=10100}"
: "${STUN_SERVER:=stun.l.google.com:19302}"
: "${EXTERNAL_IP:=$(curl -s --max-time 5 ifconfig.me || echo '')}"
: "${LOCAL_NET:=172.16.0.0/12}"
: "${TRUNK_HOST:=43.112.27.24}"
: "${TRUNK_PORT:=5060}"
: "${OUTBOUND_PREFIX:=}"
: "${PEER_SECRET:=}"
: "${PEER_START:=1001}"
: "${PEER_END:=1020}"

if [ -z "$PEER_SECRET" ]; then
    echo "[entrypoint] ERROR: PEER_SECRET must be set in the environment (.env)." >&2
    exit 1
fi
if [ -z "$EXTERNAL_IP" ]; then
    echo "[entrypoint] ERROR: EXTERNAL_IP could not be detected; set it explicitly." >&2
    exit 1
fi

render() {
    # $1 = source file, $2 = destination file
    sed \
        -e "s|__HTTP_PORT__|${HTTP_PORT}|g" \
        -e "s|__RTP_START__|${RTP_START}|g" \
        -e "s|__RTP_END__|${RTP_END}|g" \
        -e "s|__STUN_SERVER__|${STUN_SERVER}|g" \
        -e "s|__EXTERNAL_IP__|${EXTERNAL_IP}|g" \
        -e "s|__LOCAL_NET__|${LOCAL_NET}|g" \
        -e "s|__TRUNK_HOST__|${TRUNK_HOST}|g" \
        -e "s|__TRUNK_PORT__|${TRUNK_PORT}|g" \
        -e "s|__OUTBOUND_PREFIX__|${OUTBOUND_PREFIX}|g" \
        "$1" > "$2"
}

render "$SRC/modules.conf"     "$CONF/modules.conf"
render "$SRC/http.conf"       "$CONF/http.conf"
render "$SRC/rtp.conf"        "$CONF/rtp.conf"
render "$SRC/extensions.conf" "$CONF/extensions.conf"

# pjsip.conf = transport/trunk head + one block per generated peer.
render "$SRC/pjsip.conf.head" "$CONF/pjsip.conf"
for n in $(seq "$PEER_START" "$PEER_END"); do
    ext=$(printf '%04d' "$n")
    sed -e "s|__EXT__|${ext}|g" -e "s|__PEER_SECRET__|${PEER_SECRET}|g" \
        "$SRC/pjsip.peer.template" >> "$CONF/pjsip.conf"
done
echo "[entrypoint] Generated peers ${PEER_START}-${PEER_END}, trunk=${TRUNK_HOST}:${TRUNK_PORT}, prefix='${OUTBOUND_PREFIX}'"

# DTLS certificate for SRTP (media). Created once and reused.
mkdir -p "$CERTDIR"
if [ ! -f "$CERTDIR/cert.pem" ] || [ ! -f "$CERTDIR/key.pem" ]; then
    echo "[entrypoint] Generating DTLS certificate..."
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$CERTDIR/key.pem" -out "$CERTDIR/cert.pem" -days 3650 \
        -subj "/CN=${EXTERNAL_IP}" >/dev/null 2>&1
fi
chmod 644 "$CERTDIR/cert.pem"
chmod 600 "$CERTDIR/key.pem"

echo "[entrypoint] Starting Asterisk (http ${HTTP_PORT}, rtp ${RTP_START}-${RTP_END})"
exec asterisk -f -U root -vvvg
