'use strict';

function createPointCloud(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, depth: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const vertexSource = `
    attribute vec3 origin;
    attribute vec3 destination;
    attribute vec3 originColor;
    attribute vec3 cakeColor;
    attribute vec3 details;
    uniform vec2 viewport;
    uniform vec4 camera;
    uniform vec4 animation;
    uniform vec4 visibility;
    varying vec3 pigment;
    varying float opacity;
    varying float sparkle;

    void main() {
      float morph = animation.y;
      float radialSpread = animation.z;
      float time = animation.x;
      float stage = animation.w;
      float flame = details.z;
      float pulse = sin(time * 3.1 + details.y);

      vec3 point = mix(origin, destination, morph);
      float swirl = sin(morph * 3.14159) * (1.0 - details.x * 0.23) * 0.6;
      float spin = camera.z + swirl;
      float s = sin(spin);
      float c = cos(spin);
      float x = point.x * c - point.z * s;
      float z = point.x * s + point.z * c;
      float tiltSin = sin(camera.w);
      float tiltCos = cos(camera.w);
      float y = point.y * tiltCos + z * tiltSin;
      float depth = z * tiltCos - point.y * tiltSin;
      float perspective = 2.85 / max(0.8, 2.85 - depth * radialSpread);
      float flicker = sin(time * 7.6 + point.y * 12.0);
      x += flame * step(1.5, stage) * flicker * 0.018 * morph;
      y += sin(time * 1.8 + details.y) * mix(0.018, 0.008, morph);

      vec2 screen = vec2(viewport.x * 0.5, camera.y) +
        vec2(x, -y) * camera.x * perspective * radialSpread;
      gl_Position = vec4(screen.x / viewport.x * 2.0 - 1.0,
        1.0 - screen.y / viewport.y * 2.0, 0.0, 1.0);

      float front = smoothstep(-0.82, 0.85, depth);
      float nearGlow = step(1.1, details.x) * front;
      gl_PointSize = clamp((0.82 + details.x * 2.05 + nearGlow * 1.8) *
        perspective * visibility.y * visibility.w, 1.3, 10.0);
      pigment = mix(originColor, cakeColor, morph);
      pigment = mix(pigment, vec3(1.0, 0.97, 0.89), nearGlow * 0.45);
      opacity = (0.29 + front * 0.35 + pulse * 0.16 + nearGlow * 0.18) * visibility.x * visibility.z;
      sparkle = nearGlow;
      if (flame > 0.5 && stage > 0.5 && (stage < 1.5 || stage > 2.5)) opacity = 0.0;
      if (stage > 1.5 && stage < 2.5) {
        float warmth = 1.0 - smoothstep(0.0, 0.51, length(point - vec3(0.0, 0.71, 0.0)));
        pigment = mix(pigment, vec3(1.0, 0.76, 0.46), warmth * 0.46 * (1.0 - flame));
        opacity += warmth * 0.16 + flame * (0.18 + flicker * 0.11);
        gl_PointSize *= 1.0 + flame * 0.10;
      }
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec3 pigment;
    varying float opacity;
    varying float sparkle;

    void main() {
      vec2 uv = (gl_PointCoord - 0.5) * 2.0;
      float d = dot(uv, uv);
      float body = exp(-d * (6.8 - sparkle * 1.7)) * (1.0 - smoothstep(0.3, 1.0, d));
      float core = exp(-d * 20.0) * (0.25 + sparkle * 0.19);
      vec3 light = mix(pigment, vec3(1.0, 0.96, 0.91), core);
      gl_FragColor = vec4(light, clamp(opacity * (body + core), 0.0, 0.96));
    }
  `;

  function shader(kind, source) {
    const value = gl.createShader(kind);
    gl.shaderSource(value, source);
    gl.compileShader(value);
    if (gl.getShaderParameter(value, gl.COMPILE_STATUS)) return value;
    gl.deleteShader(value);
    return null;
  }

  const vertex = shader(gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const buffer = gl.createBuffer();
  const uniform = Object.fromEntries(['viewport', 'camera', 'animation', 'visibility']
    .map((name) => [name, gl.getUniformLocation(program, name)]));
  const attributes = ['origin', 'destination', 'originColor', 'cakeColor', 'details'];
  let count = 0;
  let unavailable = false;
  canvas.addEventListener('webglcontextlost', () => { unavailable = true; });
  gl.useProgram(program);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  return {
    get available() { return !unavailable; },
    setPoints(points, palette) {
      const colors = palette.map((hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255));
      const data = new Float32Array(points.length * 15);
      let offset = 0;
      for (const point of points) {
        const from = point.origin;
        const to = point.target;
        data.set([
          from.x, from.y, from.z, to.x, to.y, to.z,
          ...colors[point.color], ...colors[to.color],
          point.size, point.twinkle, to.flame ? 1 : 0,
        ], offset);
        offset += 15;
      }
      count = points.length;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (const [index, name] of attributes.entries()) {
        const position = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 60, index * 12);
      }
    },
    fit(width, height, dpr) {
      if (unavailable) return;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw({ width, height, scale, centerY, angle, tilt, t, morph, stretch, stage, visible,
      dpr, brightness, count: desiredCount }) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (visible <= 0) return;
      gl.uniform2f(uniform.viewport, width, height);
      gl.uniform4f(uniform.camera, scale, centerY, angle, tilt);
      gl.uniform4f(uniform.animation, t, morph, stretch, stage);
      const pointScale = 1 + (1 - desiredCount / count) * .27;
      gl.uniform4f(uniform.visibility, visible, dpr, brightness, pointScale);
      gl.drawArrays(gl.POINTS, 0, desiredCount);
    },
  };
}
