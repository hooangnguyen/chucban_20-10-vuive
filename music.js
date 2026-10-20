// Nhạc nền chill tự tạo bằng Web Audio: pad ấm, piano điện dạo hợp âm, bass nhẹ và tiếng vang.
// Không dùng file nhạc nên không lo bản quyền, phát vô tận và mỗi lần nghe mỗi khác.
// Sắc thái đổi theo ánh sáng của cảnh: ban ngày sáng và nhiều nốt hơn, ban đêm trầm và thưa hơn.
const ChillMusic = (() => {
    const BPM = 66;
    const EIGHTH = 60 / BPM / 2;
    const STEPS_PER_CHORD = 16;

    // Vòng hợp âm (MIDI): Fmaj9 – Em7 – Dm9 – Cmaj7, kiểu lo-fi thư giãn
    const CHORDS = [
        { bass: 41, pad: [53, 57, 60, 64], tones: [65, 69, 72, 76, 79] },
        { bass: 40, pad: [52, 55, 59, 62], tones: [64, 67, 71, 74, 76] },
        { bass: 38, pad: [50, 53, 57, 60, 64], tones: [62, 65, 69, 72, 76] },
        { bass: 36, pad: [48, 52, 55, 59, 62], tones: [64, 67, 71, 72, 74, 79] }
    ];

    let ctx = null, master, dry, wet, filter;
    let playing = false, timer = null, nextTime = 0, step = 0;
    let light = 1;

    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const rand = (a, b) => a + Math.random() * (b - a);

    function setup() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();

        master = ctx.createGain();
        master.gain.value = 0;

        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2600;
        filter.Q.value = 0.3;

        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -20;
        comp.ratio.value = 3;

        // Tiếng vang: tạo xung phản hồi từ nhiễu tắt dần
        const reverb = ctx.createConvolver();
        const len = Math.floor(ctx.sampleRate * 4);
        const ir = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = ir.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
        }
        reverb.buffer = ir;

        dry = ctx.createGain();
        dry.gain.value = 0.7;
        wet = ctx.createGain();
        wet.gain.value = 0.55;

        dry.connect(filter);
        wet.connect(reverb);
        reverb.connect(filter);
        filter.connect(comp);
        comp.connect(master);
        master.connect(ctx.destination);
    }

    function send(node, wetAmt) {
        node.connect(dry);
        const s = ctx.createGain();
        s.gain.value = wetAmt;
        node.connect(s);
        s.connect(wet);
    }

    // Pad: hai sóng lệch nhau một chút qua bộ lọc thấp, lên xuống chậm
    function pad(notes, t, dur) {
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700 + 500 * light;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 1.8);
        g.gain.setValueAtTime(0.05, t + dur - 0.4);
        g.gain.linearRampToValueAtTime(0, t + dur + 2.2);
        lp.connect(g);
        send(g, 0.8);
        for (const n of notes) {
            for (const det of [-6, 7]) {
                const o = ctx.createOscillator();
                o.type = 'triangle';
                o.frequency.value = hz(n);
                o.detune.value = det;
                const og = ctx.createGain();
                og.gain.value = 0.35;
                o.connect(og);
                og.connect(lp);
                o.start(t);
                o.stop(t + dur + 2.5);
            }
        }
    }

    // Piano điện: âm cơ bản + bội âm nhẹ, gõ rồi tắt dần
    function keys(n, t, vel) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 2.8);
        send(g, 0.6);
        const parts = [[1, 1, 'sine'], [2, 0.25, 'sine'], [3, 0.06, 'triangle']];
        for (const [mul, amp, type] of parts) {
            const o = ctx.createOscillator();
            o.type = type;
            o.frequency.value = hz(n) * mul;
            const og = ctx.createGain();
            og.gain.value = amp;
            o.connect(og);
            og.connect(g);
            o.start(t);
            o.stop(t + 3);
        }
    }

    function bass(n, t, dur) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = hz(n);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.02, t + dur);
        g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
        o.connect(g);
        send(g, 0.15);
        o.start(t);
        o.stop(t + dur + 0.4);
    }

    function scheduleStep(t) {
        const ci = Math.floor(step / STEPS_PER_CHORD) % CHORDS.length;
        const chord = CHORDS[ci];
        const s = step % STEPS_PER_CHORD;
        const chordDur = EIGHTH * STEPS_PER_CHORD;

        if (s === 0) {
            pad(chord.pad, t, chordDur);
            bass(chord.bass, t, chordDur * 0.5);
        }
        if (s === 8 && Math.random() < 0.6) bass(chord.bass + (Math.random() < 0.5 ? 7 : 12), t, chordDur * 0.45);

        // Giai điệu dạo: nhiều nốt hơn ở phách mạnh, ban đêm thưa và trầm hơn
        const strong = s % 4 === 0;
        const p = (strong ? 0.55 : 0.28) * (0.55 + 0.45 * light);
        if (Math.random() < p) {
            const shift = light < 0.4 ? -12 : 0;
            const n = chord.tones[Math.floor(Math.random() * chord.tones.length)] + shift;
            const swing = s % 2 ? EIGHTH * 0.12 : 0;
            keys(n, t + swing + rand(0, 0.02), rand(0.45, 1));
            if (Math.random() < 0.15) keys(n - 5, t + swing + EIGHTH * 0.5, rand(0.3, 0.6));
        }
        step++;
    }

    // Lên lịch trước khoảng 0,3 giây để nhịp đều kể cả khi trang bận
    function tick() {
        while (nextTime < ctx.currentTime + 0.3) {
            scheduleStep(nextTime);
            nextTime += EIGHTH;
        }
    }

    return {
        get playing() { return playing; },

        start() {
            if (!ctx) setup();
            if (ctx.state === 'suspended') ctx.resume();
            if (playing) return Promise.resolve();
            playing = true;
            nextTime = ctx.currentTime + 0.1;
            timer = setInterval(tick, 50);
            tick();
            master.gain.cancelScheduledValues(ctx.currentTime);
            master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
            master.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 3);
            return ctx.state === 'running' ? Promise.resolve() : ctx.resume();
        },

        stop() {
            if (!playing) return;
            playing = false;
            clearInterval(timer);
            master.gain.cancelScheduledValues(ctx.currentTime);
            master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
            master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
        },

        // 0 = đêm, 1 = trưa
        setLight(v) {
            light = Math.max(0, Math.min(1, v));
            if (filter) filter.frequency.setTargetAtTime(1300 + 1700 * light, ctx.currentTime, 2);
        }
    };
})();
