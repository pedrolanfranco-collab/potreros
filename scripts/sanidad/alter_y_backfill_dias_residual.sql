-- 1) Agregar la columna que falta (una sola vez)
ALTER TABLE productos_catalogo ADD COLUMN dias_residual integer NULL;

-- 2) Backfill del T_Residual de cada producto (columna K de "Costo productos")
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Aftosa';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Aspersin';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Bopriva';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Bovisan lepto 8';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Bovisan Total Se';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Clostrisan';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Clostrisan 9+T';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'CreBio 7';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Cydectin';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Ectoraz';
UPDATE productos_catalogo SET dias_residual = 45 WHERE producto = 'EON';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Epmox';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Eprinoline';
UPDATE productos_catalogo SET dias_residual = 42 WHERE producto = 'Exzolt';
UPDATE productos_catalogo SET dias_residual = 35 WHERE producto = 'Forcer';
UPDATE productos_catalogo SET dias_residual = 35 WHERE producto = 'Fusion';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Gestovac Fco';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Ivermectina R';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Ivumisol';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'MEXIVER';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Reproductiva';
UPDATE productos_catalogo SET dias_residual = 21 WHERE producto = 'Tacplus';
UPDATE productos_catalogo SET dias_residual = 35 WHERE producto = 'Tick off';
UPDATE productos_catalogo SET dias_residual = 35 WHERE producto = 'Tickxan plus';
UPDATE productos_catalogo SET dias_residual = 30 WHERE producto = 'Ticxan';
