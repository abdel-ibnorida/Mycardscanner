const fs = require('fs');

// Carica il JSON originale da un file
const rawData = fs.readFileSync('goat-full.json');
const jsonData = JSON.parse(rawData);

// Filtra i dati
const filteredData = jsonData.data.map(card => ({
  id: card.id,
  name: card.name,
  id_images: card.card_images?.map(img => img.id) || []
}));

// Salva il JSON alleggerito su un nuovo file
fs.writeFileSync('cards_light.json', JSON.stringify(filteredData, null, 2));

console.log('File cards_light.json generato con successo!');
