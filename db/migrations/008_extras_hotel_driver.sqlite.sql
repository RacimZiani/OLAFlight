-- Champs métier supplémentaires (SQLite). hotels/driver stockés en TEXT JSON.
ALTER TABLE leads ADD COLUMN client_type      TEXT;
ALTER TABLE leads ADD COLUMN needs_hotel      INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN hotel_preference TEXT;
ALTER TABLE leads ADD COLUMN needs_driver     INTEGER DEFAULT 0;
ALTER TABLE leads ADD COLUMN driver_pickup    TEXT;
ALTER TABLE leads ADD COLUMN driver_dropoff   TEXT;
ALTER TABLE leads ADD COLUMN extras_notes     TEXT;

ALTER TABLE devis ADD COLUMN hotels TEXT;
ALTER TABLE devis ADD COLUMN driver TEXT;
