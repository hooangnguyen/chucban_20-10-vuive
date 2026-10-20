// Cảnh hoàng hôn: bầu trời sao, dải ngân hà, mặt trời lặn, mây, đồi, cánh đồng hoa, cánh hoa bay và đom đóm.
// File này chạy được ở hai nơi:
//  - Trong Web Worker với OffscreenCanvas (luồng chính rảnh hoàn toàn).
//  - Ngay trên luồng chính khi trình duyệt không hỗ trợ (index.js tự chọn).
(function (global) {
    'use strict';

    const IN_WORKER = typeof WorkerGlobalScope !== 'undefined' && global instanceof WorkerGlobalScope;
    const raf = typeof global.requestAnimationFrame === 'function'
        ? cb => global.requestAnimationFrame(cb)
        : cb => setTimeout(() => cb(performance.now()), 1000 / 60);

    let canvas, ctx;
    let W = 0, H = 0, DPR = 1, isMobile = false;

    // Thời gian tính theo khung hình chuẩn 60fps, nên màn 120Hz không làm cảnh chạy nhanh gấp đôi
    let time = 0, step = 1, lastT = 0;
    let running = true, looping = false;

    // Chất lượng tự hạ khi máy yếu
    let quality = 1, frameAcc = 0, frameCount = 0, warmup = 90, lastSize = null;

    const PARALLAX = 18;
    const MAX_PARTICLES = 450;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const gust = { x: 0, s: 0 };

    let skyLayer, sunSprites, raysSprite, hillLayers = [];
    let stars = [], shootingStars = [], clouds = [], grassBuckets = [];
    let fireflies = [], particles = [], petals = [], rings = [], wisps = [], birds = [], butterflies = [];
    const grassPts = new Float32Array(32);

    const FLOWER_COLORS = ['#ffffff', '#fff4e0', '#ffd6e4', '#ffb3c8', '#c9dcff', '#e8d6ff', '#ffe3a8'];
    // Các loài hoa trên cánh đồng: [loài, bảng màu, tỉ lệ xuất hiện]
    const FLOWER_TYPES = [
        ['tulip', FLOWER_COLORS, 3],
        ['daisy', ['#ffffff', '#ffffff', '#fff4c2', '#ffd1e1', '#cfe0ff'], 4],
        ['poppy', ['#ff6b6b', '#ff8c5a', '#ff9ec4', '#ffcf5a'], 2.5],
        ['lavender', ['#b79cff', '#9f8cff', '#d1a6ff'], 2],
        ['breath', ['#ffffff', '#fff6fb'], 1.5]
    ];
    const FLOWER_WEIGHT = FLOWER_TYPES.reduce((a, t) => a + t[2], 0);
    // Màu các mảng hoa lớn nhìn từ xa trên sườn đồi
    const DRIFT_COLORS = ['#ff9ec4', '#ffd36b', '#b79cff', '#ffffff', '#ff8c5a', '#ffc2d6', '#cfe0ff'];

    function pickFlowerType() {
        let r = rng() * FLOWER_WEIGHT;
        for (const t of FLOWER_TYPES) { if ((r -= t[2]) <= 0) return t; }
        return FLOWER_TYPES[0];
    }
    const SPARK_COLORS = ['#ffffff', '#ffd6e4', '#ffb3c8', '#c9dcff', '#ffe3a8', '#e8d6ff'];
    const PETAL_COLORS = ['#ffc2d6', '#ffd9e6', '#ffb0c8', '#fff0f5'];

    // rng mặc định là Math.random; khi dựng nền thì đổi tạm sang rng có seed
    // để lần dựng lại (đổi màu theo giờ) giữ nguyên hình dáng đồi, ngân hà...
    let rng = Math.random;
    const rand = (a, b) => a + rng() * (b - a);
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const gauss = () => (rng() + rng() + rng() - 1.5) / 1.5;

    function mulberry32(a) {
        return () => {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function seeded(seed, fn) {
        const prev = rng;
        rng = mulberry32(seed);
        try { return fn(); } finally { rng = prev; }
    }

    function makeCanvas(w, h) {
        w = Math.max(1, Math.ceil(w));
        h = Math.max(1, Math.ceil(h));
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    }

    function hexToRgba(hex, a) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    // ---------- Sprite vẽ sẵn (thay cho shadowBlur / gradient mỗi khung hình) ----------

    const glowCache = {};
    function glow(color) {
        if (glowCache[color]) return glowCache[color];
        const s = 64;
        const c = makeCanvas(s, s);
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grad.addColorStop(0, color);
        grad.addColorStop(0.18, color);
        grad.addColorStop(0.45, hexToRgba(color, 0.25));
        grad.addColorStop(1, hexToRgba(color, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, s, s);
        return (glowCache[color] = c);
    }

    function drawGlow(color, x, y, size, alpha) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(glow(color), x - size / 2, y - size / 2, size, size);
    }

    function tulipPath(g, s) {
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(-s * 1.5, -s * 0.2, -s * 1.5, -s * 1.8, -s * 0.6, -s * 1.8);
        g.bezierCurveTo(-s * 0.4, -s * 1.8, -s * 0.3, -s * 2.2, 0, -s * 2.2);
        g.bezierCurveTo(s * 0.3, -s * 2.2, s * 0.4, -s * 1.8, s * 0.6, -s * 1.8);
        g.bezierCurveTo(s * 1.5, -s * 1.8, s * 1.5, -s * 0.2, 0, 0);
    }

    const FU = 16, FPAD = 8, FRES = 2;
    const flowerCache = {};
    // Vẽ sẵn mỗi bông hoa đúng cỡ hiển thị (theo nấc 0.5px) ở độ phân giải thiết bị,
    // để mỗi khung hình chỉ cần xoay rồi in ra, không phải thu nhỏ từ ảnh lớn.
    // tint: [màu, độ phủ] để nhuộm cả bông (cánh lẫn nhụy) theo ánh sáng của khung giờ
    function flowerSprite(type, color, size, glowK = 1, tint = null) {
        const sb = Math.max(1.5, Math.round(size * 2) / 2);
        const key = type + color + sb + '~' + glowK + (tint ? tint[0] + tint[1] : '') + '@' + DPR;
        if (flowerCache[key]) return flowerCache[key];
        const k = (sb / FU) * DPR;
        const w = FU * 3.2 + FPAD * 2, h = FU * 2.4 + FPAD * 2;
        const ax = w / 2, ay = FPAD + FU * 2.2;
        const c = makeCanvas(w * k, h * k);
        const g = c.getContext('2d');
        g.scale(k, k);
        g.translate(ax, ay);
        g.shadowColor = color;
        g.shadowBlur = 3 * k * glowK;
        DRAW_FLOWER[type](g, color, k);
        if (tint) {
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.globalAlpha = 1;
            g.shadowBlur = 0;
            g.globalCompositeOperation = 'source-atop';
            g.fillStyle = rgba(hex(tint[0]), tint[1]);
            g.fillRect(0, 0, c.width, c.height);
        }
        return (flowerCache[key] = { canvas: c, ox: ax * k, oy: ay * k });
    }

    // Mỗi hàm vẽ một bông hoa với gốc cuống ở (0, 0), cao tối đa khoảng 2.2 * FU
    const DRAW_FLOWER = {
        tulip(g, color) {
            g.fillStyle = color;
            tulipPath(g, FU);
            g.fill();
            g.shadowBlur = 0;
            const shade = g.createLinearGradient(0, 0, 0, -FU * 2.2);
            shade.addColorStop(0, 'rgba(90, 20, 60, 0.4)');
            shade.addColorStop(0.55, 'rgba(255, 255, 255, 0)');
            g.fillStyle = shade;
            tulipPath(g, FU);
            g.fill();
            g.globalAlpha = 0.25;
            g.strokeStyle = 'rgb(120, 40, 80)';
            g.lineWidth = 0.8;
            g.beginPath();
            g.moveTo(0, -FU * 0.3);
            g.lineTo(0, -FU * 1.9);
            g.stroke();
            g.globalAlpha = 0.45;
            g.fillStyle = '#ffffff';
            g.beginPath();
            g.ellipse(-FU * 0.4, -FU * 1.3, FU * 0.2, FU * 0.48, -0.3, 0, Math.PI * 2);
            g.fill();
        },

        // Hoa cúc nhìn hơi nghiêng: vòng cánh dẹt, nhụy vàng
        daisy(g, color) {
            const cy = -FU * 1.2, n = 13;
            g.fillStyle = color;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                g.save();
                g.translate(0, cy);
                g.scale(1, 0.62);
                g.rotate(a);
                g.beginPath();
                g.ellipse(FU * 0.62, 0, FU * 0.52, FU * 0.15, 0, 0, Math.PI * 2);
                g.fill();
                g.restore();
            }
            g.shadowBlur = 0;
            g.fillStyle = 'rgba(120, 90, 140, 0.18)';
            g.beginPath();
            g.ellipse(0, cy + FU * 0.12, FU * 0.95, FU * 0.4, 0, 0, Math.PI);
            g.fill();
            const disk = g.createRadialGradient(-FU * 0.08, cy - FU * 0.08, 0, 0, cy, FU * 0.32);
            disk.addColorStop(0, '#fff2a0');
            disk.addColorStop(0.6, '#ffc93a');
            disk.addColorStop(1, '#d98a1a');
            g.fillStyle = disk;
            g.beginPath();
            g.ellipse(0, cy, FU * 0.32, FU * 0.24, 0, 0, Math.PI * 2);
            g.fill();
        },

        // Anh túc: bốn cánh to mỏng như lụa, tâm sẫm
        poppy(g, color) {
            const cy = -FU * 1.15;
            g.fillStyle = color;
            for (const [dx, dy, r] of [[-0.45, 0.05, 0.62], [0.45, 0.05, 0.62], [-0.2, -0.35, 0.58], [0.25, -0.3, 0.58]]) {
                g.beginPath();
                g.arc(dx * FU, cy + dy * FU, r * FU, 0, Math.PI * 2);
                g.fill();
            }
            g.shadowBlur = 0;
            const shade = g.createRadialGradient(0, cy, FU * 0.1, 0, cy, FU * 1.1);
            shade.addColorStop(0, 'rgba(80, 10, 30, 0.35)');
            shade.addColorStop(0.5, 'rgba(80, 10, 30, 0)');
            shade.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
            g.globalCompositeOperation = 'source-atop';
            g.fillStyle = shade;
            g.fillRect(-FU * 1.3, cy - FU * 1.2, FU * 2.6, FU * 2.2);
            g.globalCompositeOperation = 'source-over';
            g.fillStyle = '#2a1420';
            g.beginPath();
            g.arc(0, cy - FU * 0.05, FU * 0.2, 0, Math.PI * 2);
            g.fill();
            g.globalAlpha = 0.5;
            g.fillStyle = '#ffffff';
            g.beginPath();
            g.ellipse(-FU * 0.5, cy - FU * 0.3, FU * 0.15, FU * 0.3, -0.5, 0, Math.PI * 2);
            g.fill();
        },

        // Oải hương: bông dài gồm nhiều nụ nhỏ xếp dọc
        lavender(g, color, k) {
            g.shadowBlur = 1.5 * k;
            const base = hex(color);
            for (let i = 0; i < 11; i++) {
                const t = i / 10;
                const y = -FU * (0.3 + t * 1.85);
                const r = FU * (0.24 - t * 0.12);
                for (const side of [-1, 1]) {
                    g.fillStyle = rgba(mix(base, [255, 255, 255], (i % 3) * 0.12), 1);
                    g.beginPath();
                    g.ellipse(side * r * 0.7, y, r, r * 1.3, side * 0.4, 0, Math.PI * 2);
                    g.fill();
                }
            }
        },

        // Hoa baby: chùm chấm trắng li ti trên các nhánh mảnh
        breath(g, color, k) {
            g.shadowBlur = 2 * k;
            g.strokeStyle = 'rgba(120, 150, 110, 0.7)';
            g.lineWidth = 0.6;
            const pts = [];
            for (let i = 0; i < 14; i++) {
                const a = -Math.PI / 2 + ((i / 13) - 0.5) * 2.2;
                const d = FU * (0.9 + (i % 4) * 0.3);
                pts.push([Math.cos(a) * d * 0.8, -FU * 0.5 + Math.sin(a) * d]);
            }
            g.beginPath();
            for (const [x, y] of pts) { g.moveTo(0, -FU * 0.4); g.lineTo(x, y); }
            g.stroke();
            g.fillStyle = color;
            for (const [x, y] of pts) {
                g.beginPath();
                g.arc(x, y, FU * 0.16, 0, Math.PI * 2);
                g.fill();
            }
        }
    };

    const petalCache = {};
    function petalSprite(color) {
        if (petalCache[color]) return petalCache[color];
        const w = 32, h = 22;
        const c = makeCanvas(w, h);
        const g = c.getContext('2d');
        g.translate(w / 2, h / 2);
        const grad = g.createRadialGradient(-4, -2, 1, 0, 0, 16);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.4, color);
        grad.addColorStop(1, hexToRgba(color, 0.7));
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(-14, 0);
        g.bezierCurveTo(-8, -10, 8, -10, 14, -2);
        g.lineTo(10, 0);
        g.lineTo(14, 2);
        g.bezierCurveTo(8, 10, -8, 10, -14, 0);
        g.fill();
        return (petalCache[color] = c);
    }

    function setTransform(x, y, angle, sx, sy) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        ctx.setTransform(DPR * sx * cos, DPR * sx * sin, -DPR * sy * sin, DPR * sy * cos, DPR * x, DPR * y);
    }

    function resetTransform() {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    // ---------- Bảng màu theo giờ trong ngày ----------
    // Mỗi khung giờ là một bảng màu; giữa hai mốc thì trộn mượt. Ban ngày cố ý dùng
    // tông trầm, dịu (xanh xám, hồng đất) thay vì trời xanh sáng để các hiệu ứng vẫn nổi.

    const hex = h => {
        const n = parseInt(h.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const toHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    const rgba = (c, a) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

    function mix(a, b, t) {
        if (typeof a === 'number') return a + (b - a) * t;
        if (Array.isArray(a)) return a.map((v, i) => mix(v, b[i], t));
        const o = {};
        for (const k in a) o[k] = mix(a[k], b[k], t);
        return o;
    }

    const COLOR_KEYS = ['horizon', 'rim', 'mist', 'shade', 'cloudLow', 'cloudHigh', 'cloudShade'];
    // flare: lóa ống kính, fluffy: mây cụm trắng (1) hay mây mờ (0), vignette: độ tối viền màn hình
    const DEFAULTS = { flare: 0, fluffy: 0, cloudSize: 1, vignette: 1 };
    function P(o) {
        o = { ...DEFAULTS, ...o };
        const p = { ...o, sky: o.sky.map(hex), core: o.core.map(hex), halo: o.halo.map(hex), hills: o.hills.map(l => l.map(hex)) };
        COLOR_KEYS.forEach(k => { p[k] = hex(o[k]); });
        return p;
    }

    const NIGHT = P({
        light: 0.15,
        sky: ['#02030a', '#050a1c', '#0a1430', '#11203f', '#18294a', '#1f3150', '#263a56', '#2c4058'],
        milky: 1.4, stars: 1.25, rays: 0, fireflies: 1, moon: 1,
        bx: 0.74, by: 0.2, bsize: 0.8,
        core: ['#fdfcf5', '#eceee8', '#c9cfdd'], halo: ['#c8d7ff', '#5a6ea8'], haloA: 0.55, horizon: '#5a78c0', horizonA: 0.35,
        hills: [['#1e2944', '#0e1528'], ['#121a33', '#080d1a'], ['#080b17', '#030409']],
        rim: '#b4c8ff', rimA: 0.55, mist: '#7890c8', mistA: 0.9, shade: '#020306',
        cloudLow: '#5a6a96', cloudHigh: '#3a4070', cloudShade: '#262c50', cloudA: 0.7, grass: [195, 24, 2.5, 7]
    });

    const PREDAWN = P({
        light: 0.2,
        sky: ['#03040e', '#080b22', '#121638', '#1d1d48', '#2c2552', '#41305c', '#5a3c64', '#6e4868'],
        milky: 0.9, stars: 1, rays: 0, fireflies: 0.8, moon: 1,
        bx: 0.84, by: 0.8, bsize: 0.8,
        core: ['#fdfcf5', '#eceee8', '#c9cfdd'], halo: ['#c8d7ff', '#5a6ea8'], haloA: 0.4, horizon: '#8a6aa8', horizonA: 0.45,
        hills: [['#2a2244', '#141028'], ['#18142e', '#0a0818'], ['#0b0914', '#040308']],
        rim: '#c8b4e6', rimA: 0.5, mist: '#9a84c0', mistA: 1.2, shade: '#030206',
        cloudLow: '#7a6290', cloudHigh: '#40386a', cloudShade: '#30284e', cloudA: 0.7, grass: [185, 22, 2.5, 7]
    });

    const DAWN = P({
        light: 0.5,
        sky: ['#0e1030', '#1f1f4e', '#3b3168', '#634a85', '#9a6390', '#d48a95', '#eeb0a0', '#f6cfae'],
        milky: 0.35, stars: 0.4, rays: 0.75, fireflies: 0.35, moon: 0,
        bx: 0.5, by: 0.62, bsize: 1,
        core: ['#fffaf0', '#ffe6c8', '#ffb898'], halo: ['#ffd8c0', '#ff9aa0'], haloA: 0.9, horizon: '#ffb0a0', horizonA: 1,
        hills: [['#5a4570', '#2d2240'], ['#33284a', '#1a1428'], ['#17101f', '#08060c']],
        rim: '#ffc8c8', rimA: 0.9, mist: '#ffb4c8', mistA: 1.6, shade: '#050309',
        cloudLow: '#ffb4b0', cloudHigh: '#8c6a9a', cloudShade: '#6a4a7a', cloudA: 1, grass: [170, 20, 3.5, 9],
        flare: 0.2, fluffy: 0, cloudSize: 1.1, vignette: 0.8
    });

    // Ban ngày: trời xanh trong, mây trắng bồng bềnh, đồng cỏ xanh tươi — đối lập hẳn với đêm
    const DAY = P({
        light: 1,
        sky: ['#2a6fcf', '#3a82dc', '#4f97e6', '#68aaee', '#86bff3', '#a6d2f7', '#c4e2f9', '#dcefff'],
        milky: 0, stars: 0, rays: 0.8, fireflies: 0, moon: 0,
        flare: 1, fluffy: 1, cloudSize: 1.35, vignette: 0.15,
        bx: 0.17, by: 0.12, bsize: 0.8,
        core: ['#ffffff', '#fffef6', '#fff3d6'], halo: ['#ffffff', '#cfe8ff'], haloA: 1, horizon: '#ffffff', horizonA: 0.35,
        hills: [['#a7cf8f', '#86b874'], ['#7dbb55', '#5e9e3e'], ['#62ad38', '#468f28']],
        rim: '#f4ffe0', rimA: 0.8, mist: '#ffffff', mistA: 2.5, shade: '#3a7a22',
        cloudLow: '#ffffff', cloudHigh: '#ffffff', cloudShade: '#b9cde2', cloudA: 1, grass: [92, 55, 24, 26]
    });

    const GOLDEN = P({
        light: 0.7,
        sky: ['#161a3a', '#262a55', '#3f3a6a', '#66507a', '#9a6a7e', '#cf8a80', '#e8a885', '#f2c39a'],
        milky: 0.15, stars: 0.25, rays: 0.9, fireflies: 0.55, moon: 0,
        bx: 0.55, by: 0.45, bsize: 0.95,
        core: ['#fffbec', '#ffe8b8', '#ffc890'], halo: ['#ffe0b0', '#ff9e70'], haloA: 0.9, horizon: '#ffb880', horizonA: 0.8,
        hills: [['#4a2f50', '#22162e'], ['#2a1a35', '#130c1a'], ['#140a16', '#060308']],
        rim: '#ffc8a0', rimA: 1, mist: '#ffa0a8', mistA: 1.2, shade: '#040206',
        cloudLow: '#ffb48c', cloudHigh: '#9a6a8c', cloudShade: '#6a3e66', cloudA: 1, grass: [158, 26, 3.5, 9],
        flare: 0.35, fluffy: 0.3, cloudSize: 1.15, vignette: 0.7
    });

    const SUNSET = P({
        light: 0.5,
        sky: ['#05040f', '#0c0a24', '#1d0f3a', '#45164a', '#8a2550', '#d4544e', '#f59a5a', '#ffc98a'],
        milky: 1, stars: 1, rays: 1, fireflies: 1, moon: 0,
        bx: 0.5, by: 0.6, bsize: 1,
        core: ['#fffbe8', '#ffe2a0', '#ffb070'], halo: ['#ffdc96', '#ff8246'], haloA: 1, horizon: '#ffaa5a', horizonA: 1,
        hills: [['#4a1a46', '#1e0c24'], ['#25102a', '#110714'], ['#120814', '#060308']],
        rim: '#ffb48c', rimA: 1, mist: '#ff8ca0', mistA: 1, shade: '#040206',
        cloudLow: '#ff9664', cloudHigh: '#8c4678', cloudShade: '#5a2a5a', cloudA: 1, grass: [160, 28, 3, 9]
    });

    const DUSK = P({
        light: 0.25,
        sky: ['#04030c', '#090820', '#160d33', '#2d1240', '#4a1a48', '#6e2448', '#8a3446', '#9a4a48'],
        milky: 1.1, stars: 1.1, rays: 0.15, fireflies: 1, moon: 0,
        bx: 0.5, by: 0.82, bsize: 1,
        core: ['#ffe9c8', '#ffc080', '#ff9060'], halo: ['#ff9a70', '#c04060'], haloA: 0.7, horizon: '#ff7060', horizonA: 0.7,
        hills: [['#36163c', '#170a1e'], ['#1c0c22', '#0c0510'], ['#0e0610', '#050206']],
        rim: '#ff9a8c', rimA: 0.6, mist: '#c0708c', mistA: 0.8, shade: '#030205',
        cloudLow: '#c06070', cloudHigh: '#5a3060', cloudShade: '#3a1a40', cloudA: 0.8, grass: [165, 26, 2.5, 8]
    });

    // [giờ, bảng màu]: đêm → rạng sáng → bình minh → ngày → chiều vàng → hoàng hôn → chạng vạng → đêm
    const KEYS = [
        [0, NIGHT], [4.5, NIGHT], [5.25, PREDAWN], [6.25, DAWN], [9, DAY], [15, DAY],
        [16.75, GOLDEN], [18.25, SUNSET], [19.5, DUSK], [21, NIGHT], [24, NIGHT]
    ];

    function paletteAt(h) {
        h = ((h % 24) + 24) % 24;
        for (let i = 0; i < KEYS.length - 1; i++) {
            const [h0, p0] = KEYS[i], [h1, p1] = KEYS[i + 1];
            if (h >= h0 && h <= h1) {
                const t = (h - h0) / (h1 - h0);
                return mix(p0, p1, t * t * (3 - 2 * t));
            }
        }
        return NIGHT;
    }

    let fixedHour = null;
    let pal = SUNSET;
    let seeds = { sky: 1, hills: 2, rays: 3, moon: 4, grass: 5 };
    let prevLayers = null, fade = 1, palTimer = 0;
    const PALETTE_EVERY = 90000;

    function nowHour() {
        if (fixedHour !== null) return fixedHour;
        const d = new Date();
        return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    }

    // Dựng lại nền theo màu của giờ hiện tại; crossfade từ bản cũ cho khỏi giật
    function applyPalette(crossfade) {
        prevLayers = crossfade ? { sky: skyLayer, hills: hillLayers, grass: grassBack } : null;
        fade = crossfade ? 0 : 1;
        pal = paletteAt(nowHour());
        buildSky();
        buildSun();
        buildHills();
        recolorGrass();
        clouds.forEach(buildCloud);
        notifyTone();
    }

    // Báo cho trang chính chỉnh độ tối viền màn hình theo khung giờ
    function notifyTone() {
        const msg = { type: 'tone', vignette: pal.vignette, light: pal.light };
        if (IN_WORKER) global.postMessage(msg);
        else if (global.Scene && global.Scene.onmessage) global.Scene.onmessage(msg);
    }

    // ---------- Dựng cảnh ----------

    let dprCap = 2;

    function setSize(m) {
        W = m.width;
        H = m.height;
        DPR = Math.min(m.dpr, dprCap);
        lastSize = m;
        isMobile = W < 768;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);

        const r = () => Math.floor(Math.random() * 1e9);
        seeds = { sky: r(), hills: r(), rays: r(), moon: r(), grass: r() };
        prevLayers = null;
        fade = 1;
        pal = paletteAt(nowHour());
        buildSky();
        buildSun();
        buildHills();
        initStars();
        initClouds();
        notifyTone();
        initGrass();
        initFireflies();
        initPetals();
        initButterflies();
        birds = [];
        particles = [];
        rings = [];
        wisps = [];
        breeze.active = false;
        breeze.next = rand(120, 300);
        shootingStars = [];
    }

    const sunPos = () => ({
        x: W * pal.bx,
        y: H * pal.by,
        r: (isMobile ? W * 0.13 : Math.min(W, H) * 0.075) * pal.bsize
    });

    function buildSky() {
        seeded(seeds.sky, buildSkyLayer);
    }

    function buildSkyLayer() {
        const m = PARALLAX;
        const w = W + m * 2, h = H + m * 2;
        skyLayer = makeCanvas(w * DPR, h * DPR);
        const g = skyLayer.getContext('2d');
        g.scale(DPR, DPR);

        const grad = g.createLinearGradient(0, 0, 0, h);
        [0, 0.22, 0.40, 0.52, 0.60, 0.67, 0.73, 0.80].forEach((o, i) => grad.addColorStop(o, rgba(pal.sky[i], 1)));
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);

        // Mây ti: các vệt lông chim mảnh trên cao, chỉ rõ vào ban ngày
        const blob = softBlob([255, 255, 255]);
        const streaks = isMobile ? 4 : 7;
        for (let i = 0; i < streaks; i++) {
            const x0 = rand(-0.1, 0.9) * w, y0 = rand(0.04, 0.32) * h;
            const len = rand(0.15, 0.4) * w, ang = rand(-0.25, 0.1);
            const n = Math.round(len / 6);
            for (let j = 0; j < n; j++) {
                const t = j / n;
                const x = x0 + Math.cos(ang) * len * t;
                const y = y0 + Math.sin(ang) * len * t + Math.sin(t * 9 + i) * 6 + gauss() * 4;
                const r = rand(8, 22) * Math.sin(Math.PI * t + 0.2);
                g.globalAlpha = Math.max(0, rand(0.04, 0.1) * pal.fluffy);
                g.save();
                g.translate(x, y);
                g.rotate(ang + rand(-0.2, 0.2));
                g.drawImage(blob, -r * 2.5, -r * 0.35, r * 5, r * 0.7);
                g.restore();
            }
        }
        g.globalAlpha = 1;

        // Dải ngân hà chạy chéo bầu trời
        g.globalCompositeOperation = 'lighter';
        const ax = -w * 0.05, ay = h * 0.42, bx = w * 1.05, by = -h * 0.02;
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy);
        const nx = -dy / len, ny = dx / len;
        const band = Math.min(w, h) * 0.12;

        const mk = pal.milky;
        const nebula = [`rgba(150, 120, 255, ${0.05 * mk})`, `rgba(255, 140, 210, ${0.04 * mk})`, `rgba(120, 190, 255, ${0.04 * mk})`];
        for (let i = 0; i < 80; i++) {
            const t = rng();
            const o = gauss() * band;
            const x = ax + dx * t + nx * o, y = ay + dy * t + ny * o;
            const r = rand(band * 0.6, band * 1.8);
            const rg = g.createRadialGradient(x, y, 0, x, y, r);
            rg.addColorStop(0, pick(nebula));
            rg.addColorStop(1, 'rgba(0,0,0,0)');
            g.fillStyle = rg;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }

        const dust = Math.floor((w * h) / (isMobile ? 260 : 180));
        for (let i = 0; i < dust; i++) {
            const t = rng();
            const o = gauss() * band * 1.2;
            const x = ax + dx * t + nx * o, y = ay + dy * t + ny * o;
            g.fillStyle = `rgba(255, 245, 255, ${rand(0.04, 0.22) * (1 - y / h) * Math.min(1, mk)})`;
            g.fillRect(x, y, rand(0.4, 1.1), rand(0.4, 1.1));
        }

        // Vệt bụi tối ở giữa dải ngân hà
        g.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 40; i++) {
            const t = rng();
            const o = gauss() * band * 0.25;
            const x = ax + dx * t + nx * o, y = ay + dy * t + ny * o;
            const r = rand(band * 0.2, band * 0.5);
            const rg = g.createRadialGradient(x, y, 0, x, y, r);
            rg.addColorStop(0, `rgba(5, 4, 15, ${0.12 * Math.min(1, mk)})`);
            rg.addColorStop(1, 'rgba(5, 4, 15, 0)');
            g.fillStyle = rg;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }
    }

    // Quầng sáng, lõi mặt trời và tia nắng được vẽ sẵn một lần
    function buildSun() {
        const { r } = sunPos();

        const horizon = makeCanvas(256, 64);
        let g = horizon.getContext('2d');
        g.translate(128, 32);
        g.scale(4, 1);
        let rg = g.createRadialGradient(0, 0, 0, 0, 0, 32);
        rg.addColorStop(0, rgba(pal.horizon, 0.4 * pal.horizonA));
        rg.addColorStop(0.5, rgba(pal.halo[1], 0.12 * pal.horizonA));
        rg.addColorStop(1, rgba(pal.halo[1], 0));
        g.fillStyle = rg;
        g.fillRect(-32, -32, 64, 64);

        const halo = makeCanvas(256, 256);
        g = halo.getContext('2d');
        rg = g.createRadialGradient(128, 128, 21, 128, 128, 128);
        rg.addColorStop(0, rgba(pal.halo[0], 0.75 * pal.haloA));
        rg.addColorStop(0.3, rgba(pal.halo[1], 0.3 * pal.haloA));
        rg.addColorStop(1, rgba(pal.halo[1], 0));
        g.fillStyle = rg;
        g.fillRect(0, 0, 256, 256);

        const cs = Math.ceil(r * 2 * DPR) + 2;
        const core = makeCanvas(cs, cs);
        g = core.getContext('2d');
        const c = cs / 2;
        rg = g.createRadialGradient(c, c - c * 0.3, 0, c, c, c - 1);
        rg.addColorStop(0, rgba(pal.core[0], 1));
        rg.addColorStop(0.6, rgba(pal.core[1], 1));
        rg.addColorStop(0.97, rgba(pal.core[2], 1));
        rg.addColorStop(1, rgba(pal.core[2], 0));
        g.fillStyle = rg;
        g.beginPath();
        g.arc(c, c, c - 1, 0, Math.PI * 2);
        g.fill();

        // Ban đêm: thêm vết hõm cho thành mặt trăng
        if (pal.moon > 0.02) {
            g.save();
            g.clip();
            seeded(seeds.moon, () => {
                for (let i = 0; i < 9; i++) {
                    const a = rand(0, Math.PI * 2), d = Math.sqrt(rng()) * c * 0.75;
                    const cr = rand(0.06, 0.2) * c;
                    const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
                    const cg = g.createRadialGradient(x - cr * 0.3, y - cr * 0.3, 0, x, y, cr);
                    cg.addColorStop(0, `rgba(140, 145, 170, ${0.28 * pal.moon})`);
                    cg.addColorStop(1, 'rgba(140, 145, 170, 0)');
                    g.fillStyle = cg;
                    g.fillRect(x - cr, y - cr, cr * 2, cr * 2);
                }
            });
            g.restore();
        }

        sunSprites = { horizon, halo, core };

        if (!raysSprite) seeded(seeds.rays, buildRays);
    }

    // Tia nắng: các nan sáng mảnh, mờ dần ra xa (không phụ thuộc màu nên chỉ dựng một lần)
    function buildRays() {
        let g, rg;
        const rs = 512;
        raysSprite = makeCanvas(rs, rs);
        g = raysSprite.getContext('2d');
        g.translate(rs / 2, rs / 2);
        const n = 18;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
            const spread = rand(0.015, 0.05);
            g.fillStyle = `rgba(255, 210, 160, ${rand(0.25, 0.6)})`;
            g.beginPath();
            g.moveTo(0, 0);
            g.arc(0, 0, rs / 2, a - spread, a + spread);
            g.closePath();
            g.fill();
        }
        g.globalCompositeOperation = 'destination-in';
        rg = g.createRadialGradient(0, 0, 0, 0, 0, rs / 2);
        rg.addColorStop(0, 'rgba(0,0,0,1)');
        rg.addColorStop(0.25, 'rgba(0,0,0,0.6)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg;
        g.fillRect(-rs / 2, -rs / 2, rs, rs);
    }

    // Ba lớp đồi, xa → gần, có viền sáng hắt từ mặt trời
    function buildHills() {
        seeded(seeds.hills, buildHillLayers);
    }

    // Nhiễu 1 chiều mượt (value noise) theo rng hiện tại
    function valueNoise() {
        const n = 256, v = [];
        for (let i = 0; i < n; i++) v.push(rng());
        return x => {
            const i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f);
            const a = v[((i % n) + n) % n], b = v[(((i + 1) % n) + n) % n];
            return a + (b - a) * t;
        };
    }

    // Vẽ một dãy núi: thân núi nhạt dần xuống chân, mặt sườn sáng/tối theo hướng mặt trời,
    // tuyết trên các đỉnh cao, sương phủ chân núi và viền sáng mảnh trên sống núi.
    function drawMountain(g, d, w, hh, path, yAt, heightAt, minY, topC, bottom, rock, L) {
        const baseY = d.base * H;
        const grad = g.createLinearGradient(0, minY, 0, baseY + H * 0.02);
        grad.addColorStop(0, rgba(topC, 1));
        grad.addColorStop(1, rgba(bottom, 1));
        g.fillStyle = grad;
        g.fill(path);

        g.save();
        g.clip(path);

        // Mặt sườn: sườn hướng về mặt trời sáng lên, sườn khuất tối đi. Độ dốc lấy trung bình
        // trên một đoạn dài để thành từng mảng lớn; vẽ vào lớp riêng rồi làm mềm một lần.
        const sunDir = pal.bx < 0.5 ? -1 : 1;
        const lit = mix(topC, pal.rim, 0.25 + 0.3 * L);
        const dark = mix(rock, [10, 14, 30], 0.35);
        const SR = 0.5;
        const sc = makeCanvas(w * SR, (hh - minY) * SR);
        const sg = sc.getContext('2d');
        sg.scale(SR, SR);
        sg.translate(0, -minY);
        const win = d.feature * 0.06;
        for (let x = 0; x <= w; x += 3) {
            const slope = (yAt(x + win) - yAt(x - win)) / (2 * win);
            const k = Math.max(-1, Math.min(1, slope * sunDir * 2.2));
            if (Math.abs(k) < 0.04) continue;
            const y = yAt(x);
            sg.fillStyle = k > 0 ? rgba(lit, 0.38 * k * (0.5 + 0.5 * L)) : rgba(dark, -0.3 * k * (1 - d.haze * 0.45));
            sg.fillRect(x - 0.5, y, 4, (baseY - y) * 0.85);
        }
        // Mảng sáng tối đậm ở sống núi, nhạt dần xuống chân
        sg.globalCompositeOperation = 'destination-in';
        const fade = sg.createLinearGradient(0, minY, 0, baseY);
        fade.addColorStop(0, 'rgba(0,0,0,1)');
        fade.addColorStop(1, 'rgba(0,0,0,0.1)');
        sg.fillStyle = fade;
        sg.fillRect(0, minY, w, hh - minY);
        g.filter = `blur(${Math.max(4, Math.round(d.feature / 25))}px)`;
        g.drawImage(sc, 0, minY, w, hh - minY);
        g.filter = 'none';

        // Tuyết trên các đỉnh cao: trắng ban ngày, ửng hồng lúc hoàng hôn, xanh bạc dưới trăng
        if (d.snow) {
            const snowLine = H * d.peak * 0.55;
            const snow = mix(mix([248, 250, 255], pal.rim, 0.3), topC, 0.25 + 0.35 * (1 - L));
            const snowShade = mix(snow, rock, 0.35);
            for (let x = 0; x <= w; x += 2) {
                const hgt = heightAt(x);
                if (hgt < snowLine) continue;
                const y = yAt(x);
                const depth = (hgt - snowLine) * 0.55 + Math.sin(x * 0.21) * 2 + Math.sin(x * 0.057) * 3;
                if (depth <= 0) continue;
                // Độ dốc lấy trung bình như phần sườn để mặt tuyết sáng/tối thành từng mảng liền
                const slope = (yAt(x + win) - yAt(x - win)) / (2 * win);
                const k = Math.max(0, Math.min(1, 0.5 + slope * sunDir * 3));
                g.fillStyle = rgba(mix(snowShade, snow, k), (0.4 + 0.55 * L) * Math.min(1, depth / 6));
                g.fillRect(x, y, 2.2, depth);
            }
        }

        // Sương dày ở chân núi, hoà vào đường chân trời
        const mist = g.createLinearGradient(0, baseY - H * d.peak * 0.6, 0, baseY + H * 0.02);
        mist.addColorStop(0, rgba(mix(pal.sky[6], pal.mist, 0.3), 0));
        mist.addColorStop(1, rgba(mix(pal.sky[6], pal.mist, 0.3), 0.08 + 0.3 * d.haze * L * L));
        g.fillStyle = mist;
        g.fillRect(0, baseY - H * d.peak * 0.6, w, H * d.peak * 0.6 + H * 0.05);
        g.restore();

        // Viền sáng mảnh trên sống núi
        const ridge = new Path2D();
        for (let x = 0; x <= w; x += 3) x === 0 ? ridge.moveTo(x, yAt(x)) : ridge.lineTo(x, yAt(x));
        const rx = Math.min(0.85, Math.max(0.15, pal.bx));
        const rim = g.createLinearGradient(0, 0, w, 0);
        rim.addColorStop(0, rgba(pal.rim, 0.05));
        rim.addColorStop(rx, rgba(pal.rim, Math.min(0.6, d.rim * pal.rimA)));
        rim.addColorStop(1, rgba(pal.rim, 0.05));
        g.strokeStyle = rim;
        g.lineWidth = 1;
        g.stroke(ridge);
    }

    // Mọi lệnh rng() ở đây chạy theo cùng thứ tự bất kể bảng màu, để khi dựng lại
    // theo giờ thì hình dáng đồi, cây, hoa vẫn y nguyên, chỉ đổi màu.
    function buildHillLayers() {
        const defs = [
            // Hai dãy núi xa: dãy sau cao, mờ sương và có tuyết; dãy trước thấp, đậm hơn
            { mountain: true, base: 0.575, peak: 0.17, feature: 300, haze: 0.75, snow: 1, rim: 0.2, depth: 0.08 },
            { mountain: true, base: 0.6, peak: 0.085, feature: 190, haze: 0.45, snow: 0, rim: 0.25, depth: 0.15 },
            { base: 0.60, dip: 0.04, amps: [0.03, 0.012, 0.006], rim: 0.45, depth: 0.25, meadow: 3, dots: 0.5, tufts: 1.4 },
            { base: 0.69, amps: [0.04, 0.02, 0.008], rim: 0.3, depth: 0.55, meadow: 5, dots: 0.9, tufts: 2.6 },
            { base: 0.79, amps: [0.03, 0.018, 0.01], rim: 0.18, depth: 0.85, meadow: 6, dots: 1.1, tufts: 4 }
        ];
        const rimX = Math.min(0.85, Math.max(0.15, pal.bx));
        const m = PARALLAX * 2;
        const L = pal.light;

        hillLayers = defs.map(d => {
            const w = W + m * 2, hh = H + m;

            // Màu lớp: núi xa hoà vào màu trời, các lớp đồi lấy từ bảng màu
            const li = defs.indexOf(d) - defs.filter(e => e.mountain).length;
            // Núi: xanh lam ngả theo màu trời; càng xuống chân càng nhạt vào lớp sương chân trời
            const haze = mix(pal.sky[5], pal.sky[7], 0.5);
            // Ban ngày núi xanh lam nhạt vì sương; khi trời tối dần núi thành bóng sẫm trước nền trời
            const rock = mix(mix(pal.hills[0][1], pal.sky[2], 0.6), [18, 18, 40], 0.12 + 0.4 * (1 - L));
            const topC = d.mountain ? mix(rock, haze, d.haze * (0.08 + 0.5 * L * L)) : pal.hills[li][0];
            const bottom = d.mountain ? mix(rock, haze, d.haze * (0.2 + 0.55 * L)) : pal.hills[li][1];

            let yAt;
            let heightAt = null;
            if (d.mountain) {
                // Sống núi tự nhiên từ nhiễu fractal: phần đỉnh nhọn (ridged) trộn với phần thoải.
                // Kích thước nét núi tính theo pixel nên trên màn hình hẹp núi không bị nhọn hoắt.
                const noise = valueNoise();
                const off = rand(0, 100);
                heightAt = x => {
                    const t = x / w;
                    const u = x / d.feature + off;
                    let f = 0, r = 0, amp = 1, sum = 0;
                    for (let o = 0; o < 5; o++) {
                        const n = noise(u * (1 << o));
                        f += n * amp;
                        r += (1 - Math.abs(n * 2 - 1)) * amp;
                        sum += amp;
                        amp *= 0.5;
                    }
                    const shape = Math.pow(0.45 * f / sum + 0.55 * r / sum, 1.6);
                    // Khoảng giữa thấp xuống để mặt trời lặn vẫn ló ra
                    const env = 1 - 0.92 * Math.exp(-(((t - 0.5) / 0.12) ** 2));
                    return H * d.peak * shape * env * 1.6;
                };
                yAt = x => d.base * H - heightAt(x);
            } else {
                const phases = d.amps.map(() => rand(0, Math.PI * 2));
                const freqs = [rand(1.2, 2), rand(3, 5), rand(8, 12)];
                yAt = x => {
                    let y = d.base * H;
                    d.amps.forEach((a, i) => { y += Math.sin((x / w) * freqs[i] * Math.PI + phases[i]) * a * H; });
                    // Thung lũng ở giữa để mặt trời luôn ló ra
                    if (d.dip) y += Math.exp(-(((x / w - 0.5) / 0.14) ** 2)) * d.dip * H;
                    return y;
                };
            }

            // Chỉ giữ phần ảnh từ đỉnh đồi trở xuống (phía trên là trời trong suốt, vẽ vô ích)
            let minY = hh;
            for (let x = 0; x <= w; x += 3) minY = Math.min(minY, yAt(x));
            const top = Math.max(0, Math.floor(minY - 8 - (d.tufts || 0) * 2.5));
            const c = makeCanvas(w * DPR, (hh - top) * DPR);
            const g = c.getContext('2d');
            g.scale(DPR, DPR);
            g.translate(0, -top);

            // Lớp riêng cho cỏ và hoa trên sườn đồi, để có thể lay động theo gió
            const tc = d.mountain ? null : makeCanvas(w * DPR, (hh - top) * DPR);
            const tg = tc && tc.getContext('2d');
            if (tg) {
                tg.scale(DPR, DPR);
                tg.translate(0, -top);
            }

            const path = new Path2D();
            path.moveTo(0, hh);
            for (let x = 0; x <= w; x += 3) path.lineTo(x, yAt(x));
            path.lineTo(w, hh);
            path.closePath();

            if (d.mountain) {
                drawMountain(g, d, w, hh, path, yAt, heightAt, minY, topC, bottom, rock, L);
                return { canvas: c, tex: null, depth: d.depth, margin: m, h: hh - top, top };
            }

            const grad = g.createLinearGradient(0, (d.base - 0.06) * H, 0, H);
            grad.addColorStop(0, rgba(topC, 1));
            grad.addColorStop(1, rgba(bottom, 1));
            g.fillStyle = grad;
            g.fill(path);

            g.save();
            g.clip(path);

            // Mảng sáng tối loang lổ trên sườn đồi (đồng cỏ, bụi cây xa)
            const patches = Math.round(w / 90);
            for (let i = 0; i < patches; i++) {
                const x = rand(0, w);
                const y = yAt(x) + rand(0.01, 0.14) * H;
                const r = rand(0.04, 0.12) * W;
                const lighter = rng() < 0.5;
                const pg = g.createRadialGradient(x, y, 0, x, y, r);
                pg.addColorStop(0, lighter ? rgba(pal.rim, 0.07 * (0.4 + L)) : rgba(bottom, 0.35));
                pg.addColorStop(1, lighter ? rgba(pal.rim, 0) : rgba(bottom, 0));
                g.fillStyle = pg;
                g.save();
                g.translate(x, y);
                g.scale(2.6, 0.55);
                g.translate(-x, -y);
                g.fillRect(x - r, y - r, r * 2, r * 2);
                g.restore();
            }

            // Vệt nắng chạy dọc ngay dưới đỉnh đồi
            const ridge = new Path2D();
            for (let x = 0; x <= w; x += 3) x === 0 ? ridge.moveTo(x, yAt(x)) : ridge.lineTo(x, yAt(x));
            const band = g.createLinearGradient(0, 0, w, 0);
            band.addColorStop(0, rgba(pal.rim, 0.05 * L));
            band.addColorStop(rimX, rgba(pal.rim, Math.min(0.35, 0.22 * pal.rimA * (0.4 + L))));
            band.addColorStop(1, rgba(pal.rim, 0.05 * L));
            g.filter = `blur(${Math.max(2, Math.round(H * 0.008))}px)`;
            g.strokeStyle = band;
            g.lineWidth = H * 0.022;
            g.stroke(ridge);
            g.filter = 'none';

            // Thảm cỏ phủ kín sườn đồi: ngọn cỏ nhỏ ở gần đỉnh (xa) và to dần xuống chân đồi (gần).
            // Chia ba sắc độ, mỗi sắc độ một path để vẽ nhanh.
            if (tg) {
                tg.save();
                tg.clip(path);
            }
            if (d.meadow) {
                const tones = [
                    mix(topC, pal.rim, 0.18 + 0.12 * L),
                    mix(topC, bottom, 0.3),
                    mix(bottom, [0, 0, 0], 0.15)
                ];
                const paths = tones.map(() => new Path2D());
                const n = Math.round(w * d.meadow * (isMobile ? 1.3 : 1));
                for (let i = 0; i < n; i++) {
                    const x = rand(0, w);
                    const dy = Math.pow(rng(), 1.25) * 0.2 * H;
                    const y = yAt(x) + dy + 1;
                    const len = (1.2 + dy * 0.09) * (0.5 + d.depth) * rand(0.6, 1.3);
                    const a = rand(-0.35, 0.35) + 0.12;
                    const p = paths[Math.min(2, Math.floor(rng() * 2.2 + dy / (0.2 * H) * 0.9))];
                    p.moveTo(x, y);
                    p.quadraticCurveTo(x + Math.sin(a) * len * 0.3, y - len * 0.6, x + Math.sin(a) * len, y - Math.cos(a) * len);
                }
                tg.lineCap = 'round';
                tg.lineWidth = 0.5 + d.depth * 0.7;
                tones.forEach((t, i) => {
                    tg.strokeStyle = rgba(t, 0.55);
                    tg.stroke(paths[i]);
                });
            }

            // Cánh đồng hoa phủ sườn đồi: các vạt màu lớn, rồi đến hàng nghìn bông nhỏ
            // tập trung trong vạt; xa thì li ti, gần chân đồi to dần.
            if (d.dots) {
                const fade = 0.85 - 0.6 * L;
                const drifts = [];
                const nDrift = Math.round(w / (d.depth > 0.5 ? 95 : 130));
                const span = Math.max(W, 800);
                for (let i = 0; i < nDrift; i++) {
                    const x = rand(0, w);
                    drifts.push({
                        x,
                        y: yAt(x) + rand(0.01, 0.13) * H,
                        rx: rand(0.07, 0.2) * span,
                        ry: rand(0.015, 0.04) * H * (0.6 + d.depth),
                        color: hex(pick(DRIFT_COLORS))
                    });
                }
                for (const dr of drifts) {
                    const col = mix(dr.color, topC, fade);
                    const dg = g.createRadialGradient(dr.x, dr.y, 0, dr.x, dr.y, dr.rx);
                    dg.addColorStop(0, rgba(col, 0.45 * (0.35 + 0.65 * L)));
                    dg.addColorStop(0.6, rgba(col, 0.2 * (0.35 + 0.65 * L)));
                    dg.addColorStop(1, rgba(col, 0));
                    g.fillStyle = dg;
                    g.save();
                    g.translate(dr.x, dr.y);
                    g.scale(1, dr.ry / dr.rx);
                    g.translate(-dr.x, -dr.y);
                    g.fillRect(dr.x - dr.rx, dr.y - dr.rx, dr.rx * 2, dr.rx * 2);
                    g.restore();
                }

                const nd = Math.round(w * d.dots * 10);
                const byColor = new Map();
                for (let i = 0; i < nd; i++) {
                    let x, y, color;
                    if (rng() < 0.7) {
                        const dr = drifts[Math.floor(rng() * drifts.length)];
                        x = dr.x + gauss() * dr.rx * 0.75;
                        y = Math.max(yAt(x) + 1, dr.y + gauss() * dr.ry * 1.4);
                        color = rng() < 0.85 ? dr.color : hex(pick(DRIFT_COLORS));
                    } else {
                        x = rand(0, w);
                        y = yAt(x) + Math.pow(rng(), 1.4) * 0.18 * H + 1;
                        color = hex(pick(DRIFT_COLORS));
                    }
                    const dy = Math.max(0, y - yAt(x));
                    const r = (0.45 + dy * 0.018) * (0.5 + d.depth) * rand(0.7, 1.25);
                    const key = color.join(',');
                    if (!byColor.has(key)) byColor.set(key, { color, path: new Path2D(), hi: new Path2D() });
                    const b = byColor.get(key);
                    b.path.moveTo(x + r, y);
                    b.path.arc(x, y, r, 0, Math.PI * 2);
                    if (r > 1.1) {
                        b.hi.moveTo(x - r * 0.2 + r * 0.35, y - r * 0.25);
                        b.hi.arc(x - r * 0.2, y - r * 0.25, r * 0.35, 0, Math.PI * 2);
                    }
                }
                for (const { color, path, hi } of byColor.values()) {
                    tg.fillStyle = rgba(mix(color, topC, fade * 0.9), 0.85);
                    tg.fill(path);
                    tg.fillStyle = rgba([255, 255, 255], 0.35 * L);
                    tg.fill(hi);
                }
            }

            // Sương mờ ở chân đồi
            const mist = g.createLinearGradient(0, d.base * H, 0, (d.base + 0.16) * H);
            mist.addColorStop(0, rgba(pal.mist, 0));
            mist.addColorStop(0.5, rgba(pal.mist, 0.06 * (1 - d.depth) * pal.mistA));
            mist.addColorStop(1, rgba(pal.mist, 0));
            g.fillStyle = mist;
            g.fillRect(0, d.base * H, w, 0.16 * H);
            g.restore();

            // Viền sáng đỉnh đồi
            const rim = g.createLinearGradient(0, 0, w, 0);
            rim.addColorStop(0, rgba(pal.rim, 0));
            rim.addColorStop(rimX, rgba(pal.rim, Math.min(1, d.rim * pal.rimA)));
            rim.addColorStop(1, rgba(pal.rim, 0));
            g.strokeStyle = rim;
            g.lineWidth = 1.2;
            g.stroke(ridge);

            // Cỏ lởm chởm trên đường viền để mép đồi không trơn tuột
            if (tg) tg.restore();
            if (d.tufts) {
                tg.strokeStyle = rgba(topC, 1);
                tg.lineWidth = 0.6 + d.depth * 0.8;
                tg.beginPath();
                for (let x = 0; x <= w; x += rand(1.5, 4)) {
                    const y = yAt(x) + 1;
                    const len = rand(0.5, 1.6) * d.tufts;
                    const a = rand(-0.5, 0.5);
                    tg.moveTo(x, y);
                    tg.lineTo(x + Math.sin(a) * len, y - Math.cos(a) * len);
                }
                tg.stroke();
            }

            return { canvas: c, tex: tc, depth: d.depth, margin: m, h: hh - top, top };
        });

        // Phủ tối chân màn hình làm nền cho cỏ (vẽ sẵn vào lớp đồi gần nhất)
        const near = hillLayers[hillLayers.length - 1];
        const g = near.canvas.getContext('2d');
        const shade = g.createLinearGradient(0, H * 0.72, 0, H);
        shade.addColorStop(0, rgba(pal.shade, 0));
        shade.addColorStop(1, rgba(pal.shade, 0.95));
        g.fillStyle = shade;
        g.fillRect(0, H * 0.72, W + near.margin * 2, H * 0.28 + near.margin);
        const tg = near.tex.getContext('2d');
        tg.globalCompositeOperation = 'source-atop';
        tg.fillStyle = shade;
        tg.fillRect(0, H * 0.72, W + near.margin * 2, H * 0.28 + near.margin);
        tg.globalCompositeOperation = 'source-over';
    }

    function initStars() {
        stars = [];
        const n = Math.floor((W * H) / (isMobile ? 1400 : 1100));
        const colors = ['#ffffff', '#ffffff', '#ffffff', '#cfe0ff', '#ffe6f0', '#fff3d6'];
        for (let i = 0; i < n; i++) {
            const y = Math.pow(Math.random(), 1.4) * H * 0.62;
            const bright = Math.random() > 0.96;
            stars.push({
                x: Math.random() * W,
                y,
                size: bright ? rand(1.1, 1.9) : rand(0.4, 1.3),
                bright,
                phase: rand(0, Math.PI * 2),
                speed: rand(0.01, 0.04),
                fade: 1 - y / (H * 0.66),
                color: pick(colors)
            });
        }
        // Sao lớn vẽ sau cùng để nổi lên trên
        stars.sort((a, b) => a.bright - b.bright);
    }

    function createShootingStar() {
        const dir = Math.random() > 0.5 ? 1 : -1;
        const angle = rand(Math.PI / 7, Math.PI / 4);
        return {
            x: rand(W * 0.1, W * 0.9),
            y: rand(0, H * 0.25),
            vx: Math.cos(angle) * dir,
            vy: Math.sin(angle),
            speed: rand(9, 16),
            len: rand(90, 200),
            life: 1
        };
    }

    function initClouds() {
        clouds = [];
        const n = isMobile ? 6 : 10;
        for (let i = 0; i < n; i++) clouds.push(makeCloud(Math.random() * W));
    }

    function makeCloud(x) {
        const c = {
            seed: Math.floor(Math.random() * 1e9),
            x,
            y: (0.08 + Math.random() * 0.42) * H,
            s0: (40 + Math.random() * 50) * (isMobile ? 0.7 : 1),
            speed: 0.06 + Math.random() * 0.16,
            alpha: 0.6 + Math.random() * 0.4,
            depth: 0.1 + Math.random() * 0.25
        };
        buildCloud(c);
        return c;
    }

    // Hạt mây mềm (trắng, tâm đặc, rìa tan dần) dùng để đắp mây; tô màu theo từng tông
    const blobCache = {};
    function softBlob(color) {
        const key = color.join(',');
        if (blobCache[key]) return blobCache[key];
        const sz = 64;
        const c = makeCanvas(sz, sz);
        const g = c.getContext('2d');
        const rg = g.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
        rg.addColorStop(0, rgba(color, 1));
        rg.addColorStop(0.35, rgba(color, 0.8));
        rg.addColorStop(0.7, rgba(color, 0.25));
        rg.addColorStop(1, rgba(color, 0));
        g.fillStyle = rg;
        g.fillRect(0, 0, sz, sz);
        return (blobCache[key] = c);
    }

    // Mây gồm hai lớp trộn theo bảng màu: dải mây mờ (đêm, hoàng hôn) và mây tích
    // trắng bồng bềnh (ban ngày). Toàn bộ số ngẫu nhiên được lấy trước theo seed
    // nên khi đổi màu hình dáng mây giữ nguyên.
    function buildCloud(c) {
        seeded(c.seed, () => {
            const s = c.s0 * pal.cloudSize;
            const w = s * rand(4, 7), h = s * 3.2;
            const base = h * 0.72;

            const wisps = [];
            const nw = Math.floor(rand(10, 16));
            for (let i = 0; i < nw; i++) {
                const px = rand(s * 1.1, w - s * 1.1);
                wisps.push([px, h * 0.62 + gauss() * s * 0.12, rand(s * 0.35, s * 0.6) * (1 - Math.abs(px / w - 0.5))]);
            }

            // Mây tích: vài khối lớn, mỗi khối đắp từ nhiều hạt nhỏ cho bề mặt sần như súp lơ
            const grains = [];
            const nb = Math.floor(rand(5, 9));
            for (let i = 0; i < nb; i++) {
                const t = (i + rand(0.2, 0.8)) / nb;
                const px = s * 0.9 + t * (w - 1.8 * s);
                const R = s * (0.4 + 0.6 * Math.sin(Math.PI * t)) * rand(0.8, 1.15);
                const py = base - R * rand(0.45, 0.75);
                const n = Math.round(14 + (R / s) * 22);
                for (let j = 0; j < n; j++) {
                    const a = rand(-Math.PI, Math.PI);
                    const d = Math.sqrt(rng()) * R * 0.7;
                    const gx = px + Math.cos(a) * d;
                    const gy = Math.min(base, py + Math.sin(a) * d * 0.85);
                    grains.push([gx, gy, R * rand(0.28, 0.5), rand(0.55, 0.95)]);
                }
            }
            // Thân mây phẳng ở đáy
            const nf = Math.round(w / (s * 0.35));
            for (let i = 0; i < nf; i++) {
                grains.push([rand(s * 1.1, w - s * 1.1), base - s * rand(0.15, 0.4), s * rand(0.3, 0.45), rand(0.5, 0.8)]);
            }

            // Bóng mây: vẽ các hạt mây bằng màu xanh xám ở độ phân giải thấp, khi vẽ sẽ ép dẹt xuống mặt đất
            const SR = 0.25;
            const sc = makeCanvas(w * SR, h * SR);
            const sg = sc.getContext('2d');
            sg.scale(SR, SR);
            sg.filter = `blur(${Math.max(3, Math.round(s * SR * 0.25))}px)`;
            const sb = softBlob([105, 130, 150]);
            for (const [x, y, r, a] of grains) {
                sg.globalAlpha = a * 0.35;
                sg.drawImage(sb, x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
            }
            c.shadow = sc;

            const cv = makeCanvas(w * DPR, h * DPR);
            const g = cv.getContext('2d');
            g.scale(DPR, DPR);
            const f = pal.fluffy;
            const warm = Math.min(1, c.y / (H * 0.55));
            const top = mix(pal.cloudHigh, pal.cloudLow, warm);
            const under = mix(top, pal.cloudShade, 0.6);
            const ca = pal.cloudA;

            if (f < 0.99) {
                g.filter = `blur(${Math.round(s * 0.18)}px)`;
                for (const [px, py, r] of wisps) {
                    const rg = g.createRadialGradient(px, py + r * 0.3, 0, px, py, r * 1.6);
                    rg.addColorStop(0, rgba(top, 0.22 * ca * (1 - f)));
                    rg.addColorStop(0.6, rgba(under, 0.08 * ca * (1 - f)));
                    rg.addColorStop(1, rgba(under, 0));
                    g.fillStyle = rg;
                    g.beginPath();
                    g.ellipse(px, py, r * 2.4, r, 0, 0, Math.PI * 2);
                    g.fill();
                }
                g.filter = 'none';
            }

            if (f > 0.01) {
                const layer = makeCanvas(w * DPR, h * DPR);
                const k = layer.getContext('2d');
                k.scale(DPR, DPR);

                // 1. Mật độ mây
                const white = softBlob([255, 255, 255]);
                for (const [x, y, r, a] of grains) {
                    k.globalAlpha = a;
                    k.drawImage(white, x - r, y - r, r * 2, r * 2);
                }

                // 2. Tô màu: đỉnh sáng, đáy ngả xanh xám
                k.globalAlpha = 1;
                k.globalCompositeOperation = 'source-in';
                const grad = k.createLinearGradient(0, base - s * 1.8, 0, base + s * 0.1);
                grad.addColorStop(0, rgba(top, 1));
                grad.addColorStop(0.5, rgba(mix(top, under, 0.25), 1));
                grad.addColorStop(1, rgba(under, 1));
                k.fillStyle = grad;
                k.fillRect(0, 0, w, h);

                // 3. Đổ bóng phía khuất nắng và hắt sáng phía mặt trời cho từng hạt
                const lx = pal.bx < 0.5 ? -0.6 : 0.6;
                const ly = pal.by < 0.4 ? -0.8 : -0.35;
                k.globalCompositeOperation = 'source-atop';
                const shade = softBlob(mix(under, [70, 80, 110], 0.25).map(Math.round));
                for (const [x, y, r] of grains) {
                    k.globalAlpha = 0.16;
                    k.drawImage(shade, x - lx * r * 0.45 - r * 0.8, y - ly * r * 0.45 - r * 0.8, r * 1.6, r * 1.6);
                }
                const hi = softBlob(mix(top, [255, 255, 255], 0.7).map(Math.round));
                for (const [x, y, r] of grains) {
                    k.globalAlpha = 0.22;
                    k.drawImage(hi, x + lx * r * 0.35 - r * 0.55, y + ly * r * 0.35 - r * 0.55, r * 1.1, r * 1.1);
                }

                // 4. Làm phẳng và tan nhẹ phần đáy
                k.globalAlpha = 1;
                k.globalCompositeOperation = 'destination-out';
                const cut = k.createLinearGradient(0, base - s * 0.1, 0, base + s * 0.35);
                cut.addColorStop(0, 'rgba(0,0,0,0)');
                cut.addColorStop(1, 'rgba(0,0,0,1)');
                k.fillStyle = cut;
                k.fillRect(0, base - s * 0.1, w, h);

                g.globalAlpha = Math.pow(f, 1.5) * 0.95 * Math.min(1, ca);
                g.drawImage(layer, 0, 0, w, h);
                g.globalAlpha = 1;
            }

            c.canvas = cv;
            c.w = w;
            c.h = h;
        });
    }

    // Cỏ chia nhóm theo độ sâu để hoa được vẽ xen đúng lớp.
    // - Lớp xa gần như không đung đưa: vẽ sẵn một lần vào grassBack.
    // - Lớp gần: gom thành các bụi cỏ (mỗi bụi 5–8 lá) vẽ sẵn thành ảnh; mỗi khung hình
    //   chỉ in ảnh bụi cỏ đã uốn sẵn theo độ nghiêng gần nhất, nhanh hơn nhiều so với tô từng lá.
    const NB = 8, STATIC_BUCKETS = 2, TUFT_VARIANTS = 4;
    // Mỗi bụi cỏ được vẽ sẵn ở nhiều độ nghiêng; khi vẽ chỉ chọn khung gần nhất rồi in thẳng
    const LEAN_FRAMES = 13, LEAN_MAX = 0.75;
    let grassBack = null, grassTop = 0;

    function initGrass() {
        grassBuckets = [];
        for (let i = 0; i < NB; i++) {
            const layer = (i + 0.5) / NB;
            grassBuckets.push({
                layer, hw: (1.8 + layer * 4) * 0.5, blades: [], tufts: [], flowers: [], sprites: [],
                stem: '', alpha: 0.65 + layer * 0.35
            });
        }

        const n = Math.floor(W * (isMobile ? 1.8 : 1.2) * quality);
        const m = PARALLAX * 2;

        // Chia cánh đồng thành các vạt, mỗi vạt có một loài hoa và màu chủ đạo
        const zoneW = isMobile ? 140 : 220;
        const zones = [];
        for (let x = -m - 200; x < W + m + 200; x += zoneW) {
            const type = pickFlowerType();
            zones.push({ type, color: pick(type[1]) });
        }
        for (let i = 0; i < n; i++) {
            const layer = Math.random();
            const bi = Math.min(NB - 1, Math.floor(layer * NB));
            const b = grassBuckets[bi];
            const x = rand(-m, W + m);
            if (bi < STATIC_BUCKETS) {
                b.blades.push({
                    x, layer,
                    h: H * 0.02 + layer * H * 0.09 + Math.random() * H * 0.025,
                    segs: 3 + Math.floor(layer * 2),
                    hj: rand(-12, 12), lj: rand(-1, 1.5), lean: rand(-0.05, 0.05), color: ''
                });
                continue;
            }
            if (Math.random() < 0.32) {
                b.tufts.push({ x, v: Math.floor(Math.random() * TUFT_VARIANTS), stiffness: rand(0.6, 1), sway: rand(0, Math.PI * 2) });
            }
            if (Math.random() < 0.5) {
                // 60% hoa theo loài chủ đạo của vạt đất đó để tạo thành từng vạt hoa
                const zone = zones[Math.floor((x + m + Math.sin(x * 0.004) * 90) / zoneW)] || zones[0];
                const inZone = Math.random() < 0.6;
                const [type, colors] = inZone ? zone.type : pickFlowerType();
                const color = inZone && Math.random() < 0.7 ? zone.color : pick(colors);
                const size = (layer * 2.6 + rand(2, 5)) * 1.2 * (type === 'lavender' ? 1.2 : type === 'poppy' ? 1.1 : 1);
                b.flowers.push({
                    x, layer, type, color, size,
                    h: H * 0.035 + layer * H * 0.11 + Math.random() * H * 0.03,
                    stiffness: rand(0.6, 1),
                    sway: rand(0, Math.PI * 2),
                    sprite: null,
                    tx: 0, ty: 0
                });
            }
        }

        recolorGrass();
    }

    // Tô lại màu cỏ theo bảng màu hiện tại: vẽ sẵn lớp cỏ xa và các bụi cỏ
    function recolorGrass() {
        const [hue, sat, light, range] = pal.grass;
        const shade = (layer, hj, lj) => `hsl(${hue + hj}, ${sat + layer * 18}%, ${Math.max(0.5, light + layer * range + lj)}%)`;

        // Lớp cỏ xa, chỉ giữ dải sát đáy màn hình (cỏ xa không cao quá ~7% màn hình)
        const m = PARALLAX * 2;
        grassTop = Math.floor(H * 0.91);
        grassBack = makeCanvas((W + m * 2) * DPR, (H - grassTop) * DPR);
        const g = grassBack.getContext('2d');
        g.scale(DPR, DPR);
        g.translate(m, -grassTop);
        for (let i = 0; i < STATIC_BUCKETS; i++) {
            const b = grassBuckets[i];
            for (const blade of b.blades) {
                blade.color = shade(blade.layer, blade.hj, blade.lj);
                g.fillStyle = blade.color;
                bladePath(g, blade, blade.lean, b.hw);
                g.fill();
            }
        }

        // Hoa ở gần cũng chịu ánh sáng của khung giờ: ban đêm ngả về màu trăng xanh trầm và
        // gần như không phát sáng, để cả cánh đồng có cùng một nguồn sáng.
        const L = pal.light;
        const dim = Math.round(0.85 * Math.pow(1 - L, 0.9) * 20) / 20;
        const glowK = Math.round((0.2 + 0.8 * L) * 4) / 4;
        // Màu đêm làm tròn theo nấc để không tạo quá nhiều ảnh hoa khác nhau khi màu đổi dần theo giờ
        const nightTone = toHex(mix(pal.hills[2][0], pal.sky[3], 0.45).map(v => Math.round(v / 8) * 8));
        const tint = dim > 0 ? [nightTone, dim] : null;
        for (let i = STATIC_BUCKETS; i < NB; i++) {
            for (const f of grassBuckets[i].flowers) f.sprite = flowerSprite(f.type, f.color, f.size, glowK, tint);
        }

        for (let i = STATIC_BUCKETS; i < NB; i++) {
            const b = grassBuckets[i];
            b.stem = shade(b.layer, 0, 0.5);
            b.sprites = [];
            for (let v = 0; v < TUFT_VARIANTS; v++) {
                b.sprites.push(seeded(seeds.grass + i * 97 + v, () => buildTuft(b, shade)));
            }
        }
    }

    // Một bụi cỏ: vài lá thon mọc sát nhau, gốc chung ở đáy ảnh. Vẽ sẵn LEAN_FRAMES khung,
    // mỗi khung uốn cong theo một độ nghiêng; ảnh cắt sát các lá để không in phần trong suốt thừa.
    function buildTuft(b, shade) {
        const nb = Math.floor(rand(5, 9));
        const spread = 3 + b.layer * 7;
        const hw0 = b.hw;
        const blades = [];
        for (let j = 0; j < nb; j++) {
            const layer = Math.min(1, Math.max(0, b.layer + rand(-0.06, 0.06)));
            blades.push({
                dx: gauss() * spread,
                h: (H * 0.02 + layer * H * 0.09 + rng() * H * 0.025) * rand(0.55, 1),
                lean: rand(-0.16, 0.16),
                color: shade(layer, rand(-12, 12), rand(-1, 1.5))
            });
        }
        blades.sort((a, c) => c.h - a.h);

        const frames = [];
        for (let f = 0; f < LEAN_FRAMES; f++) {
            const bend = -LEAN_MAX + (2 * LEAN_MAX * f) / (LEAN_FRAMES - 1);
            let minX = Infinity, maxX = -Infinity, minY = 0;
            const shapes = blades.map(bl => {
                const n = 4, sl = bl.h / n;
                let cx = bl.dx, cy = 0;
                const left = [[cx - hw0, 0]], right = [];
                for (let k = 1; k <= n; k++) {
                    // Gốc cứng, ngọn mềm: càng lên cao lá càng cong theo gió
                    const a = bl.lean * Math.pow(k / n, 1.4) + bend * Math.pow(k / n, 1.2);
                    const sin = Math.sin(a), cos = Math.cos(a);
                    cx += sin * sl;
                    cy -= cos * sl;
                    const hw = hw0 * (1 - k / n);
                    left.push([cx - cos * hw, cy - sin * hw]);
                    right.push([cx + cos * hw, cy + sin * hw]);
                }
                const pts = left.concat(right.slice(0, -1).reverse(), [[bl.dx + hw0, 0]]);
                for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); }
                return { pts, color: bl.color };
            });
            const pad = 1;
            const w = Math.ceil(maxX - minX + pad * 2), hgt = Math.ceil(-minY + pad);
            const c = makeCanvas(w * DPR, hgt * DPR);
            const g = c.getContext('2d');
            g.scale(DPR, DPR);
            g.translate(-minX + pad, hgt);
            for (const sh of shapes) {
                g.beginPath();
                sh.pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
                g.closePath();
                g.fillStyle = sh.color;
                g.fill();
            }
            frames.push({ canvas: c, ox: (-minX + pad) * DPR, oy: hgt * DPR });
        }
        return frames;
    }

    // Lá cỏ là hình thon nhọn uốn theo gió; trả về ngọn lá qua blade.tx / blade.ty
    function bladePath(c, g, w, hw0) {
        let cx = g.x, cy = H + 10;
        const n = g.segs;
        const sl = g.h / n;
        const rx = grassPts;
        c.beginPath();
        c.moveTo(cx - hw0, cy);
        for (let j = 1; j <= n; j++) {
            const a = w * (j / n);
            const sin = Math.sin(a), cos = Math.cos(a);
            cx += sin * sl;
            cy -= cos * sl;
            const hw = hw0 * (1 - j / n);
            rx[j * 2] = cx + cos * hw;
            rx[j * 2 + 1] = cy + sin * hw;
            c.lineTo(cx - cos * hw, cy - sin * hw);
        }
        for (let j = n - 1; j >= 1; j--) c.lineTo(rx[j * 2], rx[j * 2 + 1]);
        c.lineTo(g.x + hw0, H + 10);
        c.closePath();
        g.tx = cx;
        g.ty = cy;
    }

    function initFireflies() {
        fireflies = [];
        const n = Math.round((isMobile ? 22 : 36) * Math.max(0.6, quality));
        for (let i = 0; i < n; i++) {
            fireflies.push({
                x: Math.random() * W,
                y: H - Math.random() * H * 0.35,
                size: rand(1, 2.4),
                seed: rand(0, 1000),
                blink: rand(0.02, 0.06),
                rank: Math.random(),
                color: pick(['#d9ff7a', '#b6ff5c', '#fff3a0'])
            });
        }
    }

    function newPetal(anywhere) {
        return {
            x: anywhere ? rand(0, W) : W + rand(10, 60),
            y: anywhere ? rand(0, H) : rand(-H * 0.2, H * 0.7),
            size: rand(6, 11) * (isMobile ? 0.85 : 1),
            vx: -rand(0.5, 1.3),
            vy: rand(0.15, 0.5),
            rot: rand(0, Math.PI * 2),
            spin: rand(-0.03, 0.03),
            flip: rand(0, Math.PI * 2),
            flipSpeed: rand(0.02, 0.06),
            sprite: petalSprite(pick(PETAL_COLORS)),
            alpha: rand(0.55, 0.9)
        };
    }

    function initPetals() {
        petals = [];
        const n = Math.round((isMobile ? 12 : 22) * quality);
        for (let i = 0; i < n; i++) petals.push(newPetal(true));
    }

    // ---------- Vẽ ----------

    // Vẽ lớp cũ bên dưới rồi lớp mới mờ dần lên trên khi vừa đổi màu theo giờ
    function crossfade(cur, prev, draw) {
        if (prev && fade < 1) {
            ctx.globalAlpha = 1;
            draw(prev);
            ctx.globalAlpha = fade;
        }
        draw(cur);
        ctx.globalAlpha = 1;
    }

    function drawSky() {
        const m = PARALLAX;
        crossfade(skyLayer, prevLayers && prevLayers.sky, c =>
            ctx.drawImage(c, -m - pointer.x * 0.15, -m - pointer.y * 0.15, W + m * 2, H + m * 2));
    }

    function drawStars() {
        const ox = -pointer.x * 0.2, oy = -pointer.y * 0.2;
        for (const s of stars) {
            const tw = 0.55 + 0.45 * Math.sin(time * s.speed + s.phase);
            const a = Math.min(1, tw * s.fade * pal.stars);
            if (a < 0.02) continue;
            const x = s.x + ox, y = s.y + oy;
            ctx.fillStyle = s.color;
            if (s.bright) {
                drawGlow(s.color, x, y, s.size * 10, a * 0.6);
                // Tia sáng chữ thập cho sao lớn
                ctx.globalAlpha = a * 0.35;
                ctx.fillRect(x - s.size * 4, y - 0.4, s.size * 8, 0.8);
                ctx.fillRect(x - 0.4, y - s.size * 4, 0.8, s.size * 8);
            }
            // Sao nhỏ dùng fillRect, rẻ hơn nhiều so với arc
            ctx.globalAlpha = a;
            const d = s.size;
            ctx.fillRect(x - d / 2, y - d / 2, d, d);
        }
        ctx.globalAlpha = 1;
    }

    function drawShootingStars() {
        if (Math.random() < 0.004 * step * Math.min(1, pal.stars) && shootingStars.length < 3) shootingStars.push(createShootingStar());

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = shootingStars.length - 1; i >= 0; i--) {
            const s = shootingStars[i];
            s.x += s.vx * s.speed * step;
            s.y += s.vy * s.speed * step;
            s.life -= 0.012 * step;
            if (s.life <= 0 || s.y > H * 0.7) { shootingStars.splice(i, 1); continue; }

            const tx = s.x - s.vx * s.len, ty = s.y - s.vy * s.len;
            const grad = ctx.createLinearGradient(s.x, s.y, tx, ty);
            grad.addColorStop(0, `rgba(255, 255, 255, ${s.life})`);
            grad.addColorStop(0.3, `rgba(255, 210, 230, ${s.life * 0.4})`);
            grad.addColorStop(1, 'rgba(255, 200, 230, 0)');
            ctx.globalAlpha = 1;
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            drawGlow('#ffffff', s.x, s.y, 18, s.life);

            // Bụi sao rơi lại phía sau
            if (Math.random() < 0.5 * step) {
                addParticle({
                    x: s.x, y: s.y, color: pick(SPARK_COLORS), size: rand(0.6, 1.4),
                    vx: rand(-0.3, 0.3), vy: rand(-0.1, 0.4), life: s.life * 0.8, decay: 0.03, burst: true
                });
            }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawSun() {
        const { x: sx, y: sy, r } = sunPos();
        const x = sx - pointer.x * 0.3, y = sy - pointer.y * 0.3;
        const pulse = 1 + Math.sin(time * 0.01) * 0.04;

        ctx.globalCompositeOperation = 'lighter';

        // Tia nắng xoay rất chậm
        if (pal.rays > 0.01) {
            const rs = r * 7 * pulse;
            ctx.globalAlpha = (0.14 + Math.sin(time * 0.013) * 0.04) * pal.rays;
            setTransform(x, y, time * 0.0008, 1, 1);
            ctx.drawImage(raysSprite, -rs, -rs, rs * 2, rs * 2);
            resetTransform();
        }

        ctx.globalAlpha = 1;
        const hw = r * 26, hh = r * 8;
        ctx.drawImage(sunSprites.horizon, x - hw / 2, y - hh / 2, hw, hh);
        const hs = r * 6 * pulse;
        ctx.drawImage(sunSprites.halo, x - hs / 2, y - hs / 2, hs, hs);

        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(sunSprites.core, x - r, y - r, r * 2, r * 2);

        // Lóa ống kính: các quầng màu nhạt nằm trên đường từ mặt trời qua tâm màn hình
        if (pal.flare > 0.02) {
            const dx = W / 2 - x, dy = H / 2 - y;
            ctx.globalCompositeOperation = 'lighter';
            for (const [k, size, color, a] of FLARES) {
                drawGlow(color, x + dx * k, y + dy * k, r * size, a * pal.flare * (0.85 + 0.15 * Math.sin(time * 0.02 + k * 5)));
            }
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }
    }

    const FLARES = [
        [0.3, 1.2, '#fff3c4', 0.22], [0.55, 0.6, '#c8e6ff', 0.3], [0.8, 2.2, '#d6ffd8', 0.1],
        [1.15, 0.9, '#ffd6f0', 0.18], [1.45, 1.6, '#cfe0ff', 0.12], [1.7, 0.45, '#ffffff', 0.25]
    ];

    function drawClouds() {
        for (const c of clouds) {
            c.x -= c.speed * step;
            if (c.x < -c.w - PARALLAX) Object.assign(c, makeCloud(W + PARALLAX));
            ctx.globalAlpha = c.alpha;
            ctx.drawImage(c.canvas, c.x - pointer.x * c.depth, c.y - c.h / 2 - pointer.y * c.depth, c.w, c.h);
        }
        ctx.globalAlpha = 1;
    }

    // Bóng mây trôi trên đồi và cánh đồng (ban ngày). Mây càng cao trên trời thì bóng
    // càng nằm xa, gần chân đồi; mây thấp thì bóng ở gần và to hơn.
    function drawCloudShadows() {
        const st = pal.fluffy * pal.light;
        if (st < 0.05) return;
        const off = (0.5 - pal.bx) * W * 0.35;
        ctx.globalCompositeOperation = 'multiply';
        for (const c of clouds) {
            if (!c.shadow) continue;
            const t = Math.min(1, Math.max(0, (c.y / H - 0.08) / 0.42));
            const k = 0.55 + 0.6 * t;
            const sw = c.w * k, sh = c.h * k * (0.3 + 0.2 * t);
            const gy = H * (0.68 + 0.24 * t);
            const x = c.x + off + (c.w - sw) / 2 - pointer.x * (0.5 + 0.6 * t);
            ctx.globalAlpha = 0.5 * st * c.alpha;
            ctx.drawImage(c.shadow, x, gy - sh / 2, sw, sh);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawHills() {
        hillLayers.forEach((l, i) => {
            const prev = prevLayers && prevLayers.hills[i];
            const y = l.top - pointer.y * l.depth * 0.5;
            const x = -l.margin - pointer.x * l.depth;
            crossfade(l.canvas, prev && prev.canvas, c => ctx.drawImage(c, x, y, W + l.margin * 2, l.h));
            if (l.tex) crossfade(l.tex, prev && prev.tex, c => drawSwaying(c, l, x, y));
        });
    }

    // In lớp cỏ hoa trên sườn đồi theo từng dải ngang, mỗi dải lệch một chút theo gió;
    // dải càng gần (càng thấp) lệch càng nhiều, tạo cảm giác cả triền đồi rạp theo gió.
    function drawSwaying(c, l, x, y) {
        const slice = l.depth > 0.7 ? 6 : l.depth > 0.5 ? 7 : 9;
        const sw = W + l.margin * 2;
        const amp = 1.5 + l.depth * 3.5;
        const br = breezeAt(W / 2);
        for (let sy = 0; sy < l.h; sy += slice) {
            const rowY = y + sy;
            if (rowY > H) break;
            const persp = 0.35 + 0.65 * Math.min(1, Math.max(0, (rowY - H * 0.55) / (H * 0.45)));
            const off = amp * persp * (windBase * 1.6 + Math.sin(rowY * 0.05 - time * 0.07) * 0.45 + br * 2.5);
            const hgt = Math.min(slice, l.h - sy);
            ctx.drawImage(c, 0, sy * DPR, c.width, hgt * DPR, x + off, rowY, sw, hgt);
        }
    }

    // Vệt sáng lướt trên đồng cỏ như khi gió rạp ngọn cỏ xuống
    const sheens = [];
    function drawWindSheen() {
        if (!sheens.length) {
            for (let i = 0; i < 6; i++) sheens.push({ x: Math.random() * W, y: rand(0.7, 0.95), s: rand(0.7, 1.3), seed: rand(0, 10) });
        }
        const dir = windBase + breezeAt(W / 2) >= 0 ? 1 : -1;
        const strength = (0.35 + 0.65 * pal.light) * (0.6 + Math.abs(windBase) * 2 + Math.abs(breezeAt(W / 2)) * 3);
        const blob = softBlob(pal.light > 0.5 ? [255, 255, 235] : [190, 200, 255]);
        ctx.globalCompositeOperation = 'lighter';
        for (const sh of sheens) {
            sh.x += dir * (1.2 + sh.s) * step;
            const w = W * 0.35 * sh.s, h = H * 0.035 * sh.s;
            if (sh.x > W + w) sh.x = -w;
            if (sh.x < -w) sh.x = W + w;
            ctx.globalAlpha = Math.min(0.12, 0.05 * strength * (0.6 + 0.4 * Math.sin(time * 0.01 + sh.seed)));
            ctx.drawImage(blob, sh.x - w / 2, sh.y * H - h / 2, w, h);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    // Gió tại một điểm của cánh đồng: gió nền, sóng gió lướt ngang qua đồng,
    // dao động riêng từng bụi, cơn gió từ chỗ chạm và cơn gió thoảng.
    let windBase = 0;
    function windAt(x, sway, sx) {
        let w = windBase
            + Math.sin(time * 0.02 + x * 0.01 + sway) * 0.1
            + Math.sin(x * 0.0055 - time * 0.035) * 0.16
            + Math.sin(x * 0.013 - time * 0.06 + 1.3) * 0.05;
        if (gust.s > 0.01) {
            const dx = x - gust.x;
            w += gust.s * Math.sign(dx) * Math.exp(-(dx * dx) / 40000) * Math.cos(time * 0.15 + sway);
        }
        return w + breezeAt(sx) * (1 + 0.3 * Math.sin(time * 0.2 + sway));
    }

    function drawGrass() {
        windBase = Math.sin(time * 0.012) * 0.2 + Math.sin(time * 0.031) * 0.06;
        const ox = -pointer.x * 1.1;
        gust.s *= Math.pow(0.95, step);

        const m = PARALLAX * 2;
        crossfade(grassBack, prevLayers && prevLayers.grass, c =>
            ctx.drawImage(c, ox - m, grassTop, W + m * 2, H - grassTop));

        const baseY = H + 10;
        for (let i = STATIC_BUCKETS; i < NB; i++) {
            const b = grassBuckets[i];

            // Bụi cỏ: chọn khung uốn sẵn gần với độ nghiêng hiện tại, in thẳng theo điểm ảnh thiết bị
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const half = (LEAN_FRAMES - 1) / 2;
            const by = DPR * baseY;
            for (const t of b.tufts) {
                const x = t.x + ox;
                if (x < -80 || x > W + 80) continue;
                const lean = windAt(t.x, t.sway, x) * t.stiffness * b.layer;
                const fi = Math.round(half + Math.max(-1, Math.min(1, lean / LEAN_MAX)) * half);
                const sp = b.sprites[t.v][fi];
                ctx.drawImage(sp.canvas, Math.round(DPR * x - sp.ox), Math.round(by - sp.oy));
            }
            resetTransform();

            // Cuống hoa: đoạn thẳng nghiêng theo gió, gom thành một nét vẽ cho cả lớp.
            // Chỉ vẽ nửa trên vì nửa dưới đã chìm trong cỏ.
            ctx.beginPath();
            for (const f of b.flowers) {
                const x = f.x + ox;
                if (x < -60 || x > W + 60) { f.tx = -999; continue; }
                const lean = windAt(f.x, f.sway, x) * f.stiffness * b.layer;
                f.tx = x + Math.sin(lean) * f.h;
                f.ty = baseY - Math.cos(lean) * f.h;
                ctx.moveTo(x + (f.tx - x) * 0.45, baseY + (f.ty - baseY) * 0.45);
                ctx.lineTo(f.tx, f.ty);
            }
            ctx.strokeStyle = b.stem;
            ctx.lineWidth = 0.7 + b.layer * 1.3;
            ctx.stroke();

            // Bông hoa ở ngọn cuống, in thẳng (không xoay) cho nhanh
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = b.alpha;
            for (const f of b.flowers) {
                if (f.tx === -999) continue;
                ctx.drawImage(f.sprite.canvas, Math.round(DPR * f.tx - f.sprite.ox), Math.round(DPR * f.ty - f.sprite.oy));

                // Phấn hoa bay lên
                if (Math.random() < 0.0015 * step) {
                    addParticle({
                        x: f.tx, y: f.ty - f.size, color: f.color, size: rand(1, 2.4),
                        vx: rand(-0.25, 0.25), vy: rand(-1.4, -0.4), life: 1, decay: 0.005, burst: false
                    });
                }
            }
            resetTransform();
            ctx.globalAlpha = 1;
        }
    }

    function drawPetals() {
        for (const p of petals) {
            const pb = breezeAt(p.x);
            p.x += (p.vx - Math.sin(time * 0.01) * 0.3 + pb * 6) * step;
            p.spin += pb * 0.002 * step;
            p.y += (p.vy + Math.sin(time * 0.03 + p.flip) * 0.25) * step;
            p.rot += p.spin * step;
            p.flip += p.flipSpeed * step;
            if (p.x < -40 || p.y > H + 40) Object.assign(p, newPetal(false));

            const x = p.x - pointer.x * 1.3;
            const k = p.size / 14;
            ctx.globalAlpha = p.alpha * (0.35 + 0.65 * pal.light);
            // Lật cánh hoa bằng cách co trục y theo cos để trông như đang xoay trong gió
            setTransform(x, p.y, p.rot, k, k * (0.25 + 0.75 * Math.abs(Math.cos(p.flip))));
            ctx.drawImage(p.sprite, -16, -11, 32, 22);
        }
        resetTransform();
        ctx.globalAlpha = 1;
    }

    function addParticle(p) {
        if (particles.length < MAX_PARTICLES) particles.push(p);
    }

    function drawParticles() {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            if (p.burst) {
                p.x += p.vx * step;
                p.y += p.vy * step;
                const f = Math.pow(0.93, step);
                p.vx *= f;
                p.vy = p.vy * f + 0.05 * step;
            } else {
                p.x += (p.vx + Math.sin(time * 0.04 + p.y * 0.05) * 0.4) * step;
                p.y += p.vy * step;
            }
            p.life -= p.decay * step;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            drawGlow(p.color, p.x, p.y, p.size * 8, Math.min(1, p.life) * 0.8);
        }

        // Vòng sóng sáng lan ra từ chỗ chạm
        ctx.lineWidth = 1.5;
        for (let i = rings.length - 1; i >= 0; i--) {
            const r = rings[i];
            r.r += (r.max - r.r) * 0.06 * step;
            r.life -= 0.022 * step;
            if (r.life <= 0) { rings.splice(i, 1); continue; }
            ctx.globalAlpha = r.life * 0.6;
            ctx.strokeStyle = r.color;
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawFireflies() {
        ctx.globalCompositeOperation = 'lighter';
        for (const f of fireflies) {
            const t = time * 0.01 + f.seed;
            f.x += (Math.sin(t * 1.3) * 0.6 + Math.cos(t * 0.7) * 0.4 + breezeAt(f.x) * 3) * step;
            f.y += (Math.cos(t * 1.1) * 0.4 + Math.sin(t * 0.5) * 0.2) * step;
            if (f.x < -10) f.x = W + 10;
            if (f.x > W + 10) f.x = -10;
            if (f.y < H * 0.6) f.y += step;
            if (f.y > H) f.y -= step;

            if (f.rank > pal.fireflies) continue;
            const a = Math.max(0, Math.sin(time * f.blink + f.seed)) ** 2;
            if (a < 0.02) continue;
            const x = f.x - pointer.x * 0.9;
            drawGlow(f.color, x, f.y, f.size * 14, a * 0.8);
            drawGlow('#fffbe0', x, f.y, f.size * 3, a);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    // ---------- Cơn gió thoảng: dải đốm sáng bay lượn ngang màn hình ----------

    const breeze = { active: false, next: 240, x: 0, dir: 1, speed: 0, fade: 0, curve: null };

    function startBreeze() {
        breeze.active = true;
        breeze.dir = Math.random() > 0.5 ? 1 : -1;
        breeze.speed = Math.max(3, W / rand(260, 340));
        breeze.x = breeze.dir > 0 ? -120 : W + 120;
        breeze.fade = 1;
        // Mỗi cơn gió đi theo một đường lượn sóng riêng
        breeze.curve = {
            y: rand(0.42, 0.8) * H,
            amp: rand(0.04, 0.1) * H,
            freq: (rand(1.2, 2.6) * Math.PI) / W,
            phase: rand(0, Math.PI * 2),
            spread: rand(0.04, 0.07) * H
        };
    }

    const curveY = (c, x) => c.y + Math.sin(x * c.freq + c.phase) * c.amp;

    // Độ nghiêng do gió tại toạ độ x: mạnh nhất ở đầu cơn gió, nhạt dần phía sau
    function breezeAt(x) {
        if (!breeze.active) return 0;
        const d = (x - breeze.x) * breeze.dir;
        const k = d > 0 ? Math.exp(-(d * d) / 40000) : Math.exp(d / 600);
        return breeze.dir * k * 0.42 * breeze.fade;
    }

    function updateBreeze() {
        if (!breeze.active) {
            breeze.next -= step;
            if (breeze.next <= 0) startBreeze();
            return;
        }
        breeze.x += breeze.dir * breeze.speed * step;
        const inside = breeze.x > -100 && breeze.x < W + 100;

        if (inside && wisps.length < 70 && Math.random() < 0.4 * step * quality) {
            const c = breeze.curve;
            wisps.push({
                bx: breeze.x - breeze.dir * rand(0, 220),
                dir: breeze.dir,
                speed: breeze.speed * rand(1, 1.6),
                off: gauss() * c.spread,
                curve: c,
                age: 0,
                max: rand(140, 260),
                size: rand(0.8, 2),
                loop: Math.random() < 0.3 ? rand(10, 22) : 0,
                seed: rand(0, 100),
                color: pick(['#ffffff', '#fff1c9', '#ffd6e4', '#d9e8ff', '#ffe3a8']),
                trail: []
            });
        }

        // Cơn gió đã đi qua hết màn hình: lặng dần rồi chờ cơn sau
        const past = breeze.dir > 0 ? breeze.x > W + 300 : breeze.x < -300;
        if (past) {
            breeze.fade -= 0.01 * step;
            if (breeze.fade <= 0) {
                breeze.active = false;
                breeze.next = rand(420, 900);
            }
        }
    }

    function drawWisps() {
        if (!wisps.length) return;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const ox = -pointer.x * 0.8;
        for (let i = wisps.length - 1; i >= 0; i--) {
            const w = wisps[i];
            w.age += step;
            w.bx += w.dir * w.speed * step;
            if (w.age >= w.max) { wisps.splice(i, 1); continue; }

            let x = w.bx, y = curveY(w.curve, w.bx) + w.off;
            if (w.loop) {
                // Đốm sáng xoáy một vòng nhỏ trong gió
                const a = w.age * 0.11 + w.seed;
                x += Math.cos(a) * w.loop * w.dir;
                y += Math.sin(a) * w.loop;
            } else {
                y += Math.sin(w.age * 0.06 + w.seed) * 5;
            }
            x += ox;
            w.trail.push(x, y);
            if (w.trail.length > 40) w.trail.splice(0, 2);

            const a = Math.sin((Math.PI * w.age) / w.max);
            const t = w.trail;
            if (t.length >= 6) {
                const grad = ctx.createLinearGradient(x, y, t[0], t[1]);
                grad.addColorStop(0, hexToRgba(w.color, 0.55 * a));
                grad.addColorStop(1, hexToRgba(w.color, 0));
                ctx.globalAlpha = 1;
                ctx.strokeStyle = grad;
                ctx.lineWidth = w.size * 0.9;
                ctx.beginPath();
                ctx.moveTo(t[0], t[1]);
                for (let j = 2; j < t.length; j += 2) ctx.lineTo(t[j], t[j + 1]);
                ctx.stroke();
            }
            drawGlow(w.color, x, y, w.size * 11, a * 0.85);

            if (Math.random() < 0.06 * step) {
                addParticle({
                    x, y, color: w.color, size: rand(0.5, 1.2),
                    vx: w.dir * rand(0.2, 0.8), vy: rand(-0.2, 0.3), life: 0.8, decay: 0.03, burst: true
                });
            }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    // ---------- Đàn chim và bướm (ban ngày, hoàng hôn) ----------

    function spawnFlock() {
        const dir = Math.random() > 0.5 ? 1 : -1;
        const n = 3 + Math.floor(Math.random() * 5);
        const y0 = (0.1 + Math.random() * 0.25) * H;
        const speed = (0.8 + Math.random() * 0.6) * (isMobile ? 0.8 : 1.1);
        const x0 = dir > 0 ? -40 : W + 40;
        for (let i = 0; i < n; i++) {
            const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
            birds.push({
                x: x0 - dir * row * rand(14, 22),
                y: y0 + side * row * rand(7, 12),
                dir, speed,
                size: rand(4, 7) * (isMobile ? 0.85 : 1),
                phase: rand(0, Math.PI * 2),
                flap: rand(0.18, 0.26)
            });
        }
    }

    function drawBirds() {
        if (pal.light > 0.35 && !birds.length && Math.random() < 0.0015 * step) spawnFlock();
        if (!birds.length) return;
        const fade = Math.min(1, (pal.light - 0.2) * 2);
        ctx.strokeStyle = `rgba(28, 26, 40, ${0.7 * Math.max(0.2, fade)})`;
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = birds.length - 1; i >= 0; i--) {
            const b = birds[i];
            b.x += b.dir * b.speed * step;
            b.y += Math.sin(time * 0.02 + b.phase) * 0.12 * step;
            if (b.x < -80 || b.x > W + 80) { birds.splice(i, 1); continue; }
            const f = Math.sin(time * b.flap + b.phase);
            const s = b.size, x = b.x - pointer.x * 0.4, y = b.y;
            ctx.moveTo(x - s, y - f * s * 0.7);
            ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.35 - f * s * 0.2, x, y);
            ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.35 - f * s * 0.2, x + s, y - f * s * 0.7);
        }
        ctx.stroke();
    }

    function initButterflies() {
        butterflies = [];
        const n = isMobile ? 7 : 14;
        for (let i = 0; i < n; i++) {
            butterflies.push({
                x: Math.random() * W,
                by: H * rand(0.7, 0.9),
                seed: rand(0, 100),
                drift: rand(-0.4, 0.4),
                size: rand(4, 7),
                color: pick(['#fff7d6', '#ffd36b', '#ffffff', '#ffb3c8', '#b9d7ff', '#ffa94d'])
            });
        }
    }

    function drawButterflies() {
        const a = Math.min(1, (pal.light - 0.55) / 0.3);
        if (a <= 0) return;
        for (const b of butterflies) {
            const t = time * 0.01 + b.seed;
            b.x += (Math.sin(t * 0.7) * 0.7 + b.drift + breezeAt(b.x) * 4) * step;
            if (b.x < -20) b.x = W + 20;
            if (b.x > W + 20) b.x = -20;
            const x = b.x - pointer.x * 1.2;
            const y = b.by + Math.sin(t * 1.7) * 14 + Math.sin(t * 0.45) * 22;
            // Cánh vỗ: co bề ngang của cánh theo nhịp
            const flap = 0.15 + 0.85 * Math.abs(Math.sin(time * 0.32 + b.seed));
            const s = b.size;
            ctx.globalAlpha = a * 0.95;
            ctx.fillStyle = b.color;
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.ellipse(x + side * s * 0.55 * flap, y - s * 0.25, s * 0.6 * flap, s * 0.55, side * 0.5, 0, Math.PI * 2);
                ctx.ellipse(x + side * s * 0.4 * flap, y + s * 0.35, s * 0.4 * flap, s * 0.35, -side * 0.4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = 'rgba(40, 30, 30, 0.8)';
            ctx.fillRect(x - 0.6, y - s * 0.5, 1.2, s);
        }
        ctx.globalAlpha = 1;
    }

    // ---------- Vòng lặp ----------

    function frame(now) {
        if (!running) { looping = false; return; }
        const dt = lastT ? now - lastT : 16.67;
        lastT = now;
        step = Math.min(dt / 16.67, 3);
        time += step;

        adaptQuality(dt);

        if (fade < 1) {
            fade = Math.min(1, fade + step / 150);
            if (fade >= 1) prevLayers = null;
        }
        palTimer += Math.min(dt, 1000);
        if (palTimer > PALETTE_EVERY && fixedHour === null) {
            palTimer = 0;
            applyPalette(true);
        }

        const ease = 1 - Math.pow(0.96, step);
        pointer.x += (pointer.tx - pointer.x) * ease;
        pointer.y += (pointer.ty - pointer.y) * ease;

        resetTransform();
        ctx.clearRect(0, 0, W, H);

        drawSky();
        drawStars();
        drawShootingStars();
        drawSun();
        drawClouds();
        drawBirds();
        drawHills();
        drawWindSheen();
        drawGrass();
        drawCloudShadows();
        drawButterflies();
        drawPetals();
        updateBreeze();
        drawFireflies();
        drawWisps();
        drawParticles();

        raf(frame);
    }

    // Nếu trung bình mỗi khung hình chậm hơn ~40fps: giảm độ phân giải vẽ trước,
    // sau đó mới giảm mật độ cỏ và cánh hoa
    function adaptQuality(dt) {
        if (warmup > 0) { warmup--; return; }
        frameAcc += Math.min(dt, 100);
        frameCount++;
        if (frameAcc < 2000) return;
        const avg = frameAcc / frameCount;
        frameAcc = 0;
        frameCount = 0;
        if (avg <= 25) return;
        if (DPR > 1.25) {
            dprCap = Math.max(1.25, DPR - 0.5);
            setSize(lastSize);
        } else if (quality > 0.4) {
            quality = Math.max(0.4, quality - 0.2);
            initGrass();
            initPetals();
        }
        warmup = 30;
    }

    function startLoop() {
        if (looping || !running) return;
        looping = true;
        lastT = 0;
        raf(frame);
    }

    // ---------- Tương tác ----------

    // Mở thiệp: trái tim bằng đốm sáng nở ra rồi tan, kèm mưa cánh hoa
    function celebrate(x, y) {
        const s = Math.min(W, H) * 0.012;
        for (let i = 0; i < 90; i++) {
            const t = (i / 90) * Math.PI * 2;
            const hx = 16 * Math.pow(Math.sin(t), 3);
            const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
            addParticle({
                x, y, color: pick(['#ffd6e4', '#ffb3c8', '#ffffff', '#ffe3a8']), size: rand(1.2, 2.6),
                vx: hx * s * 0.055, vy: hy * s * 0.055, life: 1.8, decay: rand(0.008, 0.012), burst: true
            });
        }
        rings.push({ x, y, r: 6, max: Math.min(W, H) * 0.25, life: 1, color: '#ffd6e4' });
        for (let i = 0; i < 28; i++) {
            const p = newPetal(true);
            p.x = rand(0, W);
            p.y = rand(-H * 0.3, -10);
            p.vy = rand(0.6, 1.4);
            petals.push(p);
        }
        if (petals.length > 70) petals.splice(0, petals.length - 70);
    }

    function burst(x, y) {
        for (let i = 0; i < 36; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = rand(1.5, 6.5);
            addParticle({
                x, y, color: pick(SPARK_COLORS), size: rand(1, 3),
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 1.4, decay: rand(0.012, 0.022), burst: true
            });
        }
        rings.push({ x, y, r: 4, max: rand(70, 110), life: 1, color: pick(['#ffd6e4', '#c9dcff', '#ffe3a8']) });

        if (y < H * 0.6) {
            // Chạm lên bầu trời: thêm sao băng
            for (let i = 0; i < 2; i++) setTimeout(() => shootingStars.push(createShootingStar()), i * 250);
        } else {
            // Chạm xuống cánh đồng: gió thổi dạt cỏ và tung cánh hoa
            gust.x = x + pointer.x * 1.1;
            gust.s = 0.9;
            for (let i = 0; i < 6; i++) {
                const p = newPetal(false);
                p.x = x;
                p.y = y;
                p.vx = rand(-2.5, 2.5);
                p.vy = rand(-2.5, -0.8);
                petals.push(p);
            }
            if (petals.length > 60) petals.splice(0, petals.length - 60);
        }
    }

    function trail(x, y) {
        addParticle({
            x: x + rand(-4, 4), y: y + rand(-4, 4), color: pick(SPARK_COLORS), size: rand(0.6, 1.6),
            vx: rand(-0.3, 0.3), vy: rand(-0.6, 0), life: 0.9, decay: rand(0.02, 0.035), burst: true
        });
    }

    function handle(m) {
        switch (m.type) {
            case 'init':
                fixedHour = typeof m.hour === 'number' ? m.hour : null;
                canvas = m.canvas;
                ctx = canvas.getContext('2d');
                setSize(m);
                startLoop();
                break;
            case 'hour':
                // Chỉnh giờ từ nút đồng hồ: số giờ cố định, hoặc null để theo giờ thật
                fixedHour = typeof m.hour === 'number' ? m.hour : null;
                palTimer = 0;
                if (ctx) applyPalette(true);
                break;
            case 'resize':
                if (ctx) setSize(m);
                break;
            case 'pointer':
                pointer.tx = m.x * PARALLAX;
                pointer.ty = m.y * PARALLAX * 0.5;
                break;
            case 'celebrate':
                celebrate(m.x, m.y);
                break;
            case 'tap':
                burst(m.x, m.y);
                break;
            case 'trail':
                trail(m.x, m.y);
                break;
            case 'visibility':
                running = m.visible;
                // Quay lại sau khi ẩn tab: cập nhật ngay màu theo giờ hiện tại
                if (running && ctx) {
                    if (fixedHour === null) applyPalette(true);
                    startLoop();
                }
                break;
        }
    }

    if (IN_WORKER) global.onmessage = e => handle(e.data);
    else global.Scene = { post: handle };
})(self);
