FROM node:18-slim

# প্রয়োজনীয় প্যাকেজ ইনস্টল করুন
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp ইন্সটল করুন (সিস্টেম প্রোটেকশন বাইপাস)
RUN pip3 install --break-system-packages --upgrade yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
