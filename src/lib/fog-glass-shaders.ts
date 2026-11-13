export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** 4-tap box downsample (avoids aliasing when shrinking 4x). */
export const DOWN = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSrcTexel;
out vec4 o;
void main() {
  vec2 d = uSrcTexel;
  vec3 c = texture(uTex, vUv + vec2(-d.x, -d.y)).rgb
         + texture(uTex, vUv + vec2( d.x, -d.y)).rgb
         + texture(uTex, vUv + vec2(-d.x,  d.y)).rgb
         + texture(uTex, vUv + vec2( d.x,  d.y)).rgb;
  o = vec4(c * 0.25, 1.0);
}
`;

/** Separable gaussian using linear-sampled taps. */
export const BLUR = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir; // texel step * direction
out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  o = vec4(c, 1.0);
}
`;

export const FINAL = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSharp;
uniform sampler2D uBlur;
uniform sampler2D uMask;
uniform sampler2D uWide; // very wide blur for halos
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uDrops; // 1 = show water beads, 0 = plain fog
out vec4 o;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash2(vec2 p) {
  float n = hash(p);
  return vec2(n, hash(p + n * 17.17));
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

// Field of round droplets. Returns (normal.xy, height) of the tallest drop under px.
vec3 droplets(vec2 px, float cell, float rMin, float rMax, float density) {
  vec2 g = px / cell;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec3 best = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 cid = id + o;
      if (hash(cid + 3.3) > density) continue;
      vec2 c = o + 0.15 + hash2(cid) * 0.7;
      float r = mix(rMin, rMax, pow(hash(cid * 1.91 + 7.0), 2.2));
      vec2 d = f - c;
      d.y *= 0.92; // slightly flattened by gravity
      float dist = length(d) / r;
      if (dist < 1.0) {
        float h = sqrt(1.0 - dist * dist);
        if (h > best.z) best = vec3(d / r, h);
      }
    }
  }
  return best;
}

vec3 shadeDrop(vec3 dd, vec2 uv, vec3 milk, float strength) {
  // a bead is a tiny lens: a clearer, flipped view of what's behind it
  vec2 off = -dd.xy * 0.012 * strength;
  vec3 refr = mix(texture(uSharp, uv + off).rgb, texture(uBlur, uv + off * 1.5).rgb, 0.45);
  refr = refr * 1.06 + 0.025;
  vec3 n = normalize(vec3(dd.xy * 1.7, dd.z));
  vec3 L = normalize(vec3(-0.4, 0.7, 0.8));
  float spec = pow(clamp(dot(reflect(-L, n), vec3(0, 0, 1)), 0.0, 1.0), 28.0);
  float rim = 1.0 - smoothstep(0.0, 0.38, dd.z);
  // light from behind is focused onto the lower edge → bright crescent; upper rim reads darker
  float crescent = smoothstep(0.15, 0.85, -dd.xy.y) * rim;
  float lumB = dot(texture(uBlur, uv).rgb, vec3(0.333));
  // mostly a clearer patch of fog; strong colour/darkness would read as dirt
  vec3 c = mix(milk, mix(milk, refr, 0.38), smoothstep(0.0, 0.3, dd.z));
  c *= 1.0 - rim * (0.05 + 0.1 * clamp(dd.xy.y, 0.0, 1.0));
  c += crescent * (0.1 + lumB * 0.35);
  return c + spec * 0.8;
}

void main() {
  vec2 uv = vUv;
  vec2 px = gl_FragCoord.xy / uDpr; // css px
  vec3 sharp = texture(uSharp, uv).rgb;
  vec3 blur = texture(uBlur, uv).rgb;
  vec3 wide = texture(uWide, uv).rgb;
  float m = texture(uMask, uv).a;

  // fog thickness varies softly; colder frame edges and the bottom of the pane fog up more
  float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y) * 1.4);
  float thick = 0.9 + 0.22 * fbm(px / 230.0) - 0.06 * fbm(px / 38.0 + 5.0);
  thick += 0.14 * (1.0 - smoothstep(0.0, 0.16, edgeDist)) + 0.06 * (1.0 - uv.y);
  float fog = clamp(m * thick, 0.0, 1.0);

  // milky fog: scattered light = blurred, lifted, desaturated; bright lights bloom into halos
  vec3 scatter = mix(blur, wide, 0.3);
  float lum = dot(scatter, vec3(0.299, 0.587, 0.114));
  vec3 milk = mix(scatter, vec3(lum), 0.28) * 1.06 + vec3(0.80, 0.84, 0.88) * 0.18 * (1.0 - lum * 0.6);
  milk = mix(milk, vec3(0.86, 0.89, 0.92), 0.07);
  vec3 halo = max(wide - 0.35, 0.0) * 0.9 + max(blur - 0.6, 0.0) * 0.35;
  halo *= 1.0 - smoothstep(0.45, 0.85, lum); // already-bright scenes don't need extra bloom
  milk += halo * fog;

  // very fine mist (texture only) + occasional bigger beads
  vec3 d1 = droplets(px, 3.0, 0.12, 0.34, 0.8);
  vec3 d2 = droplets(px + 41.0, 26.0, 0.06, 0.22, 0.14);
  float dropVis = smoothstep(0.45, 0.9, fog) * uDrops;
  vec3 fogCol = milk;
  if (d2.z > 0.0) fogCol = mix(fogCol, shadeDrop(d2, uv, milk, 1.0), dropVis * smoothstep(0.0, 0.12, d2.z));
  else if (d1.z > 0.0) fogCol = mix(fogCol, shadeDrop(d1, uv, milk, 0.4), dropVis * 0.3 * d1.z);

  // wiped area is wet: a touch darker and more contrasty
  vec3 wet = pow(sharp, vec3(1.04)) * 0.97;
  // even a thin film scatters light: blur kicks in fast, milkiness builds with thickness
  vec3 scattered = mix(wet, blur * 1.03 + halo * 0.3, smoothstep(0.02, 0.35, fog));
  vec3 col = mix(scattered, fogCol, smoothstep(0.12, 0.9, fog));

  // what the finger leaves behind: a sprinkle of tiny clear droplets on the wet glass
  float clearZone = (1.0 - smoothstep(0.03, 0.25, m)) * uDrops;
  vec3 d4 = droplets(px + 13.0, 8.0, 0.05, 0.2, 0.28);
  if (d4.z > 0.0 && clearZone > 0.01) {
    col = mix(col, shadeDrop(d4, uv, col, 0.7), clearZone * 0.75 * smoothstep(0.0, 0.2, d4.z));
  }

  // finger pushes water to the edge of the wipe: ridge of bigger drops
  float ridge = smoothstep(0.04, 0.3, m) * (1.0 - smoothstep(0.38, 0.75, m));
  vec3 d3 = droplets(px + 97.0, 9.0, 0.16, 0.4, 0.6);
  if (uDrops > 0.5 && d3.z > 0.0 && ridge > 0.05) {
    vec3 dc = shadeDrop(d3, uv, mix(wet, milk, 0.5), 1.2);
    col = mix(col, dc, clamp(ridge * 1.3, 0.0, 0.85) * smoothstep(0.0, 0.25, d3.z));
  }

  // glass: faint diagonal reflection + vignette
  vec2 q = uv;
  float streak = smoothstep(0.0, 0.25, 1.0 - abs(q.x + (1.0 - q.y) - 0.6) * 3.0) * 0.035
               + smoothstep(0.0, 0.2, 1.0 - abs(q.x + (1.0 - q.y) - 1.1) * 6.0) * 0.02;
  col += streak;
  float vig = smoothstep(1.25, 0.35, length((q - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
  col *= mix(0.72, 1.0, vig);

  // tiny dither kills banding in smooth gradients
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}
`;
