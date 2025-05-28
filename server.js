// server.js
// ... (istniejące importy)
import NodeCache from "node-cache"; // Zainstaluj: npm install node-cache

const app = express();
// ... (reszta kodu)

// Konfiguracja cache:
// stdTTL: standardowy czas życia w sekundach (np. 1 godzina = 3600 sekund)
// checkperiod: co ile sekund sprawdzać i usuwać wygasłe elementy
const myCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // Cache na 1 godzinę

// ... (reszta kodu, zmienne środowiskowe, CORS itp.)

app.get("/api/Youtube", async (req, res) => {
  const query = req.query.q;
  const maxResults = parseInt(req.query.maxResults, 10) || 10;

  if (!query) {
    return res
      .status(400)
      .json({ error: 'Parametr zapytania "q" jest wymagany.' });
  }

  // Tworzymy unikalny klucz dla cache na podstawie zapytania i maxResults
  const cacheKey = `${query.toLowerCase()}_${maxResults}`;

  // 1. Sprawdź, czy dane są w cache
  const cachedData = myCache.get(cacheKey);
  if (cachedData) {
    console.log(`Pobrano z cache dla zapytania: '${query}'`);
    return res.json(cachedData); // Zwróć dane z cache zamiast pytać YouTube API
  }

  try {
    const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      query
    )}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

    console.log(`Wysyłam zapytanie do YouTube API (query: '${query}')`);

    const response = await fetch(youtubeApiUrl);
    const data = await response.json();

    if (!response.ok) {
      console.error("Błąd z YouTube API:", data);
      return res.status(response.status).json({
        error: data.error ? data.error.message : "Nieznany błąd z YouTube API",
        code: data.error ? data.error.code : response.status,
      });
    }

    // 2. Zapisz wyniki w cache po pobraniu z YouTube API
    myCache.set(cacheKey, data);
    console.log(`Zapisano w cache dla zapytania: '${query}'`);

    res.json(data);
  } catch (error) {
    console.error("Błąd wewnętrzny serwera:", error);
    res.status(500).json({ error: "Wystąpił błąd wewnętrzny serwera." });
  }
});

// ... (reszta kodu)
