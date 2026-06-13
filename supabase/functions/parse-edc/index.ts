import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
- fecha: string YYYY-MM-DD
- descripcion: string — nombre del comercio LIMPIO. NO incluyas el número de cuota (ej "04/04", "1/12") ni el bloque de moneda extranjera entre paréntesis (ej "(BR ,BRL, 166,16)"); esos datos van en sus campos. Ejemplos: "LOJAS RENNER 04/04" → "LOJAS RENNER"; "ALECRIM (BR ,BRL, 166,16)" → "ALECRIM".
- monto: number (positivo=gasto/débito, negativo=crédito/devolución/beneficio/descuento)
- moneda: "UYU" | "USD"
- es_pago: boolean — true SOLO si la transacción es un pago del titular hacia la tarjeta (ej "SU PAGO", "PAGO RECIBIDO", "PAGO - GRACIAS", "PAGO EN LINEA"). Estos NO son gastos. En cualquier otro caso false.
- categoria: string — DEBÉS elegir EXACTAMENTE uno de estos nombres y copiarlo TAL CUAL (mismas tildes y mayúsculas): ${catListStr}. NUNCA inventes un nombre que no esté en esta lista. Si ninguno aplica claramente, usá "Otros".
- tipo_gasto: "casual" | "recurrente" | "tdc"
  * "recurrente": servicios que se cobran todos los meses — streaming (Netflix, Spotify, Disney+, HBO, Apple TV, YouTube Premium), gym/fitness, seguros externos, internet, telefonía, planes de datos, cualquier suscripción mensual automática
  * "tdc": cargos propios de la tarjeta — cargo anual, renovación anual, IVA de financiación, intereses, mora, seguro de vida de la tarjeta, seguro de desempleo de la tarjeta, comisiones del banco sobre la tarjeta
  * "casual": cualquier otra compra puntual que no es recurrente ni cargo de tarjeta
- cuota_actual: number | null (ej: 2 si dice "2/12")
- cuotas_totales: number | null (ej: 12 si dice "2/12")
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
        model: 'claude-haiku-4-5',
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
