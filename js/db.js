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

async function getAuthUserId() {
  const { data: { user } } = await getDB().auth.getUser();
  return user?.id ?? null;
}

async function getConfig(clave) {
  const uid = await getAuthUserId();
  if (!uid) return null;
  const { data } = await getDB().from('configuracion')
    .select('valor').eq('clave', clave).eq('user_id', uid).maybeSingle();
  return data?.valor ?? null;
}

async function setConfig(clave, valor) {
  const uid = await getAuthUserId();
  if (!uid) return;
  const { error } = await getDB().from('configuracion')
    .upsert({ clave, valor, user_id: uid }, { onConflict: 'clave,user_id' });
  if (error) throw error;
}

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
function fmtUSD(n) {
  if (n == null) return '—';
  const dec = Math.abs(n) >= 100 ? 0 : 2;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function plClass(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'neu'; }
function plSign(n)  { return n > 0 ? '+' : ''; }

// Paleta Plotly según tema activo. Los valores dark son los históricos de la app
// (el modo oscuro queda idéntico); los light corresponden al tema "Lino".
function plotlyTheme() {
  const light = window.APP_THEME === 'light';
  return light ? {
    font:       '#5C5142',
    fontMono:   '#6E6455',
    axis:       '#9A8C74',
    tick:       '#7A6F5D',
    grid:       'rgba(70,58,40,.10)',
    gridStrong: '#E7DFD2',
    zero:       'rgba(70,58,40,.20)',
    spike:      '#B9AD97',
    plotBg:     '#FFFFFF',
  } : {
    font:       '#cfcfcf',
    fontMono:   '#8096b0',
    axis:       '#3d5568',
    tick:       '#6a88a0',
    grid:       'rgba(255,255,255,.05)',
    gridStrong: '#0d2848',
    zero:       'rgba(255,255,255,.1)',
    spike:      '#546272',
    plotBg:     '#071E3D',
  };
}
