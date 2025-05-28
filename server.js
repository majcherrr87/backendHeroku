// server.js
// ... (istniejące importy)
import NodeCache from "node-cache";

const app = express();
// ... (reszta kodu)

// Konfiguracja cache
const myCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// Middleware dla ustawienia nagłówków JSON
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json");
  next();
});

// ... (reszta kodu, zmienne środowiskowe, CORS itp.)

app.get("/api/Youtube", async (req, res) => {
  const query = req.query.q;
  const maxResults = parseInt(req.query.maxResults, 10) || 10;

  // Zawsze zwracaj JSON, nawet przy błędach walidacji
  if (!query) {
    return res.status(400).json({
      error: 'Parametr zapytania "q" jest wymagany.',
      code: 400,
    });
  }

  const cacheKey = `${query.toLowerCase()}_${maxResults}`;

  // Sprawdź cache
  const cachedData = myCache.get(cacheKey);
  if (cachedData) {
    console.log(`Pobrano z cache dla zapytania: '${query}'`);
    return res.json(cachedData);
  }

  try {
    const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      query
    )}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

    console.log(`Wysyłam zapytanie do YouTube API (query: '${query}')`);

    const response = await fetch(youtubeApiUrl);

    // Sprawdź czy odpowiedź to JSON
    const contentType = response.headers.get("content-type");
    let data;

    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      // Jeśli nie JSON, prawdopodobnie HTML error page
      const textResponse = await response.text();
      console.error(
        "YouTube API zwróciło nie-JSON odpowiedź:",
        textResponse.substring(0, 200)
      );

      return res.status(response.status).json({
        error: `YouTube API error: ${response.status} ${response.statusText}`,
        code: response.status,
        details: "API returned non-JSON response",
      });
    }

    if (!response.ok) {
      console.error("Błąd z YouTube API:", data);

      // Zawsze zwracaj JSON przy błędach
      return res.status(response.status).json({
        error: data.error
          ? data.error.message
          : `YouTube API error: ${response.statusText}`,
        code: data.error ? data.error.code : response.status,
        details: data.error ? data.error : "Unknown YouTube API error",
      });
    }

    // Sprawdź czy dane mają prawidłową strukturę
    if (!data || !data.items) {
      console.error(
        "YouTube API zwróciło nieprawidłową strukturę danych:",
        data
      );
      return res.status(500).json({
        error: "Invalid data structure from YouTube API",
        code: 500,
        details: "Missing items array in response",
      });
    }

    // Zapisz w cache i zwróć wyniki
    myCache.set(cacheKey, data);
    console.log(
      `Zapisano w cache dla zapytania: '${query}' (${data.items.length} items)`
    );

    res.json(data);
  } catch (error) {
    console.error("Błąd wewnętrzny serwera:", error);

    // Zawsze zwracaj JSON, nawet przy wyjątkach
    res.status(500).json({
      error: "Wystąpił błąd wewnętrzny serwera.",
      code: 500,
      details: error.message || "Internal server error",
    });
  }
});

// Globalny handler błędów - zawsze zwraca JSON
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal server error",
      code: 500,
      details: err.message || "Unknown error occurred",
    });
  }
});

// 404 handler - zawsze zwraca JSON
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    code: 404,
    details: `Path ${req.path} not found`,
  });
});

// ... (reszta kodu)
