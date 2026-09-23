# WebRTC <-> VOS3000 gateway for the SMS platform softphone.
#
# IMPORTANT: Asterisk is NOT in Debian bookworm (12) / trixie (13) archives;
# the maintained package lives in bullseye (11): Asterisk 16.28 LTS, which
# bundles chan_pjsip/res_pjsip in `asterisk-modules` (no separate -pjsip pkg).
# We therefore build on the official debian:bullseye-slim, main component only.
FROM debian:bullseye-slim

ENV DEBIAN_FRONTEND=noninteractive

# Bullseye is EOL: the bullseye-security suite was removed from the mirrors
# (all *.deb under debian-security return 404) and bullseye-updates is empty.
# Pin apt to the bullseye main point-release archive, which still hosts the
# Asterisk 16.28 packages and every dependency.
RUN printf 'deb http://deb.debian.org/debian bullseye main\n' > /etc/apt/sources.list

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
