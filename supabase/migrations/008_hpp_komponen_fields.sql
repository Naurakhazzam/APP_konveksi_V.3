-- =============================================================================
-- MIGRATION: 008_hpp_komponen_fields.sql
-- Action: Menambah field track inventory dan deskripsi pada hpp_komponen
-- Dibuat: 21 April 2026
-- =============================================================================

ALTER TABLE hpp_komponen 
  ADD COLUMN track_inventory BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN inventory_item_id UUID REFERENCES inventory_item(id),
  ADD COLUMN deskripsi TEXT;
