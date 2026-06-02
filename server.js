const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
fs.ensureDirSync(DOWNLOAD_DIR);

const COOKIE_FILE = path.join(__dirname, 'cookies.txt');
if (!fs.existsSync(COOKIE_FILE)) {
  console.error('cookies.txt not found!');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

const activeDownloads = new Map();

// ডাউনলোড শুরু করার এপিআই
app.post('/download', async (req, res) => {
  const { url, quality = 'best' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const id = uuidv4();
  activeDownloads.set(id, { status: 'queued', progress: 0 });

  (async () => {
    const outputTemplate = path.join(DOWNLOAD_DIR, `${id}_%(title)s.%(ext)s`);
    let format = 'bestvideo+bestaudio/best';
    if (quality === '1080p') format = 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]';
    if (quality === '720p') format = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]';

    const args = [
      '--cookies', COOKIE_FILE,
      '--format', format,
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--quiet',
      url
    ];

    const yt = spawn('yt-dlp', args);
    let stderr = '';

    yt.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (match) {
        const percent = parseFloat(match[1]);
        activeDownloads.set(id, { status: 'downloading', progress: percent });
      }
    });

    yt.on('close', async (code) => {
      if (code === 0) {
        const files = await fs.readdir(DOWNLOAD_DIR);
        const videoFile = files.find(f => f.startsWith(id) && (f.endsWith('.mp4') || f.endsWith('.mkv')));
        if (videoFile) {
          const filePath = path.join(DOWNLOAD_DIR, videoFile);
          activeDownloads.set(id, { status: 'completed', progress: 100, file: videoFile, filePath });
          setTimeout(() => fs.remove(filePath).catch(() => {}), 3600000);
        } else {
          activeDownloads.set(id, { status: 'failed', error: 'File not found' });
        }
      } else {
        activeDownloads.set(id, { status: 'failed', error: stderr.slice(0, 200) });
      }
    });
  })();

  res.json({ id, statusUrl: `/status/${id}` });
});

// স্ট্যাটাস চেক
app.get('/status/:id', (req, res) => {
  const data = activeDownloads.get(req.params.id);
  if (!data) return res.json({ status: 'not_found' });
  res.json(data);
});

// ডাউনলোড লিংক (ফাইল সরবরাহ)
app.get('/download/:id', async (req, res) => {
  const data = activeDownloads.get(req.params.id);
  if (!data || data.status !== 'completed' || !data.filePath) {
    return res.status(404).send('File not ready or expired');
  }
  res.download(data.filePath, data.file);
});

// ফ্রন্টএন্ড HTML পেজ
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>SonyLIV Downloader</title></head>
    <body>
      <h2>🎬 SonyLIV ভিডিও ডাউনলোডার</h2>
      <input type="text" id="url" placeholder="SonyLIV লিংক দিন" size="60" />
      <select id="quality">
        <option value="best">Best</option>
        <option value="1080p">1080p</option>
        <option value="720p">720p</option>
      </select>
      <button onclick="startDownload()">ডাউনলোড শুরু করুন</button>
      <div id="status" style="margin-top:20px; font-weight:bold;"></div>
      <div id="downloadLink"></div>

      <script>
        async function startDownload() {
          const url = document.getElementById('url').value;
          const quality = document.getElementById('quality').value;
          if(!url) return alert('লিংক দিন');

          document.getElementById('status').innerHTML = '⏳ শুরু হচ্ছে...';
          document.getElementById('downloadLink').innerHTML = '';

          const res = await fetch('/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, quality })
          });
          const data = await res.json();
          const id = data.id;

          const interval = setInterval(async () => {
            const statRes = await fetch('/status/' + id);
            const stat = await statRes.json();
            if(stat.status === 'downloading') {
              document.getElementById('status').innerHTML = \`📥 ডাউনলোড হচ্ছে: \${stat.progress}%\`;
            } else if(stat.status === 'completed') {
              clearInterval(interval);
              document.getElementById('status').innerHTML = '✅ ডাউনলোড সম্পূর্ণ!';
              document.getElementById('downloadLink').innerHTML = \`<a href="/download/\${id}" style="font-size:1.2rem;">⬇️ ভিডিও ডাউনলোড করুন (Google Download)</a>\`;
            } else if(stat.status === 'failed') {
              clearInterval(interval);
              document.getElementById('status').innerHTML = \`❌ ব্যর্থ: \${stat.error}\`;
            }
          }, 2000);
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
