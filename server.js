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

const myCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*", methods: ["GET", "POST"], credentials: false }));
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// Root route
app.get("/", (req, res) => {
  res.status(200).json({
    message: "YouTube API Server is running!",
    status: "OK",
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
    timestamp: new Date().toISOString(),
  });
});

// ✅ PATCH: Quota test endpoint (opcjonalny)
app.get("/api/Youtube/quota-status", async (req, res) => {
  try {
    const testUrl = `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${YOUTUBE_API_KEY}`;
    const response = await fetch(testUrl);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return res
        .status(502)
        .json({ error: "Non-JSON response", status: response.status });
    }

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Error",
        code: data.error?.code || response.status,
        quotaExceeded:
          data.error?.errors?.some((e) => e.reason === "quotaExceeded") ||
          false,
      });
    }

    res.status(200).json({ quotaOk: true });
  } catch (e) {
    res.status(500).json({ error: "Internal error", details: e.message });
  }
});

// ✅ PATCH: Główna trasa z poprawkami
app.get("/api/Youtube", async (req, res) => {
  const query = req.query.q;
  const maxResults = parseInt(req.query.maxResults, 10) || 10;

  if (!query || query.trim() === "") {
    return res.status(400).json({
      error: 'Parametr zapytania "q" jest wymagany.',
      code: 400,
    });
  }

  const cacheKey = `${query.toLowerCase().trim()}_${maxResults}`;
  const cachedData = myCache.get(cacheKey);
  if (cachedData) return res.status(200).json(cachedData);

  try {
    const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      query
    )}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;
    const response = await fetch(youtubeApiUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const rawText = await response.text();
      return res.status(502).json({
        error: "Non-JSON response from YouTube API",
        raw: rawText.slice(0, 200),
      });
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      const rawText = await response.text();
      return res.status(502).json({
        error: "Invalid JSON",
        raw: rawText.slice(0, 200),
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "YouTube API error",
        code: data.error?.code || response.status,
        quotaExceeded:
          data.error?.errors?.some((e) => e.reason === "quotaExceeded") ||
          false,
        details: data.error,
      });
    }

    if (!data.items || !Array.isArray(data.items)) {
      return res.status(502).json({
        error: "Invalid response structure from YouTube API",
      });
    }

    myCache.set(cacheKey, data);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Internal server error",
      details: error.message,
      type: error.name,
    });
  }
});

// ✅ PATCH: Poprawki również w video details endpoint
app.get("/api/Youtube/video/:videoId", async (req, res) => {
  const videoId = req.params.videoId;

  if (!videoId || videoId.trim() === "") {
    return res.status(400).json({
      error: 'Parametr "videoId" jest wymagany.',
    });
  }

  const cacheKey = `video_details_${videoId}`;
  const cachedData = myCache.get(cacheKey);
  if (cachedData) return res.status(200).json(cachedData);

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(
      videoId
    )}&key=${YOUTUBE_API_KEY}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const rawText = await response.text();
      return res.status(502).json({
        error: "Non-JSON response",
        raw: rawText.slice(0, 200),
      });
    }

    let data;
    try {
      data = await response.json();
    } catch (err) {
      const rawText = await response.text();
      return res.status(502).json({
        error: "Invalid JSON",
        raw: rawText.slice(0, 200),
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "YouTube API error",
        code: data.error?.code || response.status,
        quotaExceeded:
          data.error?.errors?.some((e) => e.reason === "quotaExceeded") ||
          false,
        details: data.error,
      });
    }

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: "Video not found" });
    }

    myCache.set(cacheKey, data);
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Internal error fetching video details",
      details: error.message,
      type: error.name,
    });
  }
});

// 404 JSON handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.originalUrl,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
