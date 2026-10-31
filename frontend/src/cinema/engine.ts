import { drawAtlas, drawRepoCard } from './atlas.ts';
import { CORE, FADE, LINES, OBJECTS, PARTICLES } from './shaders.ts';

/** Tunnel length in world units. The camera travels TRAVEL of it, so the core stays ahead at the end. */
export const TUNNEL_LENGTH = 420;
export const TRAVEL = 0.92;

export interface CinemaFrame {
  /** 0..1, how deep into the spiral (already smoothed by the caller). */
  progress: number;
  /** Absolute progress speed per second, drives the trail length. */
  speed: number;
  /** Pointer position, -1..1. */
  pointerX: number;
  pointerY: number;
  /** Milliseconds, monotonic. The spiral spins from this, so it never stops. */
  time: number;
}

export interface Cinema {
  resize(): void;
  render(frame: CinemaFrame): void;
  dispose(): void;
}

interface Options {
  lite: boolean;
  onLost(): void;
}

type M4 = Float32Array;

/* ---------- Matrices (column-major) ---------- */

function mul(a: M4, b: M4): M4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}
const identity = (): M4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function translation(x: number, y: number, z: number): M4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}
function rotationX(a: number): M4 {
  const m = identity();
  m[5] = Math.cos(a);
  m[6] = Math.sin(a);
  m[9] = -Math.sin(a);
  m[10] = Math.cos(a);
  return m;
}
function rotationY(a: number): M4 {
  const m = identity();
  m[0] = Math.cos(a);
  m[2] = -Math.sin(a);
  m[8] = Math.sin(a);
  m[10] = Math.cos(a);
  return m;
}
function rotationZ(a: number): M4 {
  const m = identity();
  m[0] = Math.cos(a);
  m[1] = Math.sin(a);
  m[4] = -Math.sin(a);
  m[5] = Math.cos(a);
  return m;
}
function perspective(fovY: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/* ---------- Deterministic layout ---------- */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

function buildParticles(count: number): Float32Array {
  const rand = rng(11);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const clustered = rand() < 0.7;
    const strand = Math.floor(rand() * 3);
    data[i * 4] = rand() * TUNNEL_LENGTH;
    data[i * 4 + 1] = clustered ? (strand * TAU) / 3 + (rand() - 0.5) * 0.5 : rand() * TAU;
    data[i * 4 + 2] = clustered ? [1.0, 0.82, 1.18][strand]! + (rand() - 0.5) * 0.22 : 0.3 + rand() * 1.1;
    data[i * 4 + 3] = clustered ? 0.25 + rand() * 0.75 : rand() * 0.45;
  }
  return data;
}

function buildRails(): Float32Array {
  const step = 0.9;
  const segments = Math.floor(TUNNEL_LENGTH / step);
  const rails: Array<{ phase: number; rad: number; alpha: number }> = [];
  for (let i = 0; i < 3; i++) rails.push({ phase: (i * TAU) / 3, rad: 1.0, alpha: 0.55 });
  for (let i = 0; i < 3; i++) rails.push({ phase: (i * TAU) / 3 + Math.PI / 3, rad: 0.62, alpha: 0.24 });
  const data = new Float32Array(rails.length * segments * 2 * 4);
  let o = 0;
  for (const rail of rails) {
    for (let s = 0; s < segments; s++) {
      for (const d of [s * step, (s + 1) * step]) {
        data[o++] = d;
        data[o++] = rail.phase;
        data[o++] = rail.rad;
        data[o++] = rail.alpha;
      }
    }
  }
  return data;
}

interface ObjectLayout {
  data: Float32Array; // d0, phase, rad, rnd per object
  size: Float32Array;
}

function buildObjects(count: number): ObjectLayout {
  const rand = rng(29);
  const rows: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < count; i++) {
    const d0 = 14 + ((i + rand() * 0.8) / count) * (TUNNEL_LENGTH - 34);
    rows.push([d0, rand() * TAU, 0.5 + rand() * 0.62, rand(), 1.0 + rand() * 1.15]);
  }
  rows.sort((a, b) => b[0] - a[0]); // far to near
  const data = new Float32Array(count * 4);
  const size = new Float32Array(count);
  rows.forEach((row, i) => {
    data.set(row.slice(0, 4), i * 4);
    size[i] = row[4];
  });
  return { data, size };
}

function buildLinks(objects: ObjectLayout): Float32Array {
  const count = objects.size.length;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < count - 1; i++) {
    pairs.push([i, i + 1]);
    if (i % 2 === 0 && i + 3 < count) pairs.push([i, i + 3]);
  }
  const out = new Float32Array(pairs.length * 2 * 4);
  pairs.forEach(([a, b], i) => {
    out.set(objects.data.subarray(a * 4, a * 4 + 4), i * 8);
    out.set(objects.data.subarray(b * 4, b * 4 + 4), i * 8 + 4);
  });
  return out;
}

/** Wireframe core: an icosahedron, three orbit rings and a small stack of report pages. */
function buildCore(): Float32Array {
  const verts: number[] = [];
  const push = (x: number, y: number, z: number, k: number) => verts.push(x, y, z, k);
  const phi = (1 + Math.sqrt(5)) / 2;
  const base: Array<[number, number, number]> = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) base.push([0, a, b], [a, b, 0], [b, 0, a]);
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const p = base[i]!;
      const q = base[j]!;
      const dist = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (Math.abs(dist - 2) < 0.01) {
        push(p[0], p[1], p[2], 1);
        push(q[0], q[1], q[2], 1);
      }
    }
  }
  const ring = (radius: number, tiltX: number, tiltZ: number) => {
    const seg = 72;
    for (let i = 0; i < seg; i++) {
      const pts = [i, i + 1].map((n) => {
        const a = (n / seg) * TAU;
        let x = Math.cos(a) * radius;
        let y = 0;
        let z = Math.sin(a) * radius;
        const y1 = y * Math.cos(tiltX) - z * Math.sin(tiltX);
        const z1 = y * Math.sin(tiltX) + z * Math.cos(tiltX);
        y = y1;
        z = z1;
        const x2 = x * Math.cos(tiltZ) - y * Math.sin(tiltZ);
        const y2 = x * Math.sin(tiltZ) + y * Math.cos(tiltZ);
        x = x2;
        y = y2;
        return [x, y, z] as const;
      });
      push(...pts[0]!, 0.5);
      push(...pts[1]!, 0.5);
    }
  };
  ring(2.3, 0.3, 0.2);
  ring(2.9, 1.1, -0.5);
  ring(3.5, -0.7, 0.9);
  for (const z of [-0.35, 0, 0.35]) {
    const w = 0.62;
    const h = 0.82;
    const corners: Array<[number, number]> = [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ];
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!;
      const q = corners[(i + 1) % 4]!;
      push(p[0], p[1], z, 0.95);
      push(q[0], q[1], z, 0.95);
    }
  }
  return new Float32Array(verts);
}

/* ---------- GL helpers ---------- */

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Spiral shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

function link(gl: WebGLRenderingContext, vert: string, frag: string, attributes: string[]): Program | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  attributes.forEach((name, index) => gl.bindAttribLocation(program, index, name));
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Spiral program failed to link:', gl.getProgramInfoLog(program));
    return null;
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    },
  };
}

function texture(gl: WebGLRenderingContext, source: HTMLCanvasElement, mipmaps: boolean): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmaps) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  return tex;
}

/* ---------- Engine ---------- */

export function createCinema(canvas: HTMLCanvasElement, options: Options): Cinema | null {
  const gl = canvas.getContext('webgl', {
    antialias: !options.lite,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // needed for the motion trails
  });
  if (!gl || gl.isContextLost()) return null;

  const particles = link(gl, PARTICLES.vert, PARTICLES.frag, ['aData']);
  const lines = link(gl, LINES.vert, LINES.frag, ['aData']);
  const objectsProgram = link(gl, OBJECTS.vert, OBJECTS.frag, ['aData', 'aCorner', 'aSize']);
  const core = link(gl, CORE.vert, CORE.frag, ['aPos', 'aK']);
  const fade = link(gl, FADE.vert, FADE.frag, ['aPos']);
  if (!particles || !lines || !objectsProgram || !core || !fade) return null;

  const buffer = (data: Float32Array): WebGLBuffer | null => {
    const b = gl.createBuffer();
    if (!b) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  };

  const particleData = buildParticles(options.lite ? 1300 : 2600);
  const railData = buildRails();
  const layout = buildObjects(options.lite ? 80 : 140);
  const linkData = buildLinks(layout);
  const coreData = buildCore();

  // Object quads: two triangles per object, interleaved (d0, phase, rad, rnd, cornerX, cornerY, size).
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ];
  const count = layout.size.length;
  const quads = new Float32Array(count * 6 * 7);
  for (let i = 0; i < count; i++) {
    corners.forEach(([cx, cy], v) => {
      const o = (i * 6 + v) * 7;
      quads.set(layout.data.subarray(i * 4, i * 4 + 4), o);
      quads[o + 4] = cx;
      quads[o + 5] = cy;
      quads[o + 6] = layout.size[i] as number;
    });
  }

  // Quad used by the core glow and the repository card, and a full-screen quad for the fade.
  const unitQuad = new Float32Array(6 * 4);
  corners.forEach(([x, y], i) => unitQuad.set([x, y, 0, 1], i * 4));
  const coreQuadBuffer = buffer(unitQuad);
  const bufParticles = buffer(particleData);
  const bufRails = buffer(railData);
  const bufLinks = buffer(linkData);
  const bufObjects = buffer(quads);
  const bufCore = buffer(coreData);
  const bufFade = buffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
  if (!coreQuadBuffer || !bufParticles || !bufRails || !bufLinks || !bufObjects || !bufCore || !bufFade) return null;

  const atlasTexture = texture(gl, drawAtlas(), true);
  const cardTexture = texture(gl, drawRepoCard(), false);
  if (!atlasTexture || !cardTexture) return null;

  const FLOATS = 4;
  const attrib = (index: number, size: number, stride: number, offset: number) => {
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, gl.FLOAT, false, stride * FLOATS, offset * FLOATS);
  };
  const disableAttribs = () => {
    for (let i = 0; i < 3; i++) gl.disableVertexAttribArray(i);
  };

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);

  let width = 1;
  let height = 1;
  let dpr = Math.min(window.devicePixelRatio || 1, options.lite ? 1.5 : 1.75);
  let slowFrames = 0;
  let lastTime = 0;
  let lost = false;

  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    options.onLost();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  const resize = () => {
    const cssW = Math.max(1, canvas.clientWidth);
    const cssH = Math.max(1, canvas.clientHeight);
    width = Math.round(cssW * dpr);
    height = Math.round(cssH * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.008, 0.016, 0.02, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const common = (p: Program, view: M4, proj: M4, t: number, twist: number, fovPx: number) => {
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.uniform('uView'), false, view);
    gl.uniformMatrix4fv(p.uniform('uProj'), false, proj);
    gl.uniform1f(p.uniform('uTime'), t);
    gl.uniform1f(p.uniform('uTwist'), twist);
    gl.uniform1f(p.uniform('uSpin'), 0.16);
    gl.uniform1f(p.uniform('uFlow'), 1.6);
    gl.uniform1f(p.uniform('uL'), TUNNEL_LENGTH);
    gl.uniform3f(p.uniform('uB'), TUNNEL_LENGTH * 0.357, TUNNEL_LENGTH * 0.583, TUNNEL_LENGTH * 0.81);
    gl.uniform1f(p.uniform('uPx'), fovPx);
  };

  const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const render = (frame: CinemaFrame) => {
    if (lost) return;
    const t = frame.time / 1000;

    // Adaptive resolution: if frames are consistently slow, render fewer pixels.
    if (lastTime) {
      const dt = frame.time - lastTime;
      slowFrames = dt > 28 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 40 && dpr > 1) {
        dpr = Math.max(1, dpr - 0.25);
        slowFrames = 0;
        resize();
      }
    }
    lastTime = frame.time;

    const aspect = width / height;
    const portrait = aspect < 1;
    const fovY = ((portrait ? 72 : 58) * Math.PI) / 180;
    const proj = perspective(fovY, aspect, 0.2, 700);
    const fovPx = height / (2 * Math.tan(fovY / 2));

    const depth = frame.progress * TRAVEL * TUNNEL_LENGTH;
    const camX = frame.pointerX * 0.9;
    const camY = -frame.pointerY * 0.6;
    const roll = Math.sin(t * 0.11) * 0.06 + frame.pointerX * 0.03;
    const view = mul(
      rotationZ(roll),
      mul(rotationY(-frame.pointerX * 0.05), mul(rotationX(-frame.pointerY * 0.035), translation(-camX, -camY, depth))),
    );
    const twist = frame.progress * 3.2;

    // Trails: dim the last frame instead of clearing it, only while moving fast.
    const keep = Math.min(0.5, Math.max(0, (frame.speed - 0.03) * 2.2));
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(fade.program);
    gl.uniform1f(fade.uniform('uFade'), 1 - keep);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufFade);
    attrib(0, 2, 2, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    disableAttribs();

    // Additive passes: rails, links, particles.
    gl.blendFunc(gl.ONE, gl.ONE);
    common(lines, view, proj, t, twist, fovPx);
    gl.uniform1f(lines.uniform('uDrift'), 0);
    gl.uniform1f(lines.uniform('uLinks'), 0);
    gl.uniform1f(lines.uniform('uBright'), 0.55);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufRails);
    attrib(0, 4, 4, 0);
    gl.drawArrays(gl.LINES, 0, railData.length / 4);

    gl.uniform1f(lines.uniform('uDrift'), 1);
    gl.uniform1f(lines.uniform('uLinks'), 1);
    gl.uniform1f(lines.uniform('uBright'), 0.7);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufLinks);
    attrib(0, 4, 4, 0);
    gl.drawArrays(gl.LINES, 0, linkData.length / 4);

    common(particles, view, proj, t, twist, fovPx);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufParticles);
    attrib(0, 4, 4, 0);
    gl.drawArrays(gl.POINTS, 0, particleData.length / 4);
    disableAttribs();

    // Icon panels, far to near, with premultiplied alpha.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    common(objectsProgram, view, proj, t, twist, fovPx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(objectsProgram.uniform('uTex'), 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufObjects);
    attrib(0, 4, 7, 0);
    attrib(1, 2, 7, 4);
    attrib(2, 1, 7, 6);
    gl.drawArrays(gl.TRIANGLES, 0, count * 6);
    disableAttribs();

    // Repository card at the entrance: fades as the camera flies through it.
    const cardDepth = 26;
    const cardAlpha = (1 - smoothstep(0.03, 0.075, frame.progress)) * 0.96;
    common(core, view, proj, t, twist, fovPx);
    if (cardAlpha > 0.01) {
      gl.uniform1f(core.uniform('uMode'), 2);
      gl.uniform1f(core.uniform('uAspect'), 4 / 3);
      gl.uniform1f(core.uniform('uAlpha'), cardAlpha);
      gl.uniform3f(core.uniform('uCenter'), portrait ? 0 : 8.4, portrait ? 3.4 : -0.6, -cardDepth);
      gl.uniform1f(core.uniform('uScale'), portrait ? 4.6 : 4.8);
      gl.uniform1f(core.uniform('uRotY'), -0.32 + Math.sin(t * 0.4) * 0.12);
      gl.uniform1f(core.uniform('uRotX'), 0.06);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cardTexture);
      gl.uniform1i(core.uniform('uTex'), 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, coreQuadBuffer);
      attrib(0, 3, 4, 0);
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib1f(1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Destination core: glow, then wireframe. Always present, brightest at the end.
    const coreAlpha = 0.18 + 0.82 * smoothstep(0.45, 0.98, frame.progress);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform3f(core.uniform('uCenter'), 0, 0, -TUNNEL_LENGTH);
    gl.uniform1f(core.uniform('uAlpha'), coreAlpha * 0.5);
    gl.uniform1f(core.uniform('uMode'), 1);
    gl.uniform1f(core.uniform('uScale'), 26);
    gl.bindBuffer(gl.ARRAY_BUFFER, coreQuadBuffer);
    attrib(0, 3, 4, 0);
    gl.disableVertexAttribArray(1);
    gl.vertexAttrib1f(1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.uniform1f(core.uniform('uMode'), 0);
    gl.uniform1f(core.uniform('uAlpha'), coreAlpha);
    gl.uniform1f(core.uniform('uScale'), 2.6);
    gl.uniform1f(core.uniform('uRotY'), t * 0.35);
    gl.uniform1f(core.uniform('uRotX'), 0.45 + Math.sin(t * 0.2) * 0.2);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCore);
    attrib(0, 3, 4, 0);
    attrib(1, 1, 4, 3);
    gl.drawArrays(gl.LINES, 0, coreData.length / 4);
    disableAttribs();
  };

  resize();

  return {
    resize,
    render,
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const b of [bufParticles, bufRails, bufLinks, bufObjects, bufCore, bufFade, coreQuadBuffer]) gl.deleteBuffer(b);
      gl.deleteTexture(atlasTexture);
      gl.deleteTexture(cardTexture);
      for (const p of [particles, lines, objectsProgram, core, fade]) gl.deleteProgram(p.program);
      // The context is not force-lost: React may mount this effect twice on the same canvas (dev mode),
      // and a lost context cannot be reused. The browser frees it when the canvas is removed.
    },
  };
}
