-- Migration 020 : colonne « notes » sur les devis (SQLite)
ALTER TABLE devis ADD COLUMN notes TEXT;
