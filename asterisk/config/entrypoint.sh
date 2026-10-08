#!/bin/bash
# Render Asterisk config from environment, build the WebRTC peer set and
# generate a DTLS certificate, then start Asterisk in the foreground.
set -euo pipefail

SRC=/opt/phone
CONF=/etc/asterisk

: "${HTTP_PORT:=8089}"
: "${RTP_START:=10000}"
: "${RTP_END:=10800}"
: "${STUN_SERVER:=stun.l.google.com:19302}"
: "${EXTERNAL_IP:=$(curl -s --max-time 5 ifconfig.me || echo '')}"
: "${LOCAL_NET:=172.16.0.0/12}"
: "${TRUNK_HOST:=43.112.27.24}"
: "${TRUNK_PORT:=5060}"
: "${OUTBOUND_PREFIX:=}"
# Optional second IP trunk (LAN #2). Enabled only by setting TRUNK2_HOST.
: "${TRUNK2_HOST:=}"
: "${TRUNK2_PORT:=5060}"
# Route rule: numbers whose OUTBOUND-prefixed destination starts with this go to
# trunk-lan2; empty = everything stays on trunk-vos3000 (backward compatible).
: "${TRUNK2_PREFIX:=}"
: "${TRUNK2_OUTBOUND_PREFIX:=}"
: "${PEER_SECRET:=}"
: "${PEER_START:=1001}"
: "${PEER_END:=1200}"
# Where MixMonitor writes call recordings (shared volume, see compose).
: "${RECORD_DIR:=/recordings}"

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
        -e "s|__TRUNK_HOST__|${TRUNK_HOST}|g" \
        -e "s|__TRUNK_PORT__|${TRUNK_PORT}|g" \
        -e "s|__TRUNK2_HOST__|${TRUNK2_HOST}|g" \
        -e "s|__TRUNK2_PORT__|${TRUNK2_PORT}|g" \
        -e "s|__TRUNK2_PREFIX__|${TRUNK2_PREFIX}|g" \
        -e "s|__TRUNK2_OUTBOUND_PREFIX__|${TRUNK2_OUTBOUND_PREFIX}|g" \
        -e "s|__RECORD_DIR__|${RECORD_DIR}|g" \
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
    sed -e "s|__EXT__|${ext}|g" \
        -e "s|__PEER_SECRET__|${PEER_SECRET}|g" \
        -e "s|__EXTERNAL_IP__|${EXTERNAL_IP}|g" \
        "$SRC/pjsip.peer.template" >> "$CONF/pjsip.conf"
done
echo "[entrypoint] Generated peers ${PEER_START}-${PEER_END}, trunk=${TRUNK_HOST}:${TRUNK_PORT}, prefix='${OUTBOUND_PREFIX}'"
# Optional second IP trunk (LAN #2): append its blocks only when TRUNK2_HOST is set.
if [ -n "$TRUNK2_HOST" ]; then
    render "$SRC/pjsip.trunk2.template" "$CONF/pjsip.trunk2.conf"
    cat "$CONF/pjsip.trunk2.conf" >> "$CONF/pjsip.conf"
    echo "[entrypoint] Enabled second trunk trunk-lan2=${TRUNK2_HOST}:${TRUNK2_PORT}, route-prefix='${TRUNK2_PREFIX}', outbound-prefix='${TRUNK2_OUTBOUND_PREFIX}'"
fi

# Ensure the recording volume exists and is writable by Asterisk.
mkdir -p "$RECORD_DIR"
chmod 0777 "$RECORD_DIR"

echo "[entrypoint] Starting Asterisk (http ${HTTP_PORT}, rtp ${RTP_START}-${RTP_END}, recordings=${RECORD_DIR})"
exec asterisk -f -U root -vvvg
