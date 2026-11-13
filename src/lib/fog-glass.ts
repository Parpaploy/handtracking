/**
 * Realistic fogged-glass renderer, ported from the foggy-glass project
 * (WebGL2): multi-pass blur with light halos, milky fog of varying
 * thickness, refracting droplets, streaky finger wipes, wet clear areas,
 * drops that run down from wipes, and fog slowly creeping back.
 * Adapted to size itself to its canvas (the game stage) instead of the
 * window, and to cap resolution on weaker devices.
 */
import { BLUR, DOWN, FINAL, VERT } from "./fog-glass-shaders";
import { IS_LOW_POWER } from "./stage";

export type Background =
  | { kind: "image"; el: HTMLImageElement }
  | { kind: "video"; el: HTMLVideoElement; mirror: boolean };

type Drop = {
  x: number;
  y: number;
  r: number;
  vy: number;
  stall: number;
  wob: number;
  age: number;
  bead: boolean;
};
type Seed = { x: number; y: number; r: number; wait: number };

const mk = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const c2d = (c: HTMLCanvasElement) => c.getContext("2d")!;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

export class FogGlass {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  private bg = mk(1, 1); // sharp background (cover-fit, mirrored for camera)
  private mask = mk(1, 1); // alpha = fog amount
  private regrowTex = mk(1, 1);
  private brush = mk(128, 128);

  private progDown!: Prog;
  private progBlur!: Prog;
  private progFinal!: Prog;
  private texSharp!: WebGLTexture;
  private texMask!: WebGLTexture;
  private rtH!: Target; // 1/2 res
  private rtA!: Target;
  private rtB!: Target;
  private rtC!: Target; // 1/16 res: very wide scatter → glow around lights
  private rtD!: Target;
  private quad!: WebGLVertexArrayObject;
  private bgDirty = true;

  private ro: ResizeObserver | null = null;
  private source: Background | null = null;
  private drops: Drop[] = [];
  private seeds: Seed[] = [];
  private raf = 0;
  private last = 0;
  private time = 0;
  private wipedSinceSeed = 0;
  private lastAngle = 0;
  private fogInBoost = 2.2;

  regrow = true;
  regrowSpeed = 1;
  brushSize = 18;
  private _drips = true;
  get drips() {
    return this._drips;
  }
  /** water drops on/off: running drips + beads in the fog */
  set drips(on: boolean) {
    this._drips = on;
    if (!on) {
      this.drops = [];
      this.seeds = [];
    }
  }
  breathing = false;
  private breathAt = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL2 not supported");
    this.gl = gl;
    this.overlay = document.createElement("canvas");
    this.overlay.className =
      "pointer-events-none absolute inset-0 h-full w-full";
    canvas.after(this.overlay);
    this.octx = this.overlay.getContext("2d")!;
    this.initGL();
    this.makeBrush();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.overlay.remove();
  }

  setBackground(b: Background) {
    this.source = b;
    this.renderBg();
  }

  refog() {
    this.fogInBoost = 1.6;
    this.drops = [];
    this.seeds = [];
  }

  clearAll() {
    c2d(this.mask).clearRect(0, 0, this.w, this.h);
  }

  breathe(on: boolean, x?: number, y?: number) {
    this.breathing = on;
    if (x !== undefined && y !== undefined)
      this.breathAt = { x: x * this.dpr, y: y * this.dpr };
  }

  moveBreath(x: number, y: number) {
    this.breathAt = { x: x * this.dpr, y: y * this.dpr };
  }

  snapshot() {
    const out = mk(this.w, this.h);
    const g = c2d(out);
    g.drawImage(this.canvas, 0, 0);
    g.drawImage(this.overlay, 0, 0);
    return out.toDataURL("image/png");
  }

  /** Map normalized video coords (0..1, un-mirrored) to css px on screen. */
  videoToScreen(nx: number, ny: number): { x: number; y: number } | null {
    const s = this.source;
    if (!s || s.kind !== "video") return null;
    const iw = s.el.videoWidth;
    const ih = s.el.videoHeight;
    if (!iw || !ih) return null;
    const W = this.w / this.dpr;
    const H = this.h / this.dpr;
    const sc = Math.max(W / iw, H / ih);
    const dw = iw * sc;
    const dh = ih * sc;
    const x = (W - dw) / 2 + nx * dw;
    return { x: s.mirror ? W - x : x, y: (H - dh) / 2 + ny * dh };
  }

  /** Scale from video px to css px. */
  videoScale() {
    const s = this.source;
    if (!s || s.kind !== "video" || !s.el.videoWidth) return 1;
    return Math.max(
      this.w / this.dpr / s.el.videoWidth,
      this.h / this.dpr / s.el.videoHeight,
    );
  }

  // ------------------------------------------------------------------ GL setup

  private compile(fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) ?? "link error");
    const u: Prog["u"] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!;
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  private makeTex() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.makeTex();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private freeTarget(t?: Target) {
    if (!t) return;
    this.gl.deleteFramebuffer(t.fb);
    this.gl.deleteTexture(t.tex);
  }

  private initGL() {
    const gl = this.gl;
    this.progDown = this.compile(DOWN);
    this.progBlur = this.compile(BLUR);
    this.progFinal = this.compile(FINAL);
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.texSharp = this.makeTex();
    this.texMask = this.makeTex();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  // ------------------------------------------------------------------ canvases

  private makeBrush() {
    const s = 128;
    const g = c2d(this.brush);
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.75, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // skin isn't a perfect squeegee: bands across the brush leave faint wet streaks
    // (the brush is rotated along the stroke, so bands become lines parallel to the motion)
    g.globalCompositeOperation = "destination-out";
    let y = 0;
    while (y < s) {
      const hgt = 1 + Math.random() * 4;
      const edge = Math.abs(y / s - 0.5) * 2; // streakier towards the sides of the finger
      if (Math.random() < 0.35 + edge * 0.4) {
        g.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.45})`;
        g.fillRect(0, y, s, hgt);
      }
      y += hgt + Math.random() * 6;
    }
    g.globalCompositeOperation = "source-over";
  }

  private resize = () => {
    // Full-screen shader with droplet fields: keep the pixel count sane.
    const dpr = Math.min(window.devicePixelRatio || 1, IS_LOW_POWER ? 1 : 1.5);
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (w === this.w && h === this.h) return;
    const oldMask = this.mask;
    const hadMask = this.w > 0;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.overlay.width = w;
    this.overlay.height = h;

    this.bg = mk(w, h);
    this.mask = mk(w, h);
    if (hadMask) c2d(this.mask).drawImage(oldMask, 0, 0, w, h);

    this.freeTarget(this.rtH);
    this.freeTarget(this.rtA);
    this.freeTarget(this.rtB);
    this.freeTarget(this.rtC);
    this.freeTarget(this.rtD);
    const cw = Math.max(1, Math.round(w / 16));
    const ch = Math.max(1, Math.round(h / 16));
    this.rtC = this.makeTarget(cw, ch);
    this.rtD = this.makeTarget(cw, ch);
    this.rtH = this.makeTarget(
      Math.max(1, Math.round(w / 2)),
      Math.max(1, Math.round(h / 2)),
    );
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    this.rtA = this.makeTarget(bw, bh);
    this.rtB = this.makeTarget(bw, bh);

    this.makeRegrow();
    this.renderBg();
  };

  private makeRegrow() {
    const { w, h } = this;
    this.regrowTex = mk(w, h);
    const g = c2d(this.regrowTex);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = (0.05 + Math.random() * 0.2) * Math.max(w, h);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.45)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  private renderBg() {
    const s = this.source;
    const g = c2d(this.bg);
    const { w, h } = this;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    if (!s) {
      g.fillStyle = "#223";
      g.fillRect(0, 0, w, h);
    } else {
      const iw = s.kind === "image" ? s.el.naturalWidth : s.el.videoWidth;
      const ih = s.kind === "image" ? s.el.naturalHeight : s.el.videoHeight;
      if (!iw || !ih) return;
      const sc = Math.max(w / iw, h / ih);
      const dw = iw * sc;
      const dh = ih * sc;
      g.save();
      if (s.kind === "video" && s.mirror) {
        g.translate(w, 0);
        g.scale(-1, 1);
      }
      g.drawImage(s.el, (w - dw) / 2, (h - dh) / 2, dw, dh);
      g.restore();
    }
    this.bgDirty = true;
  }

  // ------------------------------------------------------------------ input

  /** Wipe from previous point to current point (css px). sizeCss overrides the finger size. */
  wipe(
    px: number,
    py: number,
    x: number,
    y: number,
    pressure = 0.5,
    sizeCss?: number,
  ) {
    const d = this.dpr;
    const ax = px * d;
    const ay = py * d;
    const bx = x * d;
    const by = y * d;
    const size = (sizeCss ?? this.brushSize * (0.75 + pressure * 0.5)) * d;
    const m = c2d(this.mask);
    m.globalCompositeOperation = "destination-out";
    const dist = Math.hypot(bx - ax, by - ay);
    const step = Math.max(1, size * 0.1);
    const n = Math.max(1, Math.ceil(dist / step));
    const ang = dist > 0.5 ? Math.atan2(by - ay, bx - ax) : this.lastAngle;
    this.lastAngle = ang;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    m.globalAlpha = 0.5;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      m.setTransform(
        cos,
        sin,
        -sin,
        cos,
        ax + (bx - ax) * t,
        ay + (by - ay) * t,
      );
      m.drawImage(this.brush, -size / 2, -size / 2, size, size);
    }
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalAlpha = 1;
    m.globalCompositeOperation = "source-over";

    // finger pushes water to the lower rim → seeds for drips
    this.wipedSinceSeed += dist;
    if (this.drips && this.wipedSinceSeed > size * 0.9) {
      this.wipedSinceSeed = 0;
      if (Math.random() < 0.2) {
        this.seeds.push({
          x: bx + (Math.random() - 0.5) * size * 0.5,
          y: by + size * 0.4,
          r: (1.8 + Math.random() * 2.2) * d * Math.sqrt(size / d / 34),
          wait: 0.4 + Math.random() * 2.5,
        });
      }
    }
  }

  dot(x: number, y: number) {
    this.wipe(x, y, x + 0.1, y + 0.1, 0.5);
  }

  // ------------------------------------------------------------------ sim

  private loop = (now: number) => {
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    this.time += dt;
    this.step(dt);
    this.render();
    this.drawOverlay();
    this.raf = requestAnimationFrame(this.loop);
  };

  private step(dt: number) {
    const m = c2d(this.mask);
    let rate = 0;
    if (this.fogInBoost > 0) {
      this.fogInBoost -= dt;
      rate = 1.4;
    } else if (this.regrow) rate = 0.03 * this.regrowSpeed;
    if (rate > 0) {
      m.globalAlpha = Math.min(1, rate * dt);
      m.drawImage(this.regrowTex, 0, 0);
      m.globalAlpha = 1;
    }

    if (this.breathing) {
      const { x, y } = this.breathAt;
      const r = 190 * this.dpr;
      const g = m.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.16)");
      g.addColorStop(0.6, "rgba(255,255,255,0.07)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      m.fillStyle = g;
      m.fillRect(x - r, y - r, r * 2, r * 2);
    }

    for (let i = this.seeds.length - 1; i >= 0; i--) {
      const s = this.seeds[i];
      s.wait -= dt;
      if (s.wait <= 0) {
        this.seeds.splice(i, 1);
        if (this.drops.length < 120)
          this.drops.push({
            x: s.x,
            y: s.y,
            r: s.r,
            vy: 0,
            stall: 0,
            wob: Math.random() * 10,
            age: 0,
            bead: false,
          });
      }
    }

    // drops run down stop-and-go, eating a clear trail through the fog
    m.globalCompositeOperation = "destination-out";
    m.lineCap = "round";
    m.strokeStyle = "#fff";
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.bead) {
        d.r -= dt * 0.05 * this.dpr;
      } else {
        if (d.stall > 0) {
          d.stall -= dt;
          d.vy *= 0.8;
        } else {
          const target = (40 + d.r * 22) * this.dpr;
          d.vy += (target - d.vy) * dt * 3;
          if (Math.random() < dt * 0.9) d.stall = 0.15 + Math.random() * 0.9;
        }
        const oy = d.y;
        const ox = d.x;
        d.y += d.vy * dt;
        d.x += Math.sin(d.age * 2.3 + d.wob) * dt * 6 * this.dpr;
        m.beginPath();
        m.moveTo(ox, oy);
        m.lineTo(d.x, d.y);
        m.globalAlpha = 0.3;
        m.lineWidth = d.r * 2.4;
        m.stroke();
        m.globalAlpha = 1;
        m.lineWidth = d.r * 1.25;
        m.stroke();
        d.r -= dt * 0.55 * this.dpr * (d.vy > 1 ? 1 : 0.15);
        if (d.vy > 5 && Math.random() < dt * 0.8 && this.drops.length < 120) {
          this.drops.push({
            x: d.x,
            y: d.y - d.r * 2,
            r: d.r * 0.38,
            vy: 0,
            stall: 0,
            wob: 0,
            age: 0,
            bead: true,
          });
        }
      }
      if (d.r < 0.8 * this.dpr || d.y > this.h + 20) this.drops.splice(i, 1);
    }
    m.globalCompositeOperation = "source-over";
  }

  // ------------------------------------------------------------------ render

  private pass(prog: Prog, target: Target | null, bind: () => void) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : this.w, target ? target.h : this.h);
    bind();
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private upload(tex: WebGLTexture, src: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  private bindTex(
    unit: number,
    tex: WebGLTexture,
    loc: WebGLUniformLocation | null,
  ) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private render() {
    const gl = this.gl;
    if (this.source?.kind === "video") this.renderBg();

    if (this.bgDirty) {
      this.bgDirty = false;
      this.upload(this.texSharp, this.bg);
      // downsample 2x twice (tent filter, no aliasing), then repeated gaussian → smooth wide blur
      this.pass(this.progDown, this.rtH, () => {
        this.bindTex(0, this.texSharp, this.progDown.u.uTex);
        gl.uniform2f(this.progDown.u.uSrcTexel, 1 / this.w, 1 / this.h);
      });
      this.pass(this.progDown, this.rtA, () => {
        this.bindTex(0, this.rtH.tex, this.progDown.u.uTex);
        gl.uniform2f(this.progDown.u.uSrcTexel, 1 / this.rtH.w, 1 / this.rtH.h);
      });
      for (let k = 0; k < 4; k++) {
        const spread = 1;
        this.pass(this.progBlur, this.rtB, () => {
          this.bindTex(0, this.rtA.tex, this.progBlur.u.uTex);
          gl.uniform2f(this.progBlur.u.uDir, spread / this.rtA.w, 0);
        });
        this.pass(this.progBlur, this.rtA, () => {
          this.bindTex(0, this.rtB.tex, this.progBlur.u.uTex);
          gl.uniform2f(this.progBlur.u.uDir, 0, spread / this.rtA.h);
        });
      }
      this.pass(this.progDown, this.rtC, () => {
        this.bindTex(0, this.rtA.tex, this.progDown.u.uTex);
        gl.uniform2f(this.progDown.u.uSrcTexel, 1 / this.rtA.w, 1 / this.rtA.h);
      });
      for (let k = 0; k < 3; k++) {
        this.pass(this.progBlur, this.rtD, () => {
          this.bindTex(0, this.rtC.tex, this.progBlur.u.uTex);
          gl.uniform2f(this.progBlur.u.uDir, 1 / this.rtC.w, 0);
        });
        this.pass(this.progBlur, this.rtC, () => {
          this.bindTex(0, this.rtD.tex, this.progBlur.u.uTex);
          gl.uniform2f(this.progBlur.u.uDir, 0, 1 / this.rtC.h);
        });
      }
    }

    this.upload(this.texMask, this.mask);
    const u = this.progFinal.u;
    this.pass(this.progFinal, null, () => {
      this.bindTex(0, this.texSharp, u.uSharp);
      this.bindTex(1, this.rtA.tex, u.uBlur);
      this.bindTex(2, this.texMask, u.uMask);
      this.bindTex(3, this.rtC.tex, u.uWide);
      gl.uniform2f(u.uRes, this.w, this.h);
      gl.uniform1f(u.uDpr, this.dpr);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1f(u.uDrops, this._drips ? 1 : 0);
    });
  }

  private drawOverlay() {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.w, this.h);
    for (const d of this.drops) this.drawDrop(ctx, d);
  }

  /** Running drops: tiny inverted lenses with rim shading and a highlight. */
  private drawDrop(ctx: CanvasRenderingContext2D, d: Drop) {
    const r = d.r;
    if (r < 0.6) return;
    const moving = d.vy > 8;
    const rx = r;
    const ry = r * (moving ? 1.25 : 1.05);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    const span = r * 9;
    ctx.translate(d.x, d.y);
    ctx.scale(-1, -1);
    ctx.drawImage(
      this.bg,
      d.x - span,
      d.y - span,
      span * 2,
      span * 2,
      -rx * 1.1,
      -ry * 1.1,
      rx * 2.2,
      ry * 2.2,
    );
    ctx.restore();

    const g = ctx.createRadialGradient(
      d.x - r * 0.2,
      d.y - r * 0.3,
      r * 0.1,
      d.x,
      d.y,
      Math.max(rx, ry),
    );
    g.addColorStop(0, "rgba(255,255,255,0.05)");
    g.addColorStop(0.7, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.ellipse(
      d.x - rx * 0.35,
      d.y - ry * 0.4,
      rx * 0.22,
      ry * 0.16,
      -0.6,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // light passing through the drop focuses on its lower edge
    const c = ctx.createRadialGradient(
      d.x,
      d.y + ry * 0.55,
      0,
      d.x,
      d.y + ry * 0.55,
      rx * 0.7,
    );
    c.addColorStop(0, "rgba(255,255,255,0.35)");
    c.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
