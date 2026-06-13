-- Cambios de esquema — 2026-06-13
-- Aplicados en producción vía Supabase. Se versionan acá como registro.

-- 1) Permitir tipo_gasto = 'tdc' (cargos propios de la tarjeta: cargo anual,
--    intereses, IVA de financiación, seguros de la TDC). El UI y el parseo de
--    EDC ya lo usaban, pero el constraint sólo aceptaba 'recurrente' | 'casual',
--    lo que provocaba "gastos_tipo_gasto_check" al guardar cargos de TDC.
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_tipo_gasto_check;
ALTER TABLE gastos ADD CONSTRAINT gastos_tipo_gasto_check
  CHECK (tipo_gasto = ANY (ARRAY['recurrente'::text, 'casual'::text, 'tdc'::text]));

-- 2) Moneda aprendida por comercio. Cuando el usuario corrige la moneda
--    (UYU/USD) en la vista previa del EDC, se guarda acá y se reaplica en
--    futuros parseos del mismo comercio.
ALTER TABLE merchant_categorias ADD COLUMN IF NOT EXISTS moneda text
  CHECK (moneda IN ('UYU', 'USD'));
