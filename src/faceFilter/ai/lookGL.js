// lookGL.js — chạy các công đoạn NẶNG, TOÀN ẢNH của lookStage trên card đồ hoạ (WebGL 1):
//   (1) mịn da + tông da (frequency separation, CÙNG công thức processSkin) + má hồng (soft-light)
//   (2) chỉnh màu toàn ảnh (saturate/contrast/brightness, phủ hồng, cân bằng trắng, highlight)
// Các bước nhỏ theo vùng (môi, mắt, glow) vẫn vẽ bằng canvas 2D ở giữa hai bước này.
//
// Vì sao: đo trên ảnh thật (C0, 23/10) phần lớn thời gian của bản canvas KHÔNG nằm ở phép tính mà
// ở việc đọc/ghi cả ảnh qua lại giữa CPU và card đồ hoạ (getImageData/putImageData trên ảnh lớn).
// Ở đây ảnh lên card đồ hoạ một lần, mọi phép toàn ảnh chạy trên đó, không đọc ngược về CPU.
//
// Làm mờ (gaussian) cho ảnh lớn: thu nhỏ từng nửa (mỗi lần lấy trung bình 2x2) tới khi bán kính
// còn ~2.5-5 px rồi mới làm mờ, lúc dùng thì phóng lại bằng nội suy. Lớp mờ vốn chỉ còn tần số
// thấp nên thu nhỏ không mất gì thấy được, mà số phép tính giảm hàng chục lần ở ảnh 6000 px.

// uOff/uScale: vẽ một MẢNH của ảnh (xuất theo mảnh vì trình duyệt tự thu nhỏ khung vẽ WebGL quá lớn —
// đo được: xin 5799x6000 chỉ được 5662x5858 -> ảnh Canon gốc ra sai nếu vẽ một lần).
const VERT = `
attribute vec2 aPos;
uniform vec2 uOff;
uniform vec2 uScale;
varying vec2 vUv;
void main() {
    vUv = uOff + (aPos + 1.0) * 0.5 * uScale;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const TILE = 4096;

// Lấy mẫu ở đúng tâm khối 2x2 của ảnh nguồn + nội suy tuyến tính = trung bình 4 điểm.
const FRAG_COPY = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

const MAX_TAPS = 16;
const FRAG_BLUR = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uSigma;
uniform int uR;
void main() {
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    for (int i = -${MAX_TAPS}; i <= ${MAX_TAPS}; i++) {
        if (i < -uR || i > uR) continue;
        float fi = float(i);
        float w = exp(-fi * fi / (2.0 * uSigma * uSigma));
        acc += texture2D(uTex, vUv + uStep * fi) * w;
        wsum += w;
    }
    gl_FragColor = acc / wsum;
}`;

// Mịn da + tông da (giống processSkin trong lookStage.js) rồi má hồng (giống applyBlush).
// Mọi giá trị màu tính theo thang 0..255 như bản canvas để dùng lại nguyên các hằng số.
const FRAG_SKIN = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uS;
uniform sampler2D uL;
uniform sampler2D uMask;
uniform sampler2D uBlush;
uniform float uSkinOn;
uniform float uRetouch;
uniform float uToneR;
uniform float uToneY;
uniform float uAddB;
uniform float uHasRef;
uniform float uMLum;
uniform float uRefRG;
uniform float uRefY;
uniform float uBlushOn;

float softLight1(float cb, float cs) {
    if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
    float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
    return cb + (2.0 * cs - 1.0) * (d - cb);
}

void main() {
    vec3 c = texture2D(uSrc, vUv).rgb * 255.0;
    if (uSkinOn > 0.5) {
        float a = texture2D(uMask, vUv).a;
        if (a > 0.004) {
            vec3 s = texture2D(uS, vUv).rgb * 255.0;
            vec3 l = texture2D(uL, vUv).rgb * 255.0;
            vec3 d = abs(s - l);
            float dS = max(d.r, max(d.g, d.b));
            float guard = dS <= 20.0 ? 1.0 : (dS >= 48.0 ? 0.0 : (48.0 - dS) / 28.0);
            float k = uRetouch * guard * a;
            c = c - k * (s - l);
            float lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
            float wSkin = uHasRef > 0.5 ? clamp((lum - 0.35 * uMLum) / (0.25 * uMLum), 0.0, 1.0) : 1.0;
            float wgt = a * wSkin;
            if (wgt > 0.0) {
                if (uToneR > 0.0) {
                    if (uHasRef > 0.5) {
                        float excessR = (c.r - c.g) - uRefRG * (lum / uMLum);
                        if (excessR > 0.0) c.r -= excessR * 0.6 * uToneR * wgt;
                    }
                    if (c.r > c.g) c.r -= (c.r - c.g) * 0.15 * uToneR * wgt;
                }
                if (uToneY > 0.0) {
                    if (uHasRef > 0.5) {
                        float excessY = ((c.r + c.g) / 2.0 - c.b) - uRefY * (lum / uMLum);
                        if (excessY > 0.0) c.b += excessY * 0.5 * uToneY * wgt;
                    }
                    float yellow = (c.r + c.g) / 2.0 - c.b;
                    if (yellow > 0.0) c.b += yellow * 0.1 * uToneY * wgt;
                }
                c += vec3(uAddB * wgt);
            }
            c = clamp(c, 0.0, 255.0);
        }
    }
    if (uBlushOn > 0.5) {
        vec4 bl = texture2D(uBlush, vUv);
        if (bl.a > 0.0) {
            vec3 cb = c / 255.0;
            vec3 b = vec3(softLight1(cb.r, bl.r), softLight1(cb.g, bl.g), softLight1(cb.b, bl.b));
            c = mix(cb, b, bl.a) * 255.0;
        }
    }
    gl_FragColor = vec4(c / 255.0, 1.0);
}`;

// Chỉnh màu toàn ảnh (giống applyColorGrade): filter saturate -> contrast -> brightness, phủ hồng
// soft-light, cân bằng trắng (nhân kênh R/B), highlight có trọng số theo độ sáng.
const FRAG_COLOR = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform float uFilterOn;
uniform float uSat;
uniform float uCon;
uniform float uBri;
uniform float uPink;
uniform float uKr;
uniform float uKb;
uniform float uGain;

float softLight1(float cb, float cs) {
    if (cs <= 0.5) return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
    float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
    return cb + (2.0 * cs - 1.0) * (d - cb);
}

void main() {
    vec3 c = texture2D(uSrc, vUv).rgb;
    if (uFilterOn > 0.5) {
        float s = uSat;
        mat3 m = mat3(
            0.213 + 0.787 * s, 0.213 - 0.213 * s, 0.213 - 0.213 * s,
            0.715 - 0.715 * s, 0.715 + 0.285 * s, 0.715 - 0.715 * s,
            0.072 - 0.072 * s, 0.072 - 0.072 * s, 0.072 + 0.928 * s);
        c = clamp(m * c, 0.0, 1.0);
        c = clamp((c - 0.5) * uCon + 0.5, 0.0, 1.0);
        c = clamp(c * uBri, 0.0, 1.0);
        if (uPink > 0.0) {
            vec3 p = vec3(1.0, 0.6196, 0.7686); // #ff9ec4
            vec3 b = vec3(softLight1(c.r, p.r), softLight1(c.g, p.g), softLight1(c.b, p.b));
            c = mix(c, b, uPink);
        }
    }
    c *= 255.0;
    c.r = clamp(c.r * uKr, 0.0, 255.0);
    c.b = clamp(c.b * uKb, 0.0, 255.0);
    if (uGain > 0.0) {
        float L = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255.0;
        if (L > 0.55) {
            float t = clamp((L - 0.55) / 0.3, 0.0, 1.0);
            float lift = uGain * t * t * (3.0 - 2.0 * t) * (1.0 - L);
            c = clamp(c + lift * vec3(1.0, 0.98, 0.94), 0.0, 255.0);
        }
    }
    gl_FragColor = vec4(c / 255.0, 1.0);
}`;

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader lỗi: ' + gl.getShaderInfoLog(sh));
    return sh;
}

class LookGL {
    constructor() {
        this.canvas = document.createElement('canvas');
        const gl = this.canvas.getContext('webgl', {
            premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false,
        });
        if (!gl) throw new Error('Không có WebGL');
        this.gl = gl;
        const vs = compile(gl, gl.VERTEX_SHADER, VERT);
        const link = (fragSrc) => {
            const p = gl.createProgram();
            gl.attachShader(p, vs);
            gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
            gl.bindAttribLocation(p, 0, 'aPos');
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link lỗi: ' + gl.getProgramInfoLog(p));
            const u = {};
            const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
            for (let i = 0; i < n; i++) {
                const info = gl.getActiveUniform(p, i);
                u[info.name] = gl.getUniformLocation(p, info.name);
            }
            return { p, u };
        };
        this.progCopy = link(FRAG_COPY);
        this.progBlur = link(FRAG_BLUR);
        this.progSkin = link(FRAG_SKIN);
        this.progColor = link(FRAG_COLOR);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
            ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
        this.srcTex = this.newTex();
        this.maskTex = this.newTex();
        this.blushTex = this.newTex();
        this.targets = new Map(); // "w x h #i" -> {tex, fbo, w, h} (tái dùng giữa các lần gọi)
        this.dummy = this.newTex();
        gl.bindTexture(gl.TEXTURE_2D, this.dummy);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    }

    fits(w, h) { return w <= this.maxSize && h <= this.maxSize && !this.gl.isContextLost(); }

    newTex() {
        const gl = this.gl;
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        return t;
    }

    upload(tex, source) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    target(w, h, slot) {
        const key = `${this.base}|${w}x${h}#${slot}`;
        let t = this.targets.get(key);
        if (t) return t;
        const gl = this.gl;
        const tex = this.newTex();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        t = { tex, fbo, w, h };
        this.targets.set(key, t);
        return t;
    }

    // Bỏ các target của cỡ ảnh khác (khách đổi ảnh / xem trước <-> ảnh gốc) để không giữ bộ nhớ.
    trimTargets(keepW, keepH) {
        const gl = this.gl;
        this.base = `${keepW}x${keepH}`;
        for (const [key, t] of this.targets) {
            if (key.startsWith(`${this.base}|`)) continue;
            gl.deleteTexture(t.tex);
            gl.deleteFramebuffer(t.fbo);
            this.targets.delete(key);
        }
    }

    /** Trả bộ nhớ card đồ hoạ sau ảnh lớn (ảnh gốc 6000 px giữ ~400 MB nếu để nguyên). */
    release() {
        const gl = this.gl;
        if (gl.isContextLost()) return;
        this.trimTargets(0, 0);
        const empty = new Uint8Array(4);
        [this.srcTex, this.maskTex, this.blushTex].forEach((t) => {
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, empty);
        });
        this.canvas.width = 1;
        this.canvas.height = 1;
    }

    draw(prog, out, w, h, textures, uniforms, tile = null) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
        gl.viewport(0, 0, w, h);
        gl.useProgram(prog.p);
        gl.uniform2f(prog.u.uOff, tile ? tile.ox : 0, tile ? tile.oy : 0);
        gl.uniform2f(prog.u.uScale, tile ? tile.sx : 1, tile ? tile.sy : 1);
        textures.forEach(([name, tex], i) => {
            gl.activeTexture(gl.TEXTURE0 + i);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(prog.u[name], i);
        });
        for (const [name, v] of Object.entries(uniforms || {})) {
            const loc = prog.u[name];
            if (loc == null) continue;
            if (Array.isArray(v)) gl.uniform2f(loc, v[0], v[1]);
            else if (name === 'uR') gl.uniform1i(loc, v);
            else gl.uniform1f(loc, v);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.activeTexture(gl.TEXTURE0);
    }

    // Vẽ lượt cuối ra canvas 2D đích theo từng mảnh <= TILE x TILE (ảnh nhỏ thì đúng một mảnh).
    drawTiled(prog, w, h, textures, uniforms, dst) {
        const gl = this.gl;
        for (let ty = 0; ty < h; ty += TILE) {
            for (let tx = 0; tx < w; tx += TILE) {
                const tw = Math.min(TILE, w - tx), th = Math.min(TILE, h - ty);
                if (this.canvas.width !== tw) this.canvas.width = tw;
                if (this.canvas.height !== th) this.canvas.height = th;
                if (gl.drawingBufferWidth !== tw || gl.drawingBufferHeight !== th) {
                    throw new Error(`Khung vẽ bị thu nhỏ (${gl.drawingBufferWidth}x${gl.drawingBufferHeight} thay vì ${tw}x${th})`);
                }
                // uv có gốc ở DƯỚI-trái (ảnh nạp lật dọc), mảnh tính từ TRÊN-trái.
                this.draw(prog, null, tw, th, textures, uniforms, { ox: tx / w, oy: 1 - (ty + th) / h, sx: tw / w, sy: th / h });
                // Mất context giữa chừng thì khung vẽ trống trơn: phải báo lỗi, không được chép đè lên ảnh.
                if (gl.isContextLost()) throw new Error('Mất kết nối card đồ hoạ (context lost)');
                dst.save();
                dst.globalCompositeOperation = 'copy';
                dst.beginPath();
                dst.rect(tx, ty, tw, th);
                dst.clip();
                dst.drawImage(this.canvas, tx, ty);
                dst.restore();
            }
        }
    }

    // Kim tự tháp thu nhỏ từng nửa: levels[0] = ảnh gốc (srcTex), levels[k] = 1/2^k.
    pyramid(w, h, upTo) {
        const levels = [{ tex: this.srcTex, w, h }];
        for (let k = 1; k <= upTo; k++) {
            const prev = levels[k - 1];
            const nw = Math.max(1, Math.ceil(prev.w / 2));
            const nh = Math.max(1, Math.ceil(prev.h / 2));
            const t = this.target(nw, nh, `p${k}`);
            this.draw(this.progCopy, t, nw, nh, [['uTex', prev.tex]]);
            levels.push(t);
        }
        return levels;
    }

    // Làm mờ gaussian sigma (px ở cỡ gốc) -> texture ở mức thu nhỏ phù hợp.
    blur(levels, sigma, slot) {
        let k = 0;
        while (k + 1 < levels.length && sigma / 2 ** (k + 1) >= 2.5) k++;
        const L = levels[k];
        // Mỗi lần thu nhỏ trung bình 2x2 đã làm mờ sẵn một chút -> trừ bớt để tổng độ mờ đúng sigma.
        const s = Math.max(0.5, Math.sqrt(Math.max(0.25, (sigma / 2 ** k) ** 2 - (k ? 0.25 * k : 0))));
        const r = Math.min(MAX_TAPS, Math.ceil(s * 3));
        const a = this.target(L.w, L.h, `${slot}a`);
        const b = this.target(L.w, L.h, `${slot}b`);
        this.draw(this.progBlur, a, L.w, L.h, [['uTex', L.tex]], { uStep: [1 / L.w, 0], uSigma: s, uR: r });
        this.draw(this.progBlur, b, L.w, L.h, [['uTex', a.tex]], { uStep: [0, 1 / L.h], uSigma: s, uR: r });
        return b.tex;
    }

    /**
     * Mịn da + tông + má hồng. source: canvas ảnh hiện tại; kết quả vẽ đè vào dst (context 2D, cỡ w x h —
     * có thể chính là context của source: ảnh đã được chép lên card đồ hoạ trước khi vẽ).
     * p = { retouch, toneR, toneY, addB, ref:{mLum,refRG,refY}|null, sigmaS, sigmaL, mask: canvas|null, blush: canvas|null }
     */
    skin(source, w, h, p, dst) {
        const gl = this.gl;
        this.trimTargets(w, h);
        this.upload(this.srcTex, source);
        const skinOn = !!p.mask;
        let sTex = this.dummy, lTex = this.dummy;
        if (skinOn) {
            let need = 0;
            while (p.sigmaL / 2 ** (need + 1) >= 2.5 && need < 6) need++;
            const levels = this.pyramid(w, h, need);
            sTex = this.blur(levels, p.sigmaS, 's');
            lTex = this.blur(levels, p.sigmaL, 'l');
            this.upload(this.maskTex, p.mask);
        }
        if (p.blush) this.upload(this.blushTex, p.blush);
        this.drawTiled(this.progSkin, w, h, [
            ['uSrc', this.srcTex], ['uS', sTex], ['uL', lTex],
            ['uMask', skinOn ? this.maskTex : this.dummy], ['uBlush', p.blush ? this.blushTex : this.dummy],
        ], {
            uSkinOn: skinOn ? 1 : 0, uRetouch: p.retouch, uToneR: p.toneR, uToneY: p.toneY, uAddB: p.addB,
            uHasRef: p.ref ? 1 : 0, uMLum: p.ref ? p.ref.mLum : 1, uRefRG: p.ref ? p.ref.refRG : 0, uRefY: p.ref ? p.ref.refY : 0,
            uBlushOn: p.blush ? 1 : 0,
        }, dst);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /** Chỉnh màu toàn ảnh. c = { filterOn, sat, con, bri, pink, kr, kb, gain }. Vẽ đè vào dst. */
    color(source, w, h, c, dst) {
        this.upload(this.srcTex, source);
        this.drawTiled(this.progColor, w, h, [['uSrc', this.srcTex]], {
            uFilterOn: c.filterOn ? 1 : 0, uSat: c.sat, uCon: c.con, uBri: c.bri, uPink: c.pink,
            uKr: c.kr, uKb: c.kb, uGain: c.gain,
        }, dst);
    }
}

let engine;          // undefined = chưa thử, null = máy này không dùng được
export function getLookGL() {
    if (engine !== undefined) return engine;
    try {
        engine = new LookGL();
        engine.canvas.addEventListener('webglcontextlost', () => { engine = null; });
    } catch (e) {
        console.warn('[lookGL] Không dùng được card đồ hoạ, chạy bằng CPU:', e.message);
        engine = null;
    }
    return engine;
}

/** Tắt/bật đường card đồ hoạ (để so sánh, hoặc khi phát hiện máy chạy sai). */
export function setLookGLEnabled(on) {
    if (!on) {
        // Nhả luôn context cũ (Chrome chỉ cho giữ ~16 context WebGL, mỗi cái còn chiếm bộ nhớ card).
        try { engine?.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* bỏ qua */ }
        engine = null;
    }
    else if (engine === null) engine = undefined;
}
