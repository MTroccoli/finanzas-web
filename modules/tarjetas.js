window.Mods = window.Mods || {};
window.Mods.tarjetas = {
  _comRawCache:     null,
  _adicRawCache:    null,
  _descCache:       null,
  _descCatSpendCache: null,
  _descBanco:       '',
  _descCat:         '',
  _descSearch:      '',
  _descGozado:      '',  // '' | 'gozado' | 'no-gozado'
  _comSort:         { col: 'count', dir: 'desc' },
  _comSelected:     new Set(),
  _comSuggestOpen:  false,
  _suggestOpenKeys: new Set(),
  _suggestExcluded: {},
  _suggestSearch:   '',
  _suggestNames:    {},
  _adicOpenMonths:  new Set(),
  _adicTitular:     '',
  _adicMes:         null,
  _adicTitularFiltro: '',
  _adicCards:       [],

  _misEditId:       null,
  _misCards:        null,
  _misCatCache:     null,

  // State needed by helpers
  _cats:            [],
  _learned:         {},
  _histSearch:      '',
  _histBanco:       '',
  _comTipo:         '',
  _comerciosCache:  null,
  _visibleComNorms: null,
  _adicClickHandler: null,

  _invalidateCache() {
    this._comRawCache       = null;
    this._adicRawCache      = null;
    this._descCatSpendCache = null;
    this._descCache         = null;
  },

  _normMerchant(s) {
    if (!s) return '';
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b\d{1,2}\/\d{1,2}\b/g, '')
      .replace(/\b\d{3,}\b/g, '')
      .replace(/\*+\d+/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(s a|s r l|sa|srl|sas|sucursal|hiper|express|exp)\b/g, '')
      .replace(/\s+/g, ' ').trim();
  },

  _cleanComercio(s) {
    if (!s) return s;
    return String(s)
      .replace(/\(\s*[A-Za-z]{2,3}\s*,[^)]*\)/g, ' ')
      .replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ')
      .replace(/\s*([·\-–|])\s*$/,'')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;])/g, '$1')
      .trim();
  },

  _fmtUSD(n) {
    if (n == null) return '—';
    const dec = Math.abs(n) >= 100 ? 0 : 2;
    return 'USD ' + new Intl.NumberFormat('en-US', {
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }).format(n);
  },

  _fmtMon(n, mon) {
    if (mon === 'USD') return this._fmtUSD(n);
    return new Intl.NumberFormat('es-UY', {
      style: 'currency', currency: mon || 'UYU', maximumFractionDigits: 0,
    }).format(n);
  },

  _toUSD(n, mon, tc) {
    if (mon === 'USD') return parseFloat(n);
    return tc > 0 ? parseFloat(n) / tc : parseFloat(n);
  },

  _fmtView(n, mon, viewMode, tc) {
    if (viewMode === 'USD') return this._fmtUSD(this._toUSD(n, mon, tc));
    if (viewMode === 'UYU') {
      const v = mon === 'USD' ? parseFloat(n) * (tc || 1) : parseFloat(n);
      return this._fmtMon(v, 'UYU');
    }
    return this._fmtMon(n, mon);
  },

  _thSort(col, label, s) {
    const cur = s.col === col;
    const arrow = cur
      ? (s.dir === 'asc' ? ' ↑' : ' ↓')
      : ' <span style="opacity:.25;font-size:.75em">⇅</span>';
    return `<th data-sort="${col}" data-lbl="${label}" style="cursor:pointer;user-select:none;white-space:nowrap">${label}${arrow}</th>`;
  },

  _refreshSortArrows(containerEl, sortState) {
    containerEl.querySelectorAll('th[data-sort]').forEach(th => {
      const col = th.dataset.sort;
      const lbl = th.dataset.lbl;
      const cur = sortState.col === col;
      th.innerHTML = cur
        ? lbl + (sortState.dir === 'asc' ? ' ↑' : ' ↓')
        : lbl + ' <span style="opacity:.25;font-size:.75em">⇅</span>';
    });
  },

  async render(sub) {
    const c = document.getElementById('content');

    const cats = await dbFetch('categorias_gastos', { filters: { activo: 1 }, order: { col: 'nombre', asc: true } });
    this._cats = cats;

    const learnedRows = await dbFetch('merchant_categorias', { order: { col: 'seen_count', asc: false } }).catch(() => []);
    this._learned = {};
    for (const r of learnedRows) {
      this._learned[r.merchant_normalizado] = r.categoria_id;
    }

    c.innerHTML = `
      <h1>Tarjetas de Crédito</h1>
      <p class="page-subtitle" style="margin-bottom:1rem">Beneficios, comercios y tarjetas adicionales</p>
      <div id="g-content"></div>
    `;
    switch (sub || 'descuentos') {
      case 'descuentos':   return this._drawDescuentos();
      case 'comercios':    return this._drawHistorialComercios();
      case 'adicional':    return this._drawHistorialAdicional();
      case 'mis-tarjetas': return this._drawMisTarjetas();
    }
  },

  async _drawDescuentos() {
    const gc = document.getElementById('g-content');
    if (!this._descCache) gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    if (!this._descCache) {
      try {
        const [r1, r2, r3, r4, r5, r6] = await Promise.all([
          fetch('data/beneficios.json', { cache: 'no-cache' }),
          fetch('data/beneficios-santander.json', { cache: 'no-cache' }).catch(() => null),
          fetch('data/beneficios-itau.json', { cache: 'no-cache' }).catch(() => null),
          fetch('data/beneficios-scotiabank.json', { cache: 'no-cache' }).catch(() => null),
          fetch('data/beneficios-brou.json', { cache: 'no-cache' }).catch(() => null),
          fetch('data/beneficios-oca.json', { cache: 'no-cache' }).catch(() => null),
        ]);
        const bbva  = await r1.json();
        const sant  = r2 ? await r2.json().catch(() => ({ beneficios: [] })) : { beneficios: [] };
        const itau  = r3 ? await r3.json().catch(() => ({ beneficios: [] })) : { beneficios: [] };
        const scot  = r4 ? await r4.json().catch(() => ({ beneficios: [] })) : { beneficios: [] };
        const brou  = r5 ? await r5.json().catch(() => ({ beneficios: [] })) : { beneficios: [] };
        const oca   = r6 ? await r6.json().catch(() => ({ beneficios: [] })) : { beneficios: [] };
        const OCA_SKIP = ['2puntosIvaCompras', '9puntosIvaRestaurantes'];
        const parseNameParam = url => {
          if (!url) return null;
          try {
            const m = (url + '').match(/[?&]name=([^&]+)/);
            if (!m) return null;
            // Quitar "OCABlue" y "OCA" del string crudo ANTES de splitear CamelCase
            // para evitar que la regex parta "OCAy" → "OC Ay" dejando residuos
            const raw = decodeURIComponent(m[1])
              .replace(/OCABlue/gi, '').replace(/OCA/gi, '');
            let s = raw.includes('-')
              ? raw.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
              : raw.replace(/(\d)([A-Za-záéíóúüñ])/g, '$1 $2')
                   .replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, '$1 $2')
                   .replace(/([A-ZÁÉÍÓÚÜÑ]{2,})([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ])/g, '$1 $2').trim();
            // Quitar prefijos descriptivos: "Viaja con"/"Viajacon", "Descuento", "Dto."
            s = s.replace(/^\s*(Viajacon|Viaja\s+con|Descuento|Dto\.?)\s*/i, '');
            // Limpiar conectores sobrantes al inicio/fin ("y ...", "... y", "con ...")
            s = s.replace(/^\s*(y|con)\s+/i, '').replace(/\s+(y|con)\s*$/i, '').replace(/\s+/g, ' ').trim();
            return s || null;
          } catch(e) { return null; }
        };
        const norm = (b, f) => ({ ...b, fuente: f, comercio: b.comercio || b.nombre, corto: b.corto || (f === 'OCA' ? parseNameParam(b.url) : null) });
        this._descCache = {
          actualizado: [bbva.actualizado, sant.actualizado, itau.actualizado, scot.actualizado, brou.actualizado, oca.actualizado]
            .filter(Boolean).sort().pop(),
          benefits: [
            ...(bbva.beneficios  || []).map(b => norm(b, 'BBVA')),
            ...(sant.beneficios  || []).map(b => norm(b, 'Santander')),
            ...(itau.beneficios  || []).map(b => norm(b, 'Itaú')),
            ...(scot.beneficios  || []).map(b => norm(b, 'Scotiabank')),
            ...(brou.beneficios  || []).map(b => norm(b, 'BROU')),
            ...(oca.beneficios   || []).filter(b => !OCA_SKIP.some(s => b.url?.includes(s))).map(b => norm(b, 'OCA')),
          ],
        };
      } catch (e) {
        gc.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">No se pudo cargar el catálogo de beneficios.</div></div>';
        return;
      }
    }
    const { benefits, actualizado } = this._descCache;

    if (this._misCards === null) {
      const rows = await dbFetch('mis_tarjetas', { order: { col: 'created_at', asc: true } });
      this._misCards = rows || [];
    }
    const userCards = this._misCards;

    let comRows = this._comRawCache;
    if (!comRows) {
      const { data: d } = await getDB()
        .from('gastos').select('comercio, moneda, monto, fecha')
        .not('comercio', 'is', null)
        .or('titular_adicional.is.null,incluido_en_gastos.eq.true')
        .order('fecha', { ascending: false });
      comRows = d || [];
    }

    const hoy = new Date();
    const desde6 = new Date(hoy.getFullYear(), hoy.getMonth() - 6, 1).toISOString().slice(0, 10);

    if (!this._descCatSpendCache) {
      const { data: cs } = await getDB()
        .from('gastos').select('categoria_id,monto,moneda')
        .gte('fecha', desde6)
        .not('comercio', 'is', null)
        .or('titular_adicional.is.null,incluido_en_gastos.eq.true');
      this._descCatSpendCache = cs || [];
    }
    const catSpend = this._descCatSpendCache;

    const parseEndDate = vig => {
      if (!vig) return null;
      const m = vig.match(/\bal\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/i)
             || vig.match(/\bhasta\s+el\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/i);
      if (!m) return null;
      let y = +m[3]; if (y < 100) y += 2000;
      return new Date(y, +m[2] - 1, +m[1], 23, 59, 59);
    };
    const today = new Date();
    const isExpired = b => { const e = parseEndDate(b.vigencia); return e ? e < today : false; };
    const activeBenefits = benefits.filter(b => !isExpired(b));

    const benIndex = {};
    for (const b of activeBenefits) {
      const k = this._normMerchant(b.comercio);
      if (!k) continue;
      if (!benIndex[k] || (b.pctMax || 0) > (benIndex[k].pctMax || 0)) benIndex[k] = b;
    }

    const benByCat = {};
    for (const b of activeBenefits) {
      if (!b.categoria) continue;
      if (!benByCat[b.categoria]) benByCat[b.categoria] = { count: 0, maxPct: 0 };
      benByCat[b.categoria].count++;
      if ((b.pctMax || 0) > benByCat[b.categoria].maxPct) benByCat[b.categoria].maxPct = b.pctMax || 0;
    }

    const BBVA_MAP = [
      [['gastronom','restauran','comida','almuerzo','cena','bar ','cafe','cafeter','delivery','pizza','sushi','hambur','panaderia','heladeria'], 'Gastronomía'],
      [['ropa','moda','vestim','indumen','zapato','calzado','textil','accesori'], 'Moda'],
      [['nino','bebe','juguete','infant','kids','guardian'], 'Mundo Infantil'],
      [['deport','gym','fitness','club','pilates','yoga','natac'], 'Vida Activa'],
      [['hogar','mueble','deco','ferreteri','jardin','electrodom'], 'Hogar y Decoración'],
      [['belleza','peluquer','estet','cosmet','spa','manicur'], 'Cuidado Personal'],
      [['optic','lentes'], 'Ópticas'],
      [['viaje','vuelo','hotel','turismo','hospedaj','aerolinea'], 'Viajes'],
      [['mascot','veterinari'], 'Mascotas'],
      [['entret','espectacul','teatro','cine','concierto','ocio'], 'Experiencias'],
      [['libreria','papeleria','libro'], 'Librerías y papelerías'],
      [['tecnolog','electron','computac','celular'], 'Tecnología'],
      [['auto ','vehiculo','combustible','nafta','gasolina','estacionam','taller'], 'Autos'],
    ];
    const normStr = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
    const mapBBVA = catName => {
      const n = normStr(catName);
      for (const [kws, bc] of BBVA_MAP) { if (kws.some(k => n.includes(k))) return bc; }
      return null;
    };

    const spendByNorm = {};
    for (const r of comRows) {
      if (r.fecha < desde6) continue;
      const monto = parseFloat(r.monto);
      if (!(monto > 0)) continue;
      const norm = this._normMerchant(r.comercio);
      if (!norm || !benIndex[norm]) continue;
      if (!spendByNorm[norm]) spendByNorm[norm] = { norm, example: r.comercio, total: 0, count: 0, mon: r.moneda === 'USD' ? 'USD' : 'UYU' };
      spendByNorm[norm].total += monto;
      spendByNorm[norm].count++;
    }
    const oportunidades = Object.values(spendByNorm)
      .map(s => ({ ...s, benefit: benIndex[s.norm] }))
      .sort((a, b) => b.total - a.total);

    const catsMap = {};
    (this._cats || []).forEach(c => { catsMap[c.id] = c.nombre; });
    const catSpendByBBVA = {};
    for (const r of catSpend) {
      const catName = catsMap[r.categoria_id] || '';
      const bbvaCat = mapBBVA(catName);
      if (!bbvaCat || !benByCat[bbvaCat]) continue;
      const monto = parseFloat(r.monto);
      if (!(monto > 0)) continue;
      if (!catSpendByBBVA[bbvaCat]) catSpendByBBVA[bbvaCat] = { total: 0, mon: r.moneda === 'USD' ? 'USD' : 'UYU' };
      catSpendByBBVA[bbvaCat].total += monto;
    }
    const catOportunidades = Object.entries(catSpendByBBVA)
      .map(([bc, s]) => ({ bbvaCat: bc, total: s.total, mon: s.mon, count: benByCat[bc].count, maxPct: benByCat[bc].maxPct }))
      .sort((a, b) => b.total - a.total);

    const CAT_MAP = {
      'destacados':                  'Destacados',
      'ensenanza':                   'Educación',
      'espectaculos':                'Entretenimiento',
      'hogar':                       'Hogar',
      'moda':                        'Moda',
      'salud-estetica':              'Salud',
      'tecnologia':                  'Tecnología',
      'transporte':                  'Transporte',
      'turismo':                     'Viajes',
      'Cafeterías y Salones de té':  'Gastronomía',
      'Restaurantes':                'Gastronomía',
      'Electrónica':                 'Tecnología',
      'Estética':                    'Salud',
      'Farmacias':                   'Salud',
      'Ópticas':                     'Salud',
      'Interior':                    'Hogar',
      'Vestimenta':                  'Moda',
      'Viajes':                      'Viajes',
      'Papelería':                   'Librerías',
      'papelería':                   'Librerías',

      'The Platinum Card Amex':      null,
    };
    const canonCat = c => c ? (CAT_MAP.hasOwnProperty(c) ? CAT_MAP[c] : c) : null;

    const nivelAliases = { 'Gold': 'Oro', 'Oro': 'Gold' };
    const matchCards = b => {
      if (!userCards?.length) return [];
      return userCards.filter(c => {
        if (c.banco !== b.fuente) return false;
        if (b.red && b.red !== c.red) return false;
        if (b.cobranding && b.cobranding !== c.cobranding) return false;
        if (b.niveles?.length) {
          if (!b.niveles.includes(c.nivel) && !b.niveles.includes(nivelAliases[c.nivel])) return false;
        }
        return true;
      });
    };
    const bestBBVAPct = (b, myCards) => {
      if (b.fuente !== 'BBVA' || !myCards.length || !b.descuentos?.length) return null;
      const myNiveles = new Set(myCards.flatMap(c => [c.nivel, nivelAliases[c.nivel]].filter(Boolean)));
      const relevant = b.descuentos.filter(d => {
        if (d.isDebit) return false;
        return !d.niveles?.length || d.niveles.some(n => myNiveles.has(n));
      });
      return relevant.length ? Math.max(...relevant.map(d => d.pct)) : null;
    };
    const noWallet = !userCards?.length;

    const banco   = this._descBanco;
    const cat     = this._descCat;
    const gozado  = this._descGozado;
    const q       = this._normMerchant(this._descSearch);

    const forCats = banco ? activeBenefits.filter(b => b.fuente === banco) : activeBenefits;
    const catCounts = {};
    forCats.forEach(b => {
      const c = canonCat(b.categoria);
      if (c) catCounts[c] = (catCounts[c] || 0) + 1;
    });
    const catList   = Object.keys(catCounts).sort();
    const bbvaCount  = activeBenefits.filter(b => b.fuente === 'BBVA').length;
    const santCount  = activeBenefits.filter(b => b.fuente === 'Santander').length;
    const itauCount  = activeBenefits.filter(b => b.fuente === 'Itaú').length;
    const scotCount  = activeBenefits.filter(b => b.fuente === 'Scotiabank').length;
    const brouCount  = activeBenefits.filter(b => b.fuente === 'BROU').length;
    const ocaCount   = activeBenefits.filter(b => b.fuente === 'OCA').length;

    const normBen = b => this._normMerchant(b.comercio);
    const filtered = activeBenefits.filter(b => {
      if (banco  && b.fuente !== banco) return false;
      if (cat    && canonCat(b.categoria) !== cat) return false;
      if (q      && !normBen(b).includes(q)) return false;
      if (!noWallet) {
        const matched = matchCards(b);
        if (gozado === 'gozado'    && !matched.length) return false;
        if (gozado === 'no-gozado' &&  matched.length) return false;
      }
      return true;
    }).sort((a, b) => (b.pctMax || 0) - (a.pctMax || 0));

    const fmtMon  = (n, mon) => (mon === 'USD' ? 'US$ ' : '$U ') + fmt(n, 0);
    const diffDays = actualizado ? Math.floor((Date.now() - new Date(actualizado)) / 86400000) : null;
    const freshLabel = diffDays === null ? 'sin fecha'
      : diffDays === 0 ? 'hoy'
      : diffDays === 1 ? 'ayer'
      : `hace ${diffDays} días`;
    const freshClr = diffDays === null || diffDays > 7 ? '#fbbf24' : diffDays <= 3 ? '#4ade80' : 'var(--text-sec)';

    const fuenteBadge = f => f === 'BBVA'
      ? '<span style="font-size:.58rem;padding:1px 5px;border-radius:3px;background:rgba(46,142,200,.18);color:#5bb3e4;font-weight:700;letter-spacing:.03em;vertical-align:middle;margin-left:5px">BBVA</span>'
      : f === 'Santander'
      ? '<span style="font-size:.58rem;padding:1px 5px;border-radius:3px;background:rgba(230,57,70,.18);color:#e63946;font-weight:700;letter-spacing:.03em;vertical-align:middle;margin-left:5px">Santander</span>'
      : f === 'Itaú'
      ? '<span style="font-size:.58rem;padding:1px 5px;border-radius:3px;background:rgba(255,152,0,.18);color:#ffaa33;font-weight:700;letter-spacing:.03em;vertical-align:middle;margin-left:5px">Itaú</span>'
      : f === 'BROU'
      ? '<span style="font-size:.58rem;padding:1px 5px;border-radius:3px;background:rgba(41,176,140,.18);color:#29b08c;font-weight:700;letter-spacing:.03em;vertical-align:middle;margin-left:5px">BROU</span>'
      : f === 'OCA'
      ? '<span style="font-size:.58rem;padding:1px 5px;border-radius:3px;background:rgba(232,107,30,.18);color:#e86b1e;font-weight:700;letter-spacing:.03em;vertical-align:middle;margin-left:5px">OCA</span>'
      : '<span style="font-size:.58rem;padding:1px 5px;border-radius:3px;background:rgba(204,0,0,.18);color:#e84040;font-weight:700;letter-spacing:.03em;vertical-align:middle;margin-left:5px">Scotia</span>';

    const _di = 'font-size:11px;color:var(--text-sec);margin-top:2px';
    const renderDet = b => {
      let h = '';
      if (b.fuente === 'BBVA' && b.descuentos && b.descuentos.length)
        h += b.descuentos.map(d => '<div style="' + _di + ';padding:2px 0">• ' + d.texto + '</div>').join('');
      if (b.tarjetas)
        h += '<div style="' + _di + '">' + b.tarjetas + '</div>';
      if (b.fuente === 'Itaú' && !b.tarjetas)
        h += '<div style="' + _di + '">Todas las tarjetas Itaú</div>';
      if (b.vigencia) h += '<div style="' + _di + '">Vigencia: ' + b.vigencia.replace(/^vigencia:\s*/i, '') + '</div>';
      if (b.local)    h += '<div style="' + _di + '">Dónde: ' + b.local + '</div>';
      if (b.tope)     h += '<div style="' + _di + '">Tope: ' + b.tope + '</div>';
      if ((b.fuente === 'Santander' || b.fuente === 'Itaú') && b.desc) h += '<div style="' + _di + '">' + b.desc + '</div>';
      if (b.fuente === 'Scotiabank' && b.desc && b.desc !== b.tarjetas) h += '<div style="' + _di + '">' + b.desc + '</div>';
      if (b.fuente === 'OCA' && b.desc) h += '<div style="' + _di + '">' + b.desc + '</div>';
      if ((b.fuente === 'Scotiabank' || b.fuente === 'BROU' || b.fuente === 'OCA') && b.categoria && canonCat(b.categoria)) h += '<div style="' + _di + '">Categoría: ' + canonCat(b.categoria) + '</div>';
      if (b.url) h += '<a href="' + b.url + '" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);display:inline-block;margin-top:6px">Ver en sitio →</a>';
      else if (b.fuente === 'Itaú') h += '<a href="https://www.itau.com.uy/inst/' + (b.exclusivo ? 'beneficiosexclusivos' : 'beneficios') + '.html" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);display:inline-block;margin-top:6px">Ver en sitio Itaú →</a>';
      else if (b.fuente === 'Scotiabank') h += '<a href="https://www.scotiabank.com.uy/Personas/Tarjetas/Beneficios/default" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);display:inline-block;margin-top:6px">Ver en sitio Scotiabank →</a>';
      else if (b.fuente === 'OCA') h += '<a href="https://ocablue.uy/beneficios.html" target="_blank" rel="noopener" style="font-size:11px;color:var(--accent);display:inline-block;margin-top:6px">Ver en OCA Blue →</a>';
      return h || '<div style="font-size:11px;color:var(--text-sec)">Sin detalle disponible.</div>';
    };

    const thStyle = 'padding:7px 6px;border-bottom:1px solid var(--border);font-size:.68rem;color:var(--text-sec);text-transform:uppercase;font-weight:500;white-space:nowrap';
    const tdBorder = 'border-bottom:1px solid rgba(255,255,255,.04)';

    gc.innerHTML = `
      <div style="font-size:.72rem;color:var(--text-sec);margin-bottom:14px;display:flex;flex-wrap:wrap;align-items:center;gap:6px">
        <span>${bbvaCount} BBVA${santCount ? ' · ' + santCount + ' Santander' : ''}${itauCount ? ' · ' + itauCount + ' Itaú' : ''}${scotCount ? ' · ' + scotCount + ' Scotiabank' : ''}${brouCount ? ' · ' + brouCount + ' BROU' : ''}${ocaCount ? ' · ' + ocaCount + ' OCA' : ''}</span>
        <span style="opacity:.35">·</span>
        <span style="color:${freshClr}">● Datos actualizados ${freshLabel}</span>
      </div>

      ${oportunidades.length ? `
        <div class="form-card" style="padding:14px 16px;margin-bottom:18px;border-color:rgba(41,217,133,.3);background:linear-gradient(160deg,var(--surface),rgba(41,217,133,.05))">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--green);font-weight:600;margin-bottom:10px">
            💡 Oportunidades · comercios donde gastás con beneficio activo
          </div>
          <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
            <table style="width:100%;min-width:340px;border-collapse:collapse">
              <thead><tr>
                <th style="${thStyle};text-align:left">Comercio</th>
                <th style="${thStyle};text-align:right">Tu consumo 6m</th>
                <th style="${thStyle};text-align:left">%</th>
              </tr></thead>
              <tbody>
                ${oportunidades.map((o, idx) => `
                  <tr>
                    <td style="padding:7px 6px;${tdBorder};font-size:.82rem">${o.example}${fuenteBadge(o.benefit.fuente)}<button class="di-btn" data-i="op${idx}" style="background:none;border:none;color:var(--text-sec);cursor:pointer;padding:0 4px;font-size:.85rem;line-height:1;vertical-align:middle;margin-left:3px" title="Ver detalle">ⓘ</button></td>
                    <td style="padding:7px 6px;${tdBorder};font-size:.8rem;text-align:right;font-family:'DM Mono',monospace;color:var(--text-sec)">${fmtMon(o.total, o.mon)}</td>
                    <td style="padding:7px 6px;${tdBorder};font-size:.82rem;color:var(--green);font-weight:600">${o.benefit.pctMax ? 'hasta ' + o.benefit.pctMax + '%' : 'Otros'}</td>
                  </tr>
                  <tr id="di-row-op${idx}" style="display:none">
                    <td colspan="3" style="padding:3px 8px 8px 16px;font-size:11px;background:rgba(255,255,255,.025);${tdBorder}">
                      ${renderDet(o.benefit)}
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${catOportunidades.length ? `
        <div class="form-card" style="padding:14px 16px;margin-bottom:18px;border-color:rgba(212,175,55,.3);background:linear-gradient(160deg,var(--surface),rgba(212,175,55,.04))">
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--gold);font-weight:600;margin-bottom:10px">
            Por categoría · gastaste en rubros con beneficios BBVA disponibles
          </div>
          <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
            <table style="width:100%;min-width:380px;border-collapse:collapse">
              <thead><tr>
                <th style="${thStyle};text-align:left">Rubro BBVA</th>
                <th style="${thStyle};text-align:right">Tu consumo 6m</th>
                <th style="${thStyle};text-align:right">Beneficios</th>
                <th style="${thStyle};text-align:right">Mejor %</th>
              </tr></thead>
              <tbody>
                ${catOportunidades.map(co => `
                  <tr>
                    <td style="padding:7px 6px;${tdBorder};font-size:.82rem">${co.bbvaCat}</td>
                    <td style="padding:7px 6px;${tdBorder};font-size:.8rem;text-align:right;font-family:'DM Mono',monospace;color:var(--text-sec)">${fmtMon(co.total, co.mon)}</td>
                    <td style="padding:7px 6px;${tdBorder};font-size:.8rem;text-align:right;color:var(--text-sec)">${co.count}</td>
                    <td style="padding:7px 6px;${tdBorder};font-size:.82rem;text-align:right;font-weight:600;color:var(--gold)">${co.maxPct ? co.maxPct + '%' : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
        <input id="desc-search" type="text" placeholder="Buscar comercio…" value="${(this._descSearch || '').replace(/"/g, '&quot;')}"
          style="flex:1;min-width:120px;padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.8rem">
        <select id="desc-banco" style="padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.8rem">
          <option value="">Todos (${activeBenefits.length})</option>
          <option value="BBVA" ${banco === 'BBVA' ? 'selected' : ''}>BBVA (${bbvaCount})</option>
          ${santCount ? `<option value="Santander" ${banco === 'Santander' ? 'selected' : ''}>Santander (${santCount})</option>` : ''}
          ${itauCount ? `<option value="Itaú" ${banco === 'Itaú' ? 'selected' : ''}>Itaú (${itauCount})</option>` : ''}
          ${scotCount ? `<option value="Scotiabank" ${banco === 'Scotiabank' ? 'selected' : ''}>Scotiabank (${scotCount})</option>` : ''}
          ${brouCount ? `<option value="BROU" ${banco === 'BROU' ? 'selected' : ''}>BROU (${brouCount})</option>` : ''}
          ${ocaCount  ? `<option value="OCA"  ${banco === 'OCA'  ? 'selected' : ''}>OCA (${ocaCount})</option>`   : ''}
        </select>
        ${catList.length ? `
          <select id="desc-cat" style="padding:7px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.8rem">
            <option value="">Todos</option>
            ${catList.map(c => `<option value="${c}" ${cat === c ? 'selected' : ''}>${c} (${catCounts[c]})</option>`).join('')}
          </select>
        ` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-bottom:${noWallet ? '4px' : '12px'}">
        ${[['', 'Todos'], ['gozado', '✓ Tengo tarjeta'], ['no-gozado', '○ Sin tarjeta']].map(([val, lbl]) => `
          <button class="desc-goz-btn" data-goz="${val}" style="font-size:.74rem;padding:4px 11px;border-radius:6px;cursor:pointer;
            border:1px solid ${gozado === val ? 'var(--accent)' : 'var(--border)'};
            background:${gozado === val ? 'rgba(46,142,200,.15)' : 'transparent'};
            color:${gozado === val ? 'var(--accent)' : 'var(--text-sec)'}">${lbl}</button>
        `).join('')}
      </div>
      ${noWallet ? `
        <div style="font-size:.72rem;color:var(--text-sec);margin-bottom:12px;padding:5px 10px;background:var(--surface);border-radius:6px;border:1px solid var(--border)">
          💳 <a href="#tarjetas/mis-tarjetas" style="color:var(--accent)">Configurá tus tarjetas</a> para filtrar por las que tenés y ver tu descuento específico
        </div>` : ''}

      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
        <table style="width:100%;min-width:340px;border-collapse:collapse">
          <thead><tr>
            <th style="${thStyle};text-align:left">Comercio</th>
            <th style="${thStyle};text-align:left">%</th>
          </tr></thead>
          <tbody>
            ${filtered.map((b, idx) => {
              const myMatch = noWallet ? [] : matchCards(b);
              const myPct   = myMatch.length ? bestBBVAPct(b, myMatch) : null;
              const dispPct = myPct !== null ? myPct : (b.pctMax || null);
              const pctClr  = myPct !== null ? '#4ade80' : dispPct ? 'var(--gold)' : 'var(--text-sec)';
              const cardBadge = myMatch.length
                ? '<span style="font-size:.58rem;padding:1px 5px;border-radius:3px;background:rgba(74,222,128,.15);color:#4ade80;font-weight:700;letter-spacing:.03em;vertical-align:middle;margin-left:5px">✓</span>'
                : '';
              return `
              <tr>
                <td style="padding:7px 6px;${tdBorder};font-size:.82rem">
                  <span>${b.corto || b.comercio}</span>${cardBadge}${fuenteBadge(b.fuente)}<button class="di-btn" data-i="${idx}" style="background:none;border:none;color:var(--text-sec);cursor:pointer;padding:0 4px;font-size:.85rem;line-height:1;vertical-align:middle;margin-left:3px" title="Ver detalle">ⓘ</button>
                </td>
                <td style="padding:7px 6px;${tdBorder};font-size:${dispPct ? '.82rem' : '.72rem'};font-family:'DM Mono',monospace;color:${pctClr};white-space:nowrap">${dispPct ? dispPct + '%' : 'Otros'}</td>
              </tr>
              <tr id="di-row-${idx}" style="display:none">
                <td colspan="2" style="padding:3px 8px 8px 16px;font-size:11px;background:rgba(255,255,255,.025);${tdBorder}">
                  ${renderDet(b)}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${filtered.length === 0 ? '<div style="padding:18px;text-align:center;color:var(--text-sec);font-size:.8rem">Sin resultados</div>' : ''}
      </div>
    `;

    const searchEl = document.getElementById('desc-search');
    const bancoEl  = document.getElementById('desc-banco');
    const catEl    = document.getElementById('desc-cat');

    if (this._descSearch && searchEl) {
      searchEl.focus();
      const l = searchEl.value.length;
      searchEl.setSelectionRange(l, l);
    }

    let t;
    searchEl?.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { this._descSearch = searchEl.value; this._drawDescuentos(); }, 280);
    });
    bancoEl?.addEventListener('change', () => {
      this._descBanco = bancoEl.value;
      this._descCat   = '';
      this._drawDescuentos();
    });
    catEl?.addEventListener('change', () => { this._descCat = catEl.value; this._drawDescuentos(); });
    document.querySelectorAll('.desc-goz-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._descGozado = btn.dataset.goz;
        this._drawDescuentos();
      });
    });
    document.querySelectorAll('.di-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = document.getElementById('di-row-' + btn.dataset.i);
        if (!row) return;
        const open = row.style.display !== 'none';
        row.style.display = open ? 'none' : 'table-row';
        btn.style.color = open ? '' : 'var(--accent)';
      });
    });
  },

  async _drawHistorialComercios() {
    const gc = document.getElementById('g-content');

    let rows;
    if (this._comRawCache) {
      rows = this._comRawCache;
    } else {
      gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      const { data, error } = await getDB()
        .from('gastos').select('id, comercio, moneda, monto, categoria_id, fecha, tipo_gasto, cuota_actual, banco_tarjeta')
        .not('comercio', 'is', null)
        .or('titular_adicional.is.null,incluido_en_gastos.eq.true')
        .order('fecha', { ascending: false });
      if (error) throw error;
      rows = data;
      this._comRawCache = rows;
    }

    const groups = {};
    for (const r of rows) {
      const norm = this._normMerchant(r.comercio);
      if (!norm) continue;
      if (!groups[norm]) {
        groups[norm] = {
          norm, example: r.comercio, ids: [],
          gastos: [], hasQuotas: false, bancos: new Set(),
          count: 0, totals: { UYU: 0, USD: 0 }, negs: { UYU: 0, USD: 0 },
          catCounts: {}, tipoCounts: {}, ultima: r.fecha,
        };
      }
      const g = groups[norm];
      g.ids.push(r.id);
      g.gastos.push(r);
      if (r.cuota_actual) g.hasQuotas = true;
      if (r.banco_tarjeta) g.bancos.add(r.banco_tarjeta);
      g.count++;
      const monto = parseFloat(r.monto);
      const mon = r.moneda === 'USD' ? 'USD' : 'UYU';
      if (monto >= 0) g.totals[mon] += monto;
      else            g.negs[mon]   += monto;
      const cid = r.categoria_id ?? 'sin';
      g.catCounts[cid] = (g.catCounts[cid] || 0) + 1;
      const tid = r.tipo_gasto || 'casual';
      g.tipoCounts[tid] = (g.tipoCounts[tid] || 0) + 1;
    }
    const items = Object.values(groups).map(g => {
      const winner     = Object.entries(g.catCounts).sort((a,b) => b[1] - a[1])[0]?.[0];
      const tipoWinner = Object.entries(g.tipoCounts).sort((a,b) => b[1] - a[1])[0]?.[0] || 'casual';
      return { ...g, currentCat: winner === 'sin' ? null : +winner, currentTipo: tipoWinner };
    }).sort((a,b) => b.count - a.count);

    this._comerciosCache = items;

    const bancosComercio = [...new Set(items.flatMap(it => [...it.bancos]))].sort();

    gc.innerHTML = `
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:600;font-size:.9rem">${items.length} comercios únicos</div>
            <div style="font-size:.72rem;color:var(--text-sec);margin-top:2px">
              Cambiá la categoría y se actualizarán todos los gastos del comercio + el aprendizaje futuro
            </div>
          </div>
          <div style="position:relative;display:flex;align-items:center;min-width:200px;max-width:300px;flex:1">
            <input id="c-search" type="search" placeholder="🔍 Buscar comercio…" value="${this._histSearch}"
              style="width:100%;font-size:.78rem;padding:6px 28px 6px 10px;border-radius:6px;
                border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <button id="c-search-clear" type="button"
              style="position:absolute;right:6px;background:none;border:none;color:var(--text-sec);
                cursor:pointer;font-size:.85rem;padding:2px 6px;
                visibility:${this._histSearch?'visible':'hidden'}">✕</button>
          </div>
        </div>
        ${bancosComercio.length > 0 ? `
        <div style="margin-top:10px">
          <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjeta</div>
          <select id="c-banco" style="font-size:.76rem;padding:4px 9px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="">Todas las TDC</option>
            ${bancosComercio.map(b => `<option value="${b}"${b===this._histBanco?' selected':''}>${b}</option>`).join('')}
          </select>
        </div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          ${[['', 'Todos'], ['casual', '💳 Casual'], ['recurrente', '🔁 Recurrente'], ['cuotas', '📅 Cuotas']].map(([val, lbl]) => {
            const active = this._comTipo === val;
            return `<button class="c-tipo-btn" data-tipo="${val}"
              style="font-size:.74rem;padding:4px 11px;border-radius:6px;cursor:pointer;
                ${active
                  ? 'background:var(--accent);border:1px solid var(--accent);color:#fff'
                  : 'background:var(--surface);border:1px solid var(--border);color:var(--text-sec)'}">
              ${lbl}</button>`;
          }).join('')}
        </div>
      </div>

      ${items.length === 0 ? '' : `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:.5rem">
        <button id="c-detect-btn" class="btn btn-ghost" style="font-size:.76rem;padding:5px 12px">
          🔍 ${this._comSuggestOpen ? 'Ocultar similares' : 'Detectar similares'}
        </button>
        <div id="c-sel-bar" style="display:none;align-items:center;gap:8px">
          <span id="c-sel-count" style="font-size:.78rem;color:var(--text-sec)"></span>
          <button id="c-unify-btn" class="btn btn-primary" style="font-size:.76rem;padding:5px 12px">
            🔗 Unificar seleccionados
          </button>
          <button id="c-sel-clear" class="btn btn-ghost" style="font-size:.76rem;padding:5px 10px">✕ Limpiar</button>
        </div>
      </div>
      <div id="c-suggest-panel"></div>`}

      <div class="table-wrap">
        ${items.length === 0 ? `
          <div class="empty"><div class="empty-icon">🏷️</div>
          <div class="empty-text">Sin comercios registrados</div></div>
        ` : `
          <div class="table-scroll">
          <table>
            <thead id="g-com-thead"><tr>
              <th style="width:30px"><input type="checkbox" id="c-chk-all" title="Seleccionar todos los visibles"></th>
              ${this._thSort('nombre', 'Comercio',   this._comSort)}
              ${this._thSort('count',  'Gastos',     this._comSort)}
              <th>Última</th>
              ${this._thSort('totUYU', 'Total UYU',  this._comSort)}
              ${this._thSort('totUSD', 'Total USD',  this._comSort)}
              ${this._thSort('cat',    'Categoría',  this._comSort)}
              <th>Tipo</th>
            </tr></thead>
            <tbody id="g-com-tbody"></tbody>
          </table>
          </div>
        `}
      </div>
    `;

    this._renderComerciosTbody();

    document.getElementById('g-com-thead')?.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (this._comSort.col === col) {
          this._comSort.dir = this._comSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          this._comSort.col = col;
          this._comSort.dir = (col === 'nombre' || col === 'cat') ? 'asc' : 'desc';
        }
        this._refreshSortArrows(document.getElementById('g-com-thead'), this._comSort);
        this._renderComerciosTbody();
      });
    });

    document.getElementById('c-chk-all')?.addEventListener('change', e => {
      const vis = this._visibleComNorms || [];
      if (e.target.checked) vis.forEach(nm => this._comSelected.add(nm));
      else                  vis.forEach(nm => this._comSelected.delete(nm));
      this._renderComerciosTbody();
    });
    document.getElementById('c-sel-clear')?.addEventListener('click', () => {
      this._comSelected.clear();
      this._renderComerciosTbody();
    });
    document.getElementById('c-unify-btn')?.addEventListener('click', () => this._bulkUnifyComercios([...this._comSelected]));

    document.getElementById('c-detect-btn')?.addEventListener('click', () => {
      this._comSuggestOpen = !this._comSuggestOpen;
      this._drawHistorialComercios();
    });
    if (this._comSuggestOpen) this._renderSuggestPanel();

    const search = document.getElementById('c-search');
    const clear  = document.getElementById('c-search-clear');
    search?.addEventListener('input', e => {
      this._histSearch = e.target.value;
      clear.style.visibility = this._histSearch ? 'visible' : 'hidden';
      this._renderComerciosTbody();
    });
    clear?.addEventListener('click', () => {
      this._histSearch = '';
      search.value = '';
      clear.style.visibility = 'hidden';
      this._renderComerciosTbody();
      search.focus();
    });

    gc.querySelectorAll('.c-tipo-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        this._comTipo = btn.dataset.tipo;
        this._drawHistorialComercios();
      })
    );
    document.getElementById('c-banco')?.addEventListener('change', e => {
      this._histBanco = e.target.value;
      this._renderComerciosTbody();
    });

    const tbody = document.getElementById('g-com-tbody');
    tbody?.addEventListener('click', async e => {
      const editBtn = e.target.closest('.g-com-edit');
      if (editBtn) {
        await this._renameComercio(editBtn.dataset.norm);
        return;
      }
      const btn = e.target.closest('.g-com-expand');
      if (!btn) return;
      const norm = btn.dataset.norm;
      const detailRow = tbody.querySelector(`tr.g-com-detail[data-norm="${CSS.escape(norm)}"]`);
      if (!detailRow) return;
      const isOpen = detailRow.style.display !== 'none';
      detailRow.style.display = isOpen ? 'none' : 'table-row';
      btn.textContent = isOpen ? '▶' : '▼';
      btn.style.color = isOpen ? 'var(--text-sec)' : 'var(--accent)';
    });

    tbody?.addEventListener('change', async e => {
      if (e.target.classList.contains('c-chk')) {
        const norm = e.target.dataset.norm;
        if (e.target.checked) this._comSelected.add(norm);
        else                  this._comSelected.delete(norm);
        this._updateComSelBar();
        return;
      }
      if (e.target.classList.contains('c-tipo-sel')) {
        const norm = e.target.dataset.norm;
        const item = this._comerciosCache.find(i => i.norm === norm);
        if (!item) return;
        const newTipo = e.target.value;
        if (newTipo === item.currentTipo) return;
        const tipoLabel = newTipo === 'recurrente' ? '🔁 Recurrente' : newTipo === 'tdc' ? '🏦 Cargo TDC' : '💳 Casual';
        if (!confirm(`¿Marcar ${item.count} gasto(s) de "${item.example}" como ${tipoLabel}?`)) {
          e.target.value = item.currentTipo;
          return;
        }
        try {
          await Promise.all(item.ids.map(id =>
            dbUpdate('gastos', { tipo_gasto: newTipo }, { id })
          ));
          item.currentTipo = newTipo;
          this._invalidateCache();
          if (window.Mods.gastos) window.Mods.gastos._invalidateGastosCaches();
          toast(`✅ ${item.count} gasto(s) actualizado(s)`);
        } catch(err) {
          toast('❌ ' + err.message, 'err');
          e.target.value = item.currentTipo;
        }
        return;
      }
      if (!e.target.classList.contains('c-cat-sel')) return;
      const norm = e.target.dataset.norm;
      const item = this._comerciosCache.find(i => i.norm === norm);
      if (!item) return;
      const newCatId = e.target.value ? parseInt(e.target.value) : null;
      if (newCatId === item.currentCat) return;
      const catName = newCatId
        ? this._cats.find(c => c.id === newCatId)?.nombre || ''
        : 'Sin categoría';
      if (!confirm(`¿Re-categorizar ${item.count} gasto(s) de "${item.example}" como ${catName}?`)) {
        e.target.value = item.currentCat || '';
        return;
      }
      try {
        await Promise.all(item.ids.map(id =>
          dbUpdate('gastos', { categoria_id: newCatId }, { id })
        ));
        if (newCatId) {
          await dbUpsert('merchant_categorias', {
            merchant_normalizado: norm,
            categoria_id: newCatId,
            ejemplo_original: item.example,
            seen_count: item.count,
            ultima_vez: new Date().toISOString(),
          });
          this._learned[norm] = newCatId;
        }
        item.currentCat = newCatId;
        this._invalidateCache();
        if (window.Mods.gastos) window.Mods.gastos._invalidateGastosCaches();
        toast(`✅ ${item.count} gasto(s) actualizado(s)`);
      } catch(err) {
        toast('❌ ' + err.message, 'err');
        e.target.value = item.currentCat || '';
      }
    });
  },

  async _renameComercio(norm) {
    const item = this._comerciosCache?.find(i => i.norm === norm);
    if (!item) return;
    const entrada = prompt(
      `Nuevo nombre para "${item.example}" (${item.count} gasto/s).\n` +
      `Tip: poné el mismo nombre que otro comercio para unificarlos.`,
      item.example,
    );
    if (entrada == null) return;
    const nuevo = this._cleanComercio(entrada.trim());
    if (!nuevo || nuevo === item.example) return;

    const newNorm = this._normMerchant(nuevo);
    const existente = this._comerciosCache.find(i => i.norm === newNorm && i.norm !== norm);
    const msg = existente
      ? `¿Unificar "${item.example}" dentro de "${existente.example}"? Se renombrarán ${item.count} gasto/s.`
      : `¿Renombrar ${item.count} gasto/s a "${nuevo}"?`;
    if (!confirm(msg)) return;

    try {
      await Promise.all(item.ids.map(id => dbUpdate('gastos', { comercio: nuevo }, { id })));
      if (item.currentCat && !this._learned[newNorm]) {
        await dbUpsert('merchant_categorias', {
          merchant_normalizado: newNorm,
          categoria_id: item.currentCat,
          ejemplo_original: nuevo,
          seen_count: item.count,
          ultima_vez: new Date().toISOString(),
        });
        this._learned[newNorm] = item.currentCat;
      }
      toast(`✅ ${item.count} gasto/s actualizado/s`);
      this._invalidateCache();
      if (window.Mods.gastos) window.Mods.gastos._invalidateGastosCaches();
      this._drawHistorialComercios();
    } catch(err) {
      toast('❌ ' + err.message, 'err');
    }
  },

  async _bulkUnifyComercios(norms, presetNombre, excludedIds = []) {
    const items = (this._comerciosCache || []).filter(i => norms.includes(i.norm));
    if (items.length < 1) { toast('Seleccioná al menos un comercio', 'warn'); return; }
    const suggested = presetNombre
      || [...items].sort((a,b) => b.count - a.count)[0].example;
    const exclSet     = new Set(excludedIds);
    const allIds      = items.flatMap(i => i.ids).filter(id => !exclSet.has(id));
    const totalGastos = allIds.length;
    const exclCount   = excludedIds.length;
    if (totalGastos < 1) { toast('No quedó ningún gasto marcado para unificar', 'warn'); return; }
    const entrada = prompt(
      `Unificar ${totalGastos} gasto/s en un solo nombre` +
      (exclCount ? ` (${exclCount} desmarcado/s quedan sin cambios)` : '') + `:\n\n` +
      items.map(i => {
        const incl = i.ids.filter(id => !exclSet.has(id)).length;
        return `· ${i.example} (${incl}/${i.count})`;
      }).join('\n') +
      `\n\nNombre final:`,
      suggested
    );
    if (entrada == null) return;
    const nuevo = this._cleanComercio(entrada.trim());
    if (!nuevo) return;
    const newNorm = this._normMerchant(nuevo);

    if (!confirm(`¿Renombrar ${totalGastos} gasto/s de ${items.length} comercio/s a "${nuevo}"?`)) return;

    try {
      for (const id of allIds) {
        await dbUpdate('gastos', { comercio: nuevo }, { id });
      }
      const catWeight = {};
      for (const i of items) {
        if (i.currentCat != null) catWeight[i.currentCat] = (catWeight[i.currentCat] || 0) + i.count;
      }
      const domCat = Object.entries(catWeight).sort((a,b) => b[1]-a[1])[0]?.[0];
      if (domCat) {
        await dbUpsert('merchant_categorias', {
          merchant_normalizado: newNorm,
          categoria_id: +domCat,
          ejemplo_original: nuevo,
          seen_count: totalGastos,
          ultima_vez: new Date().toISOString(),
        });
        this._learned[newNorm] = +domCat;
      }
      const oldNorms = items.map(i => i.norm).filter(n => n !== newNorm);
      if (oldNorms.length) {
        await getDB().from('merchant_categorias').delete().in('merchant_normalizado', oldNorms);
        for (const n of oldNorms) delete this._learned[n];
      }
      this._comSelected.clear();
      toast(`✅ ${totalGastos} gasto/s unificados en "${nuevo}"`);
      this._invalidateCache();
      if (window.Mods.gastos) window.Mods.gastos._invalidateGastosCaches();
      this._drawHistorialComercios();
    } catch(err) {
      toast('❌ ' + err.message, 'err');
    }
  },

  _comercioBaseKey(norm) {
    const stop = new Set([
      'compra','pago','tienda','super','the','los','las','del',
      'benef','bono','bonus','desc','punt','premio','cargo','cobr',
      'prem','cash','back','acum','reem','canc','anul','devol',
      'tasa','mora','cred','deb','inter','serv','servi','aplic',
    ]);
    for (const tok of (norm || '').split(' ')) {
      if (tok.length >= 4 && !/\d/.test(tok) && !stop.has(tok)) return tok;
    }
    return null;
  },

  _buildSimilarClusters() {
    const byKey = {};
    for (const it of (this._comerciosCache || [])) {
      const k = this._comercioBaseKey(it.norm);
      if (!k) continue;
      (byKey[k] = byKey[k] || []).push(it);
    }
    return Object.entries(byKey)
      .filter(([, arr]) => arr.length >= 2)
      .map(([key, arr]) => ({
        key,
        items: [...arr].sort((a,b) => b.count - a.count),
        total: arr.reduce((s,i) => s + i.count, 0),
      }))
      .sort((a,b) => b.items.length - a.items.length);
  },

  _renderSuggestPanel() {
    const panel = document.getElementById('c-suggest-panel');
    if (!panel) return;
    const clusters = this._buildSimilarClusters();
    if (!clusters.length) {
      panel.innerHTML = `<div class="form-card" style="padding:12px 16px;margin-bottom:.5rem;font-size:.8rem;color:var(--text-sec)">
        No se detectaron comercios similares para agrupar.</div>`;
      return;
    }
    const q = (this._suggestSearch || '').toLowerCase().trim();

    panel.innerHTML = `
      <div class="form-card" style="padding:12px 16px;margin-bottom:.5rem;border:1px solid rgba(59,130,246,.3)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="font-size:.82rem;font-weight:600;flex:1">
            🔍 <span id="c-suggest-count"></span>
          </div>
        </div>
        <div style="font-size:.7rem;color:var(--text-sec);margin-bottom:10px;line-height:1.4">
          Marcá ✓ los gastos que querés <strong>incluir</strong> en la unificación.
          Los desmarcados quedan con su nombre original.
        </div>
        <div style="margin-bottom:10px">
          <input id="c-suggest-search" type="search" placeholder="Buscar comercio..."
            value="${q.replace(/"/g, '&quot;')}"
            style="width:100%;box-sizing:border-box;padding:6px 10px;border-radius:5px;
              border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:.78rem">
        </div>
        <div id="c-suggest-list" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>`;

    document.getElementById('c-suggest-search')?.addEventListener('input', e => {
      this._suggestSearch = e.target.value;
      this._renderSuggestList();
    });

    this._renderSuggestList();
  },

  _renderSuggestList() {
    const list = document.getElementById('c-suggest-list');
    if (!list) return;
    const clusters = this._buildSimilarClusters();
    const q = (this._suggestSearch || '').toLowerCase().trim();
    const visible = q
      ? clusters.filter(c => c.items.some(i =>
          i.example.toLowerCase().includes(q) || i.norm.includes(q)))
      : clusters;

    const countEl = document.getElementById('c-suggest-count');
    if (countEl) {
      countEl.textContent = `${clusters.length} grupo${clusters.length !== 1 ? 's' : ''} de posibles duplicados`
        + (q && visible.length !== clusters.length
            ? ` · ${visible.length} mostrado${visible.length !== 1 ? 's' : ''}` : '');
    }

    list.innerHTML = visible.length
      ? visible.map(c => this._renderClusterAccordion(c)).join('')
      : `<div style="font-size:.78rem;color:var(--text-sec);padding:8px 0">Sin resultados para "${q}"</div>`;

    this._attachSuggestListHandlers(clusters);
  },

  _attachSuggestListHandlers(clusters) {
    const list = document.getElementById('c-suggest-list');
    if (!list) return;

    list.querySelectorAll('.c-group-rename').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const c   = clusters.find(cl => cl.key === key);
        if (!c) return;
        const actual = this._suggestNames[key] || c.items[0].example;
        const nuevo  = prompt('Nombre final del grupo:', actual);
        if (nuevo == null) return;
        const limpio = this._cleanComercio(nuevo.trim());
        if (limpio) this._suggestNames[key] = limpio;
        this._renderSuggestList();
      })
    );

    list.querySelectorAll('.c-cluster-hdr').forEach(hdr =>
      hdr.addEventListener('click', e => {
        if (e.target.closest('.c-sugg-unify') || e.target.closest('.c-group-rename')) return;
        const key = hdr.dataset.key;
        if (this._suggestOpenKeys.has(key)) this._suggestOpenKeys.delete(key);
        else this._suggestOpenKeys.add(key);
        this._renderSuggestList();
      })
    );

    list.querySelectorAll('.c-gasto-chk').forEach(chk =>
      chk.addEventListener('change', () => {
        const key = chk.dataset.key;
        const gid = +chk.dataset.gid;
        if (!this._suggestExcluded[key]) this._suggestExcluded[key] = new Set();
        if (chk.checked) this._suggestExcluded[key].delete(gid);
        else             this._suggestExcluded[key].add(gid);
        const c = clusters.find(cl => cl.key === key);
        if (c) {
          const excl = this._suggestExcluded[key];
          const incl = c.items.flatMap(i => i.gastos).filter(g => !excl.has(g.id)).length;
          const lbl  = list.querySelector(`.c-incl-count[data-key="${CSS.escape(key)}"]`);
          if (lbl) lbl.textContent = `${incl}/${c.total} incl.`;
        }
      })
    );

    list.querySelectorAll('.c-sugg-unify').forEach(btn =>
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const c = clusters.find(cl => cl.key === key);
        if (!c) return;
        const excluded = [...(this._suggestExcluded[key] || new Set())];
        const preset   = this._suggestNames[key] || c.items[0].example;
        this._bulkUnifyComercios(c.items.map(i => i.norm), preset, excluded);
      })
    );
  },

  _renderClusterAccordion(c) {
    const isOpen  = this._suggestOpenKeys.has(c.key);
    const excl    = this._suggestExcluded[c.key] || new Set();
    const groupName = this._suggestNames[c.key] || c.items[0].example;
    const allGastos = c.items.flatMap(i => i.gastos)
      .sort((a, b) => a.fecha < b.fecha ? 1 : -1);
    const includedCount = allGastos.filter(g => !excl.has(g.id)).length;

    const body = isOpen ? `
      <div class="c-cluster-body" style="padding:8px 6px 4px;border-top:1px solid var(--border);margin-top:4px">
        <table style="width:100%;border-collapse:collapse;font-size:.7rem">
          <thead>
            <tr style="color:var(--text-sec)">
              <th style="padding:2px 4px;text-align:left;font-weight:500;width:24px"></th>
              <th style="padding:2px 4px;text-align:left;font-weight:500">Fecha</th>
              <th style="padding:2px 4px;text-align:left;font-weight:500">Comercio</th>
              <th style="padding:2px 4px;text-align:right;font-weight:500">Monto</th>
            </tr>
          </thead>
          <tbody>
            ${allGastos.map(g => `
              <tr style="border-top:1px solid rgba(255,255,255,.04);${excl.has(g.id) ? 'opacity:.45' : ''}">
                <td style="padding:2px 4px">
                  <input type="checkbox" class="c-gasto-chk"
                    data-key="${c.key}" data-gid="${g.id}"
                    ${excl.has(g.id) ? '' : 'checked'}>
                </td>
                <td style="padding:2px 4px;white-space:nowrap">${fmtDate(g.fecha)}</td>
                <td style="padding:2px 4px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                  title="${(g.comercio || '').replace(/"/g, '&quot;')}">${g.comercio || ''}</td>
                <td style="padding:2px 4px;text-align:right;white-space:nowrap">${fmt(g.monto, 2)} ${g.moneda}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

    return `
      <div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
        <div class="c-cluster-hdr" data-key="${c.key}"
          style="display:flex;align-items:center;gap:8px;padding:8px 10px;
            background:rgba(255,255,255,.03);cursor:pointer;user-select:none">
          <span style="color:var(--text-sec);font-size:.75rem;flex-shrink:0">${isOpen ? '▾' : '▸'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.79rem;font-weight:600;display:flex;align-items:center;gap:5px;flex-wrap:wrap">
              <span>${groupName}</span>
              <button class="c-group-rename" data-key="${c.key}" title="Editar nombre del grupo"
                style="background:none;border:none;cursor:pointer;color:var(--text-sec);
                  font-size:.7rem;padding:0 2px;line-height:1">✏️</button>
              <span style="color:var(--text-sec);font-weight:400">
                · ${c.items.length} variantes · <span class="c-incl-count" data-key="${c.key}">${includedCount}/${c.total} incl.</span>
              </span>
            </div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-top:2px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${c.items.map(i => `${i.example} (${i.count})`).join(' · ')}
            </div>
          </div>
          <button class="c-sugg-unify" data-key="${c.key}"
            style="font-size:.72rem;padding:4px 10px;border-radius:5px;cursor:pointer;
              background:var(--accent);border:1px solid var(--accent);color:#fff;
              white-space:nowrap;flex-shrink:0">
            🔗 Unificar
          </button>
        </div>
        ${body}
      </div>`;
  },

  _renderComerciosTbody() {
    const tbody = document.getElementById('g-com-tbody');
    if (!tbody || !this._comerciosCache) return;
    const q    = (this._histSearch || '').toLowerCase().trim();
    const tipo = this._comTipo || '';
    let items = this._comerciosCache;
    if (tipo === 'cuotas')          items = items.filter(it => it.hasQuotas);
    else if (tipo === 'recurrente') items = items.filter(it => it.currentTipo === 'recurrente');
    else if (tipo === 'casual')     items = items.filter(it => it.currentTipo !== 'recurrente');
    if (this._histBanco) items = items.filter(it => it.bancos.has(this._histBanco));
    if (q) items = items.filter(it => it.example.toLowerCase().includes(q) || it.norm.includes(q));
    const cs = this._comSort;
    items = [...items].sort((a, b) => {
      let va, vb;
      switch (cs.col) {
        case 'nombre': va = a.example.toLowerCase(); vb = b.example.toLowerCase(); break;
        case 'count':  va = a.count; vb = b.count; break;
        case 'totUYU': va = a.totals.UYU; vb = b.totals.UYU; break;
        case 'totUSD': va = a.totals.USD; vb = b.totals.USD; break;
        case 'cat': {
          const ca = a.currentCat ? (this._cats.find(c => c.id === a.currentCat)?.nombre || '') : '';
          const cb = b.currentCat ? (this._cats.find(c => c.id === b.currentCat)?.nombre || '') : '';
          va = ca.toLowerCase(); vb = cb.toLowerCase(); break;
        }
        default: va = a.count; vb = b.count;
      }
      return va < vb ? (cs.dir === 'asc' ? -1 : 1) : va > vb ? (cs.dir === 'asc' ? 1 : -1) : 0;
    });
    tbody.innerHTML = items.length
      ? items.map(it => this._comercioRow(it)).join('')
      : `<tr><td colspan="8" style="text-align:center;color:var(--text-sec);padding:20px">Sin resultados</td></tr>`;
    this._visibleComNorms = items.map(it => it.norm);
    this._updateComSelBar();
  },

  _updateComSelBar() {
    const bar   = document.getElementById('c-sel-bar');
    const count = document.getElementById('c-sel-count');
    const chkAll = document.getElementById('c-chk-all');
    const n = this._comSelected.size;
    if (bar)   bar.style.display = n ? 'flex' : 'none';
    if (count) count.textContent = `${n} comercio${n!==1?'s':''} seleccionado${n!==1?'s':''}`;
    if (chkAll) {
      const vis = this._visibleComNorms || [];
      chkAll.checked = vis.length > 0 && vis.every(nm => this._comSelected.has(nm));
    }
  },

  _comercioRow(it) {
    const ttlUYU = it.totals.UYU > 0
      ? this._fmtMon(it.totals.UYU, 'UYU')
        + (it.negs.UYU < 0 ? `<span style="color:#10b981;font-size:.7rem;display:block">${this._fmtMon(it.negs.UYU, 'UYU')}</span>` : '')
      : (it.negs.UYU < 0 ? `<span style="color:#10b981">${this._fmtMon(it.negs.UYU, 'UYU')}</span>` : '—');
    const ttlUSD = it.totals.USD > 0
      ? this._fmtUSD(it.totals.USD)
        + (it.negs.USD < 0 ? `<span style="color:#10b981;font-size:.7rem;display:block">${this._fmtUSD(it.negs.USD)}</span>` : '')
      : (it.negs.USD < 0 ? `<span style="color:#10b981">${this._fmtUSD(it.negs.USD)}</span>` : '—');

    const sortedGastos = [...(it.gastos || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
    const detailRows = sortedGastos.map(g => {
      const catC = this._cats.find(c => c.id === g.categoria_id);
      const catLabel = catC ? `${catC.icono} ${catC.nombre}` : '—';
      const val = parseFloat(g.monto);
      const montoStr = g.moneda === 'USD' ? this._fmtUSD(val) : this._fmtMon(val, 'UYU');
      const montoColored = val < 0
        ? `<span style="color:#10b981">${montoStr}</span>`
        : montoStr;
      const tipoIcon = g.tipo_gasto === 'recurrente' ? '🔁' : '💳';
      return `<tr style="border-top:1px solid rgba(255,255,255,.04)">
        <td style="white-space:nowrap;font-size:.72rem;color:var(--text-sec);padding:4px 8px">${fmtDate(g.fecha)}</td>
        <td style="font-size:.72rem;font-family:'DM Mono',monospace;white-space:nowrap;padding:4px 8px">${montoColored}</td>
        <td style="font-size:.7rem;color:var(--text-sec);padding:4px 8px">${g.moneda}</td>
        <td style="font-size:.72rem;padding:4px 8px">${catLabel}</td>
        <td style="font-size:.7rem;color:var(--text-sec);padding:4px 8px">${tipoIcon}</td>
      </tr>`;
    }).join('');

    const checked = this._comSelected.has(it.norm) ? ' checked' : '';
    return `
      <tr data-norm="${it.norm}">
        <td style="text-align:center"><input type="checkbox" class="c-chk" data-norm="${it.norm}"${checked}></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${it.example.replace(/"/g,'&quot;')}">
          <button class="g-com-expand" data-norm="${it.norm}"
            style="background:none;border:none;cursor:pointer;color:var(--text-sec);
              font-size:.72rem;margin-right:5px;padding:1px 4px;border-radius:3px;
              line-height:1;vertical-align:middle">▶</button>${it.example}
          <button class="g-com-edit" data-norm="${it.norm}" title="Renombrar / unificar comercio"
            style="background:none;border:none;cursor:pointer;color:var(--text-sec);
              font-size:.7rem;margin-left:4px;padding:1px 4px;border-radius:3px;
              line-height:1;vertical-align:middle">✏️</button>
        </td>
        <td style="font-family:'DM Mono',monospace">${it.count}</td>
        <td style="white-space:nowrap;font-size:.74rem;color:var(--text-sec)">${fmtDate(it.ultima)}</td>
        <td style="font-family:'DM Mono',monospace;white-space:nowrap">${ttlUYU}</td>
        <td style="font-family:'DM Mono',monospace;white-space:nowrap">${ttlUSD}</td>
        <td>
          <select class="c-cat-sel" data-norm="${it.norm}"
            style="font-size:.74rem;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);max-width:160px">
            <option value="">— Sin cat.</option>
            ${this._cats.map(c => `<option value="${c.id}"${it.currentCat == c.id?' selected':''}>${c.icono} ${c.nombre}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="c-tipo-sel" data-norm="${it.norm}"
            style="font-size:.74rem;padding:3px 6px;border-radius:4px;
              border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="casual"${it.currentTipo!=='recurrente'&&it.currentTipo!=='tdc'?' selected':''}>💳 Casual</option>
            <option value="recurrente"${it.currentTipo==='recurrente'?' selected':''}>🔁 Recurrente</option>
            <option value="tdc"${it.currentTipo==='tdc'?' selected':''}>🏦 Cargo TDC</option>
          </select>
        </td>
      </tr>
      <tr class="g-com-detail" data-norm="${it.norm}" style="display:none">
        <td colspan="8" style="padding:0 8px 10px 36px;background:rgba(255,255,255,.02)">
          <table style="width:100%;border-collapse:collapse">
            ${detailRows}
          </table>
        </td>
      </tr>`;
  },

  async _drawHistorialAdicional() {
    const gc = document.getElementById('g-content');

    let adicRows, descRows;
    if (this._adicRawCache) {
      ({ adicRows, descRows } = this._adicRawCache);
    } else {
      gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
      const sb = getDB();
      const [adicRes, descRes] = await Promise.all([
        sb.from('gastos')
          .select('id, fecha, monto, moneda, comercio, categoria_id, titular_adicional, banco_tarjeta, incluido_en_gastos')
          .not('titular_adicional', 'is', null)
          .order('fecha', { ascending: false }),
        sb.from('gastos')
          .select('id, fecha, monto, moneda, comercio, notas, titular_adicional, incluido_en_gastos')
          .ilike('notas', 'desc_adic:%')
          .order('fecha', { ascending: false }),
      ]);
      adicRows = adicRes.data || [];
      descRows = descRes.data || [];
      this._adicRawCache = { adicRows, descRows };
    }
    const discountIds = new Set(descRows.map(d => d.id));

    const descByRef = {};
    for (const d of descRows) {
      const ref = (d.notas || '').replace(/^desc_adic:/, '').trim();
      if (!descByRef[ref]) descByRef[ref] = [];
      descByRef[ref].push(d);
    }

    const matchDiscount = (comercio) => {
      const norm = this._normMerchant(comercio);
      for (const [ref, dlist] of Object.entries(descByRef)) {
        if (this._normMerchant(ref) === norm || norm.includes(this._normMerchant(ref)) || this._normMerchant(ref).includes(norm)) {
          return dlist;
        }
      }
      return [];
    };

    const purchaseRows = adicRows.filter(r => !discountIds.has(r.id));
    const titulares = [...new Set(purchaseRows.map(r => r.titular_adicional).filter(Boolean))].sort();

    const filtTitular = this._adicTitularFiltro || '';
    const filtMes     = this._adicMes || '';
    let rows = purchaseRows;
    if (filtTitular) rows = rows.filter(r => r.titular_adicional === filtTitular);
    if (filtMes)     rows = rows.filter(r => (r.fecha || '').startsWith(filtMes));

    const byTitular = {};
    for (const r of rows) {
      const tit = r.titular_adicional;
      const mes = (r.fecha || '').slice(0, 7);
      if (!byTitular[tit]) byTitular[tit] = {};
      if (!byTitular[tit][mes]) byTitular[tit][mes] = [];
      byTitular[tit][mes].push(r);
    }

    const now = new Date();
    const meses = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return {
        val: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        lbl: d.toLocaleDateString('es-UY', { month: 'long', year: 'numeric' }),
      };
    });

    const selSt = `font-size:.82rem;padding:5px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text)`;

    const titularesSections = Object.entries(byTitular).map(([tit, mesesData]) => {
      const monthSections = Object.entries(mesesData)
        .sort((a,b) => b[0].localeCompare(a[0]))
        .map(([mes, gastos]) => {
          const mesLabel = new Date(mes + '-15').toLocaleDateString('es-UY', { month: 'long', year: 'numeric' });
          const openKey  = `${tit}|${mes}`;
          const isOpen   = this._adicOpenMonths.has(openKey);

          let sumUYU = 0, sumUSD = 0, descUYU_sum = 0, descUSD_sum = 0;
          for (const g of gastos) {
            const discs = matchDiscount(g.comercio || '');
            if (g.moneda !== 'USD') {
              sumUYU   += parseFloat(g.monto);
              descUYU_sum += discs.filter(d=>d.moneda!=='USD').reduce((s,d)=>s+parseFloat(d.monto),0);
            } else {
              sumUSD   += parseFloat(g.monto);
              descUSD_sum += discs.filter(d=>d.moneda==='USD').reduce((s,d)=>s+parseFloat(d.monto),0);
            }
          }
          const summaryParts = [];
          if (sumUYU > 0) {
            summaryParts.push(
              `<span style="font-family:'DM Mono',monospace;font-size:.76rem">${this._fmtMon(sumUYU,'UYU')}</span>` +
              (descUYU_sum < 0 ? `<span style="color:#10b981;font-size:.7rem;margin-left:2px">−${this._fmtMon(Math.abs(descUYU_sum),'UYU')}</span>` +
                `<span style="color:var(--accent);font-size:.76rem;font-weight:600;margin-left:2px">=${this._fmtMon(sumUYU+descUYU_sum,'UYU')}</span>` : '')
            );
          }
          if (sumUSD > 0) {
            summaryParts.push(
              `<span style="font-family:'DM Mono',monospace;font-size:.76rem">${this._fmtMon(sumUSD,'USD')}</span>` +
              (descUSD_sum < 0 ? `<span style="color:#10b981;font-size:.7rem;margin-left:2px">−${this._fmtMon(Math.abs(descUSD_sum),'USD')}</span>` +
                `<span style="color:var(--accent);font-size:.76rem;font-weight:600;margin-left:2px">=${this._fmtMon(sumUSD+descUSD_sum,'USD')}</span>` : '')
            );
          }

          const tableRows = gastos.map(g => {
            const discounts = matchDiscount(g.comercio || '');
            const dUYU = discounts.filter(d => d.moneda !== 'USD').reduce((s,d) => s + parseFloat(d.monto), 0);
            const dUSD = discounts.filter(d => d.moneda === 'USD').reduce((s,d) => s + parseFloat(d.monto), 0);
            const hasDisc   = discounts.length > 0;
            const netAmount = g.moneda !== 'USD' ? parseFloat(g.monto) + dUYU : parseFloat(g.monto) + dUSD;
            const catC      = this._cats.find(c => c.id === g.categoria_id);
            const included  = !!g.incluido_en_gastos;
            const inclBtnSt = included
              ? 'background:rgba(16,185,129,.15);border:1px solid #10b981;color:#10b981'
              : 'background:var(--surface);border:1px solid var(--border);color:var(--text-sec)';
            return `
              <tr style="opacity:${included ? 1 : 0.75}">
                <td style="white-space:nowrap;font-size:.72rem;font-family:'DM Mono',monospace">${fmtDate(g.fecha)}</td>
                <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                  ${g.comercio ?? '—'}
                  ${catC ? `<span style="font-size:.62rem;color:var(--text-sec);margin-left:4px">${catC.icono}</span>` : ''}
                  ${hasDisc ? `<span style="font-size:.62rem;color:#10b981;margin-left:3px">🔗</span>` : ''}
                </td>
                <td style="font-family:'DM Mono',monospace;white-space:nowrap">${this._fmtMon(parseFloat(g.monto), g.moneda)}</td>
                <td style="font-family:'DM Mono',monospace;font-size:.72rem;color:#10b981;white-space:nowrap">
                  ${hasDisc ? (g.moneda !== 'USD' ? this._fmtMon(dUYU,'UYU') : this._fmtMon(dUSD,'USD')) : '—'}
                </td>
                <td style="font-family:'DM Mono',monospace;font-size:.8rem;font-weight:600;white-space:nowrap${hasDisc?';color:var(--accent)':''}">
                  ${this._fmtMon(netAmount, g.moneda)}
                </td>
                <td>
                  <button class="adic-incl-btn" data-id="${g.id}" data-val="${!included}"
                    style="font-size:.65rem;padding:3px 8px;border-radius:4px;cursor:pointer;white-space:nowrap;${inclBtnSt}">
                    ${included ? '✓ Incluido' : '+ Incluir'}
                  </button>
                </td>
              </tr>`;
          }).join('');

          return `
            <div style="margin-bottom:6px">
              <div class="adic-month-hdr" data-key="${openKey.replace(/"/g,'&quot;')}"
                style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;
                  padding:8px 10px;border-radius:6px;cursor:pointer;user-select:none;
                  background:rgba(255,255,255,.04);border:1px solid var(--border)">
                <span style="font-size:.78rem;font-weight:600;text-transform:capitalize">${mesLabel}</span>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                  <span style="font-size:.7rem;color:var(--text-sec)">${gastos.length} gasto${gastos.length!==1?'s':''}</span>
                  ${summaryParts.map(p=>`<span>${p}</span>`).join('')}
                  <span class="adic-arrow" style="color:var(--text-sec);font-size:.78rem;min-width:10px">${isOpen?'▼':'▶'}</span>
                </div>
              </div>
              <div class="adic-month-detail" data-key="${openKey.replace(/"/g,'&quot;')}"
                style="display:${isOpen?'block':'none'};padding:8px 4px 0">
                <div class="table-scroll">
                <table style="font-size:.8rem;margin-bottom:4px">
                  <thead><tr>
                    <th>Fecha</th><th>Comercio</th><th>Monto</th><th>Descuento</th><th>Total</th><th></th>
                  </tr></thead>
                  <tbody>${tableRows}</tbody>
                </table>
                </div>
              </div>
            </div>`;
        }).join('');

      const allTitRows = purchaseRows.filter(r => r.titular_adicional === tit);
      const grandTotUYU  = allTitRows.filter(r => r.moneda !== 'USD').reduce((s,r) => s + parseFloat(r.monto), 0);
      const grandTotUSD  = allTitRows.filter(r => r.moneda === 'USD').reduce((s,r) => s + parseFloat(r.monto), 0);
      const grandDescUYU = allTitRows.reduce((s,r) => s + matchDiscount(r.comercio||'').filter(d=>d.moneda!=='USD').reduce((ss,d)=>ss+parseFloat(d.monto),0), 0);
      const grandDescUSD = allTitRows.reduce((s,r) => s + matchDiscount(r.comercio||'').filter(d=>d.moneda==='USD').reduce((ss,d)=>ss+parseFloat(d.monto),0), 0);
      const allIncluded  = allTitRows.length > 0 && allTitRows.every(r => r.incluido_en_gastos);
      const bulkVal      = !allIncluded;
      const bulkBtnSt    = allIncluded
        ? 'background:rgba(16,185,129,.15);border:1px solid #10b981;color:#10b981'
        : 'background:var(--surface);border:1px solid var(--border);color:var(--text-sec)';
      const titEsc = tit.replace(/"/g,'&quot;');

      const headTotParts = [];
      if (grandTotUYU > 0) {
        headTotParts.push(
          `<span style="font-family:'DM Mono',monospace">${this._fmtMon(grandTotUYU + grandDescUYU, 'UYU')}</span>`
          + (grandDescUYU < 0 ? `<span style="color:#10b981;font-size:.68rem;margin-left:3px">(−${this._fmtMon(Math.abs(grandDescUYU),'UYU')} desc)</span>` : '')
        );
      }
      if (grandTotUSD > 0) {
        headTotParts.push(
          `<span style="font-family:'DM Mono',monospace">${this._fmtMon(grandTotUSD + grandDescUSD, 'USD')}</span>`
          + (grandDescUSD < 0 ? `<span style="color:#10b981;font-size:.68rem;margin-left:3px">(−${this._fmtMon(Math.abs(grandDescUSD),'USD')} desc)</span>` : '')
        );
      }

      return `
        <div class="form-card" style="padding:14px 16px;margin-bottom:.75rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="font-size:.95rem;font-weight:700;display:flex;align-items:center;gap:6px">
                👤 ${tit}
                <button class="adic-rename-btn" data-titular="${titEsc}" title="Renombrar titular"
                  style="background:none;border:none;cursor:pointer;color:var(--text-sec);
                    font-size:.7rem;padding:2px 5px;border-radius:3px;vertical-align:middle">✏️</button>
              </div>
            </div>
            <button class="adic-bulk-btn" data-titular="${titEsc}" data-val="${bulkVal}"
              style="font-size:.72rem;padding:4px 12px;border-radius:5px;cursor:pointer;${bulkBtnSt}">
              ${allIncluded ? '✓ Incluidos en gastos' : '+ Incluir todos en gastos'}
            </button>
          </div>
          ${monthSections}
          ${(grandTotUYU > 0 || grandTotUSD > 0) ? `
          <div style="border-top:2px solid var(--border);padding-top:10px;margin-top:8px">
            <div style="font-size:.7rem;color:var(--text-sec);font-weight:600;margin-bottom:4px;letter-spacing:.03em">
              TOTAL ${tit.toUpperCase()}
            </div>
            <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:.82rem">
              ${grandTotUYU > 0 ? `<div>
                <span style="color:var(--text-sec)">UYU:</span>
                <strong style="font-family:'DM Mono',monospace;margin:0 4px">${this._fmtMon(grandTotUYU,'UYU')}</strong>
                ${grandDescUYU < 0 ? `<span style="color:#10b981">− ${this._fmtMon(Math.abs(grandDescUYU),'UYU')} desc</span>` : ''}
                <span style="color:var(--accent);font-weight:700;margin-left:4px">= ${this._fmtMon(grandTotUYU+grandDescUYU,'UYU')}</span>
              </div>` : ''}
              ${grandTotUSD > 0 ? `<div>
                <span style="color:var(--text-sec)">USD:</span>
                <strong style="font-family:'DM Mono',monospace;margin:0 4px">${this._fmtMon(grandTotUSD,'USD')}</strong>
                ${grandDescUSD < 0 ? `<span style="color:#10b981">− ${this._fmtMon(Math.abs(grandDescUSD),'USD')} desc</span>` : ''}
                <span style="color:var(--accent);font-weight:700;margin-left:4px">= ${this._fmtMon(grandTotUSD+grandDescUSD,'USD')}</span>
              </div>` : ''}
            </div>
          </div>` : ''}
        </div>`;
    }).join('');

    gc.innerHTML = `
      <div class="form-card" style="padding:12px 16px;margin-bottom:.75rem">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          ${titulares.length > 1 ? `
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Tarjetahabiente</div>
            <select id="adic-titular" style="${selSt}">
              <option value="">Todos</option>
              ${titulares.map(t => `<option value="${t}"${t===filtTitular?' selected':''}>${t}</option>`).join('')}
            </select>
          </div>` : ''}
          <div>
            <div style="font-size:.68rem;color:var(--text-sec);margin-bottom:2px">Mes</div>
            <select id="adic-mes" style="${selSt}">
              <option value="">Todos los meses</option>
              ${meses.map(m => `<option value="${m.val}"${m.val===filtMes?' selected':''}>${m.lbl}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="font-size:.72rem;color:var(--text-sec);margin-top:8px">
          Los gastos de tarjeta adicional se registran cuando importás el EDC y asignás un titular.
          Los descuentos asociados se muestran vinculados automáticamente.
        </div>
      </div>

      ${adicRows.length === 0 ? `
        <div class="form-card">
          <div class="empty"><div class="empty-icon">👤</div>
          <div class="empty-text">Sin gastos de tarjeta adicional</div>
          <div style="font-size:.75rem;color:var(--text-sec);margin-top:6px">
            Al importar un EDC, asigná un nombre al titular de la tarjeta adicional<br>
            para hacer seguimiento de sus gastos acá.
          </div></div>
        </div>
      ` : Object.keys(byTitular).length === 0 ? `
        <div class="form-card">
          <div style="text-align:center;color:var(--text-sec);padding:20px;font-size:.82rem">
            Sin resultados para los filtros seleccionados
          </div>
        </div>
      ` : titularesSections}
    `;

    document.getElementById('adic-titular')?.addEventListener('change', e => {
      this._adicTitularFiltro = e.target.value;
      this._drawHistorialAdicional();
    });
    document.getElementById('adic-mes')?.addEventListener('change', e => {
      this._adicMes = e.target.value;
      this._drawHistorialAdicional();
    });

    if (this._adicClickHandler) gc.removeEventListener('click', this._adicClickHandler);
    this._adicClickHandler = async (e) => {
      const hdr = e.target.closest('.adic-month-hdr');
      if (hdr) {
        const key    = hdr.dataset.key;
        const detail = gc.querySelector(`.adic-month-detail[data-key="${CSS.escape(key)}"]`);
        const arrow  = hdr.querySelector('.adic-arrow');
        if (this._adicOpenMonths.has(key)) {
          this._adicOpenMonths.delete(key);
          if (detail) detail.style.display = 'none';
          if (arrow)  arrow.textContent = '▶';
        } else {
          this._adicOpenMonths.add(key);
          if (detail) detail.style.display = 'block';
          if (arrow)  arrow.textContent = '▼';
        }
        return;
      }

      const renameBtn = e.target.closest('.adic-rename-btn');
      if (renameBtn) {
        const oldName = renameBtn.dataset.titular;
        const newName = prompt(`Renombrar titular:\n"${oldName}"\n\nNuevo nombre:`, oldName)?.trim();
        if (!newName || newName === oldName) return;
        renameBtn.disabled = true;
        try {
          await getDB().from('gastos').update({ titular_adicional: newName }).eq('titular_adicional', oldName);
          const updated = new Set();
          for (const k of this._adicOpenMonths) {
            updated.add(k.startsWith(`${oldName}|`) ? k.replace(`${oldName}|`, `${newName}|`) : k);
          }
          this._adicOpenMonths = updated;
          toast(`✅ Titular renombrado a "${newName}"`);
          this._invalidateCache();
          if (window.Mods.gastos) window.Mods.gastos._invalidateGastosCaches();
          this._drawHistorialAdicional();
        } catch(err) {
          toast('❌ ' + err.message, 'err');
          renameBtn.disabled = false;
        }
        return;
      }

      const inclBtn = e.target.closest('.adic-incl-btn');
      const bulkBtn = e.target.closest('.adic-bulk-btn');
      if (!inclBtn && !bulkBtn) return;

      if (inclBtn) {
        const id = +inclBtn.dataset.id;
        const newVal = inclBtn.dataset.val === 'true';
        const purchase = purchaseRows.find(r => r.id === id);
        if (!purchase) return;
        const linkedIds = matchDiscount(purchase.comercio || '').map(d => d.id);
        inclBtn.disabled = true;
        inclBtn.textContent = '…';
        await getDB().from('gastos').update({ incluido_en_gastos: newVal }).in('id', [id, ...linkedIds]);
        this._invalidateCache();
        if (window.Mods.gastos) window.Mods.gastos._invalidateGastosCaches();
        this._drawHistorialAdicional();
        return;
      }

      if (bulkBtn) {
        const tit = bulkBtn.dataset.titular;
        const newVal = bulkBtn.dataset.val === 'true';
        const titPurchases = purchaseRows.filter(r => r.titular_adicional === tit);
        const titDiscIds   = descRows.filter(d => d.titular_adicional === tit).map(d => d.id);
        const allIds = [...titPurchases.map(r => r.id), ...titDiscIds];
        if (!allIds.length) return;
        bulkBtn.disabled = true;
        bulkBtn.textContent = '…';
        await getDB().from('gastos').update({ incluido_en_gastos: newVal }).in('id', allIds);
        this._invalidateCache();
        if (window.Mods.gastos) window.Mods.gastos._invalidateGastosCaches();
        this._drawHistorialAdicional();
      }
    };
    gc.addEventListener('click', this._adicClickHandler);
  },

  async _drawMisTarjetas() {
    const gc = document.getElementById('g-content');
    gc.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const [rows, catRes] = await Promise.all([
      dbFetch('mis_tarjetas', { order: { col: 'created_at', asc: true } }),
      this._misCatCache
        ? Promise.resolve(this._misCatCache)
        : fetch('data/catalogo-tarjetas.json', { cache: 'no-cache' })
            .then(r => r.json()).catch(() => ({ tarjetas: [] })),
    ]);
    this._misCards    = rows || [];
    this._misCatCache = catRes;
    const catalog = catRes.tarjetas || [];

    const BANCOS  = ['BBVA', 'Santander', 'Itaú', 'Scotiabank', 'BROU', 'OCA'];
    const REDES   = ['Visa', 'Mastercard', 'Amex', 'OCA'];
    const NIVELES = ['Clásica', 'Oro', 'Gold', 'Platinum', 'Black', 'Red', 'Blue', 'Signature', 'Infinite'];
    const BANCO_CLR = {
      'BBVA': '#004481', 'Santander': '#EC0000', 'Itaú': '#EC7000',
      'Scotiabank': '#D4002A', 'BROU': '#29b08c', 'OCA': '#e86b1e',
    };

    const getCobrandings = (banco, red, nivel) =>
      [...new Set(
        catalog
          .filter(c => c.banco === banco && (!red || c.red === red) && (!nivel || c.nivel === nivel) && c.cobranding)
          .map(c => c.cobranding)
      )].sort();

    const updateCobWrap = container => {
      const banco = container.querySelector('.mt-f-banco')?.value || '';
      const red   = container.querySelector('.mt-f-red')?.value   || '';
      const nivel = container.querySelector('.mt-f-nivel')?.value  || '';
      const opts  = getCobrandings(banco, red, nivel);
      const wrap  = container.querySelector('.mt-f-cobranding-wrap');
      if (!wrap) return;
      wrap.style.display = opts.length ? '' : 'none';
      const sel = wrap.querySelector('.mt-f-cobranding');
      if (sel) {
        const cur = sel.value;
        sel.innerHTML = `<option value="">Sin co-branding</option>
          ${opts.map(o => `<option${cur === o ? ' selected' : ''}>${o}</option>`).join('')}`;
      }
    };

    const formFields = (r = {}) => {
      const cobOpts = getCobrandings(r.banco, r.red, r.nivel);
      return `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">
        <div class="form-group" style="min-width:0">
          <label style="font-size:.8rem">Banco</label>
          <select class="mt-f-banco form-control" style="width:100%">
            <option value="">— Banco —</option>
            ${BANCOS.map(b => `<option${r.banco === b ? ' selected' : ''}>${b}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="min-width:0">
          <label style="font-size:.8rem">Red</label>
          <select class="mt-f-red form-control" style="width:100%">
            <option value="">— Red —</option>
            ${REDES.map(n => `<option${r.red === n ? ' selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="min-width:0">
          <label style="font-size:.8rem">Nivel</label>
          <select class="mt-f-nivel form-control" style="width:100%">
            <option value="">— Nivel —</option>
            ${NIVELES.map(n => `<option${r.nivel === n ? ' selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="form-group mt-f-cobranding-wrap" style="min-width:0${cobOpts.length ? '' : ';display:none'}">
          <label style="font-size:.8rem">Co-branding</label>
          <select class="mt-f-cobranding form-control" style="width:100%">
            <option value="">Sin co-branding</option>
            ${cobOpts.map(o => `<option${r.cobranding === o ? ' selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="min-width:0">
          <label style="font-size:.8rem">Apodo <span style="opacity:.55">(opcional)</span></label>
          <input type="text" class="mt-f-apodo form-control" style="width:100%;box-sizing:border-box" value="${r.apodo || ''}" placeholder="Mi Visa Oro">
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:7px;margin-top:10px;cursor:pointer;font-size:.83rem">
        <input type="checkbox" class="mt-f-principal"${r.principal !== false ? ' checked' : ''} style="accent-color:var(--accent)">
        Titular <span style="color:var(--text-sec)">(desmarcar si es adicional)</span>
      </label>`;
    };
    `;

    const readForm = wrap => ({
      banco:      wrap.querySelector('.mt-f-banco').value,
      red:        wrap.querySelector('.mt-f-red').value        || null,
      nivel:      wrap.querySelector('.mt-f-nivel').value      || null,
      cobranding: wrap.querySelector('.mt-f-cobranding')?.value || null,
      apodo:      wrap.querySelector('.mt-f-apodo').value.trim() || null,
      principal:  wrap.querySelector('.mt-f-principal').checked,
    });

    const cardHTML = r => {
      const clr   = BANCO_CLR[r.banco] || 'var(--accent)';
      const label = [r.red, r.nivel].filter(Boolean).join(' ');
      const cobBadge = r.cobranding
        ? `<span style="font-size:.68rem;padding:1px 7px;border-radius:4px;background:${clr}22;color:${clr};border:1px solid ${clr}40">${r.cobranding}</span>`
        : '';
      if (this._misEditId === r.id) {
        return `
          <div class="mt-card" data-id="${r.id}" style="border:1px solid ${clr}60;border-radius:12px;padding:16px;background:linear-gradient(135deg,${clr}14,${clr}06)">
            ${formFields(r)}
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="mt-save-btn btn btn-primary" data-id="${r.id}" style="flex:1;font-size:.82rem">Guardar</button>
              <button class="mt-cancel-btn btn btn-ghost" style="flex:1;font-size:.82rem">Cancelar</button>
            </div>
          </div>`;
      }
      return `
        <div class="mt-card" data-id="${r.id}" style="border:1px solid ${clr}40;border-radius:12px;padding:16px 14px 12px;background:linear-gradient(135deg,${clr}14,${clr}06);display:flex;flex-direction:column;gap:5px;min-height:115px;position:relative">
          <div style="font-weight:600;font-size:.95rem;color:${clr}">${r.banco}</div>
          <div style="font-size:.85rem;color:var(--text)">${label || '<span style="color:var(--text-sec)">—</span>'}</div>
          ${cobBadge}
          ${r.apodo ? `<div style="font-size:.74rem;color:var(--text-sec);font-style:italic">${r.apodo}</div>` : ''}
          <div style="font-size:.72rem;margin-top:auto;padding-top:6px;color:${r.principal ? 'var(--accent)' : 'var(--text-sec)'}">
            ${r.principal ? '● Titular' : '○ Adicional'}
          </div>
          <div style="position:absolute;top:9px;right:9px;display:flex;gap:3px">
            <button class="mt-edit-btn btn btn-ghost" data-id="${r.id}" style="padding:2px 7px;font-size:.75rem">✏️</button>
            <button class="mt-del-btn btn btn-danger" data-id="${r.id}" style="padding:2px 7px;font-size:.75rem">✕</button>
          </div>
        </div>`;
    };

    gc.innerHTML = `
      <div class="form-card" style="margin-bottom:20px">
        <div class="table-header"><span class="table-title">Agregar tarjeta</span></div>
        <div id="mt-add-form" style="margin-top:14px">
          ${formFields()}
          <div style="display:flex;justify-content:flex-end;margin-top:12px">
            <button id="mt-add-btn" class="btn btn-primary">Agregar</button>
          </div>
        </div>
      </div>
      <div class="table-header" style="margin-bottom:12px">
        <span class="table-title">Mis tarjetas <span style="font-weight:400;color:var(--text-sec);font-size:.85em">(${this._misCards.length})</span></span>
      </div>
      <div id="mt-cards-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px">
        ${this._misCards.length
          ? this._misCards.map(cardHTML).join('')
          : '<p style="color:var(--text-sec)">No tenés tarjetas cargadas todavía.</p>'}
      </div>
    `;

    // Reactivo: actualizar cobranding al cambiar banco/red/nivel
    gc.querySelectorAll('.mt-f-banco, .mt-f-red, .mt-f-nivel').forEach(sel => {
      sel.addEventListener('change', () => {
        const container = sel.closest('.mt-card, #mt-add-form');
        if (!container) return;
        // Auto-red para OCA
        if (sel.classList.contains('mt-f-banco') && sel.value === 'OCA') {
          const redSel = container.querySelector('.mt-f-red');
          if (redSel) redSel.value = 'OCA';
        }
        updateCobWrap(container);
      });
    });

    document.getElementById('mt-add-btn').addEventListener('click', async () => {
      const data = readForm(document.getElementById('mt-add-form'));
      if (!data.banco) { toast('Elegí un banco', 'err'); return; }
      const btn = document.getElementById('mt-add-btn');
      btn.disabled = true; btn.textContent = '…';
      try {
        await dbInsert('mis_tarjetas', data);
        this._misCards = null;
        this._drawMisTarjetas();
      } catch(e) {
        toast('❌ ' + e.message, 'err');
        btn.disabled = false; btn.textContent = 'Agregar';
      }
    });

    gc.querySelectorAll('.mt-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._misEditId = +btn.dataset.id;
        this._drawMisTarjetas();
      });
    });

    gc.querySelectorAll('.mt-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._misEditId = null;
        this._drawMisTarjetas();
      });
    });

    gc.querySelectorAll('.mt-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id   = +btn.dataset.id;
        const data = readForm(btn.closest('.mt-card'));
        if (!data.banco) { toast('Elegí un banco', 'err'); return; }
        btn.disabled = true; btn.textContent = '…';
        try {
          await dbUpdate('mis_tarjetas', data, { id });
          this._misEditId = null;
          this._misCards  = null;
          this._drawMisTarjetas();
        } catch(e) {
          toast('❌ ' + e.message, 'err');
          btn.disabled = false; btn.textContent = 'Guardar';
        }
      });
    });

    gc.querySelectorAll('.mt-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta tarjeta?')) return;
        btn.disabled = true;
        try {
          await dbDelete('mis_tarjetas', { id: +btn.dataset.id });
          this._misCards = null;
          this._drawMisTarjetas();
        } catch(e) {
          toast('❌ ' + e.message, 'err');
          btn.disabled = false;
        }
      });
    });
  },
};
