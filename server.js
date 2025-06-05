import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

// Prosty endpoint powitalny
app.get("/", (req, res) => {
  res.send("Minimalny serwer Express działa!");
});

// Endpoint health
app.get("/health", (req, res) => {
  res.send("Minimalny serwer Express jest zdrowy!");
});

app.listen(PORT, () => {
  console.log(`Minimalny serwer uruchomiony na porcie ${PORT}`);
});
