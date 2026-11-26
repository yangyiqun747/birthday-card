'use strict';

function createBlowDetector({ onState = () => {}, onBlow = () => {} } = {}) {
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  const sampleInterval = 40;
  const calibrationTime = 600;
  const listeningTime = 14000;
  const requiredBlowTime = 520;
  const allowedGap = 130;
  let active;

  function stop() {
    if (!active) return;
    const session = active;
    active = undefined;
    window.clearTimeout(session.timeout);
    window.clearInterval(session.sampling);
    for (const track of session.stream?.getTracks() ?? []) {
      track.removeEventListener('ended', session.inputEnded);
      track.stop();
    }
    session.source?.disconnect();
    session.analyser?.disconnect();
    session.silentOutput?.disconnect();
    if (session.context && session.context.state !== 'closed') {
      void session.context.close().catch(() => {});
    }
  }

  function finish(session, state) {
    if (active !== session) return;
    stop();
    if (state === 'blow') onBlow();
    else onState(state, 0);
  }

  function loudness(samples) {
    let sum = 0;
    let squares = 0;
    for (const sample of samples) {
      sum += sample;
      squares += sample ** 2;
    }
    const mean = sum / samples.length;
    return Math.sqrt(Math.max(0, squares / samples.length - mean ** 2));
  }

  function coverage(spectrum, [first, last]) {
    let peak = -Infinity;
    for (let bin = first; bin < last; bin++) peak = Math.max(peak, spectrum[bin]);
    const cutoff = Math.max(-89, peak - 19);
    let occupied = 0;
    for (let bin = first; bin < last; bin++) {
      if (spectrum[bin] >= cutoff) occupied++;
    }
    return occupied / Math.max(1, last - first);
  }

  function listen(session) {
    const analyser = session.context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    session.source = session.context.createMediaStreamSource(session.stream);
    session.source.connect(analyser);
    // Keep the Web Audio graph active while sending only silence to the output.
    session.analyser = analyser;
    session.silentOutput = session.context.createGain();
    session.silentOutput.gain.value = 0;
    analyser.connect(session.silentOutput);
    session.silentOutput.connect(session.context.destination);
    const waveform = new Float32Array(analyser.fftSize);
    const spectrum = new Float32Array(analyser.frequencyBinCount);
    const binWidth = session.context.sampleRate / analyser.fftSize;
    const band = (low, high) => [
      Math.ceil(low / binWidth),
      Math.min(spectrum.length, Math.ceil(high / binWidth)),
    ];
    const low = band(85, 450);
    const mid = band(450, 1500);
    const high = band(1500, 4000);
    const calibratedLevels = [];
    const calibrationEnds = performance.now() + calibrationTime;
    let threshold;
    let qualifiedTime = 0;
    let lastQualifiedAt = -Infinity;
    let lastSampleAt = performance.now();
    let lastProgress = 0;
    let lastLevel = -1;

    session.sampling = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.min(now - lastSampleAt, sampleInterval);
      lastSampleAt = now;
      analyser.getFloatTimeDomainData(waveform);
      const volume = loudness(waveform);
      const level = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(volume, .00001)) + 65) / 43));
      if (threshold === undefined) {
        calibratedLevels.push(volume);
        if (now < calibrationEnds) {
          if (Math.abs(lastLevel - level) > .03) {
            lastLevel = level;
            onState('calibrating', 0, level);
          }
          return;
        }
        calibratedLevels.sort((first, second) => first - second);
        const ambient = calibratedLevels[Math.floor(calibratedLevels.length * .4)];
        threshold = Math.max(.0035, ambient * 1.55, ambient + .0018);
        onState('listening', 0, level);
        return;
      }

      if (now - lastQualifiedAt > allowedGap) qualifiedTime = 0;
      if (volume >= threshold) {
        analyser.getFloatFrequencyData(spectrum);
        // Phone microphones may filter one side of the spectrum. Still require
        // broad energy in two neighbouring bands to reject narrow tones.
        if (coverage(spectrum, mid) >= .23 &&
            (coverage(spectrum, low) >= .26 || coverage(spectrum, high) >= .16)) {
          qualifiedTime += elapsed;
          lastQualifiedAt = now;
        }
      }

      if (qualifiedTime >= requiredBlowTime) {
        finish(session, 'blow');
        return;
      }
      const progress = qualifiedTime / requiredBlowTime;
      if (progress !== lastProgress || Math.abs(lastLevel - level) > .03) {
        lastProgress = progress;
        lastLevel = level;
        onState('listening', progress, level);
      }
    }, sampleInterval);
    onState('calibrating', 0);
  }

  async function start() {
    if (active || document.hidden) return;
    const media = navigator.mediaDevices;
    if (!AudioEngine || !media?.getUserMedia) {
      onState('unavailable', 0);
      return;
    }

    const session = {};
    active = session;
    onState('loading', 0);
    if (active !== session) return;

    try {
      session.context = new AudioEngine();
      // Request audio activation in the click handler, before permission can interrupt it.
      const resumed = session.context.resume().then(() => true, () => false);
      const stream = await media.getUserMedia({
        video: false,
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: false },
          noiseSuppression: { ideal: false },
          autoGainControl: { ideal: false },
        },
      });
      if (active !== session) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      session.stream = stream;
      const tracks = stream.getTracks();
      if (!tracks.length || tracks.every((track) => track.readyState === 'ended')) {
        finish(session, 'unavailable');
        return;
      }
      session.inputEnded = () => finish(session, 'unavailable');
      for (const track of tracks) track.addEventListener('ended', session.inputEnded, { once: true });
      session.timeout = window.setTimeout(() => finish(session, 'timeout'), listeningTime);
      if (!await resumed || session.context.state !== 'running') {
        finish(session, 'error');
        return;
      }
      if (active === session) listen(session);
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      const unavailable = error?.name === 'NotFoundError' || error?.name === 'NotSupportedError' ||
        error?.name === 'OverconstrainedError';
      finish(session, denied ? 'denied' : (unavailable ? 'unavailable' : 'error'));
    }
  }

  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });

  return { start, stop };
}
