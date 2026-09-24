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
  var currentSession = null;
  var timerHandle = null;
  var timerStart = 0;
  var localMicStream = null;

  // Intercept getUserMedia so we can meter the EXACT mic stream that SIP.js
  // uses (reading a sender track into a new MediaStream does not carry level).
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    var origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      return origGetUserMedia(constraints).then(function (stream) {
        if (stream && stream.getAudioTracks && stream.getAudioTracks().length) {
          localMicStream = stream;
        }
        return stream;
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
            addRemoteTrack(ev.track);
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

  /* ---------------- Session wiring ---------------- */
  function attachSession(session) {
    currentSession = session;
    hangupBtn.disabled = false;
    callBtn.disabled = true;
    callState.textContent = "Conectando...";
    forceRemotePlay();

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

    session.on("progress", function () {
      callState.textContent = "Llamando...";
      forceRemotePlay();
      bindLocalMedia();
      monitorRemoteTrack();
      setTimeout(monitorRemoteTrack, 800);
    });
    session.on("accepted", function () {
      callState.textContent = "En llamada";
      startTimer();
      forceRemotePlay();
      bindLocalMedia();
      monitorRemoteTrack();
      setTimeout(monitorRemoteTrack, 800);
    });
    session.on("failed", function () {
      callState.textContent = "Falló la llamada";
      resetCall();
    });
    session.on("terminated", function () {
      callState.textContent = "Finalizada";
      resetCall();
    });
    session.on("rejected", function () {
      callState.textContent = "Rechazada";
      resetCall();
    });
  }

  function resetCall() {
    currentSession = null;
    hangupBtn.disabled = true;
    callBtn.disabled = false;
    stopTimer();
    stopMicMeter();
    stopInboundHud();
    try { remoteAudio.srcObject = null; } catch (e) { /* noop */ }
    remoteStream = null;
    lastRemoteTrack = null;
    remoteAudio.muted = false;
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
  function connect(extension, password) {
    if (busy) { return; }
    busy = true;
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
      registered = false;
      showError("No se pudo registrar la extensión (" + cause + "). Revisa número y contraseña.");
      setStatus("Error de registro: " + cause, false);
      notifyParent({ type: "webphone-registration-failed", cause: String(cause) });
      stopUA();
      showLogin();
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
  }

  function stopUA() {
    if (ua) {
      try { ua.stop(); } catch (e) { /* noop */ }
      ua = null;
    }
  }

  function logout() {
    stopUA();
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
    pwdInput.value = "";
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
    connect(ext, pwd);
  });

  callBtn.addEventListener("click", function () {
    var target = numberInput.value.replace(/[^0-9+*#]/g, "");
    if (!ua || !target) { callState.textContent = "Ingresa un número"; return; }
    callState.textContent = "Marcando...";
    // Start the <audio> sink inside this gesture so it is already "playing"
    // by the time SIP.js assigns the remote MediaStream (Chrome keeps the
    // origin's autoplay permission; a live sink keeps NetEq from flushing).
    forceRemotePlay();
    try {
      var session = ua.invite(target, {
        media: { render: { remote: remoteAudio } }
      });
      attachSession(session);
    } catch (e) {
      callState.textContent = "Error: " + e.message;
    }
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

  // Auto-login with remembered credentials.
  (function autoLogin() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.ext && saved.pwd) {
          extInput.value = saved.ext;
          pwdInput.value = saved.pwd;
          connect(saved.ext, saved.pwd);
        }
      }
    } catch (e) { /* corrupt storage */ }
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
        var target = String(d.number || "").replace(/[^0-9+*#]/g, "");
        if (!target) { notifyParent({ type: "webphone-toast", message: "Número inválido", level: "error" }); return; }
        if (!registered || !ua) {
          notifyParent({ type: "webphone-not-registered" });
          return;
        }
        if (currentSession) {
          notifyParent({ type: "webphone-toast", message: "Ya hay una llamada en curso", level: "error" });
          return;
        }
        try {
          forceRemotePlay();
          var s = ua.invite(target, { media: { render: { remote: remoteAudio } } });
          attachSession(s);
          notifyParent({ type: "webphone-dialing", number: target });
          notifyParent({ type: "webphone-toast", message: "Llamando...", level: "info" });
        } catch (e) {
          notifyParent({ type: "webphone-toast", message: "Error al llamar: " + e.message, level: "error" });
          notifyParent({ type: "webphone-idle" });
        }
      } else if (d.type === "webphone-hangup") {
        try {
          if (currentSession) { currentSession.terminate(); }
          resetCall();
        } catch (e) { /* noop */ }
        notifyParent({ type: "webphone-idle" });
      } else if (d.type === "webphone-status") {
        notifyParent({ type: "webphone-status", registered: registered });
      }
    });
  }
})();
