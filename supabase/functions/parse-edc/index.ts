import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
};

function parseRobust(text: string): any {
  // Strategy 1: direct parse
  try { return JSON.parse(text); } catch {}

  // Strategy 2: extract first {...} block
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
    // Strategy 3: fix trailing commas
    const fixed = m[0].replace(/,([\s\r\n]*[}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch {}
    // Strategy 4: close unclosed brackets/braces
    let s = fixed;
    const opens  = (s.match(/\[/g) || []).length;
    const closes = (s.match(/\]/g) || []).length;
    if (opens > closes) s += ']'.repeat(opens - closes);
    const ob = (s.match(/\{/g) || []).length;
    const cb = (s.match(/\}/g) || []).length;
    if (ob > cb) s += '}'.repeat(ob - cb);
    try { return JSON.parse(s); } catch {}
  }

  // Strategy 5: extract individual transaction objects
  const txs: any[] = [];
  for (const hit of text.matchAll(/\{[^{}]*"fecha"[^{}]*"descripcion"[^{}]*\}/gs)) {
    try { txs.push(JSON.parse(hit[0])); } catch {}
  }
  if (txs.length) return { transactions: txs, fecha_cierre: null, banco_tarjeta: null };

  throw new Error('No se pudo parsear la respuesta de la IA');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) throw new Error('No se recibió archivo');

    let learned: { ejemplo: string; categoria: string }[] = [];
    try { learned = JSON.parse((form.get('learned') as string) || '[]'); } catch {}

    // Categorías reales del usuario (enviadas por el cliente). Si no llegan, usar default.
    let cats: string[] = [];
    try { cats = JSON.parse((form.get('categorias') as string) || '[]'); } catch {}
    const DEFAULT_CATS = [
      'Alimentación', 'Restaurantes', 'Supermercado', 'Transporte', 'Salud', 'Farmacia',
      'Educación', 'Entretenimiento', 'Viajes', 'Ropa', 'Tecnología', 'Servicios',
      'Suscripciones', 'Combustible', 'Beneficio', 'Otros',
    ];
    const catList    = (Array.isArray(cats) && cats.length) ? cats : DEFAULT_CATS;
    const catListStr = catList.join(', ');

    // File → base64
    const bytes = await file.arrayBuffer();
    const u8    = new Uint8Array(bytes);
    let b64 = '';
    const chunk = 8192;
    for (let i = 0; i < u8.length; i += chunk)
      b64 += String.fromCharCode(...u8.subarray(i, i + chunk));
    const base64    = btoa(b64);
    const mediaType = (file.type || 'application/pdf') as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    // ── Learned hints (máxima prioridad) ─────────────────────────────────────
    const learnedBlock = learned.length
      ? `\n## CATEGORÍAS YA APRENDIDAS — MÁXIMA PRIORIDAD
Si el comercio de una transacción coincide (exacto o parcial, ignorando números de cuota como "1/12") con alguno de estos ejemplos, usá OBLIGATORIAMENTE esa categoría, por encima de cualquier otra regla:
${learned.map(l => `- "${l.ejemplo}" → ${l.categoria}`).join('\n')}\n`
      : '';

    // ── Prompt ───────────────────────────────────────────────────────────────
    const prompt = `Sos un asistente financiero experto en análisis de estados de cuenta de tarjetas de crédito (EDC) de Uruguay.
Analizá este documento COMPLETO y extraé TODAS las transacciones en formato JSON estricto.
${learnedBlock}
## TARJETAS ADICIONALES
Muchos EDC incluyen secciones separadas por tarjeta adicional. Debés:
1. Detectar TODAS las tarjetas adicionales que aparezcan en el documento (pueden ser varias)
2. Para CADA transacción de una adicional: marcar tarjeta_adicional: true
3. Extraer adicional_card_digits (últimos 4 dígitos de ESA tarjeta adicional, ej: "7084")
4. Extraer adicional_card_name (nombre del titular de la adicional exactamente como aparece en el doc, en MAYÚSCULAS, ej: "JUAN PEREZ"). Si no aparece el nombre, usar null.
5. Si hay múltiples tarjetas adicionales, cada transacción lleva los datos de SU tarjeta.
6. Para beneficios o descuentos que aparecen en la tarjeta titular PERO corresponden a una compra de adicional: marcar descuento_de_adicional: true y en ref_comercio el nombre exacto del comercio de la compra original de la adicional.

## CAMPOS POR TRANSACCIÓN
Inclui exactamente estos campos para cada transacción:
- fecha: string YYYY-MM-DD. Reglas de fecha:
  * Algunos bancos (Itaú) escriben la fecha como "DD MM AA" separada por ESPACIOS (ej "05 04 26" = día 05, mes 04, año 2026 → "2026-04-05"). El año de dos dígitos "AA" es 20AA.
  * Otros bancos usan "DD/MM" o "DD/MM/AA".
  * Usá SIEMPRE la fecha LITERAL de cada renglón. Las compras en cuotas muestran la fecha de la compra ORIGINAL, que puede ser de meses o incluso años ANTERIORES al cierre del resumen (ej un resumen de abril 2026 puede tener una cuota con fecha "09 10 25" = 2025-10-09). NO cambies esa fecha al mes del resumen.
- descripcion: string — nombre del comercio LIMPIO. NO incluyas el número de cuota (ej "04/04", "1/12") ni el bloque de moneda extranjera entre paréntesis (ej "(BR ,BRL, 166,16)"); esos datos van en sus campos. Ejemplos: "LOJAS RENNER 04/04" → "LOJAS RENNER"; "ALECRIM (BR ,BRL, 166,16)" → "ALECRIM".
- monto: number (positivo=gasto/débito, negativo=crédito/devolución/beneficio/descuento)
- moneda: "UYU" | "USD" — ver la sección MONEDA más abajo, es CRÍTICO no equivocarse
- es_pago: boolean — true SOLO si la transacción es un pago del titular hacia la tarjeta (ej "SU PAGO", "PAGO RECIBIDO", "PAGO - GRACIAS", "PAGO EN LINEA"). Estos NO son gastos. En cualquier otro caso false.
- categoria: string — DEBÉS elegir EXACTAMENTE uno de estos nombres y copiarlo TAL CUAL (mismas tildes y mayúsculas): ${catListStr}. NUNCA inventes un nombre que no esté en esta lista. Si ninguno aplica claramente, usá "Otros".
- tipo_gasto: "casual" | "recurrente" | "tdc"
  * "recurrente": servicios que se cobran todos los meses — streaming (Netflix, Spotify, Disney+, HBO, Apple TV, YouTube Premium), gym/fitness, seguros externos, internet, telefonía, planes de datos, cualquier suscripción mensual automática
  * "tdc": cargos propios de la tarjeta — cargo anual, renovación anual, IVA de financiación, intereses, mora, seguro de vida de la tarjeta, seguro de desempleo de la tarjeta, comisiones del banco sobre la tarjeta
  * "casual": cualquier otra compra puntual que no es recurrente ni cargo de tarjeta
- cuota_actual: number | null. El indicador de cuota aparece como "N/M" entre la descripción y los importes, y PUEDE tener espacios alrededor de la barra (ej "2/12", "7/10", "6/ 6", "1/ 2"). cuota_actual = N (ej: 2 si dice "2/12", 6 si dice "6/ 6").
- cuotas_totales: number | null = M (ej: 12 si dice "2/12", 6 si dice "6/ 6"). OJO: NO confundas el indicador de cuota de una transacción con la tabla de "oferta de financiación de saldo" que algunos bancos ponen al final (líneas tipo "3 cuotas de ...", "6 cuotas de ...", "12 cuotas de ... TEA ...%"): esa tabla NO son transacciones, ignorala por completo.
- tarjeta_adicional: boolean
- adicional_card_digits: string | null (solo si tarjeta_adicional: true)
- adicional_card_name: string | null (solo si tarjeta_adicional: true)
- descuento_de_adicional: boolean
- ref_comercio: string | null (solo si descuento_de_adicional: true)

## GUÍA DE CATEGORIZACIÓN (mapeá el comercio al nombre de la lista de arriba que mejor corresponda al concepto)
Reconocé comercios uruguayos comunes y NO los dejes en "Otros" si son identificables:
- Supermercados / autoservicios / almacenes: Disco, Devoto, Tienda Inglesa, Ta-Ta, Macromercado, El Dorado, Frog, Kinko, "SUPERMERCADO ...", "AUTOSERVICE ..." → concepto supermercado/alimentación
- Farmacias: Farmashop, San Roque, Farmacia Brasil, "FARMACIA ..." → concepto farmacia/salud
- Salud: sanatorios, mutualistas, médicos, laboratorios, ópticas → concepto salud
- Seguros: HDI, Sura/SURA, Mapfre, Porto Seguro, BSE, "SEGURO ...", "SEGUROS ..." → concepto seguros (si no existe categoría de seguros, usá Servicios)
- Combustible: Ancap, Esso, Petrobras, Shell, DUCSA, "ESTACION ..." → concepto combustible/transporte
- Transporte / movilidad: Uber, Cabify, taxis, peajes, STM, ómnibus, estacionamientos → concepto transporte
- Restaurantes / bares / cafés / delivery: PedidosYa, Rappi, McDonald's, Burger King, "RESTAURANT ...", parrillas, cafés → concepto restaurantes
- Streaming / suscripciones: Netflix, Spotify, Disney, HBO Max, YouTube Premium, Apple, Amazon Prime, ChatGPT/OpenAI → concepto suscripciones
- Indumentaria: Zara, tiendas de ropa, calzado → concepto ropa
- Tecnología / electrónica: tiendas de electrónica, Apple Store, Mercado Libre tech → concepto tecnología
Si el comercio es claramente reconocible, asigná su categoría; sólo usá "Otros" cuando realmente no se pueda identificar.

## MONEDA (CRÍTICO — determiná la moneda por el símbolo que acompaña al importe)
En Uruguay los EDC de Santander y otros bancos muestran los importes en DOS columnas:
- Columna IZQUIERDA: importes en PESOS URUGUAYOS (UYU) — símbolo "$"
- Columna DERECHA: importes en DÓLARES (USD) — símbolo "US$", "U$S", "USD" o "U$"

REGLAS ABSOLUTAS para determinar la moneda:
1. Si el importe aparece con el símbolo "$" SOLO (sin "US", "U$", ni "USD" antes) → moneda: "UYU"
2. Si el importe aparece con "US$", "U$S", "U$", "USD", "US " antes del número → moneda: "USD"
3. Si el importe aparece en la columna de la IZQUIERDA (sin símbolo de dólar) → moneda: "UYU"
4. Si el importe aparece en la columna de la DERECHA (con símbolo de dólar o USD) → moneda: "USD"
5. NUNCA infieras la moneda por el nombre del comercio ni porque "suene" internacional.
6. Comercios LOCALES uruguayos (telepeaje, peajes, ANTEL, UTE, OSE, supermercados, farmacias, ómnibus/STM, taxis, combustible) son CASI SIEMPRE pesos (UYU).
7. Si tenés duda, la moneda por DEFECTO es "UYU" — NO "USD".
8. La MAYORÍA de las transacciones en un EDC uruguayo son en pesos. Si estás marcando más de la mitad como USD, probablemente estás equivocado.

## FORMATO DE FILA ITAÚ URUGUAY (si el documento es de Itaú)
Cada transacción se lista con columnas separadas por espacios, en este orden:
  FECHA(DD MM AA)  TERMINACIÓN(4 dígitos)  DESCRIPCIÓN  [N/M de cuota]  [importe moneda origen]  importe en pesos
- Los 4 dígitos justo después de la fecha son la TERMINACIÓN de la tarjeta (ej "6028"). NO son parte de la descripción ni del importe. Si esa terminación corresponde a una tarjeta adicional, usala como adicional_card_digits; si es la tarjeta titular, ignorala.
- Hay hasta DOS columnas de importe: la de la IZQUIERDA es el importe en la moneda de ORIGEN (solo aparece si la compra fue en moneda extranjera, normalmente USD); la de la DERECHA es el importe en PESOS (UYU). Determiná la moneda así: si el renglón SOLO tiene importe en la columna de pesos (derecha) → moneda "UYU"; si tiene importe en la columna de origen (izquierda) → esa es la moneda (normalmente "USD", ej suscripciones como CLAUDE.AI, APPLE.COM/BILL, GOOGLE, o compras en el exterior/aerolíneas).
- Líneas que NO son transacciones y debés IGNORAR: "SALDO DEL ESTADO DE CUENTA ANTERIOR", "SALDO CONTADO", "SALDO FINANCIABLE", "SEGURO DE VIDA SOBRE SALDO" total, la tabla de oferta de financiación ("N cuotas de ... TEA ...%"), "UD. HA GENERADO ... MILLAS", totales y textos promocionales.
- "PAGOS" con importe negativo = pago del titular a la tarjeta → es_pago: true.
- "REDUC. IVA LEY 17934" / "REDUC. IVA" (importe negativo) = reducción/crédito de IVA → moneda según la columna, tipo_gasto "tdc".
- "COM. PAGO RED COBRANZA" y cargos/comisiones/seguros de la tarjeta → tipo_gasto "tdc".

## DATOS DEL DOCUMENTO
También extraé del encabezado/pie del documento:
- fecha_cierre: string YYYY-MM (mes del cierre del resumen)
- banco_tarjeta: string (nombre del banco + tipo de tarjeta, ej: "BBVA Visa", "Santander Mastercard", "BROU Visa")

Devolvé ÚNICAMENTE JSON válido con esta estructura exacta, sin texto antes ni después:
{
  "fecha_cierre": "YYYY-MM",
  "banco_tarjeta": "...",
  "transactions": [ ... ]
}`;

    // ── Claude call ──────────────────────────────────────────────────────────
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!aiResp.ok) {
      const err = await aiResp.text();
      throw new Error(`Anthropic error ${aiResp.status}: ${err}`);
    }

    const aiJson    = await aiResp.json();
    const rawText   = (aiJson.content?.[0]?.text ?? '') as string;
    const truncated = aiJson.stop_reason === 'max_tokens';

    const parsed        = parseRobust(rawText);
    const transactions  = Array.isArray(parsed) ? parsed : (parsed.transactions ?? []);
    const fecha_cierre  = parsed.fecha_cierre  ?? null;
    const banco_tarjeta = parsed.banco_tarjeta ?? null;

    // Derivar lista única de tarjetas adicionales detectadas
    const adicionales: { digits: string; name: string | null }[] = [];
    const seen = new Set<string>();
    for (const t of transactions) {
      if (t.tarjeta_adicional && t.adicional_card_digits) {
        const k = String(t.adicional_card_digits);
        if (!seen.has(k)) {
          seen.add(k);
          adicionales.push({ digits: k, name: t.adicional_card_name ?? null });
        }
      }
    }

    return new Response(
      JSON.stringify({ transactions, count: transactions.length, fecha_cierre, banco_tarjeta, adicionales, truncated }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message ?? String(err) }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }
});
