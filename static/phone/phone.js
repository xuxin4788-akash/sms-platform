/* Softphone client: SIP.js 0.15.x -> Asterisk (WSS via nginx /ws).
 * Standalone page; no platform build step. Credentials stay in localStorage.
 */
(function () {
  "use strict";

  var STORE_KEY = "phone_session_v1";
  var WSS_URL = "wss://" + location.host + "/ws";
  var DOMAIN = location.host;

  var ua = null;
  var busy = false;
  var registered = false;
  var myExtension = "";
  var currentSession = null;
  var callContext = null; // {number, extension, connectedAt}
  function connectedSeconds() {
    if (!callContext || !callContext.connectedAt) { return 0; }
    return Math.max(0, Math.floor(Date.now() / 1000) - callContext.connectedAt);
  }
  var timerHandle = null;
  var timerStart = 0;
  var localMicStream = null;

  // ---- Diagnostics bridge ------------------------------------------------
  // Forward internal logs/errors from this (off-screen) iframe to the parent's
  // floating debug card so a failed invite is visible without opening DevTools
  // against the iframe. Defined before use; notifyParent is declared later but
  // these helpers only call it asynchronously (hoisted function is available).
  function plog(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: "webphone", type: "webphone-debug", message: String(msg) }, "*");
      }
      console.log("[phone]", msg);
    } catch (e) { /* noop */ }
  }
  window.addEventListener("error", function (ev) {
    plog("window.error: " + (ev && ev.message) + " @ " + (ev && ev.filename) + ":" + (ev && ev.lineno));
  });
  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev && ev.reason;
    plog("unhandledrejection: " + (r && (r.message || r.name) ? (r.name + " " + r.message) : String(r)));
  });

  function wirePcLog(pc) {
    if (!pc || pc.__wpPcLogged) { return; }
    pc.__wpPcLogged = true;
    try {
      pc.addEventListener("iceconnectionstatechange", function () {
        plog("ICE state=" + pc.iceConnectionState);
      });
      pc.addEventListener("icegatheringstatechange", function () {
        plog("ICE gathering=" + pc.iceGatheringState);
      });
      pc.addEventListener("signalingstatechange", function () {
        plog("signaling state=" + pc.signalingState);
      });
    } catch (e) { /* noop */ }
  }

  // Intercept getUserMedia so we can meter the EXACT mic stream that SIP.js
  // uses (reading a sender track into a new MediaStream does not carry level).
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    var origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      plog("getUserMedia solicitado...");
      return origGetUserMedia(constraints).then(function (stream) {
        if (stream && stream.getAudioTracks && stream.getAudioTracks().length) {
          localMicStream = stream;
          plog("microfono OK (" + stream.getAudioTracks().length + " pista(s))");
        }
        return stream;
      }, function (err) {
        plog("getUserMedia FALLO: " + (err && err.name) + " " + (err && err.message));
        throw err;
      });
    };
  }

  // SIP.js 0.15's remote render does not fire on Chrome's Unified-Plan
  // ontrack path, so the <audio> element ends up with pistas=0. We wrap
  // RTCPeerConnection and attach every inbound audio track ourselves the
  // moment the browser emits the track event.
  var remoteStream = null;
  var lastRemoteTrack = null;
  function addRemoteTrack(track) {
    if (!track || track.kind !== "audio") { return; }
    if (lastRemoteTrack === track && remoteStream) { return; }
    lastRemoteTrack = track;
    if (!remoteStream) { remoteStream = new MediaStream(); }
    if (remoteStream.getAudioTracks().indexOf(track) === -1) {
      remoteStream.addTrack(track);
    }
    try {
      remoteAudio.srcObject = remoteStream;
      remoteAudio.muted = false;
      remoteAudio.volume = 1;
      var p = remoteAudio.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () { /* user can press Reanudar audio */ });
      }
    } catch (e) { /* noop */ }
  }
  if (typeof window.RTCPeerConnection !== "undefined") {
    var OrigPC = window.RTCPeerConnection;
    var WrappedPC = function (config, constraints) {
      var pc = new OrigPC(config, constraints);
      try {
        pc.addEventListener("track", function (ev) {
          if (ev.track && ev.track.kind === "audio") {
            var t = ev.track;
            plog("pista remota entrada: id=" + t.id + " muted=" + t.muted +
                 " readyState=" + t.readyState + " enabled=" + t.enabled);
            addRemoteTrack(t);
            t.addEventListener("unmute", function () { plog("pista remota -> unmute (con audio)"); });
            t.addEventListener("mute", function () { plog("pista remota -> mute (sin audio)"); });
          }
        });
      } catch (e) { /* noop */ }
      return pc;
    };
    // Preserve statics and prototype for SIP.js / browser internals.
    WrappedPC.prototype = OrigPC.prototype;
    Object.keys(OrigPC).forEach(function (k) { WrappedPC[k] = OrigPC[k]; });
    window.RTCPeerConnection = WrappedPC;
    if (window.webkitRTCPeerConnection === OrigPC) {
      window.webkitRTCPeerConnection = WrappedPC;
    }
  }

  // DOM refs
  var $ = function (id) { return document.getElementById(id); };
  var loginPanel = $("login-panel");
  var dialerPanel = $("dialer-panel");
  var statusLine = $("status-line");
  var extInput = $("ext-input");
  var pwdInput = $("pwd-input");
  var rememberBox = $("remember");
  var loginBtn = $("login-btn");
  var loginError = $("login-error");
  var numberInput = $("number-input");
  var callBtn = $("call-btn");
  var hangupBtn = $("hangup-btn");
  var logoutBtn = $("logout-btn");
  var callState = $("call-state");
  var callTimer = $("call-timer");
  var remoteAudio = $("remote-audio");
  var micMeter = $("mic-meter");
  var micMeterFill = $("mic-meter-fill");

  function setStatus(text, connected) {
    statusLine.textContent = text;
    statusLine.style.color = connected ? "var(--green)" : "var(--muted)";
  }

  function showError(msg) {
    loginError.textContent = msg;
    loginError.hidden = !msg;
  }

  /* ---------------- Keypad ---------------- */
  var KEYS = [
    ["1", ""], ["2", "ABC"], ["3", "DEF"],
    ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
    ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
    ["*", ""], ["0", "+"], ["#", ""]
  ];
  var keypad = $("keypad");
  KEYS.forEach(function (pair) {
    var b = document.createElement("button");
    b.className = "key";
    b.innerHTML = pair[0] + (pair[1] ? "<small>" + pair[1] + "</small>" : "");
    b.addEventListener("click", function () {
      numberInput.value += pair[0];
      numberInput.focus();
    });
    keypad.appendChild(b);
  });

  /* ---------------- Timer ---------------- */
  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function startTimer() {
    stopTimer();
    timerStart = Math.floor(Date.now() / 1000);
    timerHandle = setInterval(function () {
      callTimer.textContent = fmt(Math.floor(Date.now() / 1000) - timerStart);
    }, 1000);
  }
  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    callTimer.textContent = "00:00";
  }

  /* ---------------- Local ringback tone ----------------
   * While waiting for the remote party to answer, many SIP trunks only send
   * 180 Ringing with no early media, so the caller would hear silence. We play
   * a local ringback (North-American cadence: 2 s on / 4 s off, 440+480 Hz)
   * so the wait is always audible. Stopped on answer / failure / hangup. */
  var ringCtx = null;
  var ringTimer = null;

  function _ringBeep() {
    if (!ringCtx) { return; }
    var t = ringCtx.currentTime;
    var dur = 2;
    var g = ringCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(ringCtx.destination);
    [440, 480].forEach(function (f) {
      var o = ringCtx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + dur);
    });
  }

  function startRingback() {
    stopRingback();
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      ringCtx = new Ctx();
      if (ringCtx.state === "suspended") { ringCtx.resume(); }
      _ringBeep();
      ringTimer = setInterval(_ringBeep, 6000);
    } catch (e) { ringCtx = null; }
  }

  function stopRingback() {
    if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
    if (ringCtx) {
      try { ringCtx.close(); } catch (e) { /* noop */ }
      ringCtx = null;
    }
  }

  /* ---------------- Local mic level meter ----------------
   * The meter observes the mic stream but never owns/stops it (SIP.js does). */
  var micAudioCtx = null;
  var micSource = null;
  var micRaf = null;

  function stopMicMeter() {
    if (micRaf) { cancelAnimationFrame(micRaf); micRaf = null; }
    if (micSource) { try { micSource.disconnect(); } catch (e) { /* noop */ } micSource = null; }
    if (micAudioCtx) { try { micAudioCtx.close(); } catch (e) { /* noop */ } micAudioCtx = null; }
    micMeter.hidden = true;
    micMeterFill.style.width = "0%";
  }

  function startMicMeter(stream) {
    stopMicMeter();
    micMeter.hidden = false;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      micAudioCtx = new Ctx();
      micSource = micAudioCtx.createMediaStreamSource(stream);
      var analyser = micAudioCtx.createAnalyser();
      analyser.fftSize = 256;
      var buf = new Uint8Array(analyser.fftSize);
      micSource.connect(analyser);
      function tick() {
        analyser.getByteTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) {
          var v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) { peak = v; }
        }
        micMeterFill.style.width = Math.min(100, Math.round(peak * 140)) + "%";
        micRaf = requestAnimationFrame(tick);
      }
      tick();
    } catch (e) { /* meter is diagnostic only */ }
  }

  /* ---------------- Inbound diagnostics HUD (on-screen) ---------------- */
  var inboundHud = $("inbound-hud");
  var inboundHudState = $("inbound-hud-state");
  var inboundHudPkts = $("inbound-hud-pkts");
  var hudRaf = null;

  function stopInboundHud() {
    if (hudRaf) { clearInterval(hudRaf); hudRaf = null; }
    if (inboundHud) { inboundHud.hidden = true; }
  }

  function updateInboundHud(pc, why) {
    if (!inboundHud) { return; }
    inboundHud.hidden = false;
    var muted = true;
    pc.getReceivers().forEach(function (r) {
      if (r.track && r.track.kind === "audio" && !r.track.muted) { muted = false; }
    });
    inboundHudState.textContent = muted ? "Pista: silencio" : "Pista: con audio";
    inboundHudState.style.color = muted ? "var(--muted)" : "var(--green)";
    if (!hudRaf) {
      function loop() {
        try {
          pc.getStats().then(function (stats) {
            stats.forEach(function (rep) {
              if (rep.type === "inbound-rtp" && rep.kind === "audio" &&
                  rep.id.indexOf("IT") === 0) {
                inboundHudPkts.textContent = "Paquetes recibidos: " +
                  (rep.packetsReceived || 0) +
                  " · perdidos: " + (rep.packetsLost || 0);
              }
            });
          }).catch(function () { /* noop */ });
        } catch (e) { /* noop */ }
      }
      loop();
      hudRaf = setInterval(loop, 1000);
    }
  }

  /* ---------------- Live media stats into the debug card ---------------- */
  // Uses the browser's own RTCPeerConnection.getStats() so the numbers are what
  // the engine really sees — no tcpdump. Logs one compact line per tick with:
  //   in: inbound audio packets/bytes/lost/jitter + codec
  //   out: outbound audio packets/bytes + codec
  //   path: selected ICE candidate pair (which local/remote addresses carry RTP)
  var mediaStatsTimer = null;
  function fmtKb(n) {
    n = Number(n) || 0;
    if (n >= 1e6) { return (n / 1e6).toFixed(2) + "MB"; }
    if (n >= 1e3) { return (n / 1e3).toFixed(1) + "KB"; }
    return String(n) + "B";
  }
  function dumpMediaStats(pc) {
    if (!pc || !pc.getStats) { return; }
    try {
      pc.getStats().then(function (stats) {
        var inbound = null, outbound = null, selectedPair = null;
        var codecs = {};
        stats.forEach(function (rep) {
          if (rep.type === "codec" && rep.payloadType != null && rep.mimeType) {
            codecs[rep.payloadType] = String(rep.mimeType).replace("audio/", "");
          }
          if (rep.type === "inbound-rtp" && rep.kind === "audio" && !inbound) { inbound = rep; }
          if (rep.type === "outbound-rtp" && rep.kind === "audio" && !outbound) { outbound = rep; }
          if (rep.type === "candidate-pair" &&
              (rep.selected || rep.nominated) && rep.state === "succeeded" && !selectedPair) {
            selectedPair = rep;
          }
        });
        var codecName = function (r) {
          if (!r) { return "-"; }
          return codecs[r.codecId] ||
                 (r.mimeType ? String(r.mimeType).replace("audio/", "") : "?");
        };
        var inLine = inbound
          ? ("IN pkt=" + (inbound.packetsReceived || 0) +
             " " + fmtKb(inbound.bytesReceived) +
             " lost=" + (inbound.packetsLost || 0) +
             " jit=" + Math.round((inbound.jitter || 0) * 1000) + "ms" +
             " [" + codecName(inbound) + "]")
          : "IN (sin inbound-rtp)";
        var outLine = outbound
          ? ("OUT pkt=" + (outbound.packetsSent || 0) +
             " " + fmtKb(outbound.bytesSent) +
             " [" + codecName(outbound) + "]")
          : "OUT (sin outbound-rtp)";
        var pathLine = "path=?";
        if (selectedPair) {
          var local = stats.get(selectedPair.localCandidateId);
          var remote = stats.get(selectedPair.remoteCandidateId);
          pathLine = "path=" +
            (local ? (local.candidateType + ":" + (local.address || local.ip) + ":" + local.port) : "?") +
            " -> " +
            (remote ? (remote.candidateType + ":" + (remote.address || remote.ip) + ":" + remote.port) : "?");
        }
        plog("[media] " + inLine + " | " + outLine);
        plog("[media] " + pathLine);
      }).catch(function (e) { plog("getStats fallo: " + (e && e.message)); });
    } catch (e) { /* noop */ }
  }
  // Log the remote (Asterisk) SDP media address + ICE candidates so we can see
  // exactly what media endpoint the server advertised to the browser.
  function dumpRemoteSdp(pc) {
    try {
      var rd = pc.remoteDescription;
      if (!rd || !rd.sdp) { plog("[sdp] sin remoteDescription"); return; }
      var cLines = rd.sdp.match(/^c=IN.*$/gm) || [];
      var mLine = rd.sdp.match(/^m=audio.*$/gm) || [];
      var cands = (rd.sdp.match(/^a=candidate:.*$/gm) || []).slice(0, 6);
      plog("[sdp] Asterisk media -> " + (cLines.join(" ; ") || "(sin c line)"));
      plog("[sdp] m=audio -> " + (mLine.join(" ; ") || "(sin m=audio)"));
      if (cands.length) { plog("[sdp] candidate remotos:\n" + cands.join("\n")); }
    } catch (e) { plog("dumpRemoteSdp fallo: " + (e && e.message)); }
  }
  function startMediaStats(pc) {
    stopMediaStats();
    if (!pc) { return; }
    dumpRemoteSdp(pc);
    dumpMediaStats(pc);
    mediaStatsTimer = setInterval(function () { dumpMediaStats(pc); }, 3000);
  }
  function stopMediaStats() {
    if (mediaStatsTimer) { clearInterval(mediaStatsTimer); mediaStatsTimer = null; }
  }

  /* ---------------- Force the remote <audio> to actually play ---------------- */
  function forceRemotePlay() {
    try {
      remoteAudio.muted = false;
      remoteAudio.volume = 1;
      var p = remoteAudio.play();
      if (p && typeof p.catch === "function") {
        p.catch(function () { /* autoplay still blocked; user gesture helps */ });
      }
    } catch (e) { /* noop */ }
  }

  /* ---------------- Unified outbound call ---------------- */
  // Clears any stale session, builds an explicit sip target URI and starts the
  // call. Every failure path is reported back to the parent so the dial never
  // gets stuck in a silent "calling" state.
  function startOutboundCall(rawTarget) {
    plog("startOutboundCall entrada=\"" + rawTarget + "\" registered=" + registered + " ua=" + !!ua);
    var target = String(rawTarget == null ? "" : rawTarget).replace(/[^0-9+*#]/g, "");
    if (!target) {
      notifyParent({ type: "webphone-toast", message: "Número inválido", level: "error" });
      plog("numero vacio/ invalido");
      return null;
    }
    if (!registered || !ua) {
      plog("no registrado, aborto");
      notifyParent({ type: "webphone-not-registered" });
      return null;
    }
    // Release a stale session so it never blocks subsequent dials.
    if (currentSession) {
      plog("sesion previa encontrada, la termino");
      try { currentSession.terminate(); } catch (e) { /* noop */ }
      currentSession = null;
    }
    // Build a full SIP URI. A bare number is parsed as host by SIP.js 0.15 and
    // the INVITE is never transmitted. If it already looks like a URI, keep it.
    var uri = target;
    if (!/^sips?:/i.test(uri)) {
      var user = uri.charAt(0) === "+" ? uri.slice(1) : uri;
      uri = "sip:" + user + "@" + DOMAIN;
    }
    plog("URI destino=" + uri + ", pido microfono...");
    forceRemotePlay();
    callContext = {number: target, extension: myExtension, connectedAt: null};
    var s;
    try {
      s = ua.invite(uri, { media: { render: { remote: remoteAudio } } });
      plog("ua.invite devolvio session=" + !!s);
    } catch (e) {
      plog("ua.invite LANZO: " + e.name + " " + e.message);
      notifyParent({ type: "webphone-toast", message: "Error al llamar: " + e.message, level: "error" });
      notifyParent({ type: "webphone-idle" });
      return null;
    }
    attachSession(s);
    // Ring immediately once INVITE is sent — some trunks never send 180/183,
    // so "progress" may not fire and the caller would hear silence while ringing.
    startRingback();
    return s;
  }

  /* ---------------- Session wiring ---------------- */
  function attachSession(session) {
    currentSession = session;
    hangupBtn.disabled = false;
    callBtn.disabled = true;
    callState.textContent = "Conectando...";
    forceRemotePlay();

    // Surface PeerConnection / ICE state changes to the parent debug card.
    try {
      var sdh0 = session.sessionDescriptionHandler;
      if (sdh0 && sdh0.peerConnection) { wirePcLog(sdh0.peerConnection); }
      else {
        // The PC may be created slightly later; retry once on the next tick.
        setTimeout(function () {
          var sdh1 = session.sessionDescriptionHandler;
          if (sdh1 && sdh1.peerConnection) { wirePcLog(sdh1.peerConnection); }
        }, 0);
      }
    } catch (e) { /* logging only */ }

    function bindLocalMedia() {
      if (localMicStream) {
        startMicMeter(localMicStream);
      } else {
        // Fallback if the interceptor missed it: request the same mic stream.
        try {
          navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then(function (stream) { startMicMeter(stream); })
            .catch(function () { /* meter optional */ });
        } catch (e) { /* noop */ }
      }
    }

    // Monitor (without taking over) the inbound receiver track. The actual
    // audio sink is owned by SIP.js render; we only surface state on screen.
    function monitorRemoteTrack() {
      try {
        var sdh = session.sessionDescriptionHandler;
        var pc = sdh && sdh.peerConnection;
        if (!pc || !pc.getReceivers) { return; }
        pc.getReceivers().forEach(function (r) {
          if (r.track && r.track.kind === "audio") {
            r.track.onunmute = function () {
              forceRemotePlay();
              updateInboundHud(pc, "unmuted");
            };
            r.track.onmute = function () { updateInboundHud(pc, "muted"); };
            // If already unmuted, make sure the sink is live.
            if (!r.track.muted) { forceRemotePlay(); }
          }
        });
        updateInboundHud(pc, "poll");
      } catch (e) { /* monitor optional */ }
    }

    // No-response watchdog: if the INVITE produces neither progress nor a final
    // outcome within this window, the server/relay dropped it. Fail visibly and
    // end the session instead of leaving the caller stuck in 'Llamando' forever.
    var INVITE_TIMEOUT_MS = 65000;
    var inviteTimer = setTimeout(function () {
      if (endReported) { return; }
      reportEnd("failed", "sin respuesta del servidor (timeout)", "Sin respuesta");
      try { session.cancel(); } catch (e) { try { session.terminate(); } catch (e2) { /* noop */ } }
    }, INVITE_TIMEOUT_MS);
    function clearInviteTimer() { if (inviteTimer) { clearTimeout(inviteTimer); inviteTimer = null; } }

    session.on("progress", function (response) {
      clearInviteTimer(); // got a real provisional response -> no longer stalling
      callState.textContent = "Llamando...";
      // If the provider sends early media (183 with an SDP answer), its own
      // Keep the local ringback running through 180/183: this trunk signals
      // progress but sends no usable early-media audio, and stopping the tone
      // here left the caller in silence until 408. It only stops on
      // accepted/failed/rejected/terminated.
      forceRemotePlay();
      bindLocalMedia();
      monitorRemoteTrack();
      setTimeout(monitorRemoteTrack, 800);
    });
    session.on("accepted", function () {
      callState.textContent = "En llamada";
      stopRingback();
      startTimer();
      if (callContext) { callContext.connectedAt = Math.floor(Date.now() / 1000); }
      forceRemotePlay();
      bindLocalMedia();
      monitorRemoteTrack();
      setTimeout(monitorRemoteTrack, 800);
      // Begin live getStats() reporting into the debug card. Retry shortly because
      // the PeerConnection handle may lag the accepted event by a tick.
      var pc0 = session.sessionDescriptionHandler && session.sessionDescriptionHandler.peerConnection;
      if (pc0) { startMediaStats(pc0); }
      setTimeout(function () {
        var pc1 = session.sessionDescriptionHandler && session.sessionDescriptionHandler.peerConnection;
        if (pc1 && !mediaStatsTimer) { startMediaStats(pc1); }
      }, 500);
      notifyParent({ type: "webphone-answer", number: callContext ? callContext.number : "", extension: myExtension });
    });
    function failInfo(response, cause) {
      var code = "", txt = "";
      if (response) {
        code = (response.status_code != null ? response.status_code : response.statusCode) || "";
        txt = response.reason_phrase || response.statusText || "";
      }
      return (code ? code : "") + (txt ? (" " + txt) : "") + (cause ? (" [" + cause + "]") : "");
    }
    var endReported = false;
    function reportEnd(kind, reason, callStateText) {
      if (endReported) { return; }
      endReported = true;
      clearInviteTimer();
      if (callState) { callState.textContent = callStateText; }
      notifyParent({ type: "webphone-session-ended", outcome: kind, reason: reason,
        number: callContext ? callContext.number : "", extension: myExtension, duration: connectedSeconds() });
      resetCall();
    }
    session.on("failed", function (response, cause) {
      reportEnd("failed", failInfo(response, cause), "Falló la llamada");
    });
    session.on("terminated", function () {
      var wasConnected = callContext && callContext.connectedAt;
      if (endReported) { return; }
      endReported = true;
      if (callState) { callState.textContent = "Finalizada"; }
      notifyParent({ type: "webphone-session-ended", outcome: wasConnected ? "answered" : "no-answer",
        reason: wasConnected ? "hangup" : "terminated",
        number: callContext ? callContext.number : "", extension: myExtension, duration: connectedSeconds() });
      resetCall();
    });
    session.on("rejected", function (response, cause) {
      reportEnd("rejected", failInfo(response, cause), "Rechazada");
    });
  }

  function resetCall() {
    currentSession = null;
    hangupBtn.disabled = true;
    callBtn.disabled = false;
    stopTimer();
    stopRingback();
    stopMicMeter();
    stopInboundHud();
    stopMediaStats();
    try { remoteAudio.srcObject = null; } catch (e) { /* noop */ }
    remoteStream = null;
    lastRemoteTrack = null;
    remoteAudio.muted = false;
    callContext = null;
    notifyParent({ type: "webphone-idle" });
  }

  function showDialer() {
    loginPanel.hidden = true;
    dialerPanel.hidden = false;
  }
  function showLogin() {
    dialerPanel.hidden = true;
    loginPanel.hidden = false;
    loginBtn.disabled = false;
    busy = false;
  }

  /* ---------------- Connect / register ---------------- */
  var REGISTER_TIMEOUT_MS = 15000; // no registered/failed event within this -> stale
  var MAX_CONNECT_ATTEMPTS = 5;
  var registerWatchdog = null;
  var connectAttempts = 0;
  var pendingCred = null;          // {ext,pwd} retained for auto re-connect

  function clearRegisterWatchdog() {
    if (registerWatchdog) { clearTimeout(registerWatchdog); registerWatchdog = null; }
  }

  function scheduleReconnect(cause) {
    clearRegisterWatchdog();
    stopUA();
    busy = false;
    loginBtn.disabled = false;
    if (!pendingCred || connectAttempts >= MAX_CONNECT_ATTEMPTS) {
      connectAttempts = 0;
      setStatus("No se pudo registrar: " + cause, false);
      notifyParent({ type: "webphone-registration-failed", cause: String(cause) });
      showLogin();
      return;
    }
    var attempt = connectAttempts;
    var backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 16000); // 1s,2s,4s,8s,16s
    setStatus("Reintentando registro (" + attempt + "/" + MAX_CONNECT_ATTEMPTS + ")...", false);
    plog("registro sin respuesta (" + cause + "); reintento " + attempt + " en " + backoffMs + "ms");
    setTimeout(function () {
      if (registered || ua) { return; }       // recovered meanwhile
      connect(pendingCred.ext, pendingCred.pwd);
    }, backoffMs);
  }

  function connect(extension, password) {
    if (busy) { return; }
    busy = true;
    connectAttempts += 1;
    pendingCred = { ext: String(extension || ""), pwd: password };
    myExtension = String(extension || "");
    showError("");
    loginBtn.disabled = true;

    try {
      ua = new SIP.UA({
        uri: "sip:" + extension + "@" + DOMAIN,
        transportOptions: { wsServers: WSS_URL },
        authorizationUser: extension,
        password: password,
        register: true,
        userAgent: "pagoserve-webphone",
        sessionDescriptionHandlerFactoryOptions: {
          constraints: { audio: true, video: false },
          peerConnectionConfiguration: {
            iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
          }
        }
      });
    } catch (e) {
      showError("No se pudo iniciar el teléfono: " + e.message);
      showLogin();
      return;
    }

    ua.on("registered", function () {
      clearRegisterWatchdog();
      connectAttempts = 0;
      busy = false;
      registered = true;
      setStatus("Conectado · " + extension, true);
      showDialer();
      notifyParent({ type: "webphone-registered", extension: extension });
      if (rememberBox.checked) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ ext: extension, pwd: password })); }
        catch (e) { /* storage blocked */ }
      }
    });

    ua.on("registrationFailed", function (cause) {
      console.error("[phone] registrationFailed, cause =", cause);
      clearRegisterWatchdog();
      registered = false;
      showError("No se pudo registrar la extensión (" + cause + "). Revisa número y contraseña.");
      // A rejected credential (401/403) will never succeed by retrying; stop.
      var c = String(cause || "");
      if (/\b(401|403)\b|Rejection|forbidden|unauthor/i.test(c)) {
        connectAttempts = 0;
        setStatus("Error de registro: " + cause, false);
        notifyParent({ type: "webphone-registration-failed", cause: c });
        stopUA();
        busy = false;
        loginBtn.disabled = false;
        showLogin();
        return;
      }
      // Transient failure -> bounded auto re-connect.
      scheduleReconnect(c);
    });

    ua.on("unregistered", function () { registered = false; setStatus("Desconectado", false); notifyParent({ type: "webphone-unregistered" }); });

    ua.on("disconnected", function () {
      registered = false;
      setStatus("Sin conexión al servidor", false);
      showLogin();
      notifyParent({ type: "webphone-disconnected" });
    });

    // Inbound call (not expected yet, but wire it safely)
    ua.on("invite", function (session) {
      attachSession(session);
      session.accept({ media: { render: { remote: remoteAudio } } });
    });

    // Guard against a silent stall: SIP.js 0.15 emits neither 'registered' nor
    // 'registrationFailed' when REGISTER is dropped after the WSS opens. Without
    // this the UA hangs forever in 'registrando' and queued calls never fire.
    clearRegisterWatchdog();
    registerWatchdog = setTimeout(function () {
      if (registered) { return; }
      scheduleReconnect("timeout");
    }, REGISTER_TIMEOUT_MS);
  }

  function stopUA() {
    clearRegisterWatchdog();
    if (ua) {
      try { ua.stop(); } catch (e) { /* noop */ }
      ua = null;
    }
  }

  function logout() {
    stopUA();
    pendingCred = null;
    connectAttempts = 0;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
    pwdInput.value = "";
    busy = false;
    loginBtn.disabled = false;
    setStatus("Desconectado", false);
    showLogin();
  }

  /* ---------------- Actions ---------------- */
  loginBtn.addEventListener("click", function () {
    var ext = extInput.value.trim();
    var pwd = pwdInput.value;
    if (busy) { return; }
    if (!/^\d{2,6}$/.test(ext)) { showError("Ingresa una extensión válida (solo números)."); return; }
    if (!pwd) { showError("Ingresa la contraseña de la extensión."); return; }
    connectAttempts = 0; // fresh explicit gesture -> full retry budget
    connect(ext, pwd);
  });

  callBtn.addEventListener("click", function () {
    var target = numberInput.value;
    if (!target || !String(target).replace(/[^0-9+*#]/g, "")) { callState.textContent = "Ingresa un número"; return; }
    // Force the <audio> sink to play inside this gesture (autoplay unlock).
    forceRemotePlay();
    var session = startOutboundCall(target);
    if (session) { callState.textContent = "Marcando..."; }
  });

  hangupBtn.addEventListener("click", function () {
    if (currentSession) {
      try { currentSession.terminate(); } catch (e) { /* noop */ }
    }
    resetCall();
    callState.textContent = "Listo";
  });

  logoutBtn.addEventListener("click", logout);

  // Definite user gesture: force the remote element to play (autoplay bypass).
  var resumeAudioBtn = $("resume-audio-btn");
  if (resumeAudioBtn) {
    resumeAudioBtn.addEventListener("click", function () {
      forceRemotePlay();
      // Re-attach any live inbound track (definitive user gesture).
      try {
        var sdh = currentSession && currentSession.sessionDescriptionHandler;
        var pc = sdh && sdh.peerConnection;
        if (pc && pc.getReceivers) {
          pc.getReceivers().forEach(function (r) {
            if (r.track && r.track.kind === "audio") { addRemoteTrack(r.track); }
          });
        }
      } catch (e) { /* noop */ }
    });
  }

  // Fetch a server-provided credential (same-origin, carries the platform
  // session cookie) and register. Can be called on load and again by the
  // parent after login, because the off-screen iframe loads BEFORE the user
  // authenticates — the first fetch may 401 and must be retried post-login.
  var serverLoginTried = false;
  function tryServerLogin() {
    if (registered || ua) { return; }      // already connecting/connected
    fetch("/api/my/webphone-credential", {
      method: "GET",
      credentials: "same-origin",
      headers: { "Accept": "application/json" }
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      var d = r.data || {};
      if (r.ok && d.configured && d.extension && d.secret) {
        extInput.value = d.extension;
        pwdInput.value = d.secret;
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify({ ext: d.extension, pwd: d.secret }));
        } catch (e) { /* storage blocked */ }
        connect(d.extension, d.secret);
      } else {
        serverLoginTried = true;
        plog("credencial webphone no disponible: " + (d.reason || "error") + " (" + (d.message || "") + ")");
        notifyParent({ type: "webphone-credential-error", reason: String(d.reason || "error"), message: String(d.message || "") });
      }
    }).catch(function (err) {
      plog("fallo al pedir credencial webphone: " + (err && err.message ? err.message : err));
    });
  }

  // Auto-login: remembered credentials first, otherwise ask the platform
  // backend to hand us this user's SIP extension + shared peer secret.
  (function autoLogin() {
    var saved = null;
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { saved = JSON.parse(raw); }
    } catch (e) { saved = null; }

    if (saved && saved.ext && saved.pwd) {
      extInput.value = saved.ext;
      pwdInput.value = saved.pwd;
      connect(saved.ext, saved.pwd);
      return;
    }
    tryServerLogin();
  })();

  // ---- Parent-window control (contact page click-to-call) ----------------
  // The SPA embeds this page in an off-screen iframe; credentials are shared
  // via same-origin localStorage, so this page auto-registers. The parent
  // posts message commands; we post back status so the parent can toast.
  function notifyParent(msg) {
    try {
      if (window.parent && window.parent !== window) {
        var payload = { source: "webphone" };
        Object.keys(msg).forEach(function (k) { payload[k] = msg[k]; });
        window.parent.postMessage(payload, "*");
      }
    } catch (e) { /* noop */ }
  }
  if (window !== window.top) {
    window.addEventListener("message", function (ev) {
      var d = ev.data;
      if (!d || d.source !== "app") { return; }
      if (d.type === "webphone-dial") {
        var s = startOutboundCall(d.number);
        if (s) {
          var tn = String(d.number || "").replace(/[^0-9+*#]/g, "");
          notifyParent({ type: "webphone-dialing", number: tn, extension: myExtension });
        }
      } else if (d.type === "webphone-hangup") {
        try {
          if (currentSession) { currentSession.terminate(); }
          resetCall();
        } catch (e) { /* noop */ }
        notifyParent({ type: "webphone-idle" });
      } else if (d.type === "webphone-status") {
        notifyParent({ type: "webphone-status", registered: registered });
      } else if (d.type === "webphone-login") {
        // Parent tells us the platform user just authenticated; retry the
        // credential fetch in case the pre-login attempt returned 401.
        serverLoginTried = false;
        tryServerLogin();
        notifyParent({ type: "webphone-status", registered: registered });
      } else if (d.type === "webphone-resume") {
        // Force the remote sink to play (autoplay may have been blocked);
        // the parent surfaced a "sonido" button so this runs on a user gesture.
        forceRemotePlay();
        notifyParent({ type: "webphone-resumed" });
      }
    });
  }
})();
