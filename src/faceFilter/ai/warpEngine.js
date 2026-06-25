// warpEngine.js
// Engine LIQUIFY/MESH-WARP bằng WebGL: dịch chuyển pixel theo các "warp primitive"
// (tâm + bán kính + hệ số phóng/thu theo trục) suy ra từ landmark. Cộng dồn displacement
// của tất cả primitive (mọi khuôn mặt) rồi sample lại 1 lần -> mượt, không vết nối.

const MAX_WARPS = 64;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
    vUv = (aPos + 1.0) * 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAspect;
uniform int uCount;
uniform vec2 uCenter[${MAX_WARPS}];
uniform float uRadius[${MAX_WARPS}];
uniform float uSX[${MAX_WARPS}];
uniform float uSY[${MAX_WARPS}];
void main() {
    vec2 uv = vUv;
    vec2 disp = vec2(0.0);
    for (int i = 0; i < ${MAX_WARPS}; i++) {
        if (i >= uCount) break;
        vec2 c = uCenter[i];
        vec2 dc = (uv - c) * vec2(uAspect, 1.0);
        float r = uRadius[i];
        if (r <= 0.0) continue;
        float t = length(dc) / r;
        if (t < 1.0) {
            float f = (1.0 - t) * (1.0 - t);           // tắt dần mượt ở mép
            float mx = 1.0 - uSX[i] * f;               // <1 = phóng to, >1 = thu nhỏ
            float my = 1.0 - uSY[i] * f;
            vec2 dcw = vec2(dc.x * mx, dc.y * my);
            vec2 srcUv = c + dcw * vec2(1.0 / uAspect, 1.0);
            disp += srcUv - uv;                        // cộng dồn dịch chuyển
        }
    }
    gl_FragColor = texture2D(uTex, uv + disp);
}`;

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('Shader lỗi: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
}

export class WarpEngine {
    constructor() {
        this.canvas = document.createElement('canvas');
        const gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error('Trình duyệt không hỗ trợ WebGL');
        this.gl = gl;

        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('Link program lỗi: ' + gl.getProgramInfoLog(prog));
        }
        this.prog = prog;

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        this.tex = gl.createTexture();
        this.u = {
            aspect: gl.getUniformLocation(prog, 'uAspect'),
            count: gl.getUniformLocation(prog, 'uCount'),
            center: gl.getUniformLocation(prog, 'uCenter'),
            radius: gl.getUniformLocation(prog, 'uRadius'),
            sx: gl.getUniformLocation(prog, 'uSX'),
            sy: gl.getUniformLocation(prog, 'uSY'),
            tex: gl.getUniformLocation(prog, 'uTex'),
        };
    }

    /**
     * Vẽ warp.
     * @param source   ảnh nguồn (HTMLImageElement / Canvas) đã có nội dung
     * @param width,height  kích thước canvas đích
     * @param primitives mảng { cx, cy, radius, sx, sy }
     * @returns canvas WebGL (dùng làm nguồn drawImage)
     */
    render(source, width, height, primitives) {
        const gl = this.gl;
        this.canvas.width = width;
        this.canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.useProgram(this.prog);

        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

        const list = (primitives || []).slice(0, MAX_WARPS);
        const centers = new Float32Array(MAX_WARPS * 2);
        const radii = new Float32Array(MAX_WARPS);
        const sxs = new Float32Array(MAX_WARPS);
        const sys = new Float32Array(MAX_WARPS);
        list.forEach((p, i) => {
            centers[i * 2] = p.cx;
            centers[i * 2 + 1] = p.cy;
            radii[i] = p.radius;
            sxs[i] = p.sx;
            sys[i] = p.sy;
        });

        gl.uniform1f(this.u.aspect, width / height);
        gl.uniform1i(this.u.count, list.length);
        gl.uniform2fv(this.u.center, centers);
        gl.uniform1fv(this.u.radius, radii);
        gl.uniform1fv(this.u.sx, sxs);
        gl.uniform1fv(this.u.sy, sys);
        gl.uniform1i(this.u.tex, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return this.canvas;
    }
}

// Singleton dùng chung (1 context WebGL cho cả app).
let engine = null;
export function getWarpEngine() {
    if (!engine) engine = new WarpEngine();
    return engine;
}
