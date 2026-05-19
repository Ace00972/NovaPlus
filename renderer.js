// ===================== STATE =====================
const state = {
    allMedia: { videos: [], audio: [] },
    currentView: 'home',
    searchQuery: '',
    movieFolders: [],
    musicFolders: [],
    omdbKey: '',
    accentColor: '#63b3ff',
    bgStyle: 'default',
};

// ===================== UI REFS =====================
const mediaGrid     = document.getElementById('media-grid');
const viewTitle     = document.getElementById('view-title');
const playerOverlay = document.getElementById('player-overlay');
const musicPopup    = document.getElementById('music-popup');
const videoElement  = document.getElementById('video-element');
const audioElement  = document.getElementById('audio-element');
const searchInput   = document.getElementById('search-input');
const settingsView  = document.getElementById('settings-view');
const contentArea   = document.querySelector('.content');

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    setupEventListeners();
    setupSettingsListeners();
    if (state.movieFolders.length || state.musicFolders.length) {
        // Show cached library instantly, then rescan in background
        render();
        await rescanAll();
    }
    render();
});

// ===================== EVENT LISTENERS =====================
function setupEventListeners() {
    document.getElementById('btn-min').onclick   = () => window.electronAPI.minimize();
    document.getElementById('btn-max').onclick   = () => window.electronAPI.maximize();
    document.getElementById('btn-close').onclick = () => window.electronAPI.close();

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentView = btn.dataset.view;
            contentArea.scrollTop = 0;
            render();
        };
    });

    searchInput.oninput = e => {
        state.searchQuery = e.target.value.toLowerCase();
        render();
    };

    document.querySelector('.close-player').onclick = closePlayer;
    document.getElementById('btn-close-music').onclick = closeMusicPlayer;

    // ---- Custom video controls ----
    const video        = videoElement;
    const progressWrap = document.getElementById('video-progress');
    const progressFill = document.getElementById('video-progress-fill');
    const timeLabel    = document.getElementById('video-time');
    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnMute      = document.getElementById('btn-mute');
    const volSlider    = document.getElementById('volume-slider');
    const btnFs        = document.getElementById('btn-fullscreen');

    btnPlayPause.onclick = () => video.paused ? video.play() : video.pause();
    video.onplay  = () => btnPlayPause.innerText = '⏸';
    video.onpause = () => btnPlayPause.innerText = '▶';

    video.ontimeupdate = () => {
        if (!video.duration) return;
        const pct = (video.currentTime / video.duration) * 100;
        progressFill.style.width = pct + '%';
        timeLabel.innerText = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
    };

    progressWrap.onclick = e => {
        const rect = progressWrap.getBoundingClientRect();
        video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration;
    };

    btnMute.onclick = () => {
        video.muted = !video.muted;
        btnMute.innerText = video.muted ? '🔇' : '🔊';
    };
    volSlider.oninput = e => { video.volume = e.target.value; };

    btnFs.onclick = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else playerOverlay.requestFullscreen();
    };

    // Hide controls on mouse idle
    let hideTimer;
    playerOverlay.onmousemove = () => {
        document.getElementById('video-controls').style.opacity = '1';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!video.paused)
                document.getElementById('video-controls').style.opacity = '0';
        }, 2500);
    };

    // ---- Custom music controls ----
    const musicProgress     = document.getElementById('music-progress');
    const musicProgressFill = document.getElementById('music-progress-fill');
    const musicCurrent      = document.getElementById('music-current');
    const musicDuration     = document.getElementById('music-duration');
    const musicBtnPlay      = document.getElementById('music-btn-play');
    const musicVolume       = document.getElementById('music-volume');

    musicBtnPlay.onclick = () => audioElement.paused ? audioElement.play() : audioElement.pause();
    audioElement.onplay  = () => musicBtnPlay.innerText = '⏸';
    audioElement.onpause = () => musicBtnPlay.innerText = '▶';

    audioElement.ontimeupdate = () => {
        if (!audioElement.duration) return;
        const pct = (audioElement.currentTime / audioElement.duration) * 100;
        musicProgressFill.style.width = pct + '%';
        musicCurrent.innerText  = fmtTime(audioElement.currentTime);
        musicDuration.innerText = fmtTime(audioElement.duration);
    };

    musicProgress.onclick = e => {
        const rect = musicProgress.getBoundingClientRect();
        audioElement.currentTime = ((e.clientX - rect.left) / rect.width) * audioElement.duration;
    };

    musicVolume.oninput = e => { audioElement.volume = e.target.value; };

}

// ===================== RENDER =====================
function render() {
    const isSettings = state.currentView === 'settings';
    mediaGrid.classList.toggle('hidden', isSettings);
    settingsView.classList.toggle('hidden', !isSettings);
    searchInput.parentElement.style.display = isSettings ? 'none' : '';

    if (isSettings) {
        viewTitle.innerText = 'Settings';
        renderFolderList('movies');
        renderFolderList('music');
        return;
    }

    mediaGrid.innerHTML = '';
    let items = [];

    if (state.currentView === 'home') {
        items = [...state.allMedia.videos, ...state.allMedia.audio];
        viewTitle.innerText = 'Library';
    } else if (state.currentView === 'movies') {
        items = state.allMedia.videos;
        viewTitle.innerText = 'Movies';
    } else if (state.currentView === 'music') {
        items = state.allMedia.audio;
        viewTitle.innerText = 'Music';
    }

    if (state.searchQuery) {
        items = items.filter(i => i.name.toLowerCase().includes(state.searchQuery));
    }

    if (items.length === 0) {
        mediaGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📂</div>
                <h2>No items found</h2>
                <p>Go to Settings to add folders.</p>
            </div>`;
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';

        const artContent = item.poster
            ? `<img src="${item.poster}" alt="${item.name}" class="card-poster">`
            : `<span class="card-emoji">${item.type === 'video' ? '🎬' : '🎵'}</span>`;

        const meta = item.type === 'video'
            ? ([item.year, item.genre ? item.genre.split(',')[0] : ''].filter(Boolean).join(' · ') || 'Video File')
            : (item.artist || 'Unknown Artist');

        const ratingBadge = item.rating ? `<div class="card-rating">⭐ ${item.rating}</div>` : '';

        card.innerHTML = `
            <div class="card-art">${artContent}${ratingBadge}</div>
            <div class="card-info">
                <h3>${item.name}</h3>
                <p>${meta}</p>
            </div>`;
        card.onclick = () => playMedia(item);
        mediaGrid.appendChild(card);
    });
}

// ===================== PLAYER =====================
function playMedia(item) {
    const mediaUrl = window.electronAPI.toMediaUrl(item.path);

    if (item.type === 'video') {
        playerOverlay.classList.remove('hidden');
        musicPopup.classList.add('hidden');
        videoElement.src = mediaUrl;
        videoElement.play();
    } else {
        musicPopup.classList.remove('hidden');
        playerOverlay.classList.add('hidden');
        document.getElementById('now-playing-title').innerText  = item.name;
        document.getElementById('now-playing-artist').innerText = item.artist || 'Unknown Artist';

        // Album art — use poster if available else emoji
        const artEl = document.getElementById('music-art');
        if (item.poster) {
            artEl.innerHTML = `<img src="${item.poster}" style="width:100%;height:100%;object-fit:cover;border-radius:20px;">`;
        } else {
            artEl.innerText = '🎵';
        }

        audioElement.src = mediaUrl;
        audioElement.play();
    }
}

function closePlayer() {
    videoElement.pause();
    videoElement.src = '';
    playerOverlay.classList.add('hidden');
    document.getElementById('video-progress-fill').style.width = '0%';
}

function closeMusicPlayer() {
    audioElement.pause();
    audioElement.src = '';
    musicPopup.classList.add('hidden');
    document.getElementById('music-progress-fill').style.width = '0%';
}

function fmtTime(s) {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
}

// ===================== PERSISTENCE =====================
async function loadSettings() {
    try {
        const raw = localStorage.getItem('novaplus_v2');
        if (raw) {
            const p = JSON.parse(raw);
            state.movieFolders = p.movieFolders || [];
            state.musicFolders = p.musicFolders || [];
            state.omdbKey      = p.omdbKey      || '';
            state.accentColor  = p.accentColor  || '#63b3ff';
            state.bgStyle      = p.bgStyle      || 'default';
        }
    } catch(e) {}

    // Restore cached media library (with OMDB data) so it shows instantly on launch
    try {
        const mediaRaw = localStorage.getItem('novaplus_media');
        if (mediaRaw) {
            state.allMedia = JSON.parse(mediaRaw);
        }
    } catch(e) {}

    applyAccent(state.accentColor);
    applyBg(state.bgStyle);

    const omdbInput = document.getElementById('omdb-api-key');
    if (omdbInput && state.omdbKey) omdbInput.value = state.omdbKey;
}

function saveSettings() {
    localStorage.setItem('novaplus_v2', JSON.stringify({
        movieFolders: state.movieFolders,
        musicFolders: state.musicFolders,
        omdbKey:      state.omdbKey,
        accentColor:  state.accentColor,
        bgStyle:      state.bgStyle,
    }));
}

function saveMediaCache() {
    try {
        localStorage.setItem('novaplus_media', JSON.stringify(state.allMedia));
    } catch(e) {
        // If storage is full, clear and retry
        localStorage.removeItem('novaplus_media');
        try { localStorage.setItem('novaplus_media', JSON.stringify(state.allMedia)); } catch(e2) {}
    }
}

// ===================== APPEARANCE =====================
function applyAccent(color) {
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-glow', color + '44');
    state.accentColor = color;
    document.querySelectorAll('.colour-swatch').forEach(s =>
        s.classList.toggle('active', s.dataset.color === color));
}

function applyBg(style) {
    document.body.className = document.body.className.replace(/\bbg-\S+/g, '').trim();
    if (style !== 'default') document.body.classList.add('bg-' + style);
    state.bgStyle = style;
    document.querySelectorAll('.wallpaper-option').forEach(o =>
        o.classList.toggle('active', o.dataset.bg === style));
}

// ===================== FOLDERS =====================
function getFolderList(type) {
    return type === 'movies' ? state.movieFolders : state.musicFolders;
}

async function addFolderByType(type, folderPath) {
    const list = getFolderList(type);
    if (list.find(f => f.path === folderPath)) return;
    const name = folderPath.split(/[\\/]/).pop() || folderPath;
    list.push({ path: folderPath, name });
    saveSettings();
    await rescanAll();
    renderFolderList(type);
}

async function removeFolderByType(type, folderPath) {
    if (type === 'movies') {
        state.movieFolders = state.movieFolders.filter(f => f.path !== folderPath);
    } else {
        state.musicFolders = state.musicFolders.filter(f => f.path !== folderPath);
    }
    saveSettings();
    await rescanAll();
    renderFolderList(type);
}

async function rescanAll() {
    viewTitle.innerText = 'Scanning…';

    // Build a lookup of existing OMDB data keyed by file path
    const omdbCache = {};
    for (const v of state.allMedia.videos) {
        if (v.poster || v.rating || v.year) omdbCache[v.path] = {
            poster: v.poster, year: v.year, genre: v.genre,
            rating: v.rating, plot: v.plot
        };
    }

    const combined = { videos: [], audio: [] };

    for (const folder of state.movieFolders) {
        try {
            const r = await window.electronAPI.scanMedia(folder.path);
            combined.videos.push(...r.videos);
        } catch(e) {}
    }

    for (const folder of state.musicFolders) {
        try {
            const r = await window.electronAPI.scanMedia(folder.path);
            combined.audio.push(...r.audio);
        } catch(e) {}
    }

    // Re-apply saved OMDB data onto freshly scanned videos
    for (const v of combined.videos) {
        if (omdbCache[v.path]) Object.assign(v, omdbCache[v.path]);
    }

    state.allMedia = combined;
    saveMediaCache(); // persist merged result immediately
    if (state.currentView !== 'settings') render();
    else viewTitle.innerText = 'Settings';
}

function renderFolderList(type) {
    const listId = type === 'movies' ? 'folder-list-movies' : 'folder-list-music';
    const list   = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';

    const folders = getFolderList(type);
    if (folders.length === 0) {
        list.innerHTML = `<p class="folder-empty-hint">No folders added yet.</p>`;
        return;
    }

    folders.forEach(folder => {
        const item = document.createElement('div');
        item.className = 'folder-item';
        item.innerHTML = `
            <div class="folder-item-left">
                <span class="folder-icon">${type === 'movies' ? '🎬' : '🎵'}</span>
                <div style="overflow:hidden">
                    <div class="folder-item-name">${folder.name}</div>
                    <div class="folder-item-path">${folder.path}</div>
                </div>
            </div>
            <button class="btn-remove-folder" title="Remove">✕</button>`;
        item.querySelector('.btn-remove-folder').onclick = () => removeFolderByType(type, folder.path);
        list.appendChild(item);
    });
}

// ===================== SETTINGS LISTENERS =====================
function setupSettingsListeners() {
    document.getElementById('btn-browse-movies').onclick = async () => {
        const p = await window.electronAPI.selectFolder();
        if (p) await addFolderByType('movies', p);
    };

    document.getElementById('btn-browse-music').onclick = async () => {
        const p = await window.electronAPI.selectFolder();
        if (p) await addFolderByType('music', p);
    };

    setupDropZone('drop-zone-movies', 'movies');
    setupDropZone('drop-zone-music',  'music');

    const omdbStatus = document.getElementById('omdb-status');

    document.getElementById('btn-save-omdb').onclick = () => {
        const val = document.getElementById('omdb-api-key').value.trim();
        state.omdbKey = val;
        saveSettings();
        omdbStatus.className = 'omdb-status ' + (val ? 'success' : 'error');
        omdbStatus.innerText  = val ? '✓ API key saved!' : '⚠ Key is empty.';
        setTimeout(() => omdbStatus.classList.add('hidden'), 3000);
    };

    document.getElementById('btn-refresh-omdb').onclick = async () => {
        const key = document.getElementById('omdb-api-key').value.trim() || state.omdbKey;
        if (!key) {
            omdbStatus.className = 'omdb-status error';
            omdbStatus.innerText = '⚠ Enter and save an API key first.';
            setTimeout(() => omdbStatus.classList.add('hidden'), 3000);
            return;
        }
        state.omdbKey = key;
        saveSettings();
        await fetchOmdbMetadata(key);
    };

    document.querySelectorAll('.colour-swatch').forEach(s => {
        s.onclick = () => { applyAccent(s.dataset.color); saveSettings(); };
    });

    document.querySelectorAll('.wallpaper-option').forEach(o => {
        o.onclick = () => { applyBg(o.dataset.bg); saveSettings(); };
    });

    // ---- Feedback / Bug Report ----

    // ⚠️ EmailJS credentials
    const EMAILJS_SERVICE_ID  = 'service_hc8ryvu';
    const EMAILJS_TEMPLATE_ID = 'template_yd4x8x6';
    const EMAILJS_PUBLIC_KEY  = 'mBKibk4UMN4KKrF2f';

    // Direct EmailJS REST API — no SDK needed, works in Electron
    async function sendViaEmailJS(templateParams) {
        const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id:   EMAILJS_SERVICE_ID,
                template_id:  EMAILJS_TEMPLATE_ID,
                user_id:      EMAILJS_PUBLIC_KEY,
                template_params: templateParams,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`EmailJS error ${res.status}: ${err}`);
        }
        return res;
    }

    let feedbackFiles = []; // { name, base64, type }

    // Type toggle
    document.querySelectorAll('.feedback-type-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.feedback-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('feedback-text').placeholder =
                btn.dataset.type === 'bug'
                    ? 'Describe the bug — what happened and when…'
                    : 'Share your idea or suggestion…';
        };
    });

    // Char counter
    const feedbackText = document.getElementById('feedback-text');
    const feedbackChar = document.getElementById('feedback-char');
    const MAX_CHARS = 500;
    feedbackText.oninput = () => {
        if (feedbackText.value.length > MAX_CHARS) feedbackText.value = feedbackText.value.slice(0, MAX_CHARS);
        feedbackChar.innerText = `${feedbackText.value.length} / ${MAX_CHARS}`;
        feedbackChar.style.color = feedbackText.value.length >= MAX_CHARS ? '#f87171' : 'var(--text-muted)';
    };

    // File input trigger
    const fileInput      = document.getElementById('feedback-files');
    const uploadTrigger  = document.getElementById('feedback-upload-trigger');
    const dropZone       = document.getElementById('feedback-drop-zone');

    uploadTrigger.onclick = () => fileInput.click();

    fileInput.onchange = e => handleFeedbackFiles(Array.from(e.target.files));

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFeedbackFiles(Array.from(e.dataTransfer.files));
    });

    function handleFeedbackFiles(files) {
        const allowed = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
        const remaining = 3 - feedbackFiles.length;
        const toAdd = allowed.slice(0, remaining);

        toAdd.forEach(file => {
            if (file.size > 10 * 1024 * 1024) {
                showFeedbackStatus('error', `⚠ "${file.name}" exceeds 10MB limit.`);
                return;
            }
            const reader = new FileReader();
            reader.onload = e => {
                feedbackFiles.push({ name: file.name, base64: e.target.result, type: file.type });
                renderFeedbackFiles();
                updateVideoNote();
            };
            reader.readAsDataURL(file);
        });
    }

    function updateVideoNote() {
        const hasVideo = feedbackFiles.some(f => f.type.startsWith('video/'));
        document.getElementById('feedback-video-note').style.display = hasVideo ? 'block' : 'none';
    }

    function renderFeedbackFiles() {
        const list = document.getElementById('feedback-file-list');
        list.innerHTML = '';
        feedbackFiles.forEach((f, i) => {
            const el = document.createElement('div');
            el.className = 'feedback-file-item';
            const isImage = f.type.startsWith('image/');
            el.innerHTML = `
                ${isImage
                    ? `<img src="${f.base64}" class="feedback-file-thumb" alt="${f.name}">`
                    : `<div class="feedback-file-thumb feedback-file-video">🎬</div>`}
                <span class="feedback-file-name">${f.name}</span>
                <button class="feedback-file-remove" data-i="${i}">✕</button>`;
            el.querySelector('.feedback-file-remove').onclick = () => {
                feedbackFiles.splice(i, 1);
                renderFeedbackFiles();
                updateVideoNote();
            };
            list.appendChild(el);
        });
    }

    function showFeedbackStatus(type, msg, duration = 4000) {
        const el = document.getElementById('feedback-status');
        el.className = 'omdb-status ' + type;
        el.innerText = msg;
        if (duration) setTimeout(() => el.classList.add('hidden'), duration);
    }

    // Send
    const btnSend = document.getElementById('btn-send-feedback');
    const btnLabel = document.getElementById('feedback-btn-label');

    btnSend.onclick = async () => {
        const text = feedbackText.value.trim();
        const type = document.querySelector('.feedback-type-btn.active')?.dataset.type || 'bug';

        if (!text) {
            showFeedbackStatus('error', '⚠ Please write something before sending.');
            return;
        }

        btnSend.disabled = true;
        btnLabel.innerText = 'Uploading…';

        // Upload images to imgbb (free, no account needed for base64 upload)
        // Using imgbb free API — images hosted publicly, URL sent in email
        const IMGBB_API_KEY = '8375c3f0dbbd9db6963c67df6de076b2';
        let imageLinks = [];

        for (const f of feedbackFiles) {
            if (f.type.startsWith('video/')) {
                // imgbb doesn't support video — note it clearly in the email
                imageLinks.push(`📹 Video: ${f.name} (${Math.round(f.base64.length * 0.75 / 1024)}KB) — please reply to this email and we'll follow up for the video`);
                continue;
            }
            try {
                btnLabel.innerText = `Uploading ${imageLinks.length + 1}/${feedbackFiles.length}…`;
                const base64Data = f.base64.split(',')[1];
                const formData = new FormData();
                formData.append('key', IMGBB_API_KEY);
                formData.append('image', base64Data);
                formData.append('name', f.name);

                const res  = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.success) {
                    imageLinks.push(`🖼 ${f.name}: ${data.data.url}`);
                } else {
                    imageLinks.push(`🖼 ${f.name}: (upload failed)`);
                }
            } catch(e) {
                imageLinks.push(`🖼 ${f.name}: (upload error — ${e.message})`);
            }
        }

        btnLabel.innerText = 'Sending…';

        const userEmail = document.getElementById('feedback-email').value.trim();

        const templateParams = {
            feedback_type: type === 'bug' ? '🐛 Bug Report' : '💡 Suggestion',
            feedback_text: text,
            attachments:   imageLinks.length > 0 ? imageLinks.join('\n') : 'None',
            app_version:   '2.0.0',
            sent_at:       new Date().toLocaleString(),
            user_email:    userEmail || 'Not provided',
            reply_to:      userEmail || 'dravidwright00@gmail.com',
        };

        try {
            await sendViaEmailJS(templateParams);
            feedbackText.value = '';
            feedbackChar.innerText = `0 / ${MAX_CHARS}`;
            document.getElementById('feedback-email').value = '';
            feedbackFiles = [];
            renderFeedbackFiles();
            showFeedbackStatus('success', '✓ Sent! Thanks for the feedback.');
        } catch(err) {
            console.error('EmailJS error:', err);
            showFeedbackStatus('error', `✗ Failed to send: ${err.message}`);
        } finally {
            btnSend.disabled = false;
            btnLabel.innerText = 'Send Feedback';
        }
    };
}

function setupDropZone(zoneId, type) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        for (const item of Array.from(e.dataTransfer.items || [])) {
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file && file.path) await addFolderByType(type, file.path);
            }
        }
    });
}

// ===================== OMDB =====================
async function fetchOmdbMetadata(apiKey) {
    const videos     = state.allMedia.videos;
    const omdbStatus = document.getElementById('omdb-status');

    if (videos.length === 0) {
        omdbStatus.className = 'omdb-status error';
        omdbStatus.innerText = '⚠ No movies in library to fetch metadata for.';
        setTimeout(() => omdbStatus.classList.add('hidden'), 3000);
        return;
    }

    const progressWrap  = document.getElementById('omdb-progress');
    const progressFill  = document.getElementById('omdb-progress-fill');
    const progressLabel = document.getElementById('omdb-progress-label');
    const btnRefresh    = document.getElementById('btn-refresh-omdb');

    progressWrap.classList.remove('hidden');
    omdbStatus.classList.add('hidden');
    btnRefresh.disabled  = true;
    btnRefresh.innerText = '⟳ Fetching…';

    let done = 0, fetched = 0, failed = 0;

    for (const video of videos) {
        try {
            // 1st attempt: exact title match
            let res  = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(video.name)}&apikey=${apiKey}&type=movie`);
            let data = await res.json();

            // 2nd attempt: search and take the first result
            if (data.Response !== 'True') {
                res  = await fetch(`https://www.omdbapi.com/?s=${encodeURIComponent(video.name)}&apikey=${apiKey}&type=movie`);
                data = await res.json();
                if (data.Response === 'True' && data.Search && data.Search.length > 0) {
                    // Fetch full details for the top search result
                    const imdbId = data.Search[0].imdbID;
                    res  = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`);
                    data = await res.json();
                }
            }

            if (data.Response === 'True') {
                video.poster = data.Poster !== 'N/A' ? data.Poster : null;
                video.year   = data.Year       || '';
                video.genre  = data.Genre      || '';
                video.rating = data.imdbRating || '';
                video.plot   = data.Plot       || '';
                fetched++;
            } else { failed++; }
        } catch(e) { failed++; }

        done++;
        progressFill.style.width = Math.round((done / videos.length) * 100) + '%';
        progressLabel.innerText  = `Fetching metadata… ${done} / ${videos.length}`;
    }

    progressWrap.classList.add('hidden');
    progressFill.style.width = '0%';
    btnRefresh.disabled  = false;
    btnRefresh.innerText = '⟳ Refresh';

    omdbStatus.className = 'omdb-status success';
    omdbStatus.innerText = `✓ Done — ${fetched} matched, ${failed} not found.`;
    setTimeout(() => omdbStatus.classList.add('hidden'), 4000);

    saveMediaCache(); // persist posters/ratings so they survive app restarts
    if (state.currentView !== 'settings') render();
}