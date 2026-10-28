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
- **Archivo espejo (solo Windows).** En Electron, cada guardado se replica en `%APPDATA%\NexoBar\datos\nexobar-pos.json` (escritura atómica + `.bak` horario). Si IndexedDB está vacío, se restaura desde el espejo; `mirror:load` acepta también el antiguo `brasa-pos.json`. Respaldos en `Documentos\NexoBar\Respaldos` (o la carpeta legada `BrasaPOS\Respaldos`).
- **Sincronización diferida (`sync.js`, objeto global `NexoSync`).** Cada registro lleva `sync_status` (`nuevo_local`/`pending` → `synced`). Se suben en lote a Supabase cuando hay conexión (`scheduleSync`, evento `online`) y se descargan con `pullAllFromSupabase`. Los datos del negocio se separan por `business_id` (por defecto `nexobar_default`).
- **Nunca bloquear la venta por la red.** Toda operación se completa en local primero; los fallos de Supabase solo cambian el indicador de sincronización.
- Si `supabase.min.js` no cargó, `getClient()` devuelve `null`, la app trabaja offline y `loadSupabaseLib()` reintenta desde el mismo archivo local.

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
3. `supabase.min.js` (local).
4. `theme.css` → `styles.css` → `design.css`.

Al final de `<body>` (el orden importa, solo `app.js` ejecuta el arranque):
1. `xlsx.full.min.js`
2. `demo-mode.js` — debe ir antes que todo lo que llame a `isDemoMode()`.
3. `storage.js` — solo declaraciones de persistencia.
4. `modules.js` — vistas/render (facturas, reportes, etc.).
5. `sync.js` — `NexoSync`.
6. `import-products.js` — importación de productos desde Excel.
7. `print.js` — plantillas de tickets térmicos (58/80 mm) y `printReceipt()`: en escritorio vía `desktop.printReceipt` (ventana oculta en `main.js`), en web con un `<iframe>` invisible. No usar `window.open` para imprimir: en Electron está bloqueado.
8. `app.js` — estado, lógica de negocio y `bootstrap()`.

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

Scripts de Node en `scratch/test-*.js` (`node scratch/test-demo-mode.js`). Simulan `window`/`document` y cargan los archivos de la app. Problemas conocidos ya existentes: `test-turnos-caja-and-pedidos-activos.js` falla (`paymentTimestamp is not defined` en `modules.js`) y `test-responsive-cards-and-navigation.js` no termina.
