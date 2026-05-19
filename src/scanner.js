const fs = require('fs').promises;
const path = require('path');
const musicMetadata = require('music-metadata');

const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.ogg'];
const AUDIO_EXTS = ['.mp3', '.wav', '.flac', '.m4a'];

async function scanDirectory(dirPath) {
    let results = {
        videos: [],
        audio: []
    };

    async function walk(currentPath) {
        const files = await fs.readdir(currentPath, { withFileTypes: true });

        for (const file of files) {
            const res = path.resolve(currentPath, file.name);
            if (file.isDirectory()) {
                await walk(res);
            } else {
                const ext = path.extname(file.name).toLowerCase();
                
                if (VIDEO_EXTS.includes(ext)) {
                    results.videos.push({
                        name: cleanTitle(file.name),
                        path: res,
                        ext: ext,
                        type: 'video'
                    });
                } else if (AUDIO_EXTS.includes(ext)) {
                    try {
                        const metadata = await musicMetadata.parseFile(res);
                        results.audio.push({
                            name: metadata.common.title || cleanTitle(file.name),
                            artist: metadata.common.artist || 'Unknown Artist',
                            album: metadata.common.album || 'Unknown Album',
                            path: res,
                            ext: ext,
                            type: 'audio',
                            duration: metadata.format.duration
                        });
                    } catch (err) {
                        results.audio.push({
                            name: cleanTitle(file.name),
                            artist: 'Unknown Artist',
                            path: res,
                            ext: ext,
                            type: 'audio'
                        });
                    }
                }
            }
        }
    }

    try {
        await walk(dirPath);
        return results;
    } catch (error) {
        console.error("Scan Error:", error);
        return results;
    }
}

function cleanTitle(filename) {
    return filename
        .replace(/\.[^/.]+$/, '')                          // remove extension
        .replace(/\b(19|20)\d{2}\b.*/i, '')               // strip year and everything after it
        .replace(/\b(1080p|720p|480p|4k|2160p|bluray|blu-ray|bdrip|brrip|hdtv|hdcam|dvdrip|dvdscr|hdrip|webrip|web-dl|webdl|x264|x265|hevc|avc|xvid|divx|aac|ac3|dts|extended|theatrical|remastered|unrated|directors.cut|proper|repack|retail|limited|internal|readnfo|dubbed|subbed|multi|truefrench)\b.*/gi, '')
        .replace(/[._\-]+/g, ' ')                          // dots/underscores/dashes to spaces
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = { scanDirectory };