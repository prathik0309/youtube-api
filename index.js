const express = require("express");
const ytdl = require("ytdl-core");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("YouTube Downloader API Running");
});

app.post("/api/youtube", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: "Invalid YouTube URL" });
    }

    const info = await ytdl.getInfo(url);

    const formats = info.formats
      .filter(f => f.hasVideo && f.hasAudio && f.container === "mp4")
      .map(f => ({
        quality: f.qualityLabel,
        download: f.url
      }));

    res.json({
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails.pop().url,
      formats
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to fetch video" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
