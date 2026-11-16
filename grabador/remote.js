'use strict';
(() => {
  const BROKER = 'wss://0.peerjs.com/peerjs';
  const PAGE = 'https://jeffer91.github.io/videoslistodoble/grabador/';
  const BLOCK = 16 * 1024;
  const WINDOW = 256 * 1024;
  const MAX_FILE = 1024 * 1024 * 1024;
  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
      username: 'peerjs', credential: 'peerjsp'
    }
  ];
  const SIGNALS = new Set(['OFFER', 'ANSWER', 'CANDIDATE']);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const tokenPattern = /^[a-f0-9]{64}$/;
  const peerPattern = /^r11-[a-f0-9]{32}$/;
  const sessionPattern = /^[a-f0-9-]{36}$/;

  const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  const random = size => hex(crypto.getRandomValues(new Uint8Array(size)));
  const b64 = bytes => btoa(String.fromCharCode(...bytes));
  const unb64 = data => Uint8Array.from(atob(data), c => c.charCodeAt(0));

  async function keys(token) {
    if (!tokenPattern.test(token)) throw Error('El enlace de la grabadora es inválido.');
    const bytes = Uint8Array.from(token.match(/../g), byte => parseInt(byte, 16));
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return { key, desktop: 'r11-' + hex(new Uint8Array(digest).slice(0, 16)) };
  }

  const additionalData = (type, src, dst, session) => encoder.encode(JSON.stringify([1, type, src, dst, session]));

  async function connect({ token, role, tracks, onStatus, onChannel, onTrack }) {
    const { key, desktop } = await keys(token);
    const receiver = role === 'desktop';
    const id = receiver ? desktop : 'r11-' + random(16);
    const socketToken = random(16);
    let socket, ready = false, retry, heartbeat, socketTimer, stopped = false;
    let attempt, inbound = Promise.resolve();
    const accepted = new Set();

    function remove(current = attempt) {
      if (!current || current !== attempt) return;
      attempt = null;
      clearTimeout(current.timeout);
      clearTimeout(current.disconnect);
      current.pc.close();
      if (current.channel) onChannel(null);
    }

    function send(current, type, data) {
      current.outgoing = current.outgoing.then(async () => {
        if (current !== attempt || !ready) return;
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt({
          name: 'AES-GCM', iv, additionalData: additionalData(type, id, current.peer, current.session)
        }, key, encoder.encode(JSON.stringify(data)));
        if (current !== attempt || !ready) return;
        socket.send(JSON.stringify({
          type, dst: current.peer,
          payload: { type: 'data', connectionId: current.session, iv: b64(iv), sealed: b64(new Uint8Array(encrypted)) }
        }));
      }).catch(() => {});
    }

    function attemptConnection(peer, session) {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      const current = { pc, peer, session, candidates: [], outgoing: Promise.resolve(), senders: {} };
      attempt = current;
      current.timeout = setTimeout(() => {
        if (current.channel?.readyState !== 'open') remove(current);
      }, 18000);
      pc.onicecandidate = event => {
        if (event.candidate) send(current, 'CANDIDATE', event.candidate.toJSON());
      };
      pc.ontrack = event => {
        if (attempt === current) onTrack?.(event.track);
      };
      pc.onconnectionstatechange = () => {
        if (current !== attempt) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') remove(current);
        if (pc.connectionState === 'disconnected') {
          clearTimeout(current.disconnect);
          current.disconnect = setTimeout(() => {
            if (pc.connectionState === 'disconnected') remove(current);
          }, 4200);
        }
      };
      const acceptChannel = channel => {
        if (channel.label !== 'records-mobile' || current.channel) {
          channel.close();
          return;
        }
        current.channel = channel;
        channel.binaryType = 'arraybuffer';
        channel.onopen = () => {
          if (current !== attempt) return;
          clearTimeout(current.timeout);
          onChannel(channel);
        };
        channel.onclose = () => remove(current);
      };
      if (receiver) pc.ondatachannel = event => acceptChannel(event.channel);
      else {
        for (const kind of ['video', 'audio']) {
          current.senders[kind] = pc.addTransceiver(tracks(kind) || kind, { direction: 'sendonly' }).sender;
        }
        acceptChannel(pc.createDataChannel('records-mobile'));
      }
      return current;
    }

    async function description(current, sdp) {
      await current.pc.setRemoteDescription(sdp);
      for (const candidate of current.candidates.splice(0)) {
        await current.pc.addIceCandidate(candidate).catch(() => {});
      }
    }

    async function receive(data) {
      if (stopped || !ready || typeof data !== 'string' || data.length > 90000) return;
      const message = JSON.parse(data);
      const { type, src, payload } = message;
      const session = payload?.connectionId;
      if (!SIGNALS.has(type) || !peerPattern.test(src) || !sessionPattern.test(session)) return;
      if (receiver && type === 'OFFER') {
        if (accepted.has(session) || attempt?.channel?.readyState === 'open') return;
      } else if (!attempt || attempt.peer !== src || attempt.session !== session) return;
      const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: unb64(payload.iv), additionalData: additionalData(type, src, id, session)
      }, key, unb64(payload.sealed));
      if (stopped || !ready) return;
      const parsed = JSON.parse(decoder.decode(plaintext));
      if (type === 'OFFER' && receiver && parsed.type === 'offer') {
        if (accepted.size >= 96) accepted.delete(accepted.values().next().value);
        accepted.add(session);
        remove();
        const current = attemptConnection(src, session);
        try {
          await description(current, parsed);
          await current.pc.setLocalDescription(await current.pc.createAnswer());
          send(current, 'ANSWER', current.pc.localDescription.toJSON());
        } catch (error) {
          remove(current);
          throw error;
        }
      } else {
        const current = attempt;
        if (!current || current.peer !== src || current.session !== session) return;
        if (type === 'ANSWER' && !receiver && !current.pc.remoteDescription && parsed.type === 'answer') {
          await description(current, parsed);
        } else if (type === 'CANDIDATE') {
          if (current.pc.remoteDescription) await current.pc.addIceCandidate(parsed).catch(() => {});
          else if (current.candidates.length < 128) current.candidates.push(parsed);
        }
      }
    }

    async function dial() {
      if (stopped || !ready || receiver || attempt) return;
      const current = attemptConnection(desktop, crypto.randomUUID());
      let offered = false;
      const candidates = [];
      current.pc.onicecandidate = event => {
        if (!event.candidate) return;
        if (offered) send(current, 'CANDIDATE', event.candidate.toJSON());
        else candidates.push(event.candidate.toJSON());
      };
      try {
        await current.pc.setLocalDescription(await current.pc.createOffer());
        send(current, 'OFFER', current.pc.localDescription.toJSON());
        offered = true;
        for (const candidate of candidates) send(current, 'CANDIDATE', candidate);
      } catch {
        remove(current);
      }
    }

    function open() {
      if (stopped || socket) return;
      onStatus('Conectando con el servicio de enlace…');
      const url = new URL(BROKER);
      url.search = new URLSearchParams({ key: 'peerjs', id, token: socketToken, version: '1.5.5' });
      const connection = new WebSocket(url);
      socket = connection;
      socketTimer = setTimeout(() => connection.close(), 12000);
      connection.onmessage = event => {
        if (connection !== socket || stopped) return;
        if (!ready) {
          let type;
          try { type = JSON.parse(event.data).type; } catch {}
          if (type !== 'OPEN') {
            connection.close();
            return;
          }
          ready = true;
          clearTimeout(socketTimer);
          onStatus(receiver ? 'Esperando al celular…' : 'Buscando 11 Récords Studio abierto en Windows…');
          heartbeat = setInterval(() => {
            if (socket === connection && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'HEARTBEAT' }));
            }
          }, 5000);
          dial().catch(() => {});
          return;
        }
        inbound = inbound.then(() => receive(event.data)).catch(() => {});
      };
      connection.onclose = () => {
        if (socket !== connection) return;
        socket = null;
        ready = false;
        clearTimeout(socketTimer);
        clearInterval(heartbeat);
        if (attempt?.channel?.readyState !== 'open') remove();
        if (!stopped) onStatus('Reconectando el servicio de enlace…');
      };
    }

    function maintain() {
      if (stopped) return;
      if (!socket) open();
      else if (ready && !attempt) dial().catch(() => {});
    }

    maintain();
    retry = setInterval(maintain, 2600);
    return {
      async setTracks() {
        const current = attempt;
        if (!current || receiver) return;
        await Promise.all(['video', 'audio'].map(kind => current.senders[kind].replaceTrack(tracks(kind) || null)));
      },
      close() {
        stopped = true;
        clearInterval(retry);
        clearInterval(heartbeat);
        clearTimeout(socketTimer);
        remove();
        socket?.close();
      }
    };
  }

  function send(channel, message) {
    if (channel?.readyState !== 'open') return false;
    channel.send(JSON.stringify(message));
    return true;
  }

  function meter(stream, update) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !stream.getAudioTracks().length) return { stop() {}, resume() {} };
    const context = new Audio();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let frame;
    function sample() {
      analyser.getFloatTimeDomainData(data);
      let energy = 0;
      for (const value of data) energy += value * value;
      const db = Math.max(-60, Math.round(20 * Math.log10(Math.max(.001, Math.sqrt(energy / data.length)))));
      update(db);
      frame = requestAnimationFrame(sample);
    }
    sample();
    const resume = () => context.resume().catch(() => {});
    resume();
    return { resume, stop() { cancelAnimationFrame(frame); context.close().catch(() => {}); update(-60); } };
  }

  window.RecordsRemote = { PAGE, BLOCK, WINDOW, MAX_FILE, tokenPattern, connect, send, meter };
})();
