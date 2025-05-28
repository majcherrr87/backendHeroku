import express from "express";
import cors from "cors";
import NodeCache from "node-cache";
import dotenv from "dotenv";

// Załaduj zmienne środowiskowe
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Pobierz YouTube API Key ze zmiennych środowiskowych
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!YOUTUBE_API_KEY) {
  console.error("BŁĄD: Brak YouTube API Key w zmiennych środowiskowych");
  process.exit(1);
}

// Konfiguracja cache (1 godzina)
const myCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// MIDDLEWARE - bardzo ważne żeby było PRZED routami!
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS - dodaj wszystkie możliwe origins
app.use(
  cors({
    origin: ["*"], // W produkcji lepiej ograniczyć do konkretnych domen
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    credentials: false,
  })
);

// Middleware do wymuszania JSON response
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// ROUTE: Root endpoint - test czy serwer działa
app.get("/", (req, res) => {
  res.status(200).json({
    message: "YouTube API Server is running!",
    status: "OK",
    endpoints: {
      Youtube: "/api/Youtube?q=search_term&maxResults=5",
      youtube_video_details: "/api/Youtube/video/:videoId", // Dodano dla jasności
    },
    timestamp: new Date().toISOString(),
  });
});

// ROUTE: Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// MAIN ROUTE: Youtube API
app.get("/api/Youtube", async (req, res) => {
  console.log("YouTube API endpoint called with query:", req.query);

  const query = req.query.q;
  const maxResults = parseInt(req.query.maxResults, 10) || 10;

  // Walidacja parametrów
  if (!query || query.trim() === "") {
    return res.status(400).json({
      error: 'Parametr zapytania "q" jest wymagany.',
      code: 400,
      example: "/api/Youtube?q=react&maxResults=5",
    });
  }

  const cacheKey = `${query.toLowerCase().trim()}_${maxResults}`;

  // Sprawdź cache
  const cachedData = myCache.get(cacheKey);
  if (cachedData) {
    console.log(`Cache hit dla zapytania: '${query}'`);
    return res.status(200).json(cachedData);
  }

  try {
    const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      query
    )}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

    console.log(`Wysyłam zapytanie do YouTube API dla: '${query}'`);

    const response = await fetch(youtubeApiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "NodeJS-Server/1.0",
      },
      signal: AbortSignal.timeout(10000), // 10 sekund timeout
    });

    console.log(`YouTube API response status: ${response.status}`);

    // Sprawdź content-type
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const textResponse = await response.text();
      console.error(
        "YouTube API zwróciło nie-JSON:",
        textResponse.substring(0, 200)
      );

      return res.status(502).json({
        error: "YouTube API returned non-JSON response",
        code: 502,
        details: `Expected JSON, got: ${contentType}`,
        status: response.status,
      });
    }

    const data = await response.json();

    if (!response.ok) {
      console.error("YouTube API error:", data);

      return res.status(response.status).json({
        error:
          data.error?.message || `YouTube API error: ${response.statusText}`,
        code: data.error?.code || response.status,
        details: data.error || "YouTube API returned an error",
        quotaExceeded: data.error?.code === 403,
      });
    }

    // Walidacja struktury odpowiedzi
    if (!data || !Array.isArray(data.items)) {
      console.error("Invalid YouTube API response structure:", data);

      return res.status(502).json({
        error: "Invalid response structure from YouTube API",
        code: 502,
        details: "Missing or invalid items array",
      });
    }

    // Sukces - zapisz w cache i zwróć
    myCache.set(cacheKey, data);
    console.log(
      `Success: Cached ${data.items.length} videos for query: '${query}'`
    );

    return res.status(200).json(data);
  } catch (error) {
    console.error("Server error:", error);

    // Różne typy błędów
    let errorMessage = "Internal server error";
    let errorCode = 500;

    if (error.name === "AbortError") {
      errorMessage = "Request timeout";
      errorCode = 408;
    } else if (error.code === "ENOTFOUND") {
      errorMessage = "DNS resolution failed";
      errorCode = 502;
    } else if (error.code === "ECONNREFUSED") {
      errorMessage = "Connection refused";
      errorCode = 502;
    }

    return res.status(errorCode).json({
      error: errorMessage,
      code: errorCode,
      details: error.message,
      type: error.name || "UnknownError",
    });
  }
});

// NEW ROUTE: YouTube Video Details API (using videoId)
app.get("/api/Youtube/video/:videoId", async (req, res) => {
  const videoId = req.params.videoId;
  console.log("YouTube Video Details endpoint called for videoId:", videoId);

  // Walidacja parametru videoId
  if (!videoId || videoId.trim() === "") {
    return res.status(400).json({
      error: 'Parametr "videoId" jest wymagany w ścieżce URL.',
      code: 400,
      example: "/api/Youtube/video/dQw4w9WgXcQ",
    });
  }

  const cacheKey = `video_details_${videoId}`;

  // Sprawdź cache
  const cachedData = myCache.get(cacheKey);
  if (cachedData) {
    console.log(`Cache hit dla wideo: '${videoId}'`);
    return res.status(200).json(cachedData);
  }

  try {
    const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(
      videoId
    )}&key=${YOUTUBE_API_KEY}`;

    console.log(
      `Wysyłam zapytanie do YouTube API dla szczegółów wideo: '${videoId}'`
    );

    const response = await fetch(youtubeApiUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "NodeJS-Server/1.0",
      },
      signal: AbortSignal.timeout(10000), // 10 sekund timeout
    });

    console.log(
      `YouTube API video details response status: ${response.status}`
    );

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const textResponse = await response.text();
      console.error(
        "YouTube API (video details) zwróciło nie-JSON:",
        textResponse.substring(0, 200)
      );
      return res.status(502).json({
        error: "YouTube API (video details) returned non-JSON response",
        code: 502,
        details: `Expected JSON, got: ${contentType}`,
        status: response.status,
      });
    }

    const data = await response.json();

    if (!response.ok) {
      console.error("YouTube API (video details) error:", data);
      return res.status(response.status).json({
        error:
          data.error?.message ||
          `YouTube API (video details) error: ${response.statusText}`,
        code: data.error?.code || response.status,
        details:
          data.error || "YouTube API returned an error for video details",
        quotaExceeded: data.error?.code === 403,
      });
    }

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({
        error: "Video not found or no items returned by YouTube API.",
        code: 404,
      });
    }

    // Sukces - zapisz w cache i zwróć
    myCache.set(cacheKey, data);
    console.log(`Success: Cached video details for '${videoId}'`);

    return res.status(200).json(data);
  } catch (error) {
    console.error("Server error fetching video details:", error);
    let errorMessage = "Internal server error fetching video details";
    let errorCode = 500;

    if (error.name === "AbortError") {
      errorMessage = "Request timeout fetching video details";
      errorCode = 408;
    } else if (error.code === "ENOTFOUND") {
      errorMessage = "DNS resolution failed fetching video details";
      errorCode = 502;
    } else if (error.code === "ECONNREFUSED") {
      errorMessage = "Connection refused fetching video details";
      errorCode = 502;
    }

    return res.status(errorCode).json({
      error: errorMessage,
      code: errorCode,
      details: error.message,
      type: error.name || "UnknownError",
    });
  }
});

// 404 Handler - musi być JSON
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    code: 404,
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      "/",
      "/health",
      "/api/Youtube",
      "/api/Youtube/video/:videoId",
    ],
  });
});

// Global Error Handler - zawsze JSON
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Internal server error",
    code: 500,
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(
    `🔍 YouTube API Search: http://localhost:${PORT}/api/Youtube?q=test&maxResults=5`
  );
  console.log(
    `🎬 YouTube Video Details: http://localhost:${PORT}/api/Youtube/video/dQw4w9WgXcQ` // Example video ID
  );
  console.log(
    `🔑 YouTube API Key configured: ${YOUTUBE_API_KEY ? "✅ Yes" : "❌ No"}`
  );
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
