-- Cambios de esquema — 2026-06-14
-- Aplicado en producción vía Supabase MCP. Se versiona acá como registro.

-- Cierre y vencimiento por mes/estado de cuenta de cada tarjeta.
-- `banco_tarjeta` referencia el texto libre que usa `gastos.banco_tarjeta`
-- (no hay tabla de tarjetas; la lista se deriva de los gastos/importaciones).
create table if not exists tarjeta_periodos (
  banco_tarjeta text not null,
  periodo       text not null,            -- 'YYYY-MM'
  cierre        date,
  vencimiento   date,
  primary key (banco_tarjeta, periodo)
);

alter table tarjeta_periodos enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'tarjeta_periodos' and policyname = 'tarjeta_periodos_all'
  ) then
    create policy tarjeta_periodos_all on tarjeta_periodos
      for all using (true) with check (true);
  end if;
end $$;
