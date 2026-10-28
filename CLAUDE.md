# NexoBar POS

POS para bares (antes "Brasa POS"), en español de Colombia (`es-CO`, pesos sin decimales). Funciona 100% sin conexión y sincroniza con Supabase cuando hay internet.

## Reglas técnicas

- **Vanilla JS puro.** Sin frameworks, sin TypeScript, sin bundlers, transpiladores ni paso de build. Los archivos `.js` se sirven tal cual con `<script>` clásicos (no módulos ES): las funciones de nivel superior son globales y se comparten entre archivos. No introducir `import`/`export`, npm runtime deps ni herramientas de compilación.
- Sin dependencias externas en tiempo de ejecución: `xlsx.full.min.js` y `supabase.min.js` están vendorizados en la raíz. `supabase.min.js` es el build UMD de `@supabase/supabase-js` **2.117.3** (`dist/umd/supabase.js` del tarball de npm, integridad verificada; sha256 `d6a5c4414a5d4ce646d9c1de223aa7067d3ff664c15394ffeb7fcffc763354a3`). Para actualizarlo, repetir ese proceso con una versión fija y actualizar esta línea. No volver a cargar scripts desde un CDN: la CSP lo bloquea.
- **CSP** (meta en `index.html` y `admin.html`): `script-src 'self'` + el hash del script del tema. Si cambias ese script en línea, recalcula su hash (`sha256-…` de su contenido exacto) en ambos archivos y en `_headers` (cabeceras de Cloudflare). Nada de `<script>` en línea nuevos, atributos `on*=` ni `eval`.
- Los scripts también se cargan en Node para las pruebas de `scratch/`: protege el acceso a `window`, `document`, `navigator` y `localStorage` con `typeof … !== 'undefined'` o `try/catch`.
- Comentarios y textos de interfaz en español.

## Arquitectura offline-first

- **Fuente de verdad local.** El estado completo (`state` en `app.js`) se guarda en **IndexedDB** (`storage.js`, base `brasa-pos`, store `kv`, clave `state`). Migra automáticamente desde `localStorage` (`brasa-pos-v1`) de versiones antiguas. No renombrar la base ni las claves: se perderían datos de clientes existentes.
- **Historial partido por mes.** En IndexedDB, `state` es solo el núcleo: ventas, gastos y compras van en claves `hist:<colección>:<AAAA-MM>` (`guardarParticionado` / `cargarParticionado` en `storage.js`), escritas en la misma transacción. En memoria `state` sigue completo. Cada guardado escribe el núcleo y los meses recientes; un mes viejo solo si cambia su resumen (cantidad, total, pendientes, ids). Si editas en el lugar un registro antiguo sin cambiar esos datos, llama a `marcarHistorialModificado(colección, registro)`; la revisión completa (cada 10 min y al ocultar o cerrar la app) es solo la red de seguridad. **No instalar versiones anteriores a este cambio**: leerían el núcleo con el historial vacío. Prueba: `scratch/test-storage-particionado.js`.
- **Archivo espejo (solo Windows).** En Electron, cada guardado se replica en `%APPDATA%\NexoBar\datos\nexobar-pos.json` (escritura atómica + `.bak` horario). Si IndexedDB está vacío, se restaura desde el espejo; `mirror:load` acepta también el antiguo `brasa-pos.json`. Respaldos en `Documentos\NexoBar\Respaldos` (o la carpeta legada `BrasaPOS\Respaldos`).
- **Sincronización diferida (`sync.js`, objeto global `NexoSync`).** Cada registro lleva `sync_status` (`nuevo_local`/`pending` → `synced`). Se suben en lote a Supabase cuando hay conexión (`scheduleSync`, evento `online`) y se descargan con `pullAllFromSupabase`. Los datos del negocio se separan por `business_id` (por defecto `nexobar_default`).
- **Descargas siempre paginadas.** PostgREST corta en 1000 filas por consulta: nunca leer una tabla con `select()` sin paginar. Usa `fetchAllRows` (tablas pequeñas: productos, proveedores) o `fetchMissingRows` (tablas que crecen: ventas, gastos, mermas; baja solo ids y luego las filas que faltan). Los borrados remotos se aplican localmente solo si la lista de ids llegó completa. Prueba: `scratch/test-pull-pagination.js`.
- **Pedidos abiertos: `pedidos_activos`, no `negocios`.** Si la tabla tiene la columna `meta` (migración de Supabase: `alter table pedidos_activos add column meta jsonb` + la tabla en la publicación `supabase_realtime`), `usaTablaPedidos` activa el modo tabla: cada pedido viaja como su fila (el pedido completo en `meta`), solo suben los que tienen cambios y `negocios.configuracion` deja de llevar `orders`. Sin la columna se mantiene el modo anterior (`configuracion.orders`). Toda escritura de `negocios.configuracion` pasa por `configuracionNegocio()`. El tiempo real de `pedidos_activos` trae un pedido por evento: se aplica con `mergeRemoteOrders([...], { completa: false })`, nunca como lista completa. Prueba: `scratch/test-pedidos-tabla.js`.
- **Fila `negocios`: solo `actualizarNegocio()`.** En Supabase las cajas solo pueden actualizar `nombre` y `configuracion` (permisos por columna) y no crean filas (las crea `admin_create_negocio`); así un bar no puede tocar `activo`, `plan` ni `fecha_vencimiento`. Nunca `upsert` ni otras columnas: Supabase lo rechaza con 403. `scratch/mock-supabase.js` replica estos permisos.
- **PIN de administrador sin texto plano.** En la nube solo `admin_salt`, `admin_hash` y `admin_pin_at`; `setUserPin` estampa `pinAt` y al descargar gana el PIN más reciente (`applyAdminPinLocally`). Un PIN de 4 dígitos con su sal se puede probar por fuerza bruta: no es un secreto frente a quien ya tiene acceso técnico a una caja. Prueba: `scratch/test-negocios-permisos.js`.
- **Nunca bloquear la venta por la red.** Toda operación se completa en local primero; los fallos de Supabase solo cambian el indicador de sincronización.
- Si `supabase.min.js` no cargó, `getClient()` devuelve `null`, la app trabaja offline y `loadSupabaseLib()` reintenta desde el mismo archivo local.

## Operación de Supabase (se hace en el panel, no en el código)

El esquema no está en el repositorio: estos pasos se aplican a mano en el proyecto de Supabase.

1. **Índices** (SQL Editor; si ya existen no hace nada). Cada página de la descarga paginada es una búsqueda directa:
   ```sql
   create index if not exists ventas_negocio_id_idx       on public.ventas (business_id, id);
   create index if not exists gastos_negocio_id_idx       on public.gastos (business_id, id);
   create index if not exists mermas_negocio_id_idx       on public.mermas (business_id, id);
   create index if not exists productos_negocio_id_idx    on public.productos (business_id, id);
   create index if not exists proveedores_negocio_id_idx  on public.proveedores (business_id, id);
   create index if not exists pedidos_activos_negocio_idx on public.pedidos_activos (business_id);
   create index if not exists turnos_caja_negocio_idx     on public.turnos_caja (business_id, estado, created_at desc);
   ```
2. **Tiempo real**: la publicación `supabase_realtime` ya incluye `negocios`, `pedidos_activos`, `productos`, `turnos_caja` y `ventas` (28-10-2026). Si se agrega otra tabla que la app escuche en `setupRealtime`, hay que agregarla también aquí.
3. **Pedidos en tabla propia** — solo cuando **todas** las cajas tengan la versión con `usaTablaPedidos` (las de Windows necesitan instalador nuevo); activa el modo en todas a la vez (la tabla ya está en el tiempo real; falta la columna):
   ```sql
   alter table public.pedidos_activos add column if not exists meta jsonb;
   do $ begin
     alter publication supabase_realtime add table public.pedidos_activos;
   exception when duplicate_object then null; end $;
   ```
4. **Plan Pro** antes del primer cliente de pago (Organization → Billing). El plan gratuito pausa el proyecto tras una semana sin uso, tiene 500 MB de base de datos y no incluye copias de seguridad descargables.
5. **Copias de seguridad**: Pro hace una copia diaria automática (Database → Backups). Para poder volver a un minuto exacto, activar el complemento Point in Time Recovery (costo aparte).
6. **Alertas de uso**: Organization → Billing → dejar activado el *spend cap* hasta conocer el consumo real, y revisar Reports → Database (tamaño y conexiones) y Usage (transferencia) cada mes. Los avisos de uso llegan al correo de facturación configurado en Organization → Billing.
7. **Revisión mensual del tamaño** (SQL Editor):
   ```sql
   select relname as tabla, pg_size_pretty(pg_total_relation_size(relid)) as tamano, n_live_tup as filas
   from pg_stat_user_tables order by pg_total_relation_size(relid) desc;
   ```

## Compatibilidad dual: PWA + Windows

- **PWA** (navegador, Netlify, móviles): `manifest.webmanifest` + `service-worker.js` (cache-first para el mismo origen; las peticiones a Supabase/CDN no se interceptan).
  - Todo archivo nuevo que cargue `index.html` debe añadirse a `ASSETS` en `service-worker.js` **y** subir la versión de `CACHE` (`nexobar-pos-vN`), o no funcionará offline.
- **Windows (Electron)**: `main.js` es el punto de entrada real (`"main"` en `package.json`) con `preload.js`; `electron/` contiene una variante equivalente. Mantén ambos en sincronía. El renderer accede al disco solo vía `window.desktop` (`contextBridge`): `loadMirror`, `saveMirror`, `onFlushRequest`, respaldos, etc. — nunca con `require` desde el renderer.
  - Todo archivo nuevo de la app debe añadirse también a `build.files` en `package.json` para que entre al instalador.
  - Detectar escritorio con `globalThis.desktop?.…` y degradar con elegancia cuando no exista.
- Comandos: `npm start` (Electron local), `npm run dist` (instalador Windows en `dist/`).

## Modo Demo (`demo-mode.js`)

- **Única definición** de `isDemoMode()` (expuesta en `globalThis`). No duplicarla en otros archivos; `storage.js` y `sync.js` solo hacen `require('./demo-mode.js')` cuando corren en Node.
- Se activa **exclusivamente** con `?demo=true` en la URL. Netlify, localhost y escritorio arrancan en producción. No se persiste: se decide en cada carga, y quitar el parámetro vuelve a producción.
- `globalThis.__FORCE_DEMO_MODE__` (booleano) lo fuerza solo en pruebas.
- En demo: base IndexedDB aislada (`nexobar_demo_db`), catálogo de ejemplo, sin escrituras ni lecturas a Supabase, sin archivo espejo, y vigilancia de inactividad que reinicia los datos. Cualquier nueva función que escriba en la nube debe comprobar `isDemoMode()` primero.

## Orden de carga en `index.html`

En `<head>`:
1. Meta CSP (primera, antes de cualquier script).
2. Script inline del tema (`nexobar-theme` / `brasa-theme` en `localStorage` → `data-theme="light"`), antes del CSS para evitar parpadeo. Su hash está en la CSP.
3. `supabase.min.js` (local, con `defer`).
4. `theme.css` → `styles.css` → `design.css`.

Al final de `<body>`, todos con `defer` (se ejecutan en este orden al terminar de leer el HTML; solo `app.js` ejecuta el arranque). Un `init` automático debe esperar a `DOMContentLoaded` mientras `readyState !== "complete"`, no solo en `"loading"`:
1. `demo-mode.js` — debe ir antes que todo lo que llame a `isDemoMode()`.
2. `storage.js` — solo declaraciones de persistencia.
3. `modules.js` — vistas/render (facturas, reportes, etc.).
4. `sync.js` — `NexoSync`.
5. `import-products.js` — importación de productos desde Excel. Carga `xlsx.full.min.js` bajo demanda (`loadXlsxLib()`) al abrir el importador o descargar la plantilla; no lo vuelvas a poner en `index.html`.
6. `print.js` — plantillas de tickets térmicos (58/80 mm) y `printReceipt()`: en escritorio vía `desktop.printReceipt` (ventana oculta en `main.js`), en web con un `<iframe>` invisible. No usar `window.open` para imprimir: en Electron está bloqueado.
7. `app.js` — estado, lógica de negocio y `bootstrap()`.

## Estilos: paleta Obsidian

- Todos los colores salen de variables CSS en `theme.css`; en `styles.css`/`design.css` usa `var(--…)`, no hex nuevos.
- **Modo Noche (por defecto)**, grafito oscuro: `--bg #181A20`, `--surface #20232B`, `--surface-2 #282C37`, `--surface-3 #323745`, texto `--text #F3F4F6` / `--muted #9CA3AF`.
- **Acento naranja NexoBar**: `--accent #FF8C32`, `--accent-strong #E6731B`, `--accent-soft`/`--accent-line` para fondos y bordes.
- **Estados**: `--success #10B981` (caja abierta, disponible), `--warn #F59E0B` (cuenta abierta), `--danger #EF4444` (con pedido, alertas de stock), `--info #3B82F6`.
- **Barra lateral** siempre grafito (`--ink #12141A`, `--ink-2 #16181F`) también en Modo Día.
- **Modo Día**: `html[data-theme="light"]` redefine los tokens en `theme.css`.
- Radios `--r-sm 8px`, `--r-md 14px`, `--r-lg 22px`; fuentes `--font-ui` (Segoe UI Variable/Inter) y `--font-display` (Bahnschrift).
- Los modales del modo demo usan las clases `.obsidian-modal` / `.obsidian-badge` (`design.css`).
- Diseño responsive: punto de quiebre principal `@media (max-width: 768px)` con menú hamburguesa.

## Pruebas

Scripts de Node en `scratch/test-*.js`. `npm test` los corre todos con `node --test` (uno a la vez; cada archivo pasa si termina con código 0); uno solo: `node scratch/test-demo-mode.js`. Simulan `window`/`document` y cargan los archivos de la app. `scratch/audit-*.js` no entran en `npm test`: `audit-security-and-bugs.js` es la auditoría de seguridad (hoy con 2 hallazgos medios conocidos: token de sesión en `localStorage` y contraseña en claro en `admin_create_negocio`, pendientes del sprint de autenticación) y `audit-supabase-schema.js` revisa el esquema.
