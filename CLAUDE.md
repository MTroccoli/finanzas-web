# CLAUDE.md — Guía del proyecto Finanzas App

Este archivo es leído automáticamente por Claude Code al inicio de cada sesión.
Define convenciones, arquitectura, estado actual y reglas de formato.

---

## Flujo de trabajo con Git

- **Rama principal:** `main` — única rama del proyecto.
- Todos los cambios se hacen y pushean directamente a `main`.
- No crear ramas feature salvo que el usuario lo pida explícitamente.
- GitHub Pages despliega automáticamente desde `main`.
- Versiones en `index.html`: `?v=YYYYMMDD[letra]` — incrementar la letra en cada deploy del mismo día.

---

## Stack tecnológico

- **Frontend:** HTML + CSS + JavaScript vanilla (sin framework, sin build step)
- **Backend / DB:** Supabase (PostgreSQL) — proyecto `qiwirnhxknmmwvcwgstg` región `us-west-2`
- **Gráficos:** Plotly.js (cargado desde CDN)
- **Fuentes:** Google Fonts — Bebas Neue, DM Sans, DM Mono
- **Precios de mercado:** Yahoo Finance vía proxy/API pública
- **Deploy:** GitHub Pages (rama `main`) → repo `mtroccoli/finanzas-web`

---

## Estructura de archivos

```
index.html              # Shell principal, nav, carga de scripts
css/
  main.css              # Estilos globales (variables CSS, componentes, mobile)
js/
  config.js             # SUPABASE_URL y SUPABASE_KEY
  db.js                 # Helpers de DB + funciones de formato globales
  app.js                # Router SPA (hash-based) + toast()
modules/
  dashboard.js          # Vista resumen general del patrimonio
  inversiones.js        # Mercado, Portafolio, Operaciones, Rentabilidad
  gastos.js             # Registro, importación y resumen de egresos  ← más complejo
  ingresos.js           # Registro y listado de ingresos
  presupuesto.js        # Límites mensuales por categoría
  config_page.js        # Configuración de la app (TC, moneda base, etc.)
```

Cada módulo expone un objeto en `window.Mods.<nombre>` con método `render()` que escribe en `#content`.

---

## Funciones globales (`js/db.js`)

### DB helpers
| Función | Uso |
|---|---|
| `dbFetch(table, {select, filters, order, limit})` | SELECT con filtros opcionales |
| `dbInsert(table, data)` | INSERT, devuelve el row creado |
| `dbUpdate(table, data, filters)` | UPDATE con filtros |
| `dbUpsert(table, data)` | UPSERT por PK |
| `dbDelete(table, filters)` | DELETE con filtros |
| `getConfig(clave)` | Lee de tabla `configuracion` |
| `setConfig(clave, valor)` | Escribe en tabla `configuracion` |

### Formato
| Función | Uso |
|---|---|
| `fmt(n, dec = 2)` | Número genérico con N decimales |
| `fmtUSD(n)` | USD: 0 dec si ≥ 100, 2 dec si < 100 |
| `fmtDate(d)` | Fecha `dd/mm/yyyy` |
| `plClass(n)` | CSS: `pos` / `neg` / `neu` según signo |
| `plSign(n)` | Prefijo `+` si positivo |

En `inversiones.js` además:
| Función | Uso |
|---|---|
| `this._fmtOrig(n, moneda)` | Precio en moneda origen: 0 dec si ≥ 1000, 2 si < 1000 |

En `gastos.js` además:
| Función | Uso |
|---|---|
| `this._fmtMon(n, moneda)` | Formatea en moneda origen (UYU, ARS, etc.) |
| `this._fmtUSD(n)` | Alias local de fmtUSD |
| `this._fmtView(n, mon, mode, tc)` | Convierte según modo ORIGEN/UYU/USD |

---

## Reglas de formato — OBLIGATORIAS

### 1. Precios unitarios → moneda origen
```js
this._fmtOrig(precioOrig, moneda)   // ✅ ARS 150,000 | $150.00
fmtUSD(precio)                       // ❌ no forzar USD en precio unitario
```
> `precio_unitario` en DB siempre en USD. Para mostrar: `precio_orig = precio_unitario / tipo_cambio_usd`

### 2. Montos y totales → siempre USD
```js
fmtUSD(monto_total)    // ✅
this._fmtOrig(monto)   // ❌
```

### 3. Cantidades → entero sin decimales
```js
fmt(Math.round(qty), 0)   // ✅
fmt(qty, 4)               // ❌
```

### 4. Decimales según magnitud
`fmtUSD` y `_fmtOrig` aplican automáticamente: `|val| ≥ 100` → 0 dec, `< 100` → 2 dec.

---

## Esquema de base de datos (estado actual)

### `gastos`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | int PK | autoincremental |
| `fecha` | date | |
| `monto` | numeric | En moneda original |
| `moneda` | text | default `'UYU'` |
| `comercio` | text | nombre del comercio / descripción |
| `categoria_id` | int | FK → categorias |
| `cuota_actual` | int | nulo si no es cuota |
| `cuotas_totales` | int | nulo si no es cuota |
| `banco_tarjeta` | text | nombre del banco/tarjeta |
| `tipo_gasto` | text | `'casual'` \| `'recurrente'` \| `'cuota'` |
| `titular_adicional` | text | si es gasto de tarjeta adicional |
| `incluido_en_gastos` | bool | false = no suma al total propio |
| `usuario` | text | default `'compartido'` |
| `fuente` | text | `'manual'` \| `'ibkr_csv'` \| importación |
| `importacion_id` | int | FK → importaciones |
| `dividido_entre` | int | default 1 |
| `referencia_ext` | text | ID externo para deduplicación |
| `notas` | text | |

### `ingresos`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | int PK | |
| `fecha` | date | |
| `monto` | numeric | En la moneda indicada |
| `moneda` | text | `'USD'` \| `'UYU'` — default `'USD'` |
| `descripcion` | text | |
| `tipo_id` | int | FK → tipos_ingreso |
| `recurrente` | int | 0/1 (no usado activamente aún) |
| `notas` | text | |
| `usuario` | text | legacy, no se usa en el formulario |

### `tipos_ingreso` (valores actuales)
`Alquileres, Dividendos, Freelance, Otros, Reembolso, Renta, Salario`

### `operaciones`
| Campo | Tipo | Notas |
|---|---|---|
| `ticker` | text | FK → activos |
| `tipo` | text | `'compra'` \| `'venta'` |
| `cantidad` | numeric | |
| `precio_unitario` | numeric | **Siempre en USD** |
| `comision` | numeric | **Siempre en USD** |
| `monto_total` | numeric | cantidad × precio + comision (USD) |
| `moneda` | text | Moneda original del ticker |
| `tipo_cambio_usd` | numeric | TC al momento de la operación |
| `fuente` | text | `'manual'` \| `'ibkr_csv'` \| `'ibkr_xml'` |

### `activos`
`ticker (PK), nombre, tipo, sector, industria, pais, moneda (default 'USD'), activo`

### `precios_historicos`
PK compuesta `(ticker, fecha)`. Columnas en USD: `apertura, maximo, minimo, cierre, cierre_ajustado, volumen`. Columnas en moneda origen: `cierre_orig, apertura_orig, maximo_orig, minimo_orig, moneda`.

### `configuracion`
Claves usadas:
| clave | valor | uso |
|---|---|---|
| `tipo_cambio` | número | TC UYU/USD para conversiones |
| `moneda_base` | `'UYU'`\|`'USD'` | moneda por defecto en gastos |
| `benefit_categories` | `'1,5,12'` | IDs de categorías que son beneficios/ahorro |

---

## Módulo `gastos.js` — Estado actual y arquitectura interna

### Estado del objeto
```js
{
  _tab:           'resumen',     // 'resumen' | 'registro' | 'cuotas' | 'adicional' | ...
  _resView:       'gastos',      // 'gastos' | 'beneficios' | 'cuotas'
  _resFilterMonth: null,         // 'YYYY-MM' al clickear barra; null = sin filtro
  _cuotasResSort: { col: 'total', dir: 'desc' },
  _tc:            '',            // tipo de cambio UYU/USD (string numérico)
  _gastoMoneda:   'ORIGEN',      // 'ORIGEN' | 'UYU' | 'USD' — modo conversión
  _resBanco:      '',            // filtro banco/tarjeta
  _resTipo:       '',            // filtro tipo_gasto
  _resCat:        '',            // filtro categoria_id
  _resDesde:      null,          // fecha desde (string ISO)
  _resHasta:      null,          // fecha hasta
  _cats:          [],            // array de categorías cargado en render
  _cuotasBanco:   '',            // filtro banco en pestaña Cuotas
}
```

### Vista Resumen (`_drawResumen`)
Estructura de datos computados:
- `byCat`: `{categoria_id: monto_en_convCur}` — gastos por categoría (rango completo)
- `byMonth`: `{YYYY-MM: {UYU, USD}}` — gastos por mes
- `bySave` / `byMonthSave`: ídem para beneficios (montos negativos con cat. de beneficio)
- `bySaveCom`: `{comercio: monto}` — ahorro por comercio (en convCur)
- `bySaveComNative`: `{comercio: {UYU, USD}}` — ahorro en moneda original
- `cuotasByMonth`: `{YYYY-MM: {UYU, USD, count}}` — cuotas proyectadas por mes
- `planMap`: `{key: row}` — deduplicación de planes de cuotas

#### Deduplicación de planes (`planMap`)
```js
// Clave: une los campos que identifican UNÍVOCAMENTE un plan de cuotas
const key = `${comercio.slice(0,30)}|${cuotas_totales}|${Math.round(monto)}|${moneda}`;
// Se queda con la cuota_actual más alta (la más reciente)
```
**Importante:** si dos cuotas del mismo plan tienen `monto` diferente en más de 0.5 (ej: 5000 vs 5001), aparecerán como dos planes distintos.

#### Filtrado por mes (`_resFilterMonth`)
Cuando el usuario hace click en una barra del gráfico:
1. Se setea `_resFilterMonth = 'YYYY-MM'`
2. Se recalculan `byCatDetail`, `bySaveComDetail`, `detailGastUYU/USD` para ese mes
3. El pie chart muestra solo las categorías de ese mes
4. El header del panel muestra los totales del mes
5. El `div#g-detail-rows` muestra la tabla de transacciones individuales del mes
6. Click en la misma barra → limpia el filtro

#### Colores en la tabla de transacciones (`g-detail-rows`)
- Gastos normales: **azul** (`#3b82f6`)
- Negativos / beneficios: **verde** (`#10b981`) con prefijo `−`

#### Gráfico cuotas (`isCuotas`)
- Dos barras apiladas: **violeta** (recurrentes, base) + **dorado** (cuotas, encima)
- Y-axis en UYU (convierte USD × TC aproximado `tc || 40`)
- `projMonths`: array dinámico desde hoy hasta el mes de la última cuota
- Sin anotaciones sobre las barras (el tooltip Plotly muestra los valores al hover)

#### Gráfico ahorro (`isBenef`)
- Y-axis en **UYU** (nativo + USD × TC); prefijo `$U`
- Una sola barra verde por mes; el hover muestra desglose UYU/USD

---

## Módulo `ingresos.js` — Estado actual

### Estado
```js
{ _filterTipo: '' }   // ID de tipo_ingreso para filtrar la tabla
```

### Presets recurrentes (localStorage)
```js
// Clave: 'ingresos_presets' → array JSON (máx 10)
{
  monto:        '5000',
  moneda:       'USD',        // 'USD' | 'UYU'
  desc:         'Salario',
  tipo:         '1',          // ID de tipos_ingreso (string)
  frecuencia:   'mensual',    // 'mensual' | 'bimensual' | 'semestral' | 'anual'
  auto:         true,         // si true, se auto-inserta al vencer
  ultima_carga: '2026-06-01', // fecha de la última inserción (= fecha del form al guardar)
}
```

### Auto-carga al abrir el módulo
`_checkAutoPresets()` se ejecuta en cada `render()`. Para cada preset con `auto:true`:
- Calcula `_nextDue(ultima_carga, frecuencia)` → suma los meses según frecuencia
- Si `today >= nextDue` → inserta ingreso en DB y actualiza `ultima_carga = today`

### Comportamiento al guardar preset ("💾 Recurrente" → panel frecuencia → "Confirmar")
- Si `fecha_del_form <= hoy` → también inserta el ingreso inmediatamente en DB
- `ultima_carga` se setea a la fecha del formulario (no a hoy)

### Layout del formulario (3 filas, CSS grid)
```
Fila 1: [Fecha 112px] [Moneda 62px] [Monto 1fr]  → grid: 112px 62px 1fr
Fila 2: [Tipo 1fr] [Descripción 2fr]              → grid: 1fr 2fr
Fila 3: [✚ Registrar 1fr] [💾 Recurrente 1fr]     → grid: 1fr 1fr
```
**Nota mobile:** el `input[type=date]` en iOS Safari ignora `width:100%` por su UA stylesheet. Solución: columna fija en px + `-webkit-appearance:none;appearance:none` en el input.

---

## Convenciones de código

- Cada módulo es un objeto literal en `window.Mods.<nombre>` — sin clases ni imports.
- El DOM se escribe vía `innerHTML` con template literals.
- Datos de Supabase: `dbFetch`, `dbInsert`, `dbUpsert`, `dbDelete`.
- Configuración: `getConfig(clave)` / `setConfig(clave, valor)`.
- Notificaciones: `toast('mensaje')` o `toast('mensaje', 'err')`.
- Sin comentarios salvo para workarounds o invariantes no obvios.
- Sin manejo de errores para escenarios imposibles; solo en boundaries externos (API, DB).
- Tablas con scroll horizontal en mobile: `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table style="min-width:Xpx">`.
- Formularios mobile: usar `display:grid` con columnas fijas/fr explícitos en lugar de `display:flex` para evitar overflow de inputs nativos.

---

## CSS — Variables y clases clave

### Variables principales
```css
--bg, --surface, --surface-alt   /* fondos */
--border, --border-strong        /* bordes */
--text, --text-sec               /* texto */
--accent, --accent-dark          /* azul principal */
--gold                           /* dorado para valores */
```

### Clases utilitarias
```css
.form-card / .card    /* panel con fondo, borde, border-radius:12, padding:20px 24px */
.form-grid            /* grid auto-fill minmax(160px,1fr), gap:14px */
.form-group           /* flex-column, gap:6px — CUIDADO: no seteea width en inputs */
.btn / .btn-primary / .btn-ghost / .btn-danger
.table-wrap / .table-header / .table-title
.pos (verde) / .neg (rojo) / .neu (gris)   /* clases de color P&L */
```

### Mobile breakpoints
`@media (max-width: 768px)` — los módulos usan inline styles para mobile; el CSS global ajusta nav, cards y form-grid.

---

## Plotly — Configuración estándar

```js
Plotly.newPlot('id', traces, {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor:  'rgba(0,0,0,0)',
  font: { color: '#cfcfcf', family: 'DM Sans, sans-serif', size: 11 },
  dragmode: false,
  margin: { t: 40, r: 10, b: 80, l: 70 },
  xaxis: { fixedrange: true, gridcolor: 'rgba(255,255,255,.05)' },
  yaxis: { fixedrange: true, gridcolor: 'rgba(255,255,255,.05)' },
}, { displayModeBar: false, responsive: true, scrollZoom: false });
```
