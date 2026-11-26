'use strict';

function createParticleScene(canvas, cloudCanvas, { onTap } = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { setPhase() {}, setHand() {} };

  const tau = Math.PI * 2;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 640px)');
  const cloud = createPointCloud(cloudCanvas);
  const fallbackCount = narrow.matches ? 2200 : 3200;
  const total = cloud ? (narrow.matches ? 9000 : 13500) : fallbackCount;
  const sky = [];
  const foreground = [];
  const points = [];
  const pointers = new Map();
  const density = [1, .74, .52];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const bursts = [
    { x: .50, y: .29, time: .63, hue: 38, size: .39 },
    { x: .24, y: .43, time: 1.05, hue: 337, size: .30 },
    { x: .77, y: .35, time: 1.40, hue: 205, size: .34 },
    { x: .60, y: .47, time: 1.85, hue: 312, size: .30 },
    { x: .35, y: .29, time: 2.16, hue: 45, size: .28 },
  ];
  const palette = ['#866797', '#e08bc2', '#ffd8e8', '#ffbd91', '#fff2cd', '#ff8fcb'];
  let width = 0;
  let height = 0;
  let phase = 'sealed';
  let phaseAt = performance.now();
  let cakeAt = phaseAt;
  let orbitYaw = null;
  let orbitPitch = 0;
  let displayedYaw = 0;
  let displayedPitch = 0;
  let zoom = 1;
  let displayedZoom = 1;
  let gesture = null;
  let velocityX = 0;
  let velocityY = 0;
  let airAnchor = null;
  let frame = 0;
  let dpr = 1;
  let lastFrame = 0;
  let lastTick = 0;
  let quality = 0;
  let checkedQualityAt = phaseAt;
  let frameTime = 16.7;
  let paintTime = 0;
  let goodChecks = 0;
  let seed = 19204;

  function rand() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  const jitter = (amount) => (rand() - rand()) * amount;

  function galaxy(index) {
    const radius = .08 + Math.pow(rand(), .73) * 1.01;
    const angle = index % 3 * tau / 3 + radius * 4.25 + jitter(.67);
    return {
      x: Math.cos(angle) * radius,
      y: jitter(.24) + Math.sin(angle * 2) * .07,
      z: Math.sin(angle) * radius,
    };
  }

  function cake(index) {
    const unit = index / total;
    const a = rand() * tau;
    let r, y, color;
    if (unit < .13) {
      r = .73 + jitter(.095);
      y = -.57 + jitter(.033);
      color = rand() < .55 ? 3 : 2;
    } else if (unit < .86) {
      const tier = unit < .45 ? 0 : unit < .69 ? 1 : 2;
      const base = [-.53, -.18, .14][tier];
      const top = [-.19, .13, .41][tier];
      const radius = [.64, .49, .335][tier];
      const band = rand();
      if (band < .54) {
        r = radius + jitter(.029);
        y = (rand() < .73 ? top : base) + jitter(.021);
        color = rand() < .64 ? 4 : 2;
      } else if (band < .84) {
        r = radius + jitter(.055);
        y = base + (top - base) * rand();
        color = Math.sin(a * 10 + y * 21) > .25 ? 5 : 1;
      } else {
        r = radius * Math.sqrt(rand());
        y = top - rand() * .026;
        color = rand() < .78 ? 2 : 3;
      }
    } else if (unit < .94) {
      r = .033 + jitter(.012);
      y = .415 + rand() * .29;
      color = Math.sin(y * 104 + a) > -.18 ? 4 : 5;
    } else {
      const t = rand();
      r = Math.sin(t * Math.PI) * .081 * Math.sqrt(rand());
      y = .71 + t * .305;
      color = t < .52 ? 4 : 3;
      return { x: Math.cos(a) * r + t * .048, y, z: Math.sin(a) * r, color, flame: true };
    }
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, color, flame: false };
  }

  for (let i = 0; i < total; i += 1) {
    const origin = galaxy(i);
    const target = cake(i);
    points.push({
      origin, target, color: i % 6,
      size: .49 + Math.pow(rand(), 3) * 1.14, twinkle: rand() * tau,
    });
  }
  for (let i = 0; i < 130; i += 1) {
    sky.push({ x: rand(), y: rand(), size: .35 + Math.pow(rand(), 4) * 1.5, wave: rand() * tau });
  }
  for (const burst of bursts) {
    burst.sparks = Array.from({ length: narrow.matches ? 78 : 115 }, (_, index) => {
      const angle = tau * index / (narrow.matches ? 78 : 115) + jitter(.35);
      const speed = .32 + Math.pow(rand(), .56) * .95;
      return {
        x: Math.cos(angle) * speed, y: Math.sin(angle) * speed,
        size: .55 + rand() * 1.22, fade: .64 + rand() * .9, phase: rand() * tau,
      };
    });
  }
  // A shuffled prefix samples every cake tier, rim and candle at every density.
  for (let i = points.length - 1; i > 0; i -= 1) {
    const other = Math.floor(rand() * (i + 1));
    [points[i], points[other]] = [points[other], points[i]];
  }
  cloud?.setPoints(points, palette);

  for (let i = 0; i < 17; i += 1) {
    foreground.push({
      x: rand(), y: rand(), size: .55 + rand() * 1.25,
      wave: rand() * tau, warm: rand() > .48,
    });
  }

  function renderSky(t, brightness) {
    ctx.fillStyle = '#fbe4ff';
    const xDrift = Math.sin(displayedYaw) * 4;
    const yDrift = Math.sin(displayedPitch) * 4;
    const count = quality ? 106 : sky.length;
    for (let i = 0; i < count; i += 1) {
      const star = sky[i];
      const x = star.x * width + Math.sin(t * .12 + star.wave) * 6 + xDrift;
      const y = star.y * height + Math.cos(t * .18 + star.wave) * 4 + yDrift;
      ctx.globalAlpha = (.10 + (.12 + .13 * Math.sin(t * .65 + star.wave)) * star.size) * brightness;
      ctx.fillRect(x, y, star.size, star.size);
    }
    ctx.globalAlpha = 1;
  }

  function renderForeground(t) {
    const count = quality ? 11 : foreground.length;
    const parallaxX = Math.sin(displayedYaw * .6) * 21;
    const parallaxY = Math.sin(displayedPitch) * 18;
    for (let i = 0; i < count; i += 1) {
      const star = foreground[i];
      const x = star.x * width + Math.sin(t * .22 + star.wave) * 13 + parallaxX;
      const y = star.y * height + Math.cos(t * .17 + star.wave) * 10 + parallaxY;
      const strength = .14 + Math.sin(t * .75 + star.wave) * .095;
      ctx.fillStyle = star.warm ? '#ffd6a4' : '#f3c9fe';
      ctx.globalAlpha = strength * .22;
      ctx.beginPath();
      ctx.arc(x, y, star.size * 3.1, 0, tau);
      ctx.fill();
      ctx.globalAlpha = strength;
      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, tau);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function firework(burst, elapsed, scale) {
    const time = elapsed - burst.time;
    const x = burst.x * width;
    const y = burst.y * height;
    if (time >= -.51 && time < 0 && !reduced.matches) {
      const rise = (time + .51) / .51;
      const tail = (height - y) * (1 - rise) ** 2 + y;
      const trail = ctx.createLinearGradient(x, tail, x, tail + 42);
      trail.addColorStop(0, 'rgba(255, 228, 177, .9)');
      trail.addColorStop(1, 'rgba(255, 160, 119, 0)');
      ctx.fillStyle = trail;
      ctx.fillRect(x - 1, tail, 2.1, 42);
      return;
    }
    if (time < 0 || time > 2.2) return;

    const travel = (1 - Math.exp(-2.8 * time)) * scale * burst.size * 2;
    const tailTravel = (1 - Math.exp(-2.8 * Math.max(0, time - .20))) * scale * burst.size * 2;
    const fall = time * time * 29;
    if (time < .36) {
      const light = ctx.createRadialGradient(x, y, 0, x, y, 46);
      light.addColorStop(0, `hsla(${burst.hue}, 100%, 86%, ${.72 * (1 - time / .36)})`);
      light.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = light;
      ctx.fillRect(x - 46, y - 46, 92, 92);
    }
    ctx.strokeStyle = `hsl(${burst.hue} 100% 77%)`;
    ctx.fillStyle = `hsl(${burst.hue} 100% 91%)`;
    const stride = quality === 2 ? 2 : 1;
    for (let i = 0; i < burst.sparks.length; i += stride) {
      const spark = burst.sparks[i];
      const fade = Math.exp(-time * spark.fade) * (1 - time / 2.2);
      const px = x + spark.x * travel;
      const py = y + spark.y * travel + fall;
      ctx.globalAlpha = Math.max(0, fade * (.77 + .23 * Math.sin(time * 25 + spark.phase)));
      ctx.lineWidth = spark.size * .85;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x + spark.x * tailTravel, y + spark.y * tailTravel + fall - time * 6);
      ctx.stroke();
      ctx.fillRect(px, py, spark.size, spark.size);
    }
    ctx.globalAlpha = 1;
  }

  function fallingEmbers(burst, elapsed, scale) {
    const time = elapsed - burst.time;
    if (time < .75 || time > 4.5) return;
    const age = time - .75;
    const verticalScale = Math.min(1, height / 480);
    const spread = (1 - Math.exp(-2.8 * time)) * scale * burst.size * 2;
    const fall = time * time * 29 * verticalScale;
    ctx.strokeStyle = `hsl(${burst.hue} 92% 69%)`;
    ctx.fillStyle = '#fff0cc';
    const stride = quality ? 9 : 6;
    for (let i = 0; i < burst.sparks.length; i += stride) {
      const spark = burst.sparks[i];
      const glow = Math.min(1, age * 4) * (1 - age / 3.75) ** 1.65;
      const x = burst.x * width + spark.x * spread + Math.sin(time * 2 + spark.phase) * age * 3;
      const y = burst.y * height + spark.y * spread + fall;
      ctx.globalAlpha = glow * (.38 + .26 * Math.sin(time * 21 + spark.phase));
      ctx.lineWidth = .5 + spark.size * .35;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(time * 2 + spark.phase) * 3, y - 7 - age * 5);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha += glow * .22;
      ctx.fillRect(x, y, 1.1, 1.1);
    }
    ctx.globalAlpha = 1;
  }

  function drawRims(scale, centerY, tilt, amount) {
    const rims = [[.73, -.57], [.64, -.19], [.49, .13], [.335, .41]];
    ctx.strokeStyle = '#ffcda8';
    for (const [radius, y] of rims) {
      ctx.beginPath();
      for (let segment = 0; segment <= 72; segment += 1) {
        const angle = segment / 72 * tau;
        const z = Math.sin(angle) * radius;
        const perspective = 2.85 / (2.85 - z * Math.cos(tilt) + y * Math.sin(tilt));
        const x = width * .5 + Math.cos(angle) * radius * scale * perspective;
        const py = centerY - (y * Math.cos(tilt) + z * Math.sin(tilt)) * scale * perspective;
        if (segment === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.globalAlpha = amount * .055;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.globalAlpha = amount * .26;
      ctx.lineWidth = .8;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function renderCandle(scale, centerY, st, ct, sin, cos, t) {
    // The glow follows the same view transform as the wick and flame particles.
    const project = (x, y) => {
      const z = x * sin;
      const perspective = 2.85 / (2.85 - z * ct + y * st);
      return [
        width * .5 + x * cos * scale * perspective,
        centerY - (y * ct + z * st) * scale * perspective,
      ];
    };
    const flicker = .87 + Math.sin(t * 6.4) * .08 + Math.sin(t * 13.1) * .05;
    const [wickX, wickY] = project(0, .713);
    const [glowX, glowY] = project(.023 + Math.sin(t * 4.8) * .013, .835);
    const [tipX, tipY] = project(.033 + Math.sin(t * 7.4) * .019, .934);
    const radius = scale * .39;
    const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, radius);
    glow.addColorStop(0, `rgba(255, 214, 149, ${flicker * .54})`);
    glow.addColorStop(.19, `rgba(255, 174, 105, ${flicker * .23})`);
    glow.addColorStop(.52, `rgba(255, 113, 67, ${flicker * .07})`);
    glow.addColorStop(1, 'rgba(255, 100, 63, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(glowX - radius, glowY - radius, radius * 2, radius * 2);

    const glowSize = scale * .066;
    const core = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowSize);
    core.addColorStop(0, `rgba(255, 248, 209, ${flicker * .83})`);
    core.addColorStop(.4, `rgba(255, 215, 133, ${flicker * .46})`);
    core.addColorStop(1, 'rgba(255, 138, 59, 0)');
    ctx.fillStyle = core;
    ctx.fillRect(glowX - glowSize, glowY - glowSize, glowSize * 2, glowSize * 2);

    const flameWidth = scale * .027;
    ctx.fillStyle = '#fff4d0';
    ctx.globalAlpha = flicker * .65;
    ctx.beginPath();
    ctx.moveTo(wickX, wickY);
    ctx.quadraticCurveTo(glowX - flameWidth, glowY, tipX, tipY);
    ctx.quadraticCurveTo(glowX + flameWidth, glowY, wickX, wickY);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function paint(now, still = false) {
    if (!width || !height) return;
    const elapsed = still ? 1.23 : Math.max(0, (now - phaseAt) / 1000);
    const t = still ? .85 : now / 1000;
    const sealed = phase === 'sealed';
    const stars = phase === 'stars';
    const galaxyStage = sealed || stars;
    const lit = phase === 'lit';
    const finale = phase === 'celebrated';
    const letter = phase === 'letter';
    const dt = Math.min(.056, (now - lastFrame) / 1000);
    if (!still && !pointers.size && (velocityX || velocityY)) {
      const decay = Math.exp(-6.5 * dt);
      const travel = (1 - decay) / 6.5;
      rotateBy(velocityX * travel, velocityY * travel);
      velocityX *= decay;
      velocityY *= decay;
      if (Math.hypot(velocityX, velocityY) < 5) stopInertia();
    }
    const viewBlend = still ? 1 : 1 - Math.exp(-dt / .047);
    displayedZoom += (zoom - displayedZoom) * viewBlend;
    const baseScale = Math.min(width * .48, height * .49);
    const scale = baseScale * displayedZoom;
    const yaw = orbitYaw ?? t * .165;
    displayedYaw = orbitYaw === null ? yaw : displayedYaw + (yaw - displayedYaw) * viewBlend;
    displayedPitch += (orbitPitch - displayedPitch) * viewBlend;
    const angle = displayedYaw;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const morph = galaxyStage ? 0 : still ? 1 : 1 - Math.exp(-Math.max(0, now - cakeAt) / 320);
    const centerY = height * (.51 + morph * .02);
    const tilt = clamp(.50 - morph * .26 + displayedPitch, -.62, 1.1);
    const st = Math.sin(tilt);
    const ct = Math.cos(tilt);
    const stretch = finale ? 1 + (1 - Math.exp(-elapsed * 3.5)) * 1.8 : 1;
    const visible = letter ? 0 : finale ? Math.max(0, 1 - elapsed / 1.3) : 1;
    const brightness = stars ? 1 + (still ? .52 : .52 * (1 - Math.exp(-elapsed * 3.8))) : 1;
    const useCloud = Boolean(cloud?.available);
    const count = Math.round((useCloud ? total : fallbackCount) * density[quality]);
    const renderer = useCloud ? 'webgl' : 'canvas';
    if (canvas.dataset.renderer !== renderer) canvas.dataset.renderer = renderer;
    if (canvas.dataset.particles !== String(count)) canvas.dataset.particles = String(count);

    ctx.clearRect(0, 0, width, height);
    renderSky(t, brightness);

    ctx.globalCompositeOperation = 'lighter';
    if (useCloud) {
      cloud.draw({
        width, height, scale, centerY, tilt, angle, t, morph, stretch, visible,
        dpr, brightness, count, stage: galaxyStage ? 0 : lit ? 2 : finale ? 3 : 1,
      });
    } else if (visible) {
      for (let index = 0; index < count; index += 1) {
        const p = points[index];
        if (!galaxyStage && p.target.flame && !lit) continue;
        const x = p.origin.x + (p.target.x - p.origin.x) * morph;
        const y = p.origin.y + (p.target.y - p.origin.y) * morph;
        const z = p.origin.z + (p.target.z - p.origin.z) * morph;
        const sway = Math.sin(t * 1.5 + p.twinkle) * (galaxyStage ? .017 : .007);
        const flicker = p.target.flame && lit ? Math.sin(t * 7.6 + y * 12) * .018 : 0;
        const px = x * cos - z * sin + flicker;
        const depthZ = x * sin + z * cos;
        const py = y * ct + depthZ * st + sway;
        const depth = depthZ * ct - y * st;
        const perspective = 2.85 / Math.max(.8, 2.85 - depth * stretch);
        const sx = width * .5 + px * scale * perspective * stretch;
        const sy = centerY - py * scale * perspective * stretch;
        const size = p.size * perspective * (1 + quality * .13);
        const color = morph < .35 ? p.color : p.target.color;

        ctx.fillStyle = palette[color];
        const warm = lit ? Math.max(0, .21 - Math.hypot(x, y - .60, z) * .39) : 0;
        ctx.globalAlpha = clamp(visible * brightness *
          (.42 + .28 * perspective + .14 * Math.sin(t * 3 + p.twinkle) + warm), 0, 1);
        ctx.fillRect(sx - size * .5, sy - size * .5, size, size);
        if (quality === 0 && size > 1.5) {
          ctx.globalAlpha *= .15;
          ctx.fillRect(sx - size * 1.15, sy - size * 1.15, size * 2.3, size * 2.3);
        }
      }
    }
    ctx.globalAlpha = 1;
    if (!galaxyStage && !finale && !letter && morph > .14) drawRims(scale, centerY, tilt, morph);
    if (lit) renderCandle(scale, centerY, st, ct, sin, cos, t);
    if (finale) {
      for (const burst of bursts) {
        firework(burst, still ? burst.time + .63 : elapsed, baseScale);
        if (!still) fallingEmbers(burst, elapsed, baseScale);
      }
    }
    renderForeground(t);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function animate(now) {
    if (phase === 'letter' || (phase === 'celebrated' && now - phaseAt > 6700)) {
      paint(now);
      frame = 0;
      return;
    }

    const gap = now - lastTick;
    if (lastTick && gap < 160) frameTime += (gap - frameTime) * .09;
    lastTick = now;
    if (now - checkedQualityAt > 1150) {
      checkedQualityAt = now;
      if (frameTime > 23 || paintTime > 12) {
        quality = Math.min(quality + 1, density.length - 1);
        goodChecks = 0;
      } else if (frameTime < 19 && paintTime < 7) {
        goodChecks += 1;
        if (quality && goodChecks >= 4) {
          quality -= 1;
          goodChecks = 0;
        }
      } else {
        goodChecks = 0;
      }
    }
    const interval = Math.max(narrow.matches ? 21 : 13, 13 + quality * 6);
    if (now - lastFrame >= interval) {
      const started = performance.now();
      paint(now);
      paintTime += (performance.now() - started - paintTime) * .12;
      lastFrame = now;
    }
    frame = requestAnimationFrame(animate);
  }

  function refresh() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTick = 0;
    if (reduced.matches || phase === 'letter') {
      stopInertia();
      paint(performance.now(), true);
    } else {
      frame = requestAnimationFrame(animate);
    }
  }

  function fit() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    dpr = Math.min(devicePixelRatio || 1, 1.65);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cloud?.fit(width, height, dpr);
    if (reduced.matches || phase === 'letter') paint(performance.now(), true);
    else if (!frame) paint(performance.now());
  }

  function stopInertia() {
    velocityX = 0;
    velocityY = 0;
  }

  function rotateBy(dx, dy) {
    const now = performance.now();
    const autoYaw = (reduced.matches ? .85 : now / 1000) * .165;
    orbitYaw = (orbitYaw ?? autoYaw) + dx * .009;
    orbitPitch = clamp(orbitPitch + dy * .007, -.85, .75);
    if (reduced.matches) paint(now, true);
  }

  function interactive() {
    return phase !== 'celebrated' && phase !== 'letter';
  }

  function trackFinger(tip) {
    if (!tip || pointers.size || !interactive()) {
      airAnchor = null;
      return;
    }
    const now = performance.now();
    const dx = airAnchor ? airAnchor.x - tip.x : 0;
    const dy = airAnchor ? tip.y - airAnchor.y : 0;
    if (!airAnchor || now - airAnchor.seen > 250 || Math.max(Math.abs(dx), Math.abs(dy)) > .25) {
      airAnchor = { x: tip.x, y: tip.y, seen: now };
      return;
    }
    airAnchor.seen = now;
    if (Math.hypot(dx, dy) < .005) return;
    const distance = Math.min(width, height) * 1.7;
    stopInertia();
    rotateBy(dx * distance, dy * distance);
    airAnchor.x = tip.x;
    airAnchor.y = tip.y;
  }

  function releasePointer(id) {
    pointers.delete(id);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }

  function resetGesture() {
    gesture = null;
    for (const id of pointers.keys()) releasePointer(id);
    canvas.removeAttribute('data-dragging');
    stopInertia();
  }

  function pinchDistance() {
    const [first, second] = pointers.values();
    return second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  }

  canvas.addEventListener('pointerdown', (event) => {
    const { pointerId, pointerType, clientX, clientY, timeStamp } = event;
    if (!interactive() || event.button !== 0 || pointers.has(pointerId)) return;
    if (pointers.size && (pointerType !== 'touch' || gesture.type !== 'touch')) return;
    if (pointers.size >= 2) return;
    airAnchor = null;
    stopInertia();
    pointers.set(pointerId, { x: clientX, y: clientY, movedAt: timeStamp });
    canvas.setPointerCapture(pointerId);
    if (pointers.size === 1) {
      gesture = {
        type: pointerType, x: clientX, y: clientY, started: timeStamp,
        slop: pointerType === 'touch' ? 10 : 6, moved: false, multiple: false,
      };
      return;
    }
    gesture.multiple = true;
    gesture.pinch = Math.max(1, pinchDistance());
    gesture.zoom = zoom;
    canvas.setAttribute('data-dragging', '');
  });

  canvas.addEventListener('pointermove', (event) => {
    const { pointerId, clientX, clientY, timeStamp } = event;
    const pointer = pointers.get(pointerId);
    if (!pointer) return;
    const dx = clientX - pointer.x;
    const dy = clientY - pointer.y;
    const seconds = Math.max(.008, (timeStamp - pointer.movedAt) / 1000);
    pointer.x = clientX;
    pointer.y = clientY;
    pointer.movedAt = timeStamp;
    if (pointers.size === 2) {
      zoom = clamp(gesture.zoom * pinchDistance() / gesture.pinch, .72, 1.48);
      if (reduced.matches) paint(performance.now(), true);
      return;
    }
    if (!gesture.moved && !gesture.multiple) {
      if (Math.hypot(clientX - gesture.x, clientY - gesture.y) < gesture.slop) return;
      gesture.moved = true;
      canvas.setAttribute('data-dragging', '');
      rotateBy(clientX - gesture.x, clientY - gesture.y);
    } else {
      rotateBy(dx, dy);
    }
    if (!reduced.matches && !gesture.multiple) {
      velocityX = clamp(dx / seconds, -1500, 1500) * .65 + velocityX * .35;
      velocityY = clamp(dy / seconds, -1500, 1500) * .65 + velocityY * .35;
    }
  });

  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(eventName, (event) => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      if (eventName !== 'pointerup') gesture.cancelled = true;
      releasePointer(event.pointerId);
      if (pointers.size) return;
      const { x, y, started, slop, moved, multiple, cancelled } = gesture;
      const bounds = canvas.getBoundingClientRect();
      const inside = event.clientX >= bounds.left && event.clientX < bounds.right &&
        event.clientY >= bounds.top && event.clientY < bounds.bottom;
      const tap = !moved && !multiple && !cancelled && inside && event.timeStamp - started < 500 &&
        Math.hypot(event.clientX - x, event.clientY - y) < slop;
      if (!moved || multiple || cancelled || event.timeStamp - pointer.movedAt > 95) stopInertia();
      gesture = null;
      canvas.removeAttribute('data-dragging');
      if (tap && interactive()) onTap?.(event);
    });
  }

  const arrowStep = { ArrowLeft: [-25, 0], ArrowRight: [25, 0], ArrowUp: [0, -25], ArrowDown: [0, 25] };
  canvas.addEventListener('keydown', (event) => {
    if (!interactive() || pointers.size) return;
    const delta = arrowStep[event.key];
    if (!delta && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (delta) {
      stopInertia();
      rotateBy(...delta);
    } else if (!event.repeat) {
      onTap?.(event);
    }
  });

  const originalTabIndex = canvas.tabIndex;
  new ResizeObserver(fit).observe(canvas);
  reduced.addEventListener('change', refresh);
  fit();
  refresh();
  return {
    setPhase(next) {
      if (next === phase) return;
      phase = next;
      phaseAt = performance.now();
      airAnchor = null;
      if (next === 'ready') cakeAt = phaseAt;
      resetGesture();
      canvas.tabIndex = interactive() ? originalTabIndex : -1;
      refresh();
    },
    setHand(points) {
      trackFinger(points?.[8]);
    },
  };
}
