// warpEngine.js
// Engine LIQUIFY/MESH-WARP bằng WebGL: dịch chuyển pixel theo các "warp primitive" suy ra từ landmark.
// Mỗi primitive có tâm + bán kính và hai kiểu tác động, dùng riêng hoặc cùng lúc:
//  - phóng/thu theo trục (sx, sy) quanh tâm — to mắt, thon mũi;
//  - kéo dịch (dx, dy): vùng quanh tâm trôi theo vector, tắt dần mượt tới mép — gọn mặt (kéo mép hàm vào
//    trong).
// Cộng dồn displacement của tất cả primitive (mọi khuôn mặt) rồi sample lại 1 lần -> mượt, không vết nối.

// Số primitive tối đa (12 mặt x ~9 primitive). Mỗi primitive chiếm 2 vec4 uniform; máy có ít uniform hơn
// thì tự hạ (xem constructor).
const WANT_WARPS = 128;
// Chrome giới hạn bộ đệm vẽ WebGL (ảnh 5799x6000 bị co thành ~5662x5858 mà không báo lỗi),
// nên ảnh lớn được vẽ thành từng ô rồi ghép lại.
const TILE = 4096;

const VERT = `
attribute vec2 aPos;
uniform vec2 uOff;
uniform vec2 uScale;
varying vec2 vUv;
void main() {
    vUv = uOff + (aPos + 1.0) * 0.5 * uScale;
    gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// uA[i] = (cx, cy, radius, 0), uB[i] = (sx, sy, dx, dy). Toạ độ uv (y lật), khoảng cách theo đơn vị
// chiều cao ảnh (x nhân aspect).
const fragSource = (n) => `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uAspect;
uniform int uCount;
uniform vec4 uA[${n}];
uniform vec4 uB[${n}];
void main() {
    vec2 uv = vUv;
    vec2 disp = vec2(0.0);
    vec2 toUv = vec2(1.0 / uAspect, 1.0);
    for (int i = 0; i < ${n}; i++) {
        if (i >= uCount) break;
        vec2 c = uA[i].xy;
        float r = uA[i].z;
        if (r <= 0.0) continue;
        vec2 dc = (uv - c) * vec2(uAspect, 1.0);
        float d2 = dot(dc, dc);
        float r2 = r * r;
        if (d2 >= r2) continue;
        // Phóng/thu theo trục.
        float t = sqrt(d2) / r;
        float f = (1.0 - t) * (1.0 - t);               // tắt dần mượt ở mép
        vec2 m = vec2(1.0) - uB[i].xy * f;             // <1 = phóng to, >1 = thu nhỏ
        disp += c + dc * m * toUv - uv;
        // Kéo dịch: điểm ở tâm lấy màu từ (tâm - vector), tắt dần (1 - t²)² tới mép. Không gập ảnh khi |vector|
        // tổng < ~0,65 bán kính. (Công thức Gustafson cũ giữ gần cả đĩa trôi cứng rồi tắt gắt sát mép -> với
        // vector nhỏ so với bán kính là gập: tai hiện hai lần.)
        vec2 mv = uB[i].zw;
        if (dot(mv, mv) > 0.0) {
            float w = 1.0 - d2 / r2;
            disp -= w * w * mv * toUv;
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

        // Card yếu chỉ đảm bảo 16 vec4 uniform cho fragment shader -> co số primitive cho vừa.
        const maxVec = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) || 16;
        this.maxWarps = Math.max(4, Math.min(WANT_WARPS, Math.floor((maxVec - 8) / 2)));

        const prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragSource(this.maxWarps)));
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
            a: gl.getUniformLocation(prog, 'uA'),
            b: gl.getUniformLocation(prog, 'uB'),
            tex: gl.getUniformLocation(prog, 'uTex'),
            off: gl.getUniformLocation(prog, 'uOff'),
            scale: gl.getUniformLocation(prog, 'uScale'),
        };
    }

    /**
     * Vẽ warp.
     * @param source   ảnh nguồn (HTMLImageElement / Canvas) đã có nội dung
     * @param width,height  kích thước canvas đích
     * @param primitives mảng { cx, cy, radius, sx?, sy?, dx?, dy? } (cy, dy theo uv đã lật y)
     * @returns canvas dùng làm nguồn drawImage (ảnh lớn hơn TILE: canvas 2D đã ghép các ô)
     */
    render(source, width, height, primitives) {
        const gl = this.gl;
        gl.useProgram(this.prog);

        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

        const n = this.maxWarps;
        if ((primitives || []).length > n) console.warn(`[warp] ${primitives.length} primitive, chỉ dùng ${n}`);
        const list = (primitives || []).slice(0, n);
        const A = new Float32Array(n * 4);
        const B = new Float32Array(n * 4);
        list.forEach((p, i) => {
            A.set([p.cx, p.cy, p.radius, 0], i * 4);
            B.set([p.sx || 0, p.sy || 0, p.dx || 0, p.dy || 0], i * 4);
        });

        gl.uniform1f(this.u.aspect, width / height);
        gl.uniform1i(this.u.count, list.length);
        gl.uniform4fv(this.u.a, A);
        gl.uniform4fv(this.u.b, B);
        gl.uniform1i(this.u.tex, 0);

        if (width <= TILE && height <= TILE) {
            this.drawTile(width, height, 0, 0, width, height);
            return this.canvas;
        }
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        const ctx = out.getContext('2d');
        for (let ty = 0; ty < height; ty += TILE) {
            for (let tx = 0; tx < width; tx += TILE) {
                const tw = Math.min(TILE, width - tx);
                const th = Math.min(TILE, height - ty);
                this.drawTile(width, height, tx, ty, tw, th);
                ctx.drawImage(this.canvas, tx, ty);
            }
        }
        return out;
    }

    // Vẽ ô (tx,ty,tw,th) của ảnh width x height vào this.canvas (kích thước tw x th).
    drawTile(width, height, tx, ty, tw, th) {
        const gl = this.gl;
        this.canvas.width = tw;
        this.canvas.height = th;
        if (gl.drawingBufferWidth < tw || gl.drawingBufferHeight < th) {
            throw new Error(`Bộ đệm WebGL chỉ ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}, cần ${tw}x${th}`);
        }
        gl.viewport(0, 0, tw, th);
        // Texture lật dọc (FLIP_Y) nên v=0 là đáy ảnh.
        gl.uniform2f(this.u.off, tx / width, 1 - (ty + th) / height);
        gl.uniform2f(this.u.scale, tw / width, th / height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}

// Singleton dùng chung (1 context WebGL cho cả app).
let engine = null;
export function getWarpEngine() {
    // Mất ngữ cảnh (driver card reset, hết bộ nhớ) thì lệnh gl im lặng không vẽ -> tạo lại thay vì trả ô trống.
    if (!engine || engine.gl.isContextLost()) engine = new WarpEngine();
    return engine;
}
