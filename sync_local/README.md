# sync_ventas_local

Servicio que corre en la **SERVER de Dragonfish** de cada local. Conecta SQL Server
local con Supabase para que las vendedoras puedan tocar "Cargar desde Dragonfish"
en la PWA de Ventas y obtener la venta del día automáticamente.

## Cómo funciona

```
┌────────────────────────────┐
│  PWA ventas-adorno         │
│  (vendedora toca "Cargar") │──┐
└────────────────────────────┘  │
                                ▼
                ┌──────────────────────────┐
                │  Supabase                │
                │  insert dragonfish_jobs  │
                │  (local, fecha,          │
                │   estado='pendiente')    │
                └──────────────────────────┘
                                ▲
                                │  polling cada 60s
                                │
        ┌─────────────────────────────────────────┐
        │  sync_ventas_local.py (acá)             │
        │  - Detecta su LOCAL del .env            │
        │  - Toma jobs pendientes para ese local  │
        │  - Ejecuta query SQL Server local       │
        │  - Empuja resultado a ventas_diarias    │
        │  - Marca job como completado            │
        └────────────┬────────────────────────────┘
                     │
                     ▼
        ┌─────────────────────────────────────────┐
        │  SQL Server local (Dragonfish)          │
        │  - DRAGONFISH_<LOCAL>1 (server física)  │
        │  - DRAGONFISH_<LOCAL>2 (terminal/online)│
        └─────────────────────────────────────────┘
```

## Instalación (en la SERVER de cada local)

### 1. Requisitos
- Python 3.8+ instalado
- ODBC Driver 17 for SQL Server
- Acceso a SQL Server local del Dragonfish con Windows auth

### 2. Copiar archivos
Copiar la carpeta `sync_local` completa a la PC server del local, por ejemplo a:
```
C:\Ventas_Adorno\sync_local\
```

### 3. Instalar dependencias
```cmd
pip install pyodbc requests
```

### 4. Configurar .env
```cmd
copy .env.example .env
notepad .env
```

Editar:
- `VENTAS_LOCAL`: alcorta | unicenter | oficina
- `VENTAS_SQL_SERVER`: nombre del SQL Server (default `localhost\ZOOLOGIC2026`)
- `SUPABASE_SERVICE_KEY`: copiar del Supabase Dashboard → Settings → API → service_role secret

### 5. Probar manual
```cmd
:: Consultar un día sin pushear:
python sync_ventas_local.py 2026-06-05

:: Consultar y pushear a Supabase:
python sync_ventas_local.py 2026-06-05 --push

:: Modo servicio (loop infinito):
python sync_ventas_local.py
```

### 6. Instalar como tarea programada
Click derecho sobre `install_task.bat` → "Ejecutar como administrador".

La tarea se llama `Ventas_Adorno_SyncLocal` y arranca al login de Windows.

Para arrancarla sin reiniciar:
```cmd
schtasks /Run /TN "Ventas_Adorno_SyncLocal"
```

## Logs
El archivo `sync.log` se actualiza con cada acción. Si algo falla, revisarlo primero.

## Troubleshooting

**"Login failed for user"** → Falta dar permisos al usuario Windows sobre las bases Dragonfish:
```sql
USE [DRAGONFISH_UNI1];
CREATE USER [NOMBRE_PC\Usuario] FROM LOGIN [NOMBRE_PC\Usuario];
ALTER ROLE db_datareader ADD MEMBER [NOMBRE_PC\Usuario];
```

**"ODBC Driver not found"** → Descargar e instalar [ODBC Driver 17 for SQL Server](https://www.microsoft.com/en-us/download/details.aspx?id=56567)

**El script no toma jobs** → Verificar que el `VENTAS_LOCAL` en .env coincide con el `local` insertado en `dragonfish_jobs` desde la PWA.
