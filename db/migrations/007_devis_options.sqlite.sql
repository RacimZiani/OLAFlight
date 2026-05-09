-- Devis multi-options (SQLite). On ajoute simplement la colonne; l'app gère
-- l'absence (encodeRow stringify, decodeRow JSON.parse).
ALTER TABLE devis ADD COLUMN options TEXT;
