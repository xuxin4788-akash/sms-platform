# WebRTC <-> VOS3000 gateway for the SMS platform softphone.
# Official Debian bookworm packages only (pjsip channel + opus + ES prompts).
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        asterisk \
        asterisk-config \
        asterisk-modules \
        asterisk-pjsip \
        asterisk-opus \
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
