const express = require("express");
const ytdl = require("ytdl-core");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());
app.use(express.json());

// For temporary file storage
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR);
}

// Clean old files every hour
setInterval(() => {
  fs.readdir(DOWNLOAD_DIR, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(DOWNLOAD_DIR, file);
      const stat = fs.statSync(filePath);
      const now = new Date().getTime();
      const endTime = new Date(stat.ctime).getTime() + 3600000; // 1 hour old
      if (now > endTime) {
        fs.unlinkSync(filePath);
      }
    });
  });
}, 3600000);

// Home endpoint
app.get("/", (req, res) => {
  res.send("YouTube Downloader API Running - Now with downloadable files!");
});

// Get video info
app.post("/api/youtube/info", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const info = await ytdl.getInfo(url);
    
    const formats = info.formats
      .filter(f => f.hasVideo && f.hasAudio)
      .map(f => ({
        quality: f.qualityLabel || f.quality,
        format: f.container,
        codec: f.codecs,
        size: f.contentLength ? `${Math.round(f.contentLength / 1024 / 1024)}MB` : 'Unknown',
        itag: f.itag,
        hasVideo: f.hasVideo,
        hasAudio: f.hasAudio
      }));

    res.json({
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
      duration: `${Math.floor(info.videoDetails.lengthSeconds / 60)}:${(info.videoDetails.lengthSeconds % 60).toString().padStart(2, '0')}`,
      author: info.videoDetails.author.name,
      formats: formats,
      videoId: info.videoDetails.videoId
    });

  } catch (err) {
    console.error("Error fetching info:", err.message);
    res.status(500).json({ error: "Failed to fetch video info", details: err.message });
  }
});

// Download video endpoint - Returns direct downloadable link
app.post("/api/youtube/download", async (req, res) => {
  try {
    const { url, quality = 'highest', format = 'mp4' } = req.body;

    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const info = await ytdl.getInfo(url);
    const videoId = info.videoDetails.videoId;
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, ''); // Remove special chars
    const filename = `${title}_${Date.now()}.${format}`;
    const filepath = path.join(DOWNLOAD_DIR, filename);
    
    console.log(`Starting download: ${title}`);

    // Download with proper options for Chrome
    const videoStream = ytdl(url, {
      quality: quality,
      filter: format === 'mp3' ? 'audioonly' : 'videoandaudio'
    });

    const writeStream = fs.createWriteStream(filepath);

    videoStream.pipe(writeStream);

    videoStream.on('progress', (chunkLength, downloaded, total) => {
      const percent = (downloaded / total * 100).toFixed(2);
      console.log(`Downloading: ${percent}%`);
    });

    writeStream.on('finish', () => {
      console.log(`Download complete: ${filepath}`);
      
      // If MP3 requested, convert
      if (format === 'mp3') {
        const mp3Path = filepath.replace('.mp4', '.mp3');
        ffmpeg(filepath)
          .toFormat('mp3')
          .on('end', () => {
            fs.unlinkSync(filepath); // Delete original mp4
            res.json({
              success: true,
              downloadUrl: `${req.protocol}://${req.get('host')}/download/${path.basename(mp3Path)}`,
              filename: `${title}.mp3`,
              title: info.videoDetails.title,
              message: "Right-click the downloadUrl and select 'Save link as...' to download"
            });
          })
          .on('error', (err) => {
            console.error("FFmpeg error:", err);
            res.status(500).json({ error: "Conversion failed" });
          })
          .save(mp3Path);
      } else {
        res.json({
          success: true,
          downloadUrl: `${req.protocol}://${req.get('host')}/download/${filename}`,
          filename: filename,
          title: info.videoDetails.title,
          size: `${(fs.statSync(filepath).size / 1024 / 1024).toFixed(2)}MB`,
          message: "Right-click the downloadUrl and select 'Save link as...' to download"
        });
      }
    });

    writeStream.on('error', (err) => {
      console.error("Write error:", err);
      res.status(500).json({ error: "File write failed" });
    });

  } catch (err) {
    console.error("Download error:", err.message);
    res.status(500).json({ error: "Download failed", details: err.message });
  }
});

// Serve downloaded files
app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(DOWNLOAD_DIR, filename);
  
  if (fs.existsSync(filepath)) {
    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);
    
    // Delete file after download (optional)
    fileStream.on('end', () => {
      setTimeout(() => {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath);
        }
      }, 5000);
    });
  } else {
    res.status(404).json({ error: "File not found or expired" });
  }
});

// Quick download endpoint (all in one)
app.get("/api/quick-download", async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
    const filename = `${title}.mp4`;
    
    // Set headers for direct download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'video/mp4');
    
    // Stream directly to response
    ytdl(url, { quality: 'highest' }).pipe(res);
    
  } catch (err) {
    res.status(500).json({ error: "Download failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Download directory: ${DOWNLOAD_DIR}`);
});
