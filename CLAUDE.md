# CLAUDE.md — Guía del proyecto Finanzas App

Este archivo es leído automáticamente por Claude Code al inicio de cada sesión.
Define convenciones, arquitectura y reglas de formato que deben respetarse en todos los módulos.

---

## Flujo de trabajo con Git

- **Rama principal:** `main` — es la única rama del proyecto.
- Todos los cambios se hacen y pushean directamente a `main`.
- No crear ramas feature salvo que el usuario lo pida explícitamente.
- GitHub Pages despliega automáticamente desde `main`.

---

## Stack tecnológico

- **Frontend:** HTML + CSS + JavaScript vanilla (sin framework)
- **Backend / DB:** Supabase (PostgreSQL)
- **Gráficos:** Plotly.js
- **Precios de mercado:** Yahoo Finance (vía proxy/API pública)
- **Deploy:** GitHub Pages (rama `main`)

---

## Estructura de archivos

```
index.html              # Shell principal, nav, carga de scripts
css/
  main.css              # Estilos globales
js/
  config.js             # SUPABASE_URL y SUPABASE_KEY
  db.js                 # Helpers de DB + funciones de formato globales
  app.js                # Router SPA (hash-based) + toast
modules/
  dashboard.js          # Vista resumen general del patrimonio
  inversiones.js        # Mercado, Portafolio, Operaciones, Rentabilidad
  gastos.js             # Registro y listado de egresos
  ingresos.js           # Registro y listado de ingresos
  presupuesto.js        # Límites mensuales por categoría
  config_page.js        # Configuración de la app
```

Cada módulo expone un objeto en `window.Mods.<nombre>` con un método `render()` que escribe en `#content`.

---

## Funciones de formato globales (`js/db.js`)

| Función | Uso |
|---|---|
| `fmt(n, dec = 2)` | Número genérico con N decimales |
| `fmtUSD(n)` | Moneda en USD: 0 decimales si ≥ 1000, 2 decimales si < 1000 |
| `fmtDate(d)` | Fecha en formato `dd/mm/yyyy` |
| `plClass(n)` | Clase CSS según signo (`pos` / `neg` / `neu`) |
| `plSign(n)` | Prefijo `+` si positivo |

En `inversiones.js` existe además:

| Función | Uso |
|---|---|
| `this._fmtOrig(n, moneda)` | Precio en moneda origen: 0 decimales si ≥ 1000, 2 si < 1000 |

---

## Reglas de formato — OBLIGATORIAS en todos los módulos

### 1. Precios unitarios → moneda origen, 2 decimales
Los precios por unidad (precio de compra/venta de un activo) se muestran siempre
en la moneda original del ticker con 2 decimales.

```js
// ✅ Correcto
this._fmtOrig(precioOrig, moneda)   // ej: ARS 150,000.00 | $150.00
fmt(precio, 2) + ' ' + moneda       // en contextos de texto plano

// ❌ Incorrecto
fmtUSD(precio)                      // no forzar USD en precio unitario
fmt(precio, 4)                      // no usar 4 decimales para precios
```

> **Nota técnica:** `precio_unitario` en la tabla `operaciones` se guarda en USD.
> Para mostrar en moneda origen: `precio_orig = precio_unitario / tipo_cambio_usd`

### 2. Montos y valores totales → siempre USD
Comisiones, montos totales, valores de portafolio y cualquier suma agregada
se muestran siempre en USD.

```js
// ✅ Correcto
fmtUSD(monto)         // monto_total (ya está en USD en la DB)
fmtUSD(comision)      // comision (ya está en USD en la DB)
fmtUSD(montoUSD)      // monto calculado en USD

// ❌ Incorrecto
this._fmtOrig(monto, moneda)   // no mostrar montos en moneda origen
```

### 3. Cantidades → entero, sin decimales
Las cantidades de unidades/acciones se muestran como número entero.

```js
// ✅ Correcto
Math.round(qty)
fmt(Math.round(qty), 0)

// ❌ Incorrecto
fmt(qty, 4)    // no usar decimales en cantidades
```

### 4. Decimales según magnitud del valor
`fmtUSD` y `_fmtOrig` aplican esta regla automáticamente. Usarla siempre.

```js
// Regla: |valor| >= 100 → 0 decimales | |valor| < 100 → 2 decimales
fmtUSD(1500)    // → $1,500
fmtUSD(250)     // → $250
fmtUSD(99.5)    // → $99.50
fmtUSD(0.75)    // → $0.75

// ❌ Incorrecto
fmt(valor, 2)   // no hardcodear 2 decimales para valores monetarios de 3+ dígitos
```

---

## Esquema de base de datos (tablas principales)

### `operaciones`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | int | PK autoincremental |
| `ticker` | text | FK → activos |
| `tipo` | text | `'compra'` \| `'venta'` |
| `fecha` | date | |
| `cantidad` | numeric | Unidades compradas/vendidas |
| `precio_unitario` | numeric | **Siempre en USD** |
| `comision` | numeric | **Siempre en USD** |
| `monto_total` | numeric | Generado: `cantidad × precio + comision` (USD) |
| `moneda` | text | Moneda original del ticker (ej: `'ARS'`, `'GBX'`) |
| `tipo_cambio_usd` | numeric | TC al momento de la operación (USD por unidad de moneda) |
| `fuente` | text | `'manual'` \| `'ibkr_csv'` \| `'ibkr_xml'` |

### `activos`
| Campo | Tipo | Notas |
|---|---|---|
| `ticker` | text | PK |
| `moneda` | text | Moneda normalizada (GBX → GBP) |
| `tipo` | text | `'accion'` \| `'etf'` \| `'fondo'` \| `'otro'` |

### `precios_historicos`
| Campo | Tipo | Notas |
|---|---|---|
| `ticker` + `fecha` | PK compuesta | |
| `cierre` / `apertura` / `maximo` / `minimo` | numeric | En USD |
| `cierre_orig` / `apertura_orig` / `maximo_orig` / `minimo_orig` | numeric | En moneda origen |
| `moneda` | text | Moneda original del precio |

### `gastos`
Montos en la moneda que el usuario ingresa (campo `monto`). Sin conversión automática.

### `ingresos`
Ídem gastos.

---

## Convenciones de código

- Cada módulo es un objeto literal en `window.Mods.<nombre>` — no usar clases ni imports.
- El DOM se escribe directamente vía `innerHTML` con template literals.
- Los datos de Supabase se obtienen con `dbFetch`, `dbInsert`, `dbUpsert`, `dbDelete`.
- Configuración de la app: `getConfig(clave)` / `setConfig(clave, valor)` — tabla `configuracion`.
- No agregar comentarios salvo que el motivo no sea obvio (workarounds, invariantes ocultos).
- No agregar manejo de errores para escenarios imposibles; solo en boundaries externos (API, DB).
