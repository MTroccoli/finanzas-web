let _sb = null;

function getDB() {
  if (!_sb) _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sb;
}

async function dbFetch(table, { select = '*', filters = {}, order = null, limit = null } = {}) {
  let q = getDB().from(table).select(select);
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  if (order) q = q.order(order.col, { ascending: order.asc ?? true });
  if (limit)  q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function dbInsert(table, data) {
  const { data: result, error } = await getDB().from(table).insert(data).select();
  if (error) throw error;
  return result[0];
}

async function dbUpdate(table, data, filters = {}) {
  let q = getDB().from(table).update(data);
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  const { data: result, error } = await q.select();
  if (error) throw error;
  return result;
}

async function dbDelete(table, filters = {}) {
  let q = getDB().from(table).delete();
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  const { error } = await q;
  if (error) throw error;
}

async function dbUpsert(table, data) {
  const { data: result, error } = await getDB().from(table).upsert(data).select();
  if (error) throw error;
  return result;
}

async function getConfig(clave) {
  const rows = await dbFetch('configuracion', { select: 'valor', filters: { clave } });
  return rows.length ? rows[0].valor : null;
}

async function setConfig(clave, valor) {
  await dbUpsert('configuracion', { clave, valor });
}

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
function fmtUSD(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function plClass(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu'; }
function plSign(n)  { return n > 0 ? '+' : ''; }
