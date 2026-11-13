-- Satuan "Yard" (4 bahan JN) dan "yard" dianggap dua satuan berbeda di
-- tab Pemakaian Bahan ("25,1 Yard · 569,23 yard"). Samakan ke huruf kecil.
UPDATE inventory_item SET satuan = 'yard' WHERE satuan = 'Yard';
