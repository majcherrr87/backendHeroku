// server.js
// Ładuje zmienne środowiskowe z pliku .env do process.env
// Działa tylko w środowisku lokalnego developmentu.
// Na Heroku zmienne środowiskowe są ustawiane bezpośrednio na platformie.
import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
// Port serwera. Heroku automatycznie ustawia zmienną środowiskową PORT.
// Lokalnie używamy portu 3000 (zdefiniowanego w .env).
const PORT = process.env.PORT || 3000;

// Pobiera klucz API YouTube ze zmiennych środowiskowych.
// Jest to bezpieczne, ponieważ klucz nie jest wbudowany w kod źródłowy.
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Sprawdzenie, czy klucz API jest dostępny.
// Jeśli nie, serwer nie wystartuje, co zapobiega błędom w działaniu API.
if (!YOUTUBE_API_KEY) {
  console.error(
    "BŁĄD: Zmienna środowiskowa YOUTUBE_API_KEY nie jest ustawiona."
  );
  console.error(
    "Upewnij się, że masz plik .env z kluczem w katalogu backendu (lokalnie) lub że klucz jest ustawiony na Heroku."
  );
  process.exit(1); // Zakończ proces, jeśli klucz nie jest dostępny
}

// Użycie middleware CORS.
// W produkcji, dla większego bezpieczeństwa, powinieneś ograniczyć dostęp tylko do domeny Twojej aplikacji React Native.
// Przykład: app.use(cors({ origin: 'https://twojaaplikacjamobilna.com' }));
app.use(cors());
// Middleware do parsowania JSON z requestów (jeśli kiedyś będziesz wysyłać dane POST/PUT).
app.use(express.json());

// --- Definicja endpointów API ---

// Główny endpoint do wyszukiwania filmów na YouTube.
// Aplikacja mobilna będzie wysyłać zapytania do tego endpointu.
app.get("/api/Youtube", async (req, res) => {
  const query = req.query.q; // Pobierz parametr zapytania 'q' (np. 'react native tutorial')
  const maxResults = parseInt(req.query.maxResults, 10) || 10; // Opcjonalny parametr, domyślnie 10 wyników

  // Walidacja zapytania
  if (!query) {
    return res
      .status(400)
      .json({ error: 'Parametr zapytania "q" jest wymagany.' });
  }

  try {
    // Skonstruuj URL zapytania do oficjalnego YouTube Data API v3
    const youtubeApiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      query
    )}&type=video&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

    // Logowanie zapytania (bez ujawniania klucza API w logach)
    console.log(`Wysyłam zapytanie do YouTube API (query: '${query}')`);

    // Wykonaj zapytanie do YouTube API
    const response = await fetch(youtubeApiUrl);
    const data = await response.json();

    // Sprawdź, czy odpowiedź z YouTube API jest poprawna
    if (!response.ok) {
      console.error("Błąd z YouTube API:", data);
      // Przekaż błąd z YouTube API z powrotem do klienta aplikacji mobilnej
      return res.status(response.status).json({
        error: data.error ? data.error.message : "Nieznany błąd z YouTube API",
        code: data.error ? data.error.code : response.status,
      });
    }

    // Przekaż dane z YouTube API (filmy) do klienta aplikacji mobilnej
    res.json(data);
  } catch (error) {
    console.error("Błąd wewnętrzny serwera:", error);
    // Zwróć ogólny błąd serwera w przypadku problemów z połączeniem lub innych błędów
    res.status(500).json({ error: "Wystąpił błąd wewnętrzny serwera." });
  }
});

// Prosty endpoint powitalny, aby sprawdzić, czy serwer działa
app.get("/", (req, res) => {
  res.send("Backend YouTube API działa poprawnie!");
});

// Uruchomienie serwera na zdefiniowanym porcie
app.listen(PORT, () => {
  console.log(`Backend serwer uruchomiony na porcie ${PORT}`);
  console.log(`Lokalnie dostępny pod adresem: http://localhost:${PORT}`);
});
