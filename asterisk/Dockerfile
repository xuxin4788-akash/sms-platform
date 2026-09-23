# WebRTC <-> VOS3000 gateway for the SMS platform softphone.
#
# Base image history (do not regress these):
#  - Debian bookworm (12) / trixie (13) do NOT ship asterisk at all.
#  - Debian bullseye ships Asterisk 16.28, but bullseye is EOL and its
#    bullseye-security suite was removed from the CDN (index points at .deb
#    files that now 404), so reliable builds are not possible there.
#  - Ubuntu 24.04 (noble) "universe" ships maintained Asterisk 20.6 LTS with
#    chan_pjsip / res_pjsip / WebSocket / SRTP inside asterisk-modules, and a
#    normal, consistent archive. We build on that.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Asterisk lives in the "universe" component.
RUN apt-get update && apt-get install -y --no-install-recommends \
        asterisk \
        asterisk-config \
        asterisk-modules \
        asterisk-core-sounds-es-wav \
        asterisk-core-sounds-es-gsm \
        ca-certificates \
        openssl \
        procps \
    && rm -rf /var/lib/apt/lists/*

# Config templates rendered by entrypoint.sh at start (env substitution +
# dynamic generation of the 1001-1020 WebRTC peers).
COPY config/ /opt/phone/

RUN mkdir -p /etc/asterisk /var/lib/asterisk/phone-certs \
    && chmod +x /opt/phone/entrypoint.sh

# http bind port (plain WS). TLS is terminated by the platform nginx (WSS).
EXPOSE 8089

ENTRYPOINT ["/opt/phone/entrypoint.sh"]
