# Pasar traslados a Excel y a `movimientos_dicose` (automático)

`pasar_traslados_automatico.py` corre cada hora `pasar_traslados_a_excel.py --aplicar` (la carpeta
`Ganaderia\Macros & phyton` de OneDrive, que no se modifica). Escribe los dos libros de DICOSE y sube
`movimientos_dicose` a Supabase.

## Qué hace en cada corrida
- Si un libro está abierto en Excel (existe `~$…`): no corre nada y lo reintenta en la próxima hora.
- Si corre y pasa renglones: un aviso normal al celular ("DICOSE al día").
- Si hay traslados rechazados (una categoría sin fila, un dueño sin bloque…): un aviso urgente, solo cuando
  cambia el conjunto de rechazos (no se repite cada hora). Se corrigen en la app o en el libro.
- Si falla de verdad (sin clave privada, no se guardó nada, excepción): aviso urgente una vez por mensaje y la
  tarea figura con error.
- Guarda la salida en `pasar_traslados_automatico.log` (la carpeta del script de Pedro; rota a ~1 MB).
- Deja los últimos 60 respaldos de los `.xlsm` en `respaldos\`.

## Instalar (una vez, en la PC)
```powershell
cd "C:\Users\Pedro\repos\potreros"
powershell -ExecutionPolicy Bypass -File scripts\dicose\instalar_tarea_traslados.ps1
Start-ScheduledTask -TaskName "Potreros - Pasar traslados a Excel"
Get-ScheduledTaskInfo -TaskName "Potreros - Pasar traslados a Excel"
```

## Pausar o quitar
```powershell
Disable-ScheduledTask -TaskName "Potreros - Pasar traslados a Excel"    # pausar
Unregister-ScheduledTask -TaskName "Potreros - Pasar traslados a Excel" -Confirm:$false   # quitar
```

## Probar sin tocar nada real
`python3 scripts/dicose/probar_pasar_traslados_automatico.py`: usa un script falso y un ntfy falso.
