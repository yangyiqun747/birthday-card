'use strict';

function createCardSound(button, { volume, music } = {}) {
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  const cues = {
    ready: [[587, 0, .27], [880, .11, .27]],
    lit: [[784, 0, .30], [1175, .055, .23]],
    celebrated: [[523, 0, .36], [784, .10, .36], [1047, .21, .42]],
    typing: [[698, 0, .14]],
  };
  const scores = {
    'music-box': {
      beat: .49,
      measure: 3,
      melodyTimes: [0, .75, 1.5, 2.25],
      bassTimes: [0, 1, 2],
      voice: 'sine',
      bars: [
        [[76, 79, 84, 83], [48, 55, 64]],
        [[79, 76, 74, 72], [45, 52, 60]],
        [[74, 77, 81, 84], [50, 57, 65]],
        [[83, 79, 76, null], [43, 55, 62]],
        [[72, 76, 79, 86], [52, 55, 64]],
        [[84, 81, 77, 76], [53, 60, 69]],
        [[74, 77, 81, 79], [43, 55, 65]],
        [[76, 74, 72, null], [48, 55, 64]],
      ],
    },
    piano: {
      beat: .55,
      measure: 4,
      melodyTimes: [0, 1, 2.5, 3.25],
      bassTimes: [0, 1.5, 2.5, 3.25],
      voice: 'triangle',
      bars: [
        [[69, 72, 76, 74], [45, 52, 60, 64]],
        [[72, 69, 67, null], [41, 48, 57, 60]],
        [[64, 67, 72, 74], [48, 55, 60, 64]],
        [[71, 69, 67, null], [43, 50, 55, 62]],
        [[69, 72, 77, 76], [41, 48, 57, 60]],
        [[74, 69, 65, 69], [50, 57, 62, 65]],
        [[67, 71, 74, 77], [43, 50, 55, 62]],
        [[76, 72, 69, null], [45, 52, 60, 64]],
      ],
    },
  };
  const effects = new Set();
  const accompaniment = new Set();
  let context;
  let output;
  let musicTimer;
  let enabled = false;
  let interruption = 0;
  let lastTyping = -Infinity;

  function canPlay() {
    return enabled && context?.state === 'running' && !document.hidden;
  }

  function updateVolume() {
    if (!output) return;
    const level = Math.max(0, Math.min(100, Number(volume?.value ?? 50))) / 100;
    output.gain.setValueAtTime(enabled ? .18 * level : 0, context.currentTime);
  }

  function tone(frequency, start, duration, wave, peak, attack, active) {
    const note = context.createOscillator();
    const gain = context.createGain();
    const end = start + duration;
    const envelopeFloor = .0001;
    note.type = wave;
    note.frequency.value = frequency;
    gain.gain.setValueAtTime(envelopeFloor, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(envelopeFloor, end);
    note.connect(gain);
    gain.connect(output);

    function disconnect() {
      if (!active.delete(voice)) return;
      note.disconnect();
      gain.disconnect();
    }

    const voice = { note, disconnect };
    active.add(voice);
    note.addEventListener('ended', disconnect, { once: true });
    note.start(start);
    note.stop(end);
  }

  function stopNotes(active) {
    for (const voice of active) {
      voice.note.stop();
      voice.disconnect();
    }
  }

  function stopMusic() {
    window.clearInterval(musicTimer);
    musicTimer = undefined;
    stopNotes(accompaniment);
  }

  function startMusic() {
    stopMusic();
    const score = music && Object.hasOwn(scores, music.value) ? scores[music.value] : null;
    if (!score || !canPlay()) return;

    const notes = [];
    const isMusicBox = score.voice === 'sine';
    const measureSeconds = score.measure * score.beat;
    score.bars.forEach(([melody, bass], bar) => {
      const measureStart = bar * measureSeconds;
      const addPart = (pitches, beats, isMelody) => {
        pitches.forEach((pitch, index) => {
          if (pitch === null) return;
          notes.push({
            time: measureStart + beats[index] * score.beat,
            frequency: 440 * 2 ** ((pitch - 69) / 12),
            peak: isMelody ? .14 : .072,
            duration: isMusicBox ? .63 : (isMelody ? .86 : 1.06),
          });
        });
      };
      addPart(melody, score.melodyTimes, true);
      addPart(bass, score.bassTimes, false);
    });
    notes.sort((first, second) => first.time - second.time);

    const length = measureSeconds * score.bars.length;
    let loopStart = context.currentTime + .035;
    let index = 0;

    function schedule() {
      if (!canPlay()) return;
      const now = context.currentTime;
      const skippedLoops = Math.floor((now - loopStart) / length);
      if (skippedLoops > 0) {
        loopStart += skippedLoops * length;
        index = 0;
      }

      while (loopStart + notes[index].time < now + .3) {
        const { frequency, time, duration, peak } = notes[index];
        const start = loopStart + time;
        if (start >= now - .035) {
          const onset = Math.max(start, now);
          tone(frequency, onset, duration, score.voice, peak, .012, accompaniment);
          if (isMusicBox) tone(frequency * 2.76, onset, .22, 'sine', peak * .18, .008, accompaniment);
        }
        index++;
        if (index === notes.length) {
          index = 0;
          loopStart += length;
        }
      }
    }

    schedule();
    musicTimer = window.setInterval(schedule, 95);
  }

  function setEnabled(next) {
    enabled = next;
    button.setAttribute('aria-pressed', String(enabled));
    button.firstElementChild.textContent = enabled ? '音效开' : '音效关';
    updateVolume();
    if (enabled) {
      startMusic();
    } else {
      stopMusic();
      stopNotes(effects);
      lastTyping = -Infinity;
    }
  }

  function mute() {
    interruption++;
    setEnabled(false);
  }

  button.hidden = !AudioEngine;
  setEnabled(false);
  button.addEventListener('click', async () => {
    if (enabled) {
      mute();
      return;
    }

    button.disabled = true;
    const attempt = interruption;
    try {
      if (!context || context.state === 'closed') {
        context = new AudioEngine();
        output = context.createGain();
        output.gain.value = 0;
        output.connect(context.destination);
      }
      await context.resume();
      setEnabled(attempt === interruption && context.state === 'running' && !document.hidden);
    } catch {
      setEnabled(false);
    } finally {
      button.disabled = false;
    }
  });

  volume?.addEventListener('input', updateVolume);
  music?.addEventListener('change', startMusic);
  window.addEventListener('pagehide', mute);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) mute();
  });

  return {
    play(phase) {
      if (!canPlay() || !Object.hasOwn(cues, phase)) return;
      const now = context.currentTime + .02;
      const typing = phase === 'typing';
      if (typing && now - lastTyping < .13) return;
      if (typing) lastTyping = now;
      for (const [frequency, delay, duration] of cues[phase]) {
        tone(frequency, now + delay, duration, 'sine', typing ? .07 : .32, .025, effects);
      }
    },
  };
}
