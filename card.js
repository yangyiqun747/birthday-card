'use strict';

const byId = (id) => document.getElementById(id);
const scene = byId('scene');
const status = byId('status');
const video = byId('camera-video');
const viewfinder = byId('viewfinder');
const letter = byId('letter');
const heading = byId('letter-title');
const dialog = byId('welcome-dialog');
const steps = document.querySelectorAll('.step');
const cameraButton = byId('camera-button');
const micButton = byId('mic-button');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const modelRoot = new URL('./vendor/hands/', document.baseURI);
const hold = BirthdayGestures.createHold(390);

const phases = {
  sealed: { step: 0, next: 'stars', tap: '点亮星星', title: '点亮星星', detail: '点一下画面，唤醒星光。' },
  stars: { step: 1, next: 'ready', tap: '聚成蛋糕', title: '张开手掌', detail: '在镜头前保持一下。', gesture: 'palm', icon: '✋' },
  ready: { step: 2, next: 'lit', tap: '点亮蜡烛', title: '捏合手指', detail: '让拇指和食指碰在一起。', gesture: 'pinch', icon: '🤏' },
  lit: { step: 3, next: 'celebrated', tap: '熄灭蜡烛', title: '许完愿，比个剪刀手', detail: '伸出食指和中指，保持一下。', gesture: 'victory', icon: '✌️' },
  celebrated: { step: 3, next: 'letter', tap: '打开祝福' },
  letter: { step: 4, next: 'sealed', tap: '再看一次' },
};

let phase = 'sealed';
let camera = null;
let handsLibrary;
let guideMode = 'guide';
let letterTimer = 0;
let typingFrame = 0;
let micRunning = false;

const particles = createParticleScene(byId('particle-scene'), byId('point-cloud'), { onTap: advance });
const sound = createCardSound(byId('sound-toggle'), { volume: byId('volume'), music: byId('music') });
const blow = createBlowDetector({ onState: updateMic, onBlow: () => advance('recognized') });

const greetingLines = BirthdayCard.greeting.map((message) => {
  const paragraph = document.createElement('p');
  const spoken = document.createElement('span');
  spoken.className = 'visually-hidden';
  spoken.textContent = message;
  const animated = document.createElement('span');
  animated.setAttribute('aria-hidden', 'true');
  paragraph.append(spoken, animated);
  byId('greeting').append(paragraph);
  return { animated, characters: Array.from(message) };
});

function renderGreeting() {
  cancelAnimationFrame(typingFrame);
  const write = (limit) => {
    let remaining = limit;
    for (const { animated, characters } of greetingLines) {
      animated.textContent = characters.slice(0, Math.max(0, remaining)).join('');
      remaining -= characters.length;
    }
    return remaining >= 0;
  };
  if (reduced.matches) {
    write(Infinity);
    return;
  }
  const started = performance.now();
  write(0);
  sound.play('typing');
  function type(now) {
    if (!write(Math.floor((now - started) / 24))) typingFrame = requestAnimationFrame(type);
  }
  typingFrame = requestAnimationFrame(type);
}

function flashRecognition(success) {
  if (reduced.matches || typeof scene.animate !== 'function') return;
  const color = success ? '#f4c69390' : '#d98fb783';
  scene.animate([{ boxShadow: '0 0 0 0 ' + color }, { boxShadow: '0 0 0 9px #0000' }], {
    duration: 510, easing: 'ease-out',
  });
}

function syncControls() {
  const current = phases[phase];
  byId('tap-button').textContent = current.tap;
  byId('tap-button').hidden = phase === 'celebrated';
  byId('finale-skip').hidden = phase !== 'celebrated';
  const active = Boolean(camera?.active);
  document.body.toggleAttribute('data-camera-active', active);
  byId('camera-action').textContent = active ? '关闭摄像头' : camera ? '取消开启' : '开启手势';
  cameraButton.hidden = phase === 'celebrated' || phase === 'letter';
  byId('orbit-hint').textContent = active ? '☝️ 食指隔空旋转' : '拖动旋转';
  viewfinder.hidden = !camera?.stream;

  micButton.hidden = phase !== 'lit';
  micButton.textContent = micRunning ? '关闭麦克风' : '吹蜡烛';
  byId('mic-meter').hidden = !micRunning;
  byId('gesture-cue').hidden = !current.title || (!active && phase !== 'lit');
  if (current.title) {
    byId('gesture-icon').textContent = active && current.gesture ? current.icon : '✧';
    byId('gesture-title').textContent = active && current.gesture ? current.title : phase === 'lit' ? '许个愿' : current.tap;
    byId('gesture-detail').textContent = active && current.gesture
      ? current.detail
      : phase === 'lit' ? '许完愿，点一下画面或开启吹气。' : '点一下画面或下方按钮。';
  }

  byId('steps').hidden = phase === 'letter';
  for (const [index, element] of steps.entries()) {
    if (index === current.step) element.setAttribute('aria-current', 'step');
    else element.removeAttribute('aria-current');
  }
}

function advance(source) {
  setPhase(phases[phase].next, { recognized: source === 'recognized' });
}

function setPhase(next, { recognized = false } = {}) {
  const previous = phase;
  if (next === previous) return;
  clearTimeout(letterTimer);
  cancelAnimationFrame(typingFrame);
  phase = next;
  document.body.dataset.phase = phase;
  if (phase !== 'letter' || previous !== 'celebrated') particles.setPhase(phase);
  hold.update(null, performance.now());
  status.textContent = '';
  letter.hidden = phase !== 'letter';

  if (next === 'celebrated' || next === 'letter') stopCamera();
  if (next !== 'lit') stopMic();
  if (camera) {
    camera.lastHand = performance.now();
    camera.successUntil = recognized ? camera.lastHand + 520 : 0;
  }
  syncControls();
  sound.play(phase);
  if (recognized) flashRecognition(true);

  if (phase === 'celebrated') {
    byId('finale-skip').focus({ preventScroll: true });
    letterTimer = setTimeout(() => setPhase('letter'), reduced.matches ? 950 : 2680);
  }
  if (phase === 'letter') {
    heading.textContent = BirthdayCard.recipient ? BirthdayCard.recipient + '，生日快乐！' : '生日快乐！';
    if (BirthdayCard.signature) {
      byId('signature').textContent = '—— ' + BirthdayCard.signature;
      byId('signature').hidden = false;
    }
    renderGreeting();
    heading.focus({ preventScroll: true });
    const rect = scene.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > innerHeight) scene.scrollIntoView({ block: 'nearest' });
  }
}

function showTracking(label, progress = 0) {
  const tracker = byId('tracking-label');
  if (tracker.textContent !== label) tracker.textContent = label;
  byId('gesture-progress').style.transform = 'scaleX(' + progress + ')';
}

function outlineHand(points, matching) {
  const box = byId('hand-box');
  box.hidden = !points;
  if (!points) return;
  const minX = Math.max(0, Math.min(...points.map((point) => point.x)) - .03);
  const maxX = Math.min(1, Math.max(...points.map((point) => point.x)) + .03);
  const minY = Math.max(0, Math.min(...points.map((point) => point.y)) - .035);
  const maxY = Math.min(1, Math.max(...points.map((point) => point.y)) + .035);
  box.style.left = 100 * (1 - maxX) + '%';
  box.style.top = 100 * minY + '%';
  box.style.width = 100 * Math.max(0, maxX - minX) + '%';
  box.style.height = 100 * Math.max(0, maxY - minY) + '%';
  box.toggleAttribute('data-matching', matching);
}

function handleHand(results, session) {
  if (camera !== session || !session.active) return;
  const now = performance.now();
  const points = results.multiHandLandmarks?.[0];
  const gesture = BirthdayGestures.classify(points);
  const expected = phases[phase].gesture;
  if (points) session.lastHand = now;
  const matching = Boolean(expected && gesture === expected);
  outlineHand(points, matching);
  particles.setHand(gesture === 'point' ? points : null);
  if (now < session.successUntil) {
    showTracking('识别成功', 1);
    return;
  }
  const { progress, complete } = hold.update(matching ? gesture : null, now);
  if (complete) {
    advance('recognized');
  } else if (gesture === 'point') {
    showTracking('移动食指旋转');
  } else {
    showTracking(!points ? '把手放进画面' : matching ? '保持这个手势' : '试试当前手势', progress);
  }
}

function loadHands() {
  if (typeof window.Hands === 'function') return Promise.resolve(window.Hands);
  if (handsLibrary) return handsLibrary;
  handsLibrary = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('hands.js', modelRoot).href;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('本地模型加载失败'));
    };
    const timer = setTimeout(fail, 16000);
    script.onerror = fail;
    script.onload = () => {
      if (typeof window.Hands !== 'function') return fail();
      clearTimeout(timer);
      resolve(window.Hands);
    };
    document.head.append(script);
  }).catch((error) => {
    handsLibrary = null;
    throw error;
  });
  return handsLibrary;
}

function stopCamera(message) {
  const session = camera;
  camera = null;
  if (session) {
    cancelAnimationFrame(session.frame);
    clearTimeout(session.timer);
    session.stream?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.srcObject = null;
    if (session.hands) Promise.resolve(session.processing).catch(() => {}).then(() => session.hands.close()).catch(() => {});
  }
  hold.update(null, performance.now());
  particles.setHand(null);
  outlineHand(null, false);
  showTracking('等待手势');
  syncControls();
  if (message) {
    status.textContent = message;
    flashRecognition(false);
  }
}

function trackFrames(session) {
  let lastSent = 0;
  let lastVideoTime = -1;
  const interval = matchMedia('(max-width: 640px)').matches ? 82 : 60;
  async function frame(now) {
    if (camera !== session) return;
    if (now - session.lastHand > 22000) {
      stopCamera('暂时没有识别到手，已切回点击。');
      return;
    }
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastSent >= interval) {
      lastSent = now;
      lastVideoTime = video.currentTime;
      try {
        session.processing = session.hands.send({ image: video });
        await session.processing;
      } catch {
        if (camera === session) stopCamera('手势识别中断，已切回点击。');
      } finally {
        session.processing = null;
      }
    }
    if (camera === session) session.frame = requestAnimationFrame(frame);
  }
  session.frame = requestAnimationFrame(frame);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia || location.protocol === 'file:') {
    stopCamera('这里无法运行手势识别，可直接点击体验。');
    return;
  }
  stopMic();
  const session = {};
  camera = session;
  syncControls();
  status.textContent = '请在浏览器提示中允许摄像头。';
  session.timer = setTimeout(() => {
    if (camera === session) stopCamera('摄像头或模型启动超时，已切回点击。');
  }, 22000);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 } },
    });
    if (camera !== session) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    session.stream = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (camera === session) stopCamera('摄像头已断开，已切回点击。');
    });
    syncControls();
    showTracking('正在准备');
    status.textContent = '正在加载本站的手势模型。';
    video.srcObject = stream;
    const [Hands] = await Promise.all([loadHands(), video.play()]);
    if (camera !== session) return;
    session.hands = new Hands({ locateFile: (file) => new URL(file, modelRoot).href });
    session.hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: .55, minTrackingConfidence: .55 });
    session.hands.onResults((results) => handleHand(results, session));
    session.processing = session.hands.initialize();
    await session.processing;
    session.processing = null;
    if (camera !== session) return;
    clearTimeout(session.timer);
    session.active = true;
    session.lastHand = performance.now();
    session.successUntil = 0;
    status.textContent = '';
    if (phase === 'sealed') setPhase('stars');
    syncControls();
    trackFrames(session);
  } catch (error) {
    if (camera !== session) return;
    const messages = {
      NotAllowedError: '摄像头未获授权，已切回点击。',
      NotFoundError: '没有检测到摄像头，已切回点击。',
      NotReadableError: '摄像头可能被其他应用占用，已切回点击。',
    };
    stopCamera(messages[error.name] || '手势暂时不可用，已切回点击。');
  }
}

function updateMic(state, progress = 0, level = 0) {
  const ongoing = ['loading', 'calibrating', 'listening'].includes(state);
  if (phase !== 'lit') return;
  if (micRunning !== ongoing) {
    micRunning = ongoing;
    sound.setMicActive(ongoing);
    syncControls();
  }
  byId('mic-level').style.transform = 'scaleX(' + level + ')';
  byId('mic-progress').style.transform = 'scaleX(' + progress + ')';
  const hint = {
    loading: '请在浏览器提示中允许麦克风。',
    calibrating: '先安静片刻，正在校准环境声。',
    listening: progress > 0 ? '识别到吹气，保持一下。' : '麦克风已开启。朝麦克风轻吹约半秒。',
    denied: '麦克风未获授权，点一下蜡烛就能熄灭。',
    unavailable: '这里无法使用麦克风，点一下蜡烛就能熄灭。',
    timeout: '暂时没有识别到吹气，点一下蜡烛也能熄灭。',
    error: '麦克风暂时不可用，点一下蜡烛就能熄灭。',
  }[state] || '';
  if (status.textContent !== hint) status.textContent = hint;
  if (!ongoing && hint) flashRecognition(false);
}

function stopMic() {
  blow.stop();
  micRunning = false;
  sound.setMicActive(false);
  byId('mic-level').style.transform = 'scaleX(0)';
  byId('mic-progress').style.transform = 'scaleX(0)';
}

function markGuideSeen() {
  guideSeen = true;
  try { localStorage.setItem('birthday-guide-v1', 'seen'); } catch { /* Private mode may deny storage. */ }
}

function openDialog(mode) {
  guideMode = mode;
  const isGuide = mode === 'guide';
  const cameraMode = mode === 'camera';
  byId('dialog-title').textContent = isGuide ? '这张贺卡怎么玩' : '允许使用' + (cameraMode ? '摄像头' : '麦克风') + '？';
  byId('dialog-copy').textContent = isGuide
    ? '点击画面可以走完整场生日贺卡。想试隔空手势，再开启摄像头。'
    : '只在你的设备上识别' + (cameraMode ? '手势' : '吹气') + '。画面和声音不上传、不存储，也可以继续点击体验。';
  byId('dialog-steps').hidden = !(isGuide || (cameraMode && !guideSeen));
  byId('dialog-accept').textContent = isGuide ? '开启手势' : '继续授权';
  byId('dialog-dismiss').textContent = '用点击体验';
  if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
  else if (!dialog.open) dialog.setAttribute('open', '');
}

function closeDialog() {
  if (guideMode !== 'mic') markGuideSeen();
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

byId('guide-button').addEventListener('click', () => openDialog('guide'));
byId('dialog-dismiss').addEventListener('click', closeDialog);
byId('dialog-accept').addEventListener('click', () => {
  if (guideMode === 'guide') {
    markGuideSeen();
    openDialog('camera');
    return;
  }
  closeDialog();
  if (guideMode === 'camera') void startCamera();
  else if (phase === 'lit') {
    stopCamera();
    void blow.start();
  }
});
dialog.addEventListener('cancel', () => {
  if (guideMode !== 'mic') markGuideSeen();
});
cameraButton.addEventListener('click', () => {
  if (camera) stopCamera('摄像头已关闭，可以继续点击。');
  else openDialog('camera');
});
micButton.addEventListener('click', () => {
  if (!micRunning) {
    openDialog('mic');
    return;
  }
  stopMic();
  syncControls();
  status.textContent = '麦克风已关闭，可以点击蜡烛。';
});
byId('tap-button').addEventListener('click', advance);
byId('finale-skip').addEventListener('click', advance);
byId('shortcuts').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-jump]');
  if (!button) return;
  event.currentTarget.open = false;
  if (button.dataset.jump === 'celebrated' && phase === 'celebrated') return;
  setPhase(button.dataset.jump);
});

function stopInputs() {
  if (camera) stopCamera('摄像头已暂停，可以重新开启或继续点击。');
  if (micRunning) {
    stopMic();
    syncControls();
    status.textContent = '麦克风已暂停，可以点击蜡烛。';
  }
}
window.addEventListener('pagehide', stopInputs);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopInputs();
});

syncControls();
let guideSeen = false;
try { guideSeen = localStorage.getItem('birthday-guide-v1') === 'seen'; } catch { /* Optional onboarding flag. */ }
