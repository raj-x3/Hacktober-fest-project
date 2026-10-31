/**
 * GLSL for the spiral. Every position is computed in the vertex shader from a few numbers per vertex,
 * so the CPU uploads static buffers once and only sets uniforms each frame.
 *
 * A point on the helix is described by:
 *   d      depth along the tunnel (0 at the entrance, uL at the core)
 *   phase  angle offset around the axis
 *   rad    radius factor
 * and spins with uSpin (continuous) plus uTwist (driven by scroll).
 */

const COMMON = /* glsl */ `
precision highp float;
uniform mat4 uView;
uniform mat4 uProj;
uniform float uTime;
uniform float uTwist;
uniform float uSpin;
uniform float uFlow;
uniform float uL;
uniform vec3 uB;
uniform float uPx;
const float R0 = 7.0;
const float K = 0.33;
const vec3 C0 = vec3(0.55, 0.95, 0.78);
const vec3 C1 = vec3(1.0, 0.74, 0.40);
const vec3 C2 = vec3(0.93, 0.91, 0.82);
const vec3 C3 = vec3(0.75, 1.0, 0.88);

float radiusAt(float d) {
  float conv = smoothstep(0.74 * uL, 0.97 * uL, d);
  return R0 * (1.0 - 0.86 * conv) + sin(d * 0.045 + uTime * 0.35) * 0.45;
}
vec3 helixPos(float d, float phase, float rad) {
  float ang = phase + d * K + uTime * uSpin + uTwist;
  float r = rad * radiusAt(d);
  return vec3(cos(ang) * r, sin(ang) * r, -d);
}
vec3 zoneColor(float d) {
  vec3 c = C0;
  c = mix(c, C1, smoothstep(uB.x - 14.0, uB.x + 14.0, d));
  c = mix(c, C2, smoothstep(uB.y - 14.0, uB.y + 14.0, d));
  c = mix(c, C3, smoothstep(uB.z - 14.0, uB.z + 14.0, d));
  return c;
}
float edgeFade(float d) {
  return smoothstep(0.0, 24.0, d) * (1.0 - smoothstep(uL - 36.0, uL - 6.0, d));
}
float boundaryFade(float d) {
  float bd = min(abs(d - uB.x), min(abs(d - uB.y), abs(d - uB.z)));
  return smoothstep(2.0, 10.0, bd);
}
float driftD(float d0) {
  return mod(d0 + uFlow * uTime, uL);
}
// Objects: the report zone snaps radii to a few rings, so the structure looks ordered.
vec3 objectPos(vec4 a, out float d) {
  d = driftD(a.x);
  float s2 = smoothstep(uB.y - 12.0, uB.y + 12.0, d) * (1.0 - smoothstep(uB.z + 12.0, uB.z + 40.0, d));
  float rad = mix(a.z, floor(a.z * 4.0 + 0.5) / 4.0, s2 * 0.9);
  return helixPos(d, a.y, rad);
}
float linkWeight(float d) {
  float z1 = smoothstep(uB.x - 12.0, uB.x + 12.0, d) * (1.0 - smoothstep(uB.y - 12.0, uB.y + 12.0, d));
  float z2 = smoothstep(uB.y - 12.0, uB.y + 12.0, d) * (1.0 - smoothstep(uB.z - 12.0, uB.z + 12.0, d));
  return z1 + 0.4 * z2 + 0.1;
}
`;

const GLOW_FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 4.0 * 5.0) * vA;
  gl_FragColor = vec4(vColor * a, a);
}
`;

const FLAT_FRAG = /* glsl */ `
precision mediump float;
varying vec3 vColor;
varying float vA;
void main() {
  gl_FragColor = vec4(vColor * vA, vA);
}
`;

/** Glowing dust and streaming particles, which drift along the helix. */
export const PARTICLES = {
  vert:
    COMMON +
    /* glsl */ `
attribute vec4 aData;
varying vec3 vColor;
varying float vA;
void main() {
  float d = driftD(aData.x);
  vec3 p = helixPos(d, aData.y, aData.z);
  vec4 v = uView * vec4(p, 1.0);
  float depth = -v.z;
  gl_Position = uProj * v;
  float size = mix(0.05, 0.22, aData.w) * uPx / max(depth, 0.5);
  gl_PointSize = clamp(size, 1.5, 30.0);
  float twinkle = 0.65 + 0.35 * sin(uTime * 1.7 + aData.y * 13.0);
  vA = 0.85 * twinkle * smoothstep(0.8, 4.0, depth) * (1.0 - smoothstep(60.0, 170.0, depth)) * edgeFade(d);
  vColor = zoneColor(d);
}`,
  frag: GLOW_FRAG,
};

/** Fixed helical rails (they only rotate) and links between objects (they drift with them). */
export const LINES = {
  vert:
    COMMON +
    /* glsl */ `
attribute vec4 aData;
uniform float uDrift;
uniform float uLinks;
uniform float uBright;
varying vec3 vColor;
varying float vA;
void main() {
  float d;
  vec3 p;
  if (uDrift > 0.5) {
    p = objectPos(aData, d);
  } else {
    d = aData.x;
    p = helixPos(d, aData.y, aData.z);
  }
  vec4 v = uView * vec4(p, 1.0);
  float depth = -v.z;
  gl_Position = uProj * v;
  float a = uBright * smoothstep(0.5, 5.0, depth) * (1.0 - smoothstep(70.0, 190.0, depth)) * edgeFade(d);
  if (uLinks > 0.5) a *= linkWeight(d) * boundaryFade(d);
  else a *= aData.w;
  vA = a;
  vColor = zoneColor(d);
}`,
  frag: FLAT_FRAG,
};

/** Icon panels. The icon type depends on which zone of the tunnel the object is currently in. */
export const OBJECTS = {
  vert:
    COMMON +
    /* glsl */ `
attribute vec4 aData;
attribute vec2 aCorner;
attribute float aSize;
varying vec3 vColor;
varying float vA;
varying vec2 vUv;
void main() {
  float d;
  vec3 p = objectPos(aData, d);
  vec4 v = uView * vec4(p, 1.0);
  float depth = -v.z;
  float zone = step(uB.x, d) + step(uB.y, d) + step(uB.z, d);
  float base = zone < 0.5 ? 0.0 : (zone < 1.5 ? 6.0 : 11.0);
  float count = zone < 0.5 ? 6.0 : 5.0;
  float tile = base + floor(aData.w * count);
  float col = mod(tile, 4.0);
  float row = floor(tile / 4.0);
  vUv = (vec2(col, row) + vec2(aCorner.x * 0.5 + 0.5, 0.5 - aCorner.y * 0.5)) / 4.0;
  float roll = (aData.w - 0.5) * 0.7 + sin(uTime * 0.3 + aData.w * 6.0) * 0.12;
  vec2 c = vec2(aCorner.x * cos(roll) - aCorner.y * sin(roll), aCorner.x * sin(roll) + aCorner.y * cos(roll));
  v.xy += c * aSize;
  gl_Position = uProj * v;
  vA = 0.92 * smoothstep(5.0, 13.0, depth) * (1.0 - smoothstep(50.0, 125.0, depth)) * edgeFade(d) * boundaryFade(d);
  vColor = mix(vec3(1.0), zoneColor(d), 0.78);
}`,
  frag: /* glsl */ `
precision mediump float;
uniform sampler2D uTex;
varying vec3 vColor;
varying float vA;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(t.rgb * vColor, t.a) * vA;
}`,
};

/**
 * The destination: wireframe core (mode 0), its glow (mode 1) and the repository card (mode 2).
 * The card and glow are drawn from a flat quad in aPos.
 */
export const CORE = {
  vert:
    COMMON +
    /* glsl */ `
attribute vec3 aPos;
attribute float aK;
uniform vec3 uCenter;
uniform float uScale;
uniform float uRotY;
uniform float uRotX;
uniform float uMode;
uniform float uAspect;
varying vec3 vColor;
varying float vA;
varying vec2 vUv;
varying float vMode;
void main() {
  vMode = uMode;
  vUv = aPos.xy;
  vec4 v;
  float depth;
  if (uMode > 0.5 && uMode < 1.5) {
    v = uView * vec4(uCenter, 1.0);
    v.xy += aPos.xy * uScale;
  } else {
    float cy = cos(uRotY), sy = sin(uRotY), cx = cos(uRotX), sx = sin(uRotX);
    vec3 q = aPos;
    if (uMode > 1.5) q.x *= uAspect;
    q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
    q = vec3(q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx);
    v = uView * vec4(q * uScale + uCenter, 1.0);
  }
  depth = -v.z;
  gl_Position = uProj * v;
  vA = aK * smoothstep(0.6, 3.0, depth);
  vColor = vec3(0.75, 1.0, 0.88);
}`,
  frag: /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTex;
uniform float uAlpha;
varying vec3 vColor;
varying float vA;
varying vec2 vUv;
varying float vMode;
void main() {
  if (vMode < 0.5) {
    float a = vA * uAlpha;
    gl_FragColor = vec4(vColor * a, a);
  } else if (vMode < 1.5) {
    float a = exp(-dot(vUv, vUv) * 3.6) * uAlpha;
    gl_FragColor = vec4(vec3(0.55, 1.0, 0.8) * a, a);
  } else {
    vec4 t = texture2D(uTex, vec2(vUv.x * 0.5 + 0.5, 0.5 - vUv.y * 0.5));
    gl_FragColor = t * (uAlpha * vA);
  }
}`,
};

/** Dims the previous frame instead of clearing it, which leaves short trails while scrolling fast. */
export const FADE = {
  vert: /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,
  frag: /* glsl */ `
precision mediump float;
uniform float uFade;
void main() { gl_FragColor = vec4(0.008, 0.016, 0.02, uFade); }`,
};
