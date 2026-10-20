// Luồng chính lo thiệp chúc mừng, sự kiện và nhạc; việc vẽ cảnh nằm trong scene.js.
// Ưu tiên chạy scene.js trong Web Worker với OffscreenCanvas, nếu không được thì chạy ngay trên luồng chính.
let canvas = document.getElementById('scene');
let send = () => {};

// ?gio=21 hoặc ?gio=21:30 để xem cảnh ở một giờ cố định; bỏ trống thì theo giờ thật
function parseHour() {
    const q = new URLSearchParams(location.search).get('gio');
    if (!q) return null;
    const [h, m = '0'] = q.split(':');
    const v = Number(h) + Number(m) / 60;
    return Number.isFinite(v) ? ((v % 24) + 24) % 24 : null;
}
const hour = parseHour();

// scene.js báo độ tối viền màn hình theo khung giờ (ban ngày gần như không có viền tối)
const vignette = document.querySelector('.vignette');
function onSceneMessage(m) {
    if (m.type !== 'tone') return;
    if (vignette) vignette.style.opacity = m.vignette;
    // Nhạc đổi sắc theo ánh sáng của cảnh
    ChillMusic.setLight(m.light);
}

const viewport = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: Math.min(window.devicePixelRatio || 1, 2)
});

function startWorker() {
    if (typeof Worker === 'undefined' || !('transferControlToOffscreen' in canvas)) return false;
    let worker;
    try {
        worker = new Worker('scene.js');
    } catch (e) {
        // Ví dụ: mở trực tiếp file:// trên Chrome không cho tạo Worker
        return false;
    }
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage({ type: 'init', canvas: offscreen, hour, ...viewport() }, [offscreen]);
    send = msg => worker.postMessage(msg);
    worker.addEventListener('message', e => onSceneMessage(e.data));

    // Worker hỏng giữa chừng: thay canvas mới và vẽ trên luồng chính
    worker.addEventListener('error', () => {
        worker.terminate();
        const fresh = canvas.cloneNode(false);
        canvas.replaceWith(fresh);
        canvas = fresh;
        startMainThread();
    }, { once: true });
    return true;
}

function startMainThread() {
    send = () => {};
    const script = document.createElement('script');
    script.src = 'scene.js';
    script.onload = () => {
        self.Scene.onmessage = onSceneMessage;
        send = msg => self.Scene.post(msg);
        send({ type: 'init', canvas, hour, ...viewport() });
    };
    document.body.appendChild(script);
}

if (!startWorker()) startMainThread();

// ---------- Sự kiện ----------

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => send({ type: 'resize', ...viewport() }), 150);
});

document.addEventListener('visibilitychange', () => {
    send({ type: 'visibility', visible: !document.hidden });
});

let lastTrail = 0;
window.addEventListener('pointermove', e => {
    if (e.target.closest && e.target.closest('#controls')) return;
    if (e.pointerType === 'mouse') {
        send({
            type: 'pointer',
            x: (e.clientX / window.innerWidth - 0.5) * 2,
            y: (e.clientY / window.innerHeight - 0.5) * 2
        });
    }
    // Vệt sáng theo con trỏ / ngón tay, giới hạn tần suất gửi
    const now = performance.now();
    if (now - lastTrail > 24) {
        lastTrail = now;
        send({ type: 'trail', x: e.clientX, y: e.clientY });
    }
});

window.addEventListener('deviceorientation', e => {
    if (e.gamma == null) return;
    send({
        type: 'pointer',
        x: Math.max(-1, Math.min(1, e.gamma / 30)),
        y: Math.max(-1, Math.min(1, (e.beta - 45) / 30))
    });
});

// ---------- Đồng hồ: chỉnh giờ của cảnh ----------

const controls = document.getElementById('controls');
const clockBtn = document.getElementById('clock-toggle');
const timePanel = document.getElementById('time-panel');
const timeRange = document.getElementById('time-range');
const timeLabel = document.getElementById('time-label');
const timeAuto = document.getElementById('time-auto');
let manualHour = hour;

const realHour = () => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
};

function formatHour(h) {
    const m = Math.round(h * 60) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function refreshClock() {
    const h = manualHour === null ? realHour() : manualHour;
    timeRange.value = h;
    timeLabel.textContent = formatHour(h);
    timeAuto.classList.toggle('active', manualHour === null);
    clockBtn.classList.toggle('manual', manualHour !== null);
}

// Ghi giờ đang chọn lên link để có thể gửi cho người khác
function updateUrl() {
    const params = new URLSearchParams(location.search);
    params.delete('gio');
    let query = params.toString();
    if (manualHour !== null) query = (query ? query + '&' : '') + 'gio=' + formatHour(manualHour);
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash);
}

// Kéo thanh trượt gửi liên tục, nên giới hạn tần suất dựng lại cảnh
let lastHourSend = 0, hourTimer;
function sendHour() {
    clearTimeout(hourTimer);
    const go = () => {
        lastHourSend = performance.now();
        send({ type: 'hour', hour: manualHour });
    };
    if (performance.now() - lastHourSend > 150) go();
    else hourTimer = setTimeout(go, 150);
}

function setPanel(open) {
    timePanel.hidden = !open;
    clockBtn.setAttribute('aria-expanded', String(open));
    if (open) refreshClock();
}

// Bấm vào cụm nút không tạo hiệu ứng chạm lên cảnh
controls.addEventListener('pointerdown', e => e.stopPropagation());
clockBtn.addEventListener('click', () => setPanel(timePanel.hidden));

timeRange.addEventListener('input', () => {
    manualHour = Number(timeRange.value) % 24;
    refreshClock();
    sendHour();
    updateUrl();
});

timeAuto.addEventListener('click', () => {
    manualHour = null;
    refreshClock();
    sendHour();
    updateUrl();
});

setInterval(() => { if (manualHour === null && !timePanel.hidden) refreshClock(); }, 30000);
refreshClock();

// ---------- Thiệp chúc mừng 20/10 ----------

const card = document.getElementById('card');
const cardMsg = document.getElementById('card-msg');
const cardClose = document.getElementById('card-close');
const cardToggle = document.getElementById('card-toggle');
const cardSign = card.querySelector('.card-sign');

// Tách lời chúc thành từng chữ để hiện dần
const words = cardMsg.textContent.trim().split(/\s+/);
cardMsg.textContent = '';
words.forEach((w, i) => {
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = w;
    span.style.animationDelay = `${1.2 + i * 0.09}s`;
    cardMsg.append(span, ' ');
});
cardSign.style.animationDelay = `${1.6 + words.length * 0.09}s`;

function openCard() {
    card.classList.remove('closing');
    card.hidden = false;
    cardToggle.hidden = true;
    // Chạy lại hiệu ứng hiện chữ mỗi lần mở
    for (const el of [card, ...cardMsg.children, cardSign]) {
        el.style.animationName = 'none';
        void el.offsetWidth;
        el.style.animationName = '';
    }
    // Trái tim bằng đốm sáng và mưa cánh hoa bung ra từ dưới thiệp
    const r = card.getBoundingClientRect();
    setTimeout(() => send({ type: 'celebrate', x: r.left + r.width / 2, y: r.bottom + 40 }), 500);
}

function closeCard() {
    card.classList.add('closing');
    setTimeout(() => {
        card.hidden = true;
        card.classList.remove('closing');
        cardToggle.hidden = false;
    }, 550);
}

card.addEventListener('pointerdown', e => e.stopPropagation());
cardClose.addEventListener('click', closeCard);
cardToggle.addEventListener('click', openCard);

// Thiệp mở sau khi cảnh hiện ra từ bóng tối
setTimeout(openCard, 2200);

// ---------- Nhạc chill ----------

const musicBtn = document.getElementById('music-toggle');
let userMuted = false;

// Trình duyệt chỉ cho phát âm thanh sau lần chạm đầu tiên
function playMusic() {
    ChillMusic.start().then(() => musicBtn.classList.add('playing')).catch(() => {});
}

musicBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!ChillMusic.playing) {
        userMuted = false;
        playMusic();
    } else {
        ChillMusic.stop();
        userMuted = true;
        musicBtn.classList.remove('playing');
    }
});

window.addEventListener('pointerdown', e => {
    if (!timePanel.hidden) setPanel(false);
    if (!userMuted && !ChillMusic.playing) playMusic();
    send({ type: 'tap', x: e.clientX, y: e.clientY });
});

// Lần chạm vào thiệp hay cụm nút cũng tính là lần tương tác đầu tiên để bật nhạc
for (const el of [card, controls]) {
    el.addEventListener('pointerdown', () => {
        if (!userMuted && !ChillMusic.playing) playMusic();
    });
}
