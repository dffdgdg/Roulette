// ============ НАСТРОЙКИ ============
const MUSIC_TRACKS = [
    { name: 'Трек 1', file: 'music/track1.mp3' },
    { name: 'Трек 2', file: 'music/track2.mp3' },
    { name: 'Трек 3', file: 'music/track3.mp3' }
];

const BACKGROUNDS = [
    { name: 'Нет', type: 'none' },
    { name: 'Космос', type: 'file', file: 'backgrounds/space.jpg' },
    { name: 'Неон', type: 'file', file: 'backgrounds/neon.jpg' },
    { name: 'Горы', type: 'file', file: 'backgrounds/mountains.jpg' },
    { name: 'Город', type: 'file', file: 'backgrounds/city.jpg' },
    { name: 'Абстракция', type: 'file', file: 'backgrounds/abstract.jpg' }
];

const COLORS = [
    '#e94560', '#00b4d8', '#8b5cf6', '#10b981',
    '#f59e0b', '#ec4899', '#06b6d4', '#ef4444'
];

// ============ СОСТОЯНИЕ ============
let participants = ['Саня', 'Свят', 'Тема', 'Слава'];
let history = [];
let currentRotation = 0;
let isSpinning = false;
let selectedTrack = 0;
let selectedBg = 0;
let wheelBgImage = null; // Картинка для фона рулетки

// ============ ЭЛЕМЕНТЫ ============
const canvas = document.getElementById('wheel');
const ctx = canvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');
const resultBox = document.getElementById('resultBox');
const resultText = document.getElementById('resultText');
const audio = document.getElementById('audio');
const modal = document.getElementById('modal');
const modalWinner = document.getElementById('modalWinner');
const modalClose = document.getElementById('modalClose');

// ============ STORAGE ============
function loadData() {
    const saved = localStorage.getItem('roulette_data');
    if (saved) {
        const data = JSON.parse(saved);
        if (data.participants?.length >= 2) participants = data.participants;
        if (data.history) history = data.history;
        if (data.selectedBg !== undefined) selectedBg = data.selectedBg;
        if (data.customBg) {
            loadWheelBackground(data.customBg);
        } else if (selectedBg > 0 && BACKGROUNDS[selectedBg]) {
            loadWheelBackground(BACKGROUNDS[selectedBg].file);
        }
    }
}

function saveData() {
    const data = { participants, history, selectedBg };
    if (selectedBg === -1 && wheelBgImage) {
        // Сохраняем base64 кастомной картинки
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = wheelBgImage.width;
        tempCanvas.height = wheelBgImage.height;
        tempCanvas.getContext('2d').drawImage(wheelBgImage, 0, 0);
        data.customBg = tempCanvas.toDataURL();
    }
    localStorage.setItem('roulette_data', JSON.stringify(data));
}

// ============ ФОН РУЛЕТКИ ============
function loadWheelBackground(src) {
    if (!src) {
        wheelBgImage = null;
        drawWheel();
        return;
    }
    
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        wheelBgImage = img;
        drawWheel();
    };
    img.onerror = () => {
        wheelBgImage = null;
        drawWheel();
    };
    img.src = src;
}

function renderBackgrounds() {
    const grid = document.getElementById('bgGrid');
    grid.innerHTML = '';
    BACKGROUNDS.forEach((bg, i) => {
        const div = document.createElement('div');
        div.className = 'bg-item' + (selectedBg === i ? ' active' : '');
        div.dataset.index = i;
        if (bg.type === 'none') {
            div.classList.add('no-bg');
            div.textContent = 'Без фона';
        } else {
            div.style.backgroundImage = `url('${bg.file}')`;
            div.innerHTML = `<span class="bg-label">${bg.name}</span>`;
        }
        grid.appendChild(div);
    });
}

// ============ КОЛЕСО ============
function drawWheel() {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 5;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Рисуем фоновую картинку если есть
    if (wheelBgImage) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        
        // Масштабируем картинку чтобы покрыть круг
        const size = radius * 2;
        const imgRatio = wheelBgImage.width / wheelBgImage.height;
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imgRatio > 1) {
            drawHeight = size;
            drawWidth = size * imgRatio;
        } else {
            drawWidth = size;
            drawHeight = size / imgRatio;
        }
        drawX = centerX - drawWidth / 2;
        drawY = centerY - drawHeight / 2;
        
        ctx.drawImage(wheelBgImage, drawX, drawY, drawWidth, drawHeight);
        
        // Затемнение поверх картинки
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.restore();
    }

    if (participants.length === 0) {
        if (!wheelBgImage) {
            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
            ctx.fill();
        }
        return;
    }

    const sliceAngle = (2 * Math.PI) / participants.length;

    participants.forEach((name, i) => {
        const startAngle = i * sliceAngle - Math.PI / 2 + (currentRotation * Math.PI / 180);
        const endAngle = startAngle + sliceAngle;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();
        
        // Если есть фон - делаем сегменты полупрозрачными
        if (wheelBgImage) {
            const color = COLORS[i % COLORS.length];
            ctx.fillStyle = hexToRgba(color, 0.6);
        } else {
            ctx.fillStyle = COLORS[i % COLORS.length];
        }
        ctx.fill();
        
        ctx.strokeStyle = wheelBgImage ? 'rgba(255,255,255,0.3)' : '#0a0a0f';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Текст
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Inter, sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 4;
        ctx.fillText(name.length > 10 ? name.slice(0, 10) + '...' : name, radius - 15, 5);
        ctx.restore();
    });

    // Центр
    ctx.beginPath();
    ctx.arc(centerX, centerY, 35, 0, 2 * Math.PI);
    ctx.fillStyle = wheelBgImage ? 'rgba(26, 26, 46, 0.9)' : '#1a1a2e';
    ctx.fill();
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.fillText('?', centerX, centerY);
}

// Конвертация HEX в RGBA
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============ РЕНДЕРЫ ============
function renderParticipants() {
    const list = document.getElementById('participantsList');
    list.innerHTML = '';
    participants.forEach((name, i) => {
        const div = document.createElement('div');
        div.className = 'participant-item';
        div.innerHTML = `
            <div class="participant-color" style="background: ${COLORS[i % COLORS.length]}"></div>
            <input type="text" class="participant-input" value="${name}" data-index="${i}" maxlength="15">
            <button class="participant-remove" data-index="${i}">×</button>
        `;
        list.appendChild(div);
    });
    document.getElementById('count').textContent = participants.length;
}

function renderMusic() {
    const list = document.getElementById('musicList');
    list.innerHTML = '';
    MUSIC_TRACKS.forEach((track, i) => {
        const div = document.createElement('div');
        div.className = 'music-item' + (selectedTrack === i ? ' active' : '');
        div.dataset.index = i;
        div.innerHTML = `
            <span class="icon">${selectedTrack === i ? '🎵' : '🎶'}</span>
            <span class="name">${track.name}</span>
        `;
        list.appendChild(div);
    });
}

function renderHistory() {
    const list = document.getElementById('historyList');
    if (history.length === 0) {
        list.innerHTML = '<div class="history-empty">Пока пусто 🎲</div>';
        return;
    }
    list.innerHTML = '';
    history.slice().reverse().forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <div class="history-num">${history.length - i}</div>
            <span class="history-name">${item.name}</span>
            <span class="history-time">${item.time}</span>
        `;
        list.appendChild(div);
    });
}

// ============ ВРАЩЕНИЕ ============
function spin() {
    if (isSpinning || participants.length < 2) {
        if (participants.length < 2) alert('Добавь минимум 2 участника!');
        return;
    }

    isSpinning = true;
    spinBtn.disabled = true;
    resultBox.classList.remove('winner');
    resultText.textContent = 'Крутится...';

    if (selectedTrack !== null) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
    }

    const spins = 5 + Math.random() * 5;
    const extraDegrees = Math.random() * 360;
    const totalDegrees = spins * 360 + extraDegrees;
    const duration = 5000;
    const startTime = performance.now();
    const startRotation = currentRotation;

    function animate(time) {
        const elapsed = time - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        currentRotation = startRotation + totalDegrees * eased;
        drawWheel();
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            finishSpin();
        }
    }

    requestAnimationFrame(animate);
}

function finishSpin() {
    const sliceAngle = 360 / participants.length;
    const normalizedRotation = ((currentRotation % 360) + 360) % 360;
    const winnerIndex = Math.floor(((360 - normalizedRotation) % 360) / sliceAngle) % participants.length;
    const winner = participants[winnerIndex];

    history.push({
        name: winner,
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    });

    resultText.textContent = '🎉 ' + winner;
    resultBox.classList.add('winner');
    modalWinner.textContent = winner;
    modal.classList.add('active');

    createConfetti();
    setTimeout(() => audio.pause(), 2000);

    saveData();
    renderHistory();

    isSpinning = false;
    spinBtn.disabled = false;
}

// ============ КОНФЕТТИ ============
function createConfetti() {
    const colors = ['#e94560', '#00b4d8', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'];
    for (let i = 0; i < 100; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDuration = (2 + Math.random() * 2) + 's';
            confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            document.body.appendChild(confetti);
            setTimeout(() => confetti.remove(), 4000);
        }, i * 30);
    }
}

// ============ ОБРАБОТЧИКИ ============
spinBtn.addEventListener('click', spin);

document.getElementById('addBtn').addEventListener('click', () => {
    const input = document.getElementById('newName');
    const name = input.value.trim();
    if (name && participants.length < 12) {
        participants.push(name);
        input.value = '';
        renderParticipants();
        drawWheel();
        saveData();
    }
});

document.getElementById('newName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('addBtn').click();
});

document.getElementById('participantsList').addEventListener('input', (e) => {
    if (e.target.classList.contains('participant-input')) {
        participants[parseInt(e.target.dataset.index)] = e.target.value;
        drawWheel();
        saveData();
    }
});

document.getElementById('participantsList').addEventListener('click', (e) => {
    if (e.target.classList.contains('participant-remove')) {
        if (participants.length <= 2) {
            alert('Минимум 2 участника!');
            return;
        }
        participants.splice(parseInt(e.target.dataset.index), 1);
        renderParticipants();
        drawWheel();
        saveData();
    }
});

document.getElementById('musicList').addEventListener('click', (e) => {
    const item = e.target.closest('.music-item');
    if (item) {
        selectedTrack = parseInt(item.dataset.index);
        audio.src = MUSIC_TRACKS[selectedTrack].file;
        audio.load();
        renderMusic();
    }
});

document.getElementById('volume').addEventListener('input', (e) => {
    audio.volume = e.target.value / 100;
    document.getElementById('volumeVal').textContent = e.target.value + '%';
});

document.getElementById('bgGrid').addEventListener('click', (e) => {
    const item = e.target.closest('.bg-item');
    if (item) {
        selectedBg = parseInt(item.dataset.index);
        if (BACKGROUNDS[selectedBg].type === 'none') {
            wheelBgImage = null;
            drawWheel();
        } else {
            loadWheelBackground(BACKGROUNDS[selectedBg].file);
        }
        renderBackgrounds();
        saveData();
    }
});

document.getElementById('bgUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            selectedBg = -1;
            loadWheelBackground(event.target.result);
            renderBackgrounds();
            saveData();
        };
        reader.readAsDataURL(file);
    }
});

document.getElementById('clearBtn').addEventListener('click', () => {
    history = [];
    renderHistory();
    saveData();
});

modalClose.addEventListener('click', () => modal.classList.remove('active'));
modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
});

document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        spin();
    }
    if (e.code === 'Escape') modal.classList.remove('active');
});

// ============ ИНИЦИАЛИЗАЦИЯ ============
loadData();
renderParticipants();
renderMusic();
renderBackgrounds();
renderHistory();
drawWheel();

audio.src = MUSIC_TRACKS[selectedTrack].file;
audio.load();
audio.volume = 0.7;