// WebGL2 context creation, program/FBO/VAO helpers with real error reporting, and the
// authoritative board(1000x1000) <-> CSS-pixel transform for the whole renderer.

const LAYOUT = {
  // Derived from REFERENCE.md 1.1: at 720x694 the 1000u board measures 568px with a
  // 76px horizontal margin, a 55px top margin, and sits 9px above the frame centre
  // because the inventory dock reserves space at the bottom.
  marginXFrac: 0.1056,
  marginYFrac: 0.0793,
  bottomReserveFrac: 0.026,
  minMarginPx: 8,
  maxDPR: 2,

  // Below this CSS width the fractional margins stop being a proportion of a comfortable
  // frame and start being most of the screen: on a 375 px iPhone XR marginXFrac alone eats
  // 79 px, capping the board at 295.8 px inside an 812 px viewport. Narrow viewports get a
  // flat pixel margin and an explicitly reserved chrome band instead.
  narrowMaxWidthPx: 560,
  narrowMarginXPx: 14,
  // Where the board sits inside the band left over after the chrome: 0.5 centres it, 1.0
  // drops it onto the dock. The band already excludes the caption strip and the dock, so
  // 0.5 leaves the two unavoidable voids on a 2.16:1 phone frame the same size -- 149 px
  // under the title against 133 px over the dock at 375x812 -- rather than piling 164 px
  // above and 118 px below.
  narrowBias: 0.5,

  // Written by js/ui/hud.js from real element rects; 0 means "not measured yet" and every
  // formula below falls back to exactly the behaviour it had before these existed.
  topReservePx: 0,
  bottomReservePx: 0,
  chromeBottomPx: 0,
  // The reference itself lets the hint's cap band sit 8 px inside the board's bottom wall
  // (board bottom y 620.9, strip top y 612.8 at 720x694), so this is the tolerated
  // intrusion, not zero. Anything past it is the overlap the round-3 critic measured at
  // 1280x720, where the strip ran 14.5 px into the brick.
  chromeOverlapPx: 9,
};

let current = { w: 1, h: 1, dpr: 1, scale: 1, ox: 0, oy: 0 };

const extCache = new WeakMap();

export const BOARD_UNITS = 1000;

export function setBoardLayout(opts) {
  Object.assign(LAYOUT, opts || {});
  return { ...LAYOUT };
}

export function getBoardLayout() {
  return { ...LAYOUT };
}

export function initGL(canvas) {
  const attrs = {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    depth: false,
    stencil: false,
    desynchronized: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  };
  const gl = canvas.getContext('webgl2', attrs);
  if (!gl) throw new Error('[refract/gl] WebGL2 is not available in this browser.');
  getExtensions(gl);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.clearColor(0, 0, 0, 1);
  return gl;
}

export function getExtensions(gl) {
  let e = extCache.get(gl);
  if (e) return e;
  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float');
  const colorBufferHalf = gl.getExtension('EXT_color_buffer_half_float');
  const floatLinear = gl.getExtension('OES_texture_float_linear');
  const aniso =
    gl.getExtension('EXT_texture_filter_anisotropic') ||
    gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
    gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  e = {
    colorBufferFloat,
    colorBufferHalf,
    floatLinear,
    aniso,
    maxAnisotropy: aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1,
    canRenderHalfFloat: !!(colorBufferFloat || colorBufferHalf),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    debugRendererInfo: (() => {
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
    })(),
  };
  extCache.set(gl, e);
  return e;
}

function annotate(src) {
  const lines = src.split('\n');
  const width = String(lines.length).length;
  return lines.map((l, i) => `${String(i + 1).padStart(width, ' ')} | ${l}`).join('\n');
}

function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || '(no info log)';
    gl.deleteShader(sh);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    const msg = `[refract/gl] ${kind} shader failed to compile${label ? ` (${label})` : ''}:\n${log}`;
    console.error(`${msg}\n${annotate(src)}`);
    throw new Error(msg);
  }
  return sh;
}

export function createProgram(gl, vs, fs, label) {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs, label);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs, label);
  const prog = gl.createProgram();
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  gl.detachShader(prog, v);
  gl.detachShader(prog, f);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || '(no info log)';
    gl.deleteProgram(prog);
    const msg = `[refract/gl] program failed to link${label ? ` (${label})` : ''}:\n${log}`;
    console.error(`${msg}\nVERTEX:\n${annotate(vs)}\nFRAGMENT:\n${annotate(fs)}`);
    throw new Error(msg);
  }
  return prog;
}

export function getUniformLocations(gl, prog, names) {
  const out = {};
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
}

export function createTexture(gl, w, h, opts = {}) {
  const {
    internalFormat = gl.RGBA8,
    format = gl.RGBA,
    type = gl.UNSIGNED_BYTE,
    linear = true,
    wrap = gl.CLAMP_TO_EDGE,
    mipmap = false,
    anisotropy = 0,
    data = null,
  } = opts;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data);
  const min = linear
    ? mipmap
      ? gl.LINEAR_MIPMAP_LINEAR
      : gl.LINEAR
    : mipmap
      ? gl.NEAREST_MIPMAP_NEAREST
      : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (mipmap) gl.generateMipmap(gl.TEXTURE_2D);
  const ext = getExtensions(gl);
  if (anisotropy > 0 && ext.aniso) {
    gl.texParameterf(
      gl.TEXTURE_2D,
      ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(anisotropy, ext.maxAnisotropy),
    );
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

export function createFBO(gl, w, h, opts = {}) {
  const ext = getExtensions(gl);
  const wantFloat = !!opts.float;
  const linear = opts.linear !== false;
  const float = wantFloat && ext.canRenderHalfFloat;
  const width = Math.max(1, Math.floor(w));
  const height = Math.max(1, Math.floor(h));

  const target = {
    w: width,
    h: height,
    float,
    floatRequested: wantFloat,
    linear,
    tex: null,
    fbo: gl.createFramebuffer(),
  };

  const alloc = (tw, th) => {
    target.w = tw;
    target.h = th;
    if (target.tex) gl.deleteTexture(target.tex);
    target.tex = createTexture(gl, tw, th, {
      internalFormat: float ? gl.RGBA16F : gl.RGBA8,
      format: gl.RGBA,
      type: float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      linear,
      wrap: gl.CLAMP_TO_EDGE,
      mipmap: false,
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `[refract/gl] framebuffer incomplete (${tw}x${th}, ${float ? 'RGBA16F' : 'RGBA8'}): 0x${status.toString(16)}`,
      );
    }
  };

  alloc(width, height);

  target.bind = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
  };
  target.resize = (nw, nh) => {
    const tw = Math.max(1, Math.floor(nw));
    const th = Math.max(1, Math.floor(nh));
    if (tw === target.w && th === target.h) return false;
    alloc(tw, th);
    return true;
  };
  target.dispose = () => {
    if (target.tex) gl.deleteTexture(target.tex);
    if (target.fbo) gl.deleteFramebuffer(target.fbo);
    target.tex = null;
    target.fbo = null;
  };
  return target;
}

export function bindDefaultFramebuffer(gl, w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
}

export function createQuad(gl) {
  const buf = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  return {
    vao,
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
    },
  };
}

export const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export function resize(gl, canvas) {
  const dpr = Math.min(LAYOUT.maxDPR, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
  const cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const layout = boardToPixel(cssW, cssH);
  current.w = cssW;
  current.h = cssH;
  current.scale = layout.scale;
  current.ox = layout.ox;
  current.oy = layout.oy;
  current.dpr = dpr;
  gl.viewport(0, 0, bw, bh);
  return { w: bw, h: bh, dpr, cssW, cssH };
}

// How many of the caller's pixels one CSS pixel is worth. `resize` and `js/ui/hud.js` ask for
// a layout in CSS pixels; `js/render/board.js` asks in drawing-buffer pixels every frame. Every
// threshold below -- narrowMaxWidthPx, the flat narrow margin, minMarginPx, and the chrome
// rects hud.js measures -- is a CSS-pixel quantity, so a drawing-buffer request has to be
// solved in CSS space and scaled back afterwards.
//
// Without this, an iPhone XR (375 CSS px, dpr 2) handed the renderer a 750 px request, which
// sailed past the 560 px narrow threshold and took the desktop branch: the board ART drew at
// 295.8 CSS px while the beams and `pixelToBoard` used the correct 347 px narrow layout. The
// beam left the board through the bottom wall and every tap landed off its mark.
function requestRatio(w) {
  const cssW = current.w;
  if (!(w > 0) || !(cssW > 1)) return 1;
  const r = w / cssW;
  return r > 1.02 && r <= 4.2 ? r : 1;
}

// PURE. It must stay pure: the live transform in `current` is the one `pixelToBoard` inverts
// to turn a pointer position into a board coordinate, and it is defined in CSS pixels. Callers
// ask this for a layout at whatever scale suits them -- `board.js` asks in drawing-buffer
// pixels every frame -- so writing the answer back into `current` here let the renderer's
// backing-pixel layout overwrite the input transform. On any HiDPI display that silently put
// every click at roughly half its true board position and nothing could be placed by hand.
// Only `resize` knows the CSS-pixel truth, so only `resize` publishes it.
export function boardToPixel(w, h) {
  const r = requestRatio(w);
  if (r === 1) return cssLayout(w, h);
  const t = cssLayout(w / r, h / r);
  return { scale: t.scale * r, ox: t.ox * r, oy: t.oy * r, size: t.size * r, w, h };
}

function cssLayout(w, h) {
  if (w <= LAYOUT.narrowMaxWidthPx) return narrowLayout(w, h);

  const mx = Math.max(LAYOUT.minMarginPx, w * LAYOUT.marginXFrac);
  const my = Math.max(LAYOUT.minMarginPx, h * LAYOUT.marginYFrac);
  const reserve = h * LAYOUT.bottomReserveFrac;
  const availW = Math.max(1, w - mx * 2);
  const availH = Math.max(1, h - my * 2 - reserve);
  let size = Math.min(availW, availH);
  let oy = (h - reserve - size) * 0.5;

  // The fractional reserve is a proportion of the viewport, but the strip and the dock are
  // laid out in near-fixed pixels, so on a short wide frame the board's bottom wall grows
  // straight through the hint. Never enlarges the board: it slides it up first and only
  // shrinks it once the top margin is reached.
  if (LAYOUT.chromeBottomPx > 0) {
    const maxBottom = h - LAYOUT.chromeBottomPx + LAYOUT.chromeOverlapPx;
    if (oy + size > maxBottom) {
      oy = maxBottom - size;
      if (oy < my) {
        oy = my;
        size = Math.max(1, maxBottom - my);
      }
    }
  }

  return { scale: size / BOARD_UNITS, ox: (w - size) * 0.5, oy, size, w, h };
}

// Phone layout. The board is as wide as the frame allows and is parked inside the band
// between the measured chrome, rather than being centred in a viewport whose top and bottom
// thirds it can never use.
function narrowLayout(w, h) {
  const mx = Math.max(LAYOUT.minMarginPx, LAYOUT.narrowMarginXPx);
  const top = LAYOUT.topReservePx > 0 ? LAYOUT.topReservePx : h * 0.13;
  const bottom = LAYOUT.bottomReservePx > 0 ? LAYOUT.bottomReservePx : h * 0.19;
  const availW = Math.max(1, w - mx * 2);
  const availH = Math.max(1, h - top - bottom);
  const size = Math.max(1, Math.min(availW, availH));
  const ox = (w - size) * 0.5;
  const oy = top + (availH - size) * LAYOUT.narrowBias;
  return { scale: size / BOARD_UNITS, ox, oy, size, w, h };
}

export function pixelToBoard(px, py) {
  return {
    x: (px - current.ox) / current.scale,
    y: (py - current.oy) / current.scale,
  };
}

export function boardToPixelPoint(x, y) {
  return {
    x: x * current.scale + current.ox,
    y: y * current.scale + current.oy,
  };
}

export function getTransform() {
  return { ...current };
}

export function boardMatrix(flipY = true) {
  // Column-major mat3 mapping board units to clip space for the current transform,
  // using CSS-pixel space as the intermediate. flipY keeps +y pointing down on screen.
  const { w, h, scale, ox, oy } = current;
  const sx = (2 * scale) / w;
  const sy = ((flipY ? -2 : 2) * scale) / h;
  const tx = (2 * ox) / w - 1;
  const ty = flipY ? 1 - (2 * oy) / h : (2 * oy) / h - 1;
  return new Float32Array([sx, 0, 0, 0, sy, 0, tx, ty, 1]);
}
