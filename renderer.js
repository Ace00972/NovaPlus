// State Management
const state = {
    allMedia: { videos: [], audio: [] },
    currentView: 'home',
    searchQuery: '',
};

// UI Elements
const mediaGrid = document.getElementById('media-grid');
const viewTitle = document.getElementById('view-title');
const playerOverlay = document.getElementById('player-overlay');
const videoElement = document.getElementById('video-element');
const audioElement = document.getElementById('audio-element');
const audioPlayerUI = document.getElementById('audio-player-ui');
const searchInput = document.getElementById('search-input');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    render();
});

function setupEventListeners() {
    // Window Controls
    document.getElementById('btn-min').onclick = () => window.electronAPI.minimize();
    document.getElementById('btn-max').onclick = () => window.electronAPI.maximize();
    document.getElementById('btn-close').onclick = () => window.electronAPI.close();

    // Navigation
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentView = btn.dataset.view;
            render();
        };
    });

    // Add Folder
    document.getElementById('btn-add-folder').onclick = async () => {
        const path = await window.electronAPI.selectFolder();
        if (path) {
            viewTitle.innerText = "Scanning...";
            const results = await window.electronAPI.scanMedia(path);
            state.allMedia = results;
            state.currentView = 'home';
            render();
        }
    };

    // Search
    searchInput.oninput = (e) => {
        state.searchQuery = e.target.value.toLowerCase();
        render();
    };

    // Player Close
    document.querySelector('.close-player').onclick = closePlayer;

    // Theme Picker
    document.querySelectorAll('.dot').forEach(dot => {
        dot.onclick = () => {
            const color = dot.dataset.color;
            document.documentElement.style.setProperty('--accent', color);
            document.documentElement.style.setProperty('--accent-glow', color + '44');
        };
    });
}

function render() {
    mediaGrid.innerHTML = '';
    
    let items = [];
    if (state.currentView === 'home') {
        items = [...state.allMedia.videos, ...state.allMedia.audio];
        viewTitle.innerText = "Library";
    } else if (state.currentView === 'movies') {
        items = state.allMedia.videos;
        viewTitle.innerText = "Movies";
    } else if (state.currentView === 'music') {
        items = state.allMedia.audio;
        viewTitle.innerText = "Music";
    }

    // Filter by search
    if (state.searchQuery) {
        items = items.filter(item => item.name.toLowerCase().includes(state.searchQuery));
    }

    if (items.length === 0) {
        mediaGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📂</div>
                <h2>No items found</h2>
                <p>Try a different search or add a folder.</p>
            </div>
        `;
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-art">${item.type === 'video' ? '🎬' : '🎵'}</div>
            <div class="card-info">
                <h3>${item.name}</h3>
                <p>${item.type === 'video' ? 'Video File' : (item.artist || 'Unknown Artist')}</p>
            </div>
        `;
        card.onclick = () => playMedia(item);
        mediaGrid.appendChild(card);
    });
}

function playMedia(item) {
    const mediaUrl = window.electronAPI.toMediaUrl(item.path);
    playerOverlay.classList.remove('hidden');

    if (item.type === 'video') {
        videoElement.classList.remove('hidden');
        audioPlayerUI.classList.add('hidden');
        videoElement.src = mediaUrl;
        videoElement.play();
    } else {
        videoElement.classList.add('hidden');
        audioPlayerUI.classList.remove('hidden');
        document.getElementById('now-playing-title').innerText = item.name;
        document.getElementById('now-playing-artist').innerText = item.artist;
        audioElement.src = mediaUrl;
        audioElement.play();
    }
}

function closePlayer() {
    videoElement.pause();
    videoElement.src = "";
    audioElement.pause();
    audioElement.src = "";
    playerOverlay.classList.add('hidden');
}
