// ===================== GLOBAL APPLICATION STATE =====================
const state = {
    allMedia: { videos: [], audio: [] },
    currentView: 'home',
    searchQuery: '',
    movieFolders: [],
    musicFolders: [],
    omdbKey: '',
    accentColor: '#63b3ff',
    bgStyle: 'default',
    bgColor: '#0a0d14',
    bgImagePath: '',

    // Theme FX (Snow / Autumn / Flames packs)
    fxEffect: 'none',
    fxIntensity: 'medium',
    unlockedEffects: [], // e.g. ['winter', 'autumn'] once purchased via Store IAP
    
    // Core Media Playlist Control States
    currentPlaylist: [],
    currentTrackIndex: 0,
    activeTrackItem: null,

    // FIX: Track the currently playing video item so ontimeupdate can reference it
    currentVideoItem: null
};

// ===================== UI ELEMENT REFERENCES =====================
const mediaGrid     = document.getElementById('media-grid');
const viewTitle     = document.getElementById('view-title');
const playerOverlay = document.getElementById('player-overlay');
const musicPopup    = document.getElementById('music-popup');
const videoElement  = document.getElementById('video-element');
const audioElement  = document.getElementById('audio-element');
const searchInput   = document.getElementById('search-input');
const settingsView  = document.getElementById('settings-view');
const contentArea   = document.querySelector('.content');

// ===================== APPLICATION INITIALIZATION =====================

// Expose debug vars to window so DevTools console tests can inspect them
Object.defineProperties(window, {
    _resumeWriteCache:  { get: () => _resumeWriteCache },
    _resumeWriteTimer:  { get: () => _resumeWriteTimer },
    _resumeSaveEnabled: { get: () => _resumeSaveEnabled },
});

// Prevent Electron from navigating the whole window if a file is
// accidentally dropped outside a designated drop zone.
document.addEventListener('dragover',  e => e.preventDefault());
document.addEventListener('drop',      e => e.preventDefault());

document.addEventListener('DOMContentLoaded', async () => {
    if (window.NovaFX) {
        NovaFX.mount(document.getElementById('fx-canvas'));
    }
    await loadSettings();
    verifyOwnedEffectsFromStore();
    setupEventListeners();
    setupSettingsListeners();
    if (state.movieFolders.length || state.musicFolders.length) {
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
            
            // AUTOMATION: Handle music pop-up visual display states
            if (state.currentView !== 'music') {
                musicPopup.classList.add('hidden');
                if (audioElement && !audioElement.paused && state.activeTrackItem) {
                    triggerPipMode();
                }
            } else {
                if (audioElement && audioElement.src !== '') {
                    musicPopup.classList.remove('hidden');
                }
            }
            render();
        };
    });

    // AUTOMATION: Handle main window minimization state syncing
    if (window.electronAPI && window.electronAPI.onMainWindowMinimized) {
        window.electronAPI.onMainWindowMinimized(() => {
            if (audioElement && !audioElement.paused && state.activeTrackItem) {
                musicPopup.classList.add('hidden');
                triggerPipMode();
            }
        });
    }

    // AUTOMATION: Clear PiP container display when expansion is handled
    if (window.electronAPI && window.electronAPI.onPipExpanded) {
        window.electronAPI.onPipExpanded(() => {
            if (state.currentView === 'music' && audioElement && audioElement.src !== '') {
                musicPopup.classList.remove('hidden');
                // Re-sync volume slider to actual audio volume on expand
                const musicVolume = document.getElementById('music-volume');
                if (musicVolume) musicVolume.value = audioElement.volume;
            } else {
                musicPopup.classList.add('hidden');
            }
            render();
        });
    }

    searchInput.oninput = e => {
        state.searchQuery = e.target.value.toLowerCase();
        render();
    };

    document.querySelector('.close-player').onclick = closePlayer;
    document.getElementById('btn-close-music').onclick = closeMusicPlayer;
    document.getElementById('btn-music-restore').onclick = () => {
        if (state.activeTrackItem) {
            triggerPipMode();
            musicPopup.classList.add('hidden');
            window.electronAPI.minimize();
        }
    };

    // Handles layout instructions moving up from the floating PiP window frame
    window.electronAPI.onPipCmd(cmd => {
        const activePlayer = (videoElement && !videoElement.paused) ? videoElement : audioElement;
        if (!activePlayer) return;

        if (typeof cmd === 'string') {
            switch (cmd) {
                case 'playpause':
                    activePlayer.paused ? activePlayer.play().catch(e => console.error(e)) : activePlayer.pause();
                    break;
                case 'prev': {
                    const prevIdx = state.currentTrackIndex - 1;
                    const prevItem = state.currentPlaylist[prevIdx];
                    if (prevIdx >= 0 && prevItem) { 
                        state.currentTrackIndex = prevIdx; 
                        playMedia(prevItem); 
                    }
                    break;
                }
                case 'next': {
                    const nextIdx = state.currentTrackIndex + 1;
                    const nextItem = state.currentPlaylist[nextIdx];
                    if (nextItem) { 
                        state.currentTrackIndex = nextIdx; 
                        playMedia(nextItem); 
                    }
                    break;
                }
            }
        } else if (cmd && typeof cmd === 'object') {
            switch (cmd.action) {
                case 'volume':
                    activePlayer.volume = Math.max(0, Math.min(1, cmd.value / 100));
                    // Sync the corresponding slider UI so it matches when returning to NovaPlus
                    const volEl = activePlayer === audioElement
                        ? document.getElementById('music-volume')
                        : document.getElementById('volume-slider');
                    if (volEl) volEl.value = activePlayer.volume;
                    break;
                case 'seek':
                    if (activePlayer.duration) {
                        activePlayer.currentTime = cmd.value * activePlayer.duration;
                    }
                    break;
            }
        }
    });

    window.electronAPI.onPipClosed(() => { state.pipActive = false; });

    // ---- Custom video controls ----
    const video        = videoElement;
    const progressWrap = document.getElementById('video-progress');
    const progressFill = document.getElementById('video-progress-fill');
    const timeCurrent  = document.getElementById('video-time-current');
    const timeDuration = document.getElementById('video-time-duration');
    const titleLabel   = document.getElementById('video-title-label');
    const btnPlayPause = document.getElementById('btn-play-pause');
    const btnMute      = document.getElementById('btn-mute');
    const volSlider    = document.getElementById('volume-slider');
    const btnFs        = document.getElementById('btn-fullscreen');

    btnPlayPause.onclick = () => video.paused ? video.play() : video.pause();
    video.addEventListener('play',  () => { const ic = document.getElementById('icon-playpause'); if (ic) ic.innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'; });
    video.addEventListener('pause', () => { const ic = document.getElementById('icon-playpause'); if (ic) ic.innerHTML = '<path d="M8 5v14l11-7z"/>'; });

    document.addEventListener('keydown', e => {
        if (playerOverlay.classList.contains('hidden')) return;
        switch(e.key) {
            case 'ArrowRight':
                e.preventDefault();
                debouncedSeek(() => Math.min(video.duration || 0, video.currentTime + 10));
                showSkipIndicator('+10s');
                break;
            case 'ArrowLeft':
                e.preventDefault();
                debouncedSeek(() => Math.max(0, video.currentTime - 10));
                showSkipIndicator('-10s');
                break;
            case 'ArrowUp':
                e.preventDefault();
                video.volume = Math.min(1, video.volume + 0.1);
                volSlider.value = video.volume;
                break;
            case 'ArrowDown':
                e.preventDefault();
                video.volume = Math.max(0, video.volume - 0.1);
                volSlider.value = video.volume;
                break;
            case ' ':
                e.preventDefault();
                video.paused ? video.play() : video.pause();
                break;
            case 'f':
            case 'F':
                e.preventDefault();
                if (document.fullscreenElement) document.exitFullscreen();
                else playerOverlay.requestFullscreen();
                break;
            case 'm':
            case 'M':
                e.preventDefault();
                video.muted = !video.muted;
                { const ic = document.getElementById('icon-mute'); if(ic) ic.innerHTML = video.muted ? '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17.73 19 1 1 0 0 0 19 17.73L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>' : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>'; }
                break;
        }
    });

    // Use a proper module-level variable for the skip timer — storing timers
    // on DOM nodes (.ind._timer) is unreliable and survives closePlayer(),
    // causing throws on detached elements that corrupt the renderer state.
    let _skipTimer = null;
    function showSkipIndicator(text) {
        let ind = document.getElementById('skip-indicator');
        if (!ind) {
            ind = document.createElement('div');
            ind.id = 'skip-indicator';
            ind.className = 'skip-indicator';
            playerOverlay.appendChild(ind);
        }
        ind.innerText = text;
        ind.classList.add('visible');
        clearTimeout(_skipTimer);
        _skipTimer = setTimeout(() => {
            const el = document.getElementById('skip-indicator');
            if (el) el.classList.remove('visible');
            _skipTimer = null;
        }, 800);
    }
    // Expose so closePlayer() can clear it
    playerOverlay._clearSkipTimer = () => {
        clearTimeout(_skipTimer);
        _skipTimer = null;
        const el = document.getElementById('skip-indicator');
        if (el) el.classList.remove('visible');
    };

    // Debounce skip buttons — rapid clicks stack decoder seek operations and
    // cause the renderer to back up. Settle on final position after 200ms.
    let _seekDebounce = null;
    let _pendingSeekTime = null;
    function debouncedSeek(getTime) {
        _pendingSeekTime = getTime();
        clearTimeout(_seekDebounce);
        _seekDebounce = setTimeout(() => {
            if (_pendingSeekTime !== null) {
                video.currentTime = _pendingSeekTime;
                _pendingSeekTime = null;
            }
            _seekDebounce = null;
        }, 200);
    }
    playerOverlay._clearSeekDebounce = () => {
        clearTimeout(_seekDebounce);
        _seekDebounce = null;
        _pendingSeekTime = null;
    };

    document.getElementById('btn-backward').onclick = () => {
        const t = Math.max(0, (video.currentTime || 0) - 10);
        debouncedSeek(() => t);
        showSkipIndicator('-10s');
    };
    document.getElementById('btn-forward').onclick = () => {
        const t = Math.min(video.duration || 0, (video.currentTime || 0) + 10);
        debouncedSeek(() => t);
        showSkipIndicator('+10s');
    };

    // ontimeupdate is installed fresh by closePlayer() after each pipeline reset
    // and by playMedia() on first play — keeping it out of here prevents duplicates.

    progressWrap.onclick = e => {
        const rect = progressWrap.getBoundingClientRect();
        video.currentTime = ((e.clientX - rect.left) / rect.width) * video.duration;
    };

    btnMute.onclick = () => {
        video.muted = !video.muted;
        const ic = document.getElementById('icon-mute');
        if (ic) ic.innerHTML = video.muted
            ? '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 17.73 19 1 1 0 0 0 19 17.73L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>'
            : '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
    };
    volSlider.oninput = e => { video.volume = e.target.value; };

    btnFs.onclick = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else playerOverlay.requestFullscreen();
    };

    // New WMP-style buttons — shuffle/repeat are cosmetic for video,
    // prev/next navigate the video playlist if one exists
    const btnShuffle  = document.getElementById('btn-shuffle');
    const btnRepeat   = document.getElementById('btn-repeat');
    const btnPrevTrack = document.getElementById('btn-prev-track');
    const btnNextTrack = document.getElementById('btn-next-track');
    if (btnShuffle)   btnShuffle.onclick  = () => btnShuffle.classList.toggle('ctrl-btn-active');
    if (btnRepeat)    btnRepeat.onclick   = () => { video.loop = !video.loop; btnRepeat.classList.toggle('ctrl-btn-active'); };
    if (btnPrevTrack) btnPrevTrack.onclick = () => {
        const prev = state.currentPlaylist[state.currentTrackIndex - 1];
        if (prev) { state.currentTrackIndex--; playMedia(prev); }
    };
    if (btnNextTrack) btnNextTrack.onclick = () => {
        const next = state.currentPlaylist[state.currentTrackIndex + 1];
        if (next) { state.currentTrackIndex++; playMedia(next); }
    };

    // FIX: Declare hideTimer at this scope so closePlayer() can clear it
    let hideTimer;
    playerOverlay._clearHideTimer = () => clearTimeout(hideTimer);

    playerOverlay.onmousemove = () => {
        document.getElementById('video-controls').style.opacity = '1';
        // FIX: Also restore the cursor on mouse move inside the player
        playerOverlay.style.cursor = '';
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!video.paused) {
                document.getElementById('video-controls').style.opacity = '0';
                // FIX: Hide cursor when controls auto-hide during playback
                playerOverlay.style.cursor = 'none';
            }
        }, 2500);
    };

    // ---- Custom music controls ----
    const musicProgress     = document.getElementById('music-progress');
    const musicProgressFill = document.getElementById('music-progress-fill');
    const musicCurrent      = document.getElementById('music-current');
    const musicDuration     = document.getElementById('music-duration');
    const musicBtnPlay      = document.getElementById('music-btn-play');
    const musicBtnPrev      = document.getElementById('music-btn-prev');
    const musicBtnNext      = document.getElementById('music-btn-next');
    const musicVolume       = document.getElementById('music-volume');

    musicBtnPlay.onclick = () => audioElement.paused ? audioElement.play() : audioElement.pause();
    audioElement.addEventListener('play',  () => { const btn = document.getElementById('music-btn-play'); if (btn) btn.textContent = '⏸'; });
    audioElement.addEventListener('pause', () => { const btn = document.getElementById('music-btn-play'); if (btn) btn.textContent = '▶'; });

    musicBtnPrev.onclick = () => {
        const prevIdx = state.currentTrackIndex - 1;
        if (prevIdx >= 0) {
            state.currentTrackIndex = prevIdx;
            playMedia(state.currentPlaylist[prevIdx]);
        }
    };
    musicBtnNext.onclick = () => {
        const nextIdx = state.currentTrackIndex + 1;
        if (nextIdx < state.currentPlaylist.length) {
            state.currentTrackIndex = nextIdx;
            playMedia(state.currentPlaylist[nextIdx]);
        }
    };

    // Throttle the IPC pipTime call — sending an IPC message 4x/sec over a
    // long session floods the main process queue and contributes to freezing.
    let _pipTimeThrottle = null;
    audioElement.ontimeupdate = () => {
        if (!audioElement.duration) return;
        const pct = (audioElement.currentTime / audioElement.duration) * 100;
        musicProgressFill.style.width = pct + '%';
        musicCurrent.innerText  = fmtTime(audioElement.currentTime);
        musicDuration.innerText = fmtTime(audioElement.duration);

        if (window.electronAPI && window.electronAPI.pipTime && !_pipTimeThrottle) {
            _pipTimeThrottle = setTimeout(() => { _pipTimeThrottle = null; }, 1000);
            window.electronAPI.pipTime({
                current:  audioElement.currentTime,
                duration: audioElement.duration,
            });
        }
    };

    musicProgress.onclick = e => {
        const rect = musicProgress.getBoundingClientRect();
        audioElement.currentTime = ((e.clientX - rect.left) / rect.width) * audioElement.duration;
    };

    musicVolume.oninput = e => { audioElement.volume = e.target.value; };

    if (videoElement && audioElement) {
        [videoElement, audioElement].forEach(player => {
            player.addEventListener('play', () => {
                if (window.electronAPI && window.electronAPI.pipState) window.electronAPI.pipState(true);
            });
            player.addEventListener('pause', () => {
                if (window.electronAPI && window.electronAPI.pipState) window.electronAPI.pipState(false);
            });
        });
    }
}

function triggerPipMode() {
    if (!state.activeTrackItem) return;
    state.pipActive = true;
    window.electronAPI.pipOpen({
        title:  state.activeTrackItem.name || state.activeTrackItem.title || 'Unknown Track',
        artist: state.activeTrackItem.artist || 'Unknown Artist',
        poster: state.activeTrackItem.poster || null,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        volume: audioElement ? audioElement.volume : 1,
    });
}

function updatePipTrack() {
    if (!state.activeTrackItem || !state.pipActive) return;
    window.electronAPI.pipOpen({
        title:  state.activeTrackItem.name || state.activeTrackItem.title || 'Unknown Track',
        artist: state.activeTrackItem.artist || 'Unknown Artist',
        poster: state.activeTrackItem.poster || null,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        volume: audioElement ? audioElement.volume : 1,
    });
}

// ===================== RENDER LAYOUT HANDLERS =====================
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

    // currentPlaylist is now set on card click based on item type — do not overwrite here

    items.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'card';

        const artContent = item.poster
            ? `<img src="${item.poster}" alt="${item.name}" class="card-poster">`
            : `<span class="card-emoji">${item.type === 'video' ? '🎬' : '🎵'}</span>`;

        const meta = item.type === 'video'
            ? ([item.year, item.genre ? item.genre.split(',')[0] : ''].filter(Boolean).join(' · ') || 'Video File')
            : (item.artist || 'Unknown Artist');

        const ratingBadge = item.rating ? `<div class="card-rating">⭐ ${item.rating}</div>` : '';

        const resumeTime = getResumeTime(item.path);
        const resumeBadge = resumeTime > 0
            ? `<div class="card-resume">▶ ${fmtTime(resumeTime)}</div>`
            : '';

        card.innerHTML = `
            <div class="card-art">${artContent}${ratingBadge}${resumeBadge}</div>
            <div class="card-info">
                <h3>${item.name}</h3>
                <p>${meta}</p>
            </div>`;

        card.onclick = () => {
            // Build playlist from same type as clicked item so prev/next works for both video and audio
            const sameType = items.filter(i => i.type === item.type);
            state.currentPlaylist = sameType;
            state.currentTrackIndex = sameType.indexOf(item);
            playMedia(item);
        };
        mediaGrid.appendChild(card);
    });
}

// ===================== CORE PLAYER ARCHITECTURE =====================
function playMedia(item, fromPlaylist = false) {
    const mediaUrl = window.electronAPI.toMediaUrl(item.path);

    if (item.type === 'video') {
        state.currentVideoItem = item;

        musicPopup.classList.add('hidden');
        playerOverlay.classList.remove('hidden');

        // Install ontimeupdate fresh each time playMedia runs for video.
        // closePlayer() nulls it out as part of pipeline teardown, so we
        // must re-register it here to ensure it's always present during playback.
        const progressFill  = document.getElementById('video-progress-fill');
        const timeCurrent   = document.getElementById('video-time-current');
        const timeDuration  = document.getElementById('video-time-duration');
        const titleLabelEl  = document.getElementById('video-title-label');
        if (titleLabelEl) titleLabelEl.textContent = item.name || '';
        videoElement.ontimeupdate = () => {
            if (!videoElement.duration || !state.currentVideoItem) return;
            saveResumeTime(state.currentVideoItem.path, videoElement.currentTime);
            const pct = (videoElement.currentTime / videoElement.duration) * 100;
            progressFill.style.width = pct + '%';
            if (timeCurrent)  timeCurrent.textContent  = fmtTime(videoElement.currentTime);
            if (timeDuration) timeDuration.textContent = fmtTime(videoElement.duration);
        };

        videoElement.src = mediaUrl;

        const saved = getResumeTime(item.path);
        videoElement.onloadedmetadata = () => {
            if (saved && saved < videoElement.duration - 5) {
                videoElement.currentTime = saved;
            }
            videoElement.play();
        };

        videoElement.onended = () => {
            flushResumeTime();
            saveResumeTime(item.path, 0);
            render();
        };

    } else {
        state.activeTrackItem = item;
        playerOverlay.classList.add('hidden');
        
        if (state.currentView === 'music') {
            musicPopup.classList.remove('hidden');
        } else {
            musicPopup.classList.add('hidden');
            triggerPipMode();
        }

        // Update PiP title if already open
        updatePipTrack();

        document.getElementById('now-playing-title').innerText  = item.name;
        document.getElementById('now-playing-artist').innerText = item.artist || 'Unknown Artist';

        const artEl = document.getElementById('music-art');
        if (item.poster) {
            artEl.innerHTML = `<img src="${item.poster}" style="width:100%;height:100%;object-fit:cover;border-radius:20px;">`;
        } else {
            artEl.innerText = '🎵';
        }

        audioElement.pause();
        audioElement.currentTime = 0;
        audioElement.src = mediaUrl;

        const saved = getResumeTime(item.path);
        audioElement.onloadedmetadata = () => {
            if (saved && saved < audioElement.duration - 5) {
                audioElement.currentTime = saved;
            } else {
                audioElement.currentTime = 0;
            }
            audioElement.play().catch(e => console.error("Audio playback interrupted:", e));
        };

        audioElement.onplay  = () => {
            const btn = document.getElementById('music-btn-play'); if (btn) btn.textContent = '⏸';
            window.electronAPI.pipState(true);
        };
        audioElement.onpause = () => {
            const btn = document.getElementById('music-btn-play'); if (btn) btn.textContent = '▶';
            window.electronAPI.pipState(false);
        };
        audioElement.onended = () => {
            saveResumeTime(item.path, 0);
            
            const nextIdx = state.currentTrackIndex + 1;
            if (nextIdx < state.currentPlaylist.length) {
                state.currentTrackIndex = nextIdx;
                playMedia(state.currentPlaylist[nextIdx]);
            } else {
                musicPopup.classList.add('hidden');
                state.activeTrackItem = null;
                render();
            }
        };
    }
}

// ===================== POSITION TRACKING =====================
// Throttle state for saveResumeTime — localStorage writes are synchronous
// and block the renderer thread. We batch them to once every 5 seconds.
const _resumeWriteCache = {};
let   _resumeWriteTimer = null;

let _resumeSaveEnabled = true; // set false during teardown to block new writes

function saveResumeTime(filePath, time) {
    // Guard: don't accept new writes during player teardown
    if (!_resumeSaveEnabled) return;

    // Always update the in-memory cache immediately (cheap)
    _resumeWriteCache[filePath] = Math.floor(time);

    // Flush to localStorage at most once every 5 seconds
    if (_resumeWriteTimer) return;
    _resumeWriteTimer = setTimeout(() => {
        _resumeWriteTimer = null;
        if (!_resumeSaveEnabled) return; // double-check at fire time
        try {
            const key  = 'novaplus_resume';
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            Object.assign(data, _resumeWriteCache);
            localStorage.setItem(key, JSON.stringify(data));
        } catch(e) {}
    }, 5000);
}

function flushResumeTime() {
    // Call this on close/end to force-write any pending cached time immediately
    if (_resumeWriteTimer) {
        clearTimeout(_resumeWriteTimer);
        _resumeWriteTimer = null;
    }
    if (Object.keys(_resumeWriteCache).length === 0) return;
    try {
        const key  = 'novaplus_resume';
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        Object.assign(data, _resumeWriteCache);
        localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {}
}

function getResumeTime(filePath) {
    try {
        const data = JSON.parse(localStorage.getItem('novaplus_resume') || '{}');
        return data[filePath] || 0;
    } catch(e) { return 0; }
}

function closePlayer() {
    // If fullscreen is active, exit it first and defer the rest of teardown
    // until the browser confirms exit via fullscreenchange. Hiding the overlay
    // while fullscreen is still active forces an async GPU compositor reset
    // that blocks input events and causes a freeze on Electron/Windows.
    if (document.fullscreenElement) {
        document.exitFullscreen().finally(() => _doClosePlayer());
        return;
    }
    _doClosePlayer();
}

function _doClosePlayer() {
    // Step 0: Block any new saveResumeTime calls immediately — ontimeupdate
    // can still fire during pipeline teardown (load() below), and we don't
    // want it restarting the write timer after we've flushed and cleared it.
    _resumeSaveEnabled = false;

    // Step 0b: Flush whatever's pending to localStorage, then clear the timer.
    flushResumeTime();

    // Step 1: Null out ALL handlers BEFORE touching src/load so none of them
    // fire during the pipeline teardown sequence below.
    videoElement.onloadedmetadata = null;
    videoElement.onended          = null;
    videoElement.ontimeupdate     = null;
    videoElement.onplay           = null;
    videoElement.onpause          = null;
    videoElement.onerror          = null;
    state.currentVideoItem        = null;

    // Step 2: Abort the media pipeline without triggering a GPU stall.
    // load() on hardware-accelerated video causes the GPU process to block
    // input events on Windows. Instead we replace the src with a tiny
    // blank video data URI which forces the decoder to switch contexts
    // gracefully without stalling the GPU compositor.
    videoElement.pause();
    videoElement.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhtZGF0AAAA';
    setTimeout(() => {
        videoElement.removeAttribute('src');
        try { videoElement.load(); } catch(e) {}
    }, 100);

    // Step 3: Hide the overlay and restore cursor/controls state.
    playerOverlay.classList.add('hidden');
    if (playerOverlay._clearHideTimer)    playerOverlay._clearHideTimer();
    if (playerOverlay._clearSkipTimer)    playerOverlay._clearSkipTimer();
    if (playerOverlay._clearSeekDebounce) playerOverlay._clearSeekDebounce();
    playerOverlay.style.cursor = '';
    document.getElementById('video-controls').style.opacity = '1';
    document.getElementById('video-progress-fill').style.width = '0%';
    const tc = document.getElementById('video-time-current');   if (tc) tc.textContent = '0:00';
    const td = document.getElementById('video-time-duration');  if (td) td.textContent = '0:00';
    const tl = document.getElementById('video-title-label');    if (tl) tl.textContent = '';

    // Re-enable resume saves so the next video can track its position
    _resumeSaveEnabled = true;

    render();
}

function closeMusicPlayer() {
    // Null handlers first, then abort the pipeline properly (same reason as closePlayer).
    audioElement.ontimeupdate = null;
    audioElement.onplay       = null;
    audioElement.onpause      = null;
    audioElement.onended      = null;
    audioElement.onloadedmetadata = null;

    audioElement.pause();
    audioElement.removeAttribute('src');
    audioElement.load();

    musicPopup.classList.add('hidden');
    state.activeTrackItem = null;
    document.getElementById('music-progress-fill').style.width = '0%';
    document.getElementById('music-current').innerText  = '0:00';
    document.getElementById('music-duration').innerText = '0:00';
    render();
}

function fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec}`;
    return `${m}:${sec}`;
}

// ===================== SETTINGS & CONFIGURATION CONFIGS =====================
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
            state.bgColor      = p.bgColor      || '#0a0d14';
            state.bgImagePath  = p.bgImagePath  || '';
            state.fxEffect        = p.fxEffect        || 'none';
            state.fxIntensity      = p.fxIntensity      || 'medium';
            state.unlockedEffects  = p.unlockedEffects  || [];
        }
    } catch(e) {}

    try {
        const mediaRaw = localStorage.getItem('novaplus_media');
        if (mediaRaw) {
            state.allMedia = JSON.parse(mediaRaw);
        }
    } catch(e) {}

    applyAccent(state.accentColor);
    applyBg(state.bgStyle);

    // Restore custom bg UI state
    const colorPicker = document.getElementById('bg-color-picker');
    if (colorPicker && state.bgColor) colorPicker.value = state.bgColor;
    if (state.bgImagePath) {
        const nameEl = document.getElementById('bg-image-name');
        const clearBtn = document.getElementById('btn-clear-bg-image');
        if (nameEl) nameEl.textContent = state.bgImagePath.split(/[\\/]/).pop();
        if (clearBtn) clearBtn.style.display = '';
    }

    const omdbInput = document.getElementById('omdb-api-key');
    if (omdbInput && state.omdbKey) omdbInput.value = state.omdbKey;

    renderEffectLockState();
    applyEffect(state.fxEffect);
    const intensitySlider = document.getElementById('effect-intensity');
    if (intensitySlider) {
        intensitySlider.value = FX_INTENSITY_STEPS.indexOf(state.fxIntensity) >= 0
            ? FX_INTENSITY_STEPS.indexOf(state.fxIntensity) : 1;
    }
}

function saveSettings() {
    localStorage.setItem('novaplus_v2', JSON.stringify({
        movieFolders: state.movieFolders,
        musicFolders: state.musicFolders,
        omdbKey:      state.omdbKey,
        accentColor:  state.accentColor,
        bgStyle:      state.bgStyle,
        bgColor:      state.bgColor      || '#0a0d14',
        bgImagePath:  state.bgImagePath  || '',
        fxEffect:        state.fxEffect        || 'none',
        fxIntensity:     state.fxIntensity     || 'medium',
        unlockedEffects: state.unlockedEffects || [],
    }));
}

// Maps the 3-step intensity slider (0/1/2) to NovaFX's named levels
const FX_INTENSITY_STEPS = ['low', 'medium', 'high'];

function applyEffect(effect) {
    // 'none' is always available; the rest are unlocked together via the bundle
    const isUnlocked = effect === 'none' || state.unlockedEffects.includes(effect);
    if (!isUnlocked) {
        promptSeasonsBundlePurchase();
        return;
    }
    state.fxEffect = effect;
    if (window.NovaFX) {
        NovaFX.setEffect(effect, { intensity: state.fxIntensity });
    }
    document.querySelectorAll('.effect-option').forEach(o =>
        o.classList.toggle('active', o.dataset.effect === effect));
    saveSettings();
}

function applyEffectIntensity(intensity) {
    state.fxIntensity = intensity;
    if (window.NovaFX) NovaFX.setIntensity(intensity);
    saveSettings();
}

// Real Microsoft Store purchase flow for the "Four Seasons Pack" add-on.
// Calls through preload -> main process -> Windows.Services.Store (see main.js).
// Only functions when running as the installed .appx; in unpackaged dev
// mode (npm start) this will report unavailable and just log, so local
// testing never fails hard.
async function promptSeasonsBundlePurchase() {
    if (!window.electronAPI || typeof window.electronAPI.purchaseSeasonsBundle !== 'function') {
        console.warn('[NovaFX] Store purchase API unavailable in this build (are you running the packaged .appx?).');
        return;
    }
    const bundleBtn = document.getElementById('btn-buy-seasons-bundle');
    if (bundleBtn) { bundleBtn.disabled = true; bundleBtn.textContent = 'Processing…'; }

    let result;
    try {
        result = await window.electronAPI.purchaseSeasonsBundle();
    } catch (e) {
        console.error('[NovaFX] Purchase call failed:', e);
        result = { success: false };
    }

    if (result && result.success) {
        state.unlockedEffects = ['winter', 'spring', 'summer', 'autumn'];
        saveSettings();
        renderEffectLockState();
    } else {
        console.log('[NovaFX] Purchase not completed:', result);
        if (bundleBtn) { bundleBtn.disabled = false; bundleBtn.textContent = 'Unlock all — $2.99'; }
    }
}

// Re-checks ownership against the real Store license on startup, so a
// user editing localStorage by hand can't fake an unlock — the Store's
// answer always wins over whatever's cached locally.
async function verifyOwnedEffectsFromStore() {
    if (!window.electronAPI || typeof window.electronAPI.checkSeasonsBundleOwned !== 'function') return;
    try {
        const result = await window.electronAPI.checkSeasonsBundleOwned();
        if (result && result.available) {
            state.unlockedEffects = result.owned ? ['winter', 'spring', 'summer', 'autumn'] : [];
            saveSettings();
            renderEffectLockState();
        }
    } catch (e) {
        console.error('[NovaFX] Store license check failed:', e);
    }
}

function renderEffectLockState() {
    document.querySelectorAll('.effect-option[data-effect]').forEach(o => {
        const effect = o.dataset.effect;
        const owned = effect === 'none' || state.unlockedEffects.includes(effect);
        o.classList.toggle('locked', !owned);
    });
    const bundleBtn = document.getElementById('btn-buy-seasons-bundle');
    if (bundleBtn) {
        const allOwned = ['winter', 'spring', 'summer', 'autumn']
            .every(e => state.unlockedEffects.includes(e));
        bundleBtn.textContent = allOwned ? 'Owned' : 'Unlock all — $2.99';
        bundleBtn.disabled = allOwned;
    }
}

function applyAccent(color) {
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-glow', color + '44');
    state.accentColor = color;
    document.querySelectorAll('.colour-swatch').forEach(s =>
        s.classList.toggle('active', s.dataset.color === color));
}

function applyBg(style) {
    document.body.className = document.body.className.replace(/\bbg-\S+/g, '').trim();
    if (style === 'solid-color') {
        document.body.classList.add('bg-solid-color');
        document.body.style.backgroundColor = state.bgColor || '#0a0d14';
    } else if (style === 'custom-image') {
        document.body.classList.add('bg-custom-image');
        document.body.style.backgroundColor = '';
        // Apply image via the ::before pseudo-element using a CSS variable
        if (state.bgImagePath) {
            document.documentElement.style.setProperty(
                '--custom-bg-image',
                `url("nova-media://${state.bgImagePath.replace(/\\/g, '/')}")`
            );
        }
    } else {
        document.body.style.backgroundColor = '';
        if (style !== 'default') document.body.classList.add('bg-' + style);
    }
    state.bgStyle = style;
    document.querySelectorAll('.wallpaper-option').forEach(o =>
        o.classList.toggle('active', o.dataset.bg === style));
}

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
    for (const v of combined.videos) {
        if (omdbCache[v.path]) Object.assign(v, omdbCache[v.path]);
    }
    state.allMedia = combined;
    saveMediaCache(); 
    if (state.currentView !== 'settings') render();
    else viewTitle.innerText = 'Settings';
}

function saveMediaCache() {
    try {
        localStorage.setItem('novaplus_media', JSON.stringify(state.allMedia));
    } catch(e) {
        localStorage.removeItem('novaplus_media');
        try { localStorage.setItem('novaplus_media', JSON.stringify(state.allMedia)); } catch(e2) {}
    }
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

    const btnSaveOmdb = document.getElementById('btn-save-omdb');
    if (btnSaveOmdb) {
        btnSaveOmdb.onclick = () => {
            const omdbStatus = document.getElementById('omdb-status');
            const val = document.getElementById('omdb-api-key').value.trim();
            state.omdbKey = val;
            saveSettings();
            if (omdbStatus) {
                omdbStatus.className = 'omdb-status ' + (val ? 'success' : 'error');
                omdbStatus.innerText  = val ? '✓ API key saved!' : '⚠ Key is empty.';
                setTimeout(() => omdbStatus.classList.add('hidden'), 3000);
            }
        };
    }

    const btnRefresh = document.getElementById('btn-refresh-omdb');

    if (btnRefresh) {
        btnRefresh.onclick = async () => {
            // Re-query these each click so they're always fresh from the live DOM
            const progressWrap  = document.getElementById('omdb-progress-wrap');
            const progressFill  = document.getElementById('omdb-progress-fill');
            const progressLabel = document.getElementById('omdb-progress-label');
            const statusEl      = document.getElementById('omdb-status');

            const key = document.getElementById('omdb-api-key').value.trim() || state.omdbKey;
            if (!key) {
                if (statusEl) {
                    statusEl.className = 'omdb-status error';
                    statusEl.innerText = '⚠ Enter and save an API key first.';
                    setTimeout(() => statusEl.classList.add('hidden'), 3000);
                }
                return;
            }
            state.omdbKey = key;
            saveSettings();

            if (progressWrap) progressWrap.classList.remove('hidden');
            btnRefresh.disabled  = true;
            btnRefresh.innerText = 'Syncing…';

            await fetchOmdbMetadata(key, progressFill, progressLabel, progressWrap, btnRefresh, statusEl);
        };
    }

    document.querySelectorAll('.colour-swatch').forEach(s => {
        s.onclick = () => { applyAccent(s.dataset.color); saveSettings(); };
    });
    document.querySelectorAll('.wallpaper-option').forEach(o => {
        o.onclick = () => { applyBg(o.dataset.bg); saveSettings(); };
    });

    document.querySelectorAll('.effect-option[data-effect]').forEach(o => {
        o.onclick = () => applyEffect(o.dataset.effect);
    });
    const bundleBtn = document.getElementById('btn-buy-seasons-bundle');
    if (bundleBtn) {
        bundleBtn.onclick = () => promptSeasonsBundlePurchase();
    }
    const intensitySlider = document.getElementById('effect-intensity');
    if (intensitySlider) {
        intensitySlider.oninput = () => {
            applyEffectIntensity(FX_INTENSITY_STEPS[+intensitySlider.value]);
        };
    }

    // Solid colour background
    const bgColorPicker = document.getElementById('bg-color-picker');
    document.getElementById('btn-apply-solid-bg').onclick = () => {
        state.bgColor = bgColorPicker.value;
        applyBg('solid-color');
        saveSettings();
    };
    document.getElementById('btn-clear-solid-bg').onclick = () => {
        applyBg('default');
        saveSettings();
    };

    // Custom image background
    document.getElementById('btn-pick-bg-image').onclick = async () => {
        const filePath = await window.electronAPI.selectFile([
            { name: 'Images', extensions: ['jpg','jpeg','png','webp','gif'] }
        ]);
        if (!filePath) return;
        state.bgImagePath = filePath;
        applyBg('custom-image');
        saveSettings();
        const name = filePath.split(/[\\/]/).pop();
        document.getElementById('bg-image-name').textContent = name;
        document.getElementById('btn-clear-bg-image').style.display = '';
    };
    document.getElementById('btn-clear-bg-image').onclick = () => {
        state.bgImagePath = '';
        applyBg('default');
        saveSettings();
        document.getElementById('bg-image-name').textContent = 'No image selected';
        document.getElementById('btn-clear-bg-image').style.display = 'none';
    };

    const EMAILJS_SERVICE_ID  = 'service_hc8ryvu';
    const EMAILJS_TEMPLATE_ID = 'template_yd4x8x6';
    const EMAILJS_PUBLIC_KEY  = 'mBKibk4UMN4KKrF2f';

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
        if (!res.ok) throw new Error(`EmailJS error ${res.status}`);
        return res;
    }

    let feedbackFiles = [];
    document.querySelectorAll('.feedback-type-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.feedback-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('feedback-text').placeholder =
                btn.dataset.type === 'bug' ? 'Describe the bug…' : 'Share your idea…';
        };
    });

    const feedbackText = document.getElementById('feedback-text');
    const feedbackChar = document.getElementById('feedback-char');
    feedbackText.oninput = () => {
        if (feedbackText.value.length > 500) feedbackText.value = feedbackText.value.slice(0, 500);
        feedbackChar.innerText = `${feedbackText.value.length} / 500`;
    };

    const fileInput = document.getElementById('feedback-files');
    document.getElementById('feedback-upload-trigger').onclick = () => fileInput.click();
    fileInput.onchange = e => handleFeedbackFiles(Array.from(e.target.files));

    function handleFeedbackFiles(files) {
        files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/')).slice(0, 3 - feedbackFiles.length).forEach(file => {
            const reader = new FileReader();
            reader.onload = e => {
                feedbackFiles.push({ name: file.name, base64: e.target.result, type: file.type });
                renderFeedbackFiles();
            };
            reader.readAsDataURL(file);
        });
    }

    function renderFeedbackFiles() {
        const list = document.getElementById('feedback-file-list');
        list.innerHTML = '';
        feedbackFiles.forEach((f, i) => {
            const el = document.createElement('div');
            el.className = 'feedback-file-item';
            el.innerHTML = `<span>${f.name}</span><button class="feedback-file-remove">✕</button>`;
            el.querySelector('.feedback-file-remove').onclick = () => { feedbackFiles.splice(i, 1); renderFeedbackFiles(); };
            list.appendChild(el);
        });
    }

    const btnSend = document.getElementById('btn-send-feedback');
    btnSend.onclick = async () => {
        const text = feedbackText.value.trim();
        if (!text) return;
        btnSend.disabled = true;
        
        const templateParams = {
            feedback_type: 'NovaHub Tracker',
            feedback_text: text,
            attachments: 'None',
            app_version: '2.1.4',
            sent_at: new Date().toLocaleString(),
            user_email: document.getElementById('feedback-email').value.trim() || 'Not provided',
        };

        try {
            await sendViaEmailJS(templateParams);
            feedbackText.value = '';
            feedbackFiles = [];
            renderFeedbackFiles();
        } catch(err) { console.error(err); }
        finally { btnSend.disabled = false; }
    };
}

function setupDropZone(zoneId, type) {
    const zone = document.getElementById(zoneId);
    if (!zone) return;

    zone.addEventListener('dragover', e => {
        try { e.preventDefault(); zone.classList.add('drag-over'); }
        catch(err) { console.error('dragover error:', err); }
    });

    zone.addEventListener('dragleave', e => {
        try { zone.classList.remove('drag-over'); }
        catch(err) { console.error('dragleave error:', err); }
    });

    zone.addEventListener('drop', async e => {
        try {
            e.preventDefault();
            zone.classList.remove('drag-over');
            const items = Array.from(e.dataTransfer.items || []);
            for (const item of items) {
                if (item.kind !== 'file') continue;
                const file = item.getAsFile();
                if (!file) continue;
                // file.path works in older Electron; newer builds with
                // contextIsolation need webUtils.getPathForFile().
                // Try both so it works regardless of Electron version.
                let filePath = null;
                try {
                    if (window.electronAPI && typeof window.electronAPI.getPathForFile === 'function') {
                        filePath = window.electronAPI.getPathForFile(file);
                    }
                } catch(_) {}
                if (!filePath) filePath = file.path || null;
                if (filePath) await addFolderByType(type, filePath);
            }
        } catch(err) { console.error('drop error:', err); }
    });
}

// ===================== METADATA OMDB SYNC MODULE =====================

// Strips resolution tags, codec info, year suffixes, and file extension
// so OMDB can actually match filenames like "Inception.2010.1080p.BluRay.x264.mkv"
function cleanMovieName(filename) {
    let name = filename.replace(/\.[^.]+$/, ''); // remove extension
    name = name
        .replace(/[\._\s]*(19|20)\d{2}[\._\s].*/i, '')
        .replace(/[\._\s]*(4k|2160p|1080p|720p|480p|bluray|bdrip|brrip|webrip|web-dl|dvdrip|hdtv|xvid|x264|x265|hevc|aac|ac3|dts|hdrip|proper|repack|extended|theatrical).*/i, '')
        .replace(/[._]/g, ' ')
        .trim();
    return name || filename;
}

async function fetchOmdbMetadata(apiKey, progressFill, progressLabel, progressWrap, btnRefresh, omdbStatus) {
    const videos = state.allMedia.videos;
    if (videos.length === 0) {
        if (progressWrap) progressWrap.classList.add('hidden');
        if (btnRefresh) {
            btnRefresh.disabled = false;
            btnRefresh.innerText = '⟳ Refresh';
        }
        return;
    }

    let done = 0, fetched = 0, failed = 0;

    for (const video of videos) {
        try {
            const cleanName = cleanMovieName(video.name);

            let res  = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(cleanName)}&apikey=${apiKey}&type=movie`);
            let data = await res.json();

            // Fallback: search by keyword if exact title fails
            if (data.Response === 'False') {
                res  = await fetch(`https://www.omdbapi.com/?s=${encodeURIComponent(cleanName)}&apikey=${apiKey}&type=movie`);
                data = await res.json();
                if (data.Response === 'True' && data.Search && data.Search.length > 0) {
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
        if (progressFill)  progressFill.style.width = Math.round((done / videos.length) * 100) + '%';
        if (progressLabel) progressLabel.innerText  = `Fetching metadata… ${done} / ${videos.length}`;
    }

    if (progressWrap) progressWrap.classList.add('hidden');
    if (progressFill) progressFill.style.width = '0%';
    if (btnRefresh) {
        btnRefresh.disabled  = false;
        btnRefresh.innerText = '⟳ Refresh';
    }

    if (omdbStatus) {
        omdbStatus.className = 'omdb-status success';
        omdbStatus.innerText = `✓ Done — ${fetched} matched, ${failed} not found.`;
        setTimeout(() => omdbStatus.classList.add('hidden'), 4000);
    }

    saveMediaCache();
    render();
}