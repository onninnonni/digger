// Minimal WebGL2 batched quad renderer with a single texture atlas.
import { ATLAS_COLS, ATLAS_PX, TILE_PX, S } from './atlas';

const MAX_QUADS = 24000;
const FLOATS_PER_VERT = 8;

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aCol;
uniform vec4 uCam;
out vec2 vUV; out vec4 vCol;
void main(){
  vec2 p = (aPos - uCam.xy) * uCam.zw;
  gl_Position = vec4(p.x - 1.0, 1.0 - p.y, 0.0, 1.0);
  vUV = aUV; vCol = aCol;
}`;
const FS = `#version 300 es
precision mediump float;
in vec2 vUV; in vec4 vCol; uniform sampler2D uTex; out vec4 o;
void main(){ o = texture(uTex, vUV) * vCol; }`;

export class Renderer {
  gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vbo: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private data = new Float32Array(MAX_QUADS * 6 * FLOATS_PER_VERT);
  private n = 0;
  private uCam: WebGLUniformLocation;
  private cam = [0, 0, 1, 1];
  private additive = false;
  width = 0; height = 0;

  constructor(public canvas: HTMLCanvasElement, atlas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not supported by this browser');
    this.gl = gl;
    const mk = (type: number, src: string) => {
      const sh = gl.createShader(type)!; gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader error');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
    this.prog = prog;
    gl.useProgram(prog);
    this.uCam = gl.getUniformLocation(prog, 'uCam')!;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);

    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.width = w; this.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  /** Camera in world (tile) units: top-left corner and visible size. */
  setCamera(x: number, y: number, viewW: number, viewH: number) {
    this.flush();
    this.cam = [x, y, 2 / viewW, 2 / viewH];
    this.gl.uniform4f(this.uCam, x, y, 2 / viewW, 2 / viewH);
  }

  begin(r: number, g: number, b: number) {
    const gl = this.gl;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.n = 0;
  }

  setAdditive(on: boolean) {
    if (on === this.additive) return;
    this.flush();
    this.additive = on;
    const gl = this.gl;
    if (on) gl.blendFunc(gl.SRC_ALPHA, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private uv(idx: number, cw: number, ch: number, flipX: boolean, out: number[]) {
    const col = idx % ATLAS_COLS, row = Math.floor(idx / ATLAS_COLS);
    const inset = 0.5 / ATLAS_PX;
    let u0 = (col * TILE_PX) / ATLAS_PX + inset, u1 = ((col + cw) * TILE_PX) / ATLAS_PX - inset;
    const v0 = (row * TILE_PX) / ATLAS_PX + inset, v1 = ((row + ch) * TILE_PX) / ATLAS_PX - inset;
    if (flipX) { const t = u0; u0 = u1; u1 = t; }
    out[0] = u0; out[1] = v0; out[2] = u1; out[3] = v1;
  }

  private tmpUV = [0, 0, 0, 0];

  /** Flat-colored textured quad. */
  quad(x: number, y: number, w: number, h: number, idx: number, r: number, g: number, b: number, a: number, flipX = false, cw = 1, ch = 1) {
    if (this.n + 6 * FLOATS_PER_VERT > this.data.length) this.flush();
    this.uv(idx, cw, ch, flipX, this.tmpUV);
    const [u0, v0, u1, v1] = this.tmpUV;
    const d = this.data; let n = this.n;
    const x1 = x + w, y1 = y + h;
    const push = (px: number, py: number, u: number, v: number) => { d[n++] = px; d[n++] = py; d[n++] = u; d[n++] = v; d[n++] = r; d[n++] = g; d[n++] = b; d[n++] = a; };
    push(x, y, u0, v0); push(x1, y, u1, v0); push(x, y1, u0, v1);
    push(x1, y, u1, v0); push(x1, y1, u1, v1); push(x, y1, u0, v1);
    this.n = n;
  }

  /** Quad with per-corner colors: c = [TL r,g,b,a, TR..., BL..., BR...] (16 floats). */
  quadC(x: number, y: number, w: number, h: number, idx: number, c: Float32Array | number[], off = 0, flipX = false) {
    if (this.n + 6 * FLOATS_PER_VERT > this.data.length) this.flush();
    this.uv(idx, 1, 1, flipX, this.tmpUV);
    const [u0, v0, u1, v1] = this.tmpUV;
    const d = this.data; let n = this.n;
    const x1 = x + w, y1 = y + h;
    const push = (px: number, py: number, u: number, v: number, k: number) => { d[n++] = px; d[n++] = py; d[n++] = u; d[n++] = v; d[n++] = c[off + k]; d[n++] = c[off + k + 1]; d[n++] = c[off + k + 2]; d[n++] = c[off + k + 3]; };
    push(x, y, u0, v0, 0); push(x1, y, u1, v0, 4); push(x, y1, u0, v1, 8);
    push(x1, y, u1, v0, 4); push(x1, y1, u1, v1, 12); push(x, y1, u0, v1, 8);
    this.n = n;
  }

  /** Untextured solid rectangle. */
  rect(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number) {
    this.quad(x, y, w, h, S.WHITE, r, g, b, a);
  }

  flush() {
    if (this.n === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.n));
    gl.drawArrays(gl.TRIANGLES, 0, this.n / FLOATS_PER_VERT);
    this.n = 0;
  }
}
