import express from "express";
import cors from "cors";
import NodeCache from "node-cache";
import dotenv from "dotenv";
import fetch from "node-fetch";

// Załaduj zmienne środowiskowe
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!YOUTUBE_API_KEY) {
  console.error("BŁĄD: Brak YouTube API Key w zmiennych środowiskowych");
  process.exit(1);
}

// Cache z dłuższym TTL dla przypadków gdy quota się skończy
const myCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 }); // 2 godziny

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST"], credentials: false }));
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// Funkcja sprawdzająca status quota
let quotaExhausted = false;
let lastQuotaCheck = 0;
const QUOTA_CHECK_INTERVAL = 300000; // 5 minut

async function checkQuotaStatus() {
  const now = Date.now();
  if (now - lastQuotaCheck < QUOTA_CHECK_INTERVAL && quotaExhausted) {
    return false; // Nie sprawdzaj zbyt często
  }

  try {
    const testUrl = `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${YOUTUBE_API_KEY}`;
    const response = await fetch(testUrl, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.error?.errors?.some((e) => e.reason === "quotaExceeded")) {
        quotaExhausted = true;
        lastQuotaCheck = now;
        return false;
      }
    }

    quotaExhausted = false;
    lastQuotaCheck = now;
    return true;
  } catch (error) {
    console.error("Quota check failed:", error.message);
    return !quotaExhausted; // Jeśli nie można sprawdzić, zakładamy że quota OK jeśli wcześniej była OK
  }
}

// Root route
app.get("/", (req, res) => {
  res.status(200).json({
    message: "YouTube API Server is running!",
    status: "OK",
    quotaStatus: quotaExhausted ? "EXHAUSTED" : "OK",
    endpoints: {
      Youtube: "/api/Youtube?q=search_term&maxResults=5",
      youtube_video_details: "/api/Youtube/video/:videoId",
      quota_status: "/api/Youtube/quota-status",
    },
    timestamp: new Date().toISOString(),
  });
});

// Health route
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
    quotaStatus: quotaExhausted ? "EXHAUSTED" : "OK",
    timestamp: new Date().toISOString(),
  });
});

// Quota status endpoint
app.get("/api/Youtube/quota-status", async (req, res) => {
  try {
    const quotaOk = await checkQuotaStatus();
    res.status(200).json({
      quotaOk,
      quotaExhausted,
      lastCheck: new Date(lastQuotaCheck).toISOString(),
      cacheSize: myCache.keys().length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error checking quota",
      details: error.message,
    });
  }
});

// Funkcja obsługująca YouTube API call z fallback na cache
async function makeYouTubeApiCall(url, cacheKey, description = "API call") {
  try {
    console.log(`Making ${description}:`, url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "YouTube-API-Server/1.0",
      },
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const rawText = await response.text();
      throw new Error(`Non-JSON response: ${rawText.slice(0, 200)}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      const rawText = await response.text();
      throw new Error(`Invalid JSON: ${rawText.slice(0, 200)}`);
    }

    if (!response.ok) {
      // Sprawdź czy to problem z quota
      if (data.error?.errors?.some((e) => e.reason === "quotaExceeded")) {
        quotaExhausted = true;
        lastQuotaCheck = Date.now();

        // Spróbuj zwrócić dane z cache jeśli dostępne
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
          console.log(`Quota exceeded, returning cached data for: ${cacheKey}`);
          return {
            success: true,
            data: { ...cachedData, _fromCache: true, _quotaExceeded: true },
            fromCache: true,
          };
        }

        throw new Error(`Quota exceeded and no cached data available`);
      }

      throw new Error(
        data.error?.message || `YouTube API error: ${response.status}`
      );
    }

    // Zapisz do cache
    if (data && cacheKey) {
      myCache.set(cacheKey, data);
    }

    return { success: true, data, fromCache: false };
  } catch (error) {
    console.error(`${description} failed:`, error.message);

    // Spróbuj zwrócić dane z cache
    const cachedData = myCache.get(cacheKey);
    if (cachedData) {
      console.log(`API failed, returning cached data for: ${cacheKey}`);
      return {
        success: true,
        data: { ...cachedData, _fromCache: true, _apiError: error.message },
        fromCache: true,
      };
    }

    throw error;
  }
}

// Główna trasa wyszukiwania
app.get("/api/Youtube", async (req, res) => {
  const query = req.query.q;
  const maxResults = Math.min(parseInt(req.query.maxResults, 10) || 10, 50);

  if (!query || query.trim() === "") {
    return res.status(400).json({
      error: 'Parametr zapytania "q" jest wymagany.',
      code: 400,
    });
  }

  const cacheKey = `search_${query.toLowerCase().trim()}_${maxResults}`;

  // Sprawdź cache najpierw
  const cachedData = myCache.get(cacheKey);
  if (cachedData) {
    return res.status(200).json({ ...cachedData, _fromCache: true });
  }

  // Jeśli quota wyczerpana, zwróć informację
  if (quotaExhausted) {
    return res.status(429).json({
      error: "YouTube API quota exceeded",
      code: 429,
      quotaExceeded: true,
      message:
        "Serwer osiągnął limit zapytań do YouTube API. Cache może zawierać starsze dane.",
      retryAfter: "Spróbuj ponownie za kilka godzin",
      cacheAvailable: myCache.keys().length > 0,
    });
  }

  try {
    const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      query
    )}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

    const result = await makeYouTubeApiCall(
      youtubeApiUrl,
      cacheKey,
      "YouTube search"
    );

    if (!result.data.items || !Array.isArray(result.data.items)) {
      return res.status(502).json({
        error: "Invalid response structure from YouTube API",
      });
    }

    return res.status(200).json(result.data);
  } catch (error) {
    console.error("Search API error:", error.message);

    return res.status(quotaExhausted ? 429 : 500).json({
      error: quotaExhausted
        ? "YouTube API quota exceeded"
        : "Internal server error",
      details: error.message,
      quotaExceeded: quotaExhausted,
      code: quotaExhausted ? 429 : 500,
    });
  }
});

// Endpoint szczegółów video
app.get("/api/Youtube/video/:videoId", async (req, res) => {
  const videoId = req.params.videoId;

  if (!videoId || videoId.trim() === "") {
    return res.status(400).json({
      error: 'Parametr "videoId" jest wymagany.',
    });
  }

  const cacheKey = `video_${videoId}`;

  // Sprawdź cache najpierw
  const cachedData = myCache.get(cacheKey);
  if (cachedData) {
    return res.status(200).json({ ...cachedData, _fromCache: true });
  }

  // Jeśli quota wyczerpana, zwróć informację
  if (quotaExhausted) {
    return res.status(429).json({
      error: "YouTube API quota exceeded",
      code: 429,
      quotaExceeded: true,
      message: "Serwer osiągnął limit zapytań do YouTube API.",
    });
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(
      videoId
    )}&key=${YOUTUBE_API_KEY}`;

    const result = await makeYouTubeApiCall(url, cacheKey, "Video details");

    if (!result.data.items || result.data.items.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    return res.status(200).json(result.data);
  } catch (error) {
    console.error("Video details API error:", error.message);

    return res.status(quotaExhausted ? 429 : 500).json({
      error: quotaExhausted
        ? "YouTube API quota exceeded"
        : "Internal error fetching video details",
      details: error.message,
      quotaExceeded: quotaExhausted,
      code: quotaExhausted ? 429 : 500,
    });
  }
});

// Endpoint: Szczegóły kanału (avatar, nazwa itp.)
app.get("/api/Youtube/channel/:channelId", async (req, res) => {
  const channelId = req.params.channelId;
  if (!channelId) {
    return res.status(400).json({ error: "Brak channelId" });
  }
  const cacheKey = `channel_${channelId}`;
  const cachedData = myCache.get(cacheKey);
  if (cachedData) {
    return res.status(200).json({ ...cachedData, _fromCache: true });
  }
  if (quotaExhausted) {
    return res.status(429).json({ error: "YouTube API quota exceeded" });
  }
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${encodeURIComponent(
      channelId
    )}&key=${YOUTUBE_API_KEY}`;
    const result = await makeYouTubeApiCall(url, cacheKey, "Channel details");
    if (!result.data.items || result.data.items.length === 0) {
      return res.status(404).json({ error: "Channel not found" });
    }
    return res.status(200).json(result.data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint do czyszczenia cache (przydatny do testów)
app.delete("/api/cache", (req, res) => {
  const keys = myCache.keys();
  myCache.flushAll();
  res.json({
    message: "Cache cleared",
    clearedKeys: keys.length,
    quotaReset: false, // Możesz dodać logikę resetowania quota jeśli potrzebne
  });
});
app.get("/api/video/stream/:videoId", async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({ error: "Video ID is required" });
    }

    // Opcja 1: Używając ytdl-core
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Sprawdź czy wideo jest dostępne
    const isValid = await ytdl.validateURL(videoUrl);
    if (!isValid) {
      return res
        .status(404)
        .json({ error: "Video not found or not accessible" });
    }

    // Pobierz informacje o wideo
    const info = await ytdl.getInfo(videoUrl);

    // Znajdź najlepszą jakość dla mobile
    const formats = ytdl.filterFormats(info.formats, "videoandaudio");
    const bestFormat = ytdl.chooseFormat(formats, {
      quality: "highestvideo",
      filter: (format) => format.container === "mp4",
    });

    if (!bestFormat) {
      return res.status(404).json({ error: "No suitable video format found" });
    }

    const response = {
      streamUrl: bestFormat.url,
      title: info.videoDetails.title,
      duration: parseInt(info.videoDetails.lengthSeconds),
      thumbnail: info.videoDetails.thumbnails[0]?.url,
      channelName: info.videoDetails.author.name,
      viewCount: info.videoDetails.viewCount,
      publishDate: info.videoDetails.publishDate,
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching video stream:", error);
    res.status(500).json({
      error: "Failed to fetch video stream",
      details: error.message,
    });
  }
});
// Endpoint do sprawdzania dostępności wideo
app.get("/api/video/check/:videoId", async (req, res) => {
  try {
    const { videoId } = req.params;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const isValid = await ytdl.validateURL(videoUrl);
    const info = isValid ? await ytdl.getBasicInfo(videoUrl) : null;

    res.json({
      isPlayable: isValid && info,
      isEmbeddable: info?.videoDetails?.isEmbeddable || false,
      isPrivate: info?.videoDetails?.isPrivate || false,
      isLive: info?.videoDetails?.isLiveContent || false,
    });
  } catch (error) {
    res.json({
      isPlayable: false,
      error: error.message,
    });
  }
});

// 404 JSON handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.originalUrl,
    availableEndpoints: [
      "GET /",
      "GET /health",
      "GET /api/Youtube?q=query&maxResults=10",
      "GET /api/Youtube/video/:videoId",
      "GET /api/Youtube/quota-status",
      "DELETE /api/cache",
    ],
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    timestamp: new Date().toISOString(),
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Cache TTL: ${myCache.options.stdTTL}s`);

  // Sprawdź quota przy starcie
  checkQuotaStatus().then((quotaOk) => {
    console.log(`📈 Initial quota status: ${quotaOk ? "OK" : "EXHAUSTED"}`);
  });
});
