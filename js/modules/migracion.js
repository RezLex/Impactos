import { batchCreate, upsert, getAll } from '../utils/db.js';
import { excelDateToISO } from '../utils/formatters.js';
import { toast } from '../utils/ui.js';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-text">
        <h2>Importar Datos</h2>
        <p>Carga el archivo IMPACTOS.xlsx para migrar tus datos a Firebase</p>
      </div>
    </div>

    <div class="row justify-content-center">
      <div class="col-lg-8">
        <div class="upload-zone" id="upload-zone">
          <i class="bi bi-cloud-upload"></i>
          <h5>Arrastra aquí tu archivo o haz clic para seleccionarlo</h5>
          <p class="text-muted">Solo archivos .xlsx</p>
          <input type="file" id="file-input" accept=".xlsx,.xls" class="d-none">
          <button class="btn btn-primary mt-2" onclick="document.getElementById('file-input').click()">
            <i class="bi bi-folder2-open me-1"></i>Seleccionar archivo
          </button>
        </div>

        <div id="preview-section" class="d-none mt-4">
          <div class="data-card mb-3">
            <div class="data-card-header"><span><i class="bi bi-eye me-2"></i>Vista previa de datos</span></div>
            <div class="data-card-body" id="preview-content"></div>
          </div>
          <div class="d-flex gap-2 justify-content-end">
            <button class="btn btn-secondary" id="btn-cancel-import">Cancelar</button>
            <button class="btn btn-primary" id="btn-confirm-import">
              <i class="bi bi-cloud-upload me-1"></i>Importar a Firebase
            </button>
          </div>
        </div>

        <div id="progress-section" class="d-none mt-4">
          <div class="data-card">
            <div class="data-card-body">
              <h6 class="mb-3">Importando datos...</h6>
              <div id="progress-log" style="font-size:0.85rem;color:#555;max-height:300px;overflow-y:auto"></div>
              <div class="progress mt-3" style="height:10px">
                <div class="progress-bar progress-bar-striped progress-bar-animated" id="import-bar" style="width:0%"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  let parsedData = null;

  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) processFile(input.files[0]);
  });

  async function processFile(file) {
    if (!file.name.match(/\.xlsx?$/i)) {
      toast('Solo se aceptan archivos .xlsx', 'warning');
      return;
    }
    zone.innerHTML = `<div class="loading-overlay"><div class="spinner-border text-primary" role="status"></div><span class="ms-2">Leyendo archivo...</span></div>`;
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(buf, { type: 'array' });
      parsedData = parseWorkbook(wb);
      showPreview(parsedData);
    } catch (e) {
      toast('Error al leer el archivo: ' + e.message, 'danger');
      renderPreUpload(zone);
    }
  }

  function showPreview(data) {
    document.getElementById('preview-section').classList.remove('d-none');
    document.getElementById('preview-content').innerHTML = `
      <div class="row g-3 text-center">
        ${previewStat('bi-bank2',          data.instituciones.length,  'Instituciones')}
        ${previewStat('bi-credit-card-2-front', data.tarjetas.length,  'Tarjetas')}
        ${previewStat('bi-calendar-range', data.msi.length,            'Compras MSI')}
        ${previewStat('bi-receipt',        data.gastosFijos.length,    'Gastos Fijos')}
        ${previewStat('bi-bar-chart-line', data.impactoMeses.length,   'Meses de Impacto')}
        ${previewStat('bi-tag-fill',       data.eventos.length,        'Eventos')}
      </div>
      <div class="alert alert-warning mt-3 mb-0" style="font-size:0.85rem">
        <i class="bi bi-exclamation-triangle me-1"></i>
        <strong>Nota:</strong> Los datos existentes en Firebase serán combinados con los importados.
        Los registros mensuales se sobreescribirán si ya existen.
      </div>`;
  }

  document.getElementById('btn-cancel-import').addEventListener('click', () => {
    document.getElementById('preview-section').classList.add('d-none');
    renderPreUpload(zone);
    parsedData = null;
  });

  document.getElementById('btn-confirm-import').addEventListener('click', async () => {
    if (!parsedData) return;
    document.getElementById('preview-section').classList.add('d-none');
    document.getElementById('progress-section').classList.remove('d-none');
    await runImport(parsedData);
  });
}

function previewStat(icon, count, label) {
  return `<div class="col-4 col-md-2">
    <div class="metric-card flex-column text-center p-3">
      <i class="bi ${icon} fs-3 mb-1" style="color:var(--primary-light)"></i>
      <div class="metric-value">${count}</div>
      <div class="metric-label">${label}</div>
    </div>
  </div>`;
}

function renderPreUpload(zone) {
  zone.innerHTML = `
    <i class="bi bi-cloud-upload"></i>
    <h5>Arrastra aquí tu archivo o haz clic para seleccionarlo</h5>
    <p class="text-muted">Solo archivos .xlsx</p>
    <input type="file" id="file-input" accept=".xlsx,.xls" class="d-none">
    <button class="btn btn-primary mt-2" onclick="document.getElementById('file-input').click()">
      <i class="bi bi-folder2-open me-1"></i>Seleccionar archivo
    </button>`;
}

// ── Parser ────────────────────────────────────────────────────────────────────
function parseWorkbook(wb) {
  const data = { instituciones: [], tarjetas: [], msi: [], gastosFijos: [], impactoMeses: [], eventos: [] };

  // ── Hoja 1: Tarjetas ──────────────────────────────────────────────────────
  try {
    const ws   = wb.Sheets['Tarjetas'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 'A', defval: '' });
    const instMap = {};
    rows.slice(2).forEach(r => {
      const entidad = String(r.B || '').trim();
      const clabe   = String(r.C || '').trim();
      const nombre  = String(r.D || '').trim();
      const tipo    = String(r.E || '').toLowerCase().includes('éb') ? 'debito' : 'credito';
      const fisica  = String(r.F || '').trim();
      const digital = String(r.G || '').trim();
      if (!nombre) return;
      let instId = instMap[entidad || '_'];
      if (entidad && !instId) {
        instId = 'inst_' + data.instituciones.length;
        instMap[entidad] = instId;
        data.instituciones.push({ _importId: instId, nombre: entidad, clabe });
      }
      data.tarjetas.push({ nombre, tipo, numeroFisico: fisica, numeroDigital: digital, _instNombre: entidad || null });
    });
  } catch (e) { console.warn('Error parseando Tarjetas:', e); }

  // ── Hoja 2: MSI ──────────────────────────────────────────────────────────
  try {
    const ws   = wb.Sheets['MSI'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 'A', defval: '' });
    let currentCard = '';
    const cardHeaders = { 'B3':'Banamex Clasica','B15':'Santander LikeU','B22':'BBVA Azul','B30':'NU','B36':'Banorte Oro' };
    rows.forEach((r, i) => {
      const cellKey = `B${i+1}`;
      if (cardHeaders[cellKey]) currentCard = cardHeaders[cellKey];
      const compra = String(r.B || '').trim();
      if (!compra || compra === 'Compra') return;
      const total    = Number(r.C) || 0;
      if (total === 0) return;
      data.msi.push({
        compra,
        total,
        restante:     Number(r.D) || 0,
        mensualidad:  Number(r.E) || 0,
        mesesPagados: Number(r.F) || 0,
        mesesTotal:   Number(r.G) || 0,
        primerPago:   excelDateToISO(r.H),
        ultimoPago:   excelDateToISO(r.I),
        _cardNombre: currentCard,
      });
    });
  } catch (e) { console.warn('Error parseando MSI:', e); }

  // ── Hoja 3: Fijos ─────────────────────────────────────────────────────────
  try {
    const ws   = wb.Sheets['Fijos'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 'A', defval: '' });
    rows.slice(2).forEach(r => {
      const nombre = String(r.B || '').trim();
      if (!nombre || nombre === 'Gasto') return;
      data.gastosFijos.push({
        nombre,
        banco:     String(r.C || '').trim(),
        diaCobro:  String(r.E || '').trim(),
        importe:   Number(r.F) || 0,
      });
    });
  } catch (e) { console.warn('Error parseando Fijos:', e); }

  // ── Hojas de Impacto ──────────────────────────────────────────────────────
  const mesMap = { ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEP:9,OCT:10,NOV:11,DIC:12 };
  wb.SheetNames.filter(n => n.startsWith('Impacto ')).forEach(name => {
    try {
      const parts = name.replace('Impacto ','').split('-');
      const mes   = mesMap[parts[0]];
      const anio  = '20' + parts[1];
      const yyyymm = `${anio}-${String(mes).padStart(2,'0')}`;
      const ws   = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 'A', defval: '' });
      const registros = [];
      let nomina = 0;
      rows.slice(2).forEach(r => {
        const entidad = String(r.B || '').trim();
        if (!entidad || entidad === 'Entidad' || entidad === 'TOTALES') return;
        if (entidad === 'TOTAL') { nomina = Number(r.D) || 0; return; }
        if (['Banorte','Mercado Pago','Santander','NU','BBVA'].some(b => entidad === b && !r.C)) return;
        const limite = Number(r.C) || 0;
        if (!entidad || (limite === 0 && !r.H)) return;
        registros.push({
          entidad,
          tipo:       'credito',
          limite,
          usado:      Number(r.D) || 0,
          disponible: Number(r.E) || 0,
          corte:      excelDateToISO(r.F),
          limitePago: excelDateToISO(r.G),
          aPagar:     Number(r.H) || 0,
          pagado:     Number(r.I) === 1,
        });
      });
      data.impactoMeses.push({ yyyymm, registros, nomina, pagosDebito: [] });
    } catch (e) { console.warn('Error parseando', name, e); }
  });

  // ── Hot Sale / Eventos ────────────────────────────────────────────────────
  wb.SheetNames.filter(n => n.includes('Hot Sale') || n.includes('Buen Fin') || n.includes('Prime')).forEach(name => {
    try {
      const ws    = wb.Sheets[name];
      const rows  = XLSX.utils.sheet_to_json(ws, { header: 'A', defval: '' });
      const plan  = [];
      let currentProd = '';
      let currentOpts = [];
      rows.slice(2).forEach(r => {
        const prod = String(r.B || '').trim();
        const tienda = String(r.C || '').trim();
        if (prod && prod !== 'Producto') {
          if (currentProd && currentOpts.length) plan.push({ producto: currentProd, opciones: currentOpts, opcionSeleccionada: -1 });
          currentProd = prod; currentOpts = [];
        }
        if (tienda && tienda !== 'Tienda') {
          const precio = Number(r.E) || 0;
          if (precio > 0) currentOpts.push({
            tienda,
            enlace:   '',
            precio,
            descuento: Number(r.F) || 0,
            banco:    '',
            msi:      Number(r.I) || 1,
          });
        }
      });
      if (currentProd && currentOpts.length) plan.push({ producto: currentProd, opciones: currentOpts, opcionSeleccionada: -1 });
      const tipo = name.includes('Hot Sale') ? 'Hot Sale' : name.includes('Buen Fin') ? 'Buen Fin' : 'Otro';
      const year = name.match(/\d{4}$/)?.[0] || '2026';
      data.eventos.push({ nombre: name, tipo, fechaInicio: '', fechaFin: '', planCompras: plan, comprasRealizadas: [], promociones: [] });
    } catch (e) { console.warn('Error parseando evento:', name, e); }
  });

  return data;
}

// ── Import runner ─────────────────────────────────────────────────────────────
async function runImport(data) {
  const log = document.getElementById('progress-log');
  const bar = document.getElementById('import-bar');
  const steps = 6;
  let step = 0;

  function logLine(msg) {
    log.insertAdjacentHTML('beforeend', `<div>${msg}</div>`);
    log.scrollTop = log.scrollHeight;
  }
  function setBar(n) {
    bar.style.width = Math.round((n / steps) * 100) + '%';
  }

  try {
    // 1. Instituciones
    logLine('⏳ Importando instituciones...');
    await batchCreate('instituciones', data.instituciones.map(({ _importId, ...i }) => i));
    step++; setBar(step);
    logLine(`✅ ${data.instituciones.length} instituciones importadas`);

    // 2. Tarjetas (resolve institucionId by looking up nombre)
    logLine('⏳ Importando tarjetas...');
    const instList = await getAll('instituciones');
    const instByNombre = Object.fromEntries(instList.map(i => [i.nombre, i.id]));
    const tarjetasToCreate = data.tarjetas.map(({ _instNombre, ...t }) => ({
      ...t,
      institucionId: instByNombre[_instNombre] || null,
    }));
    await batchCreate('tarjetas', tarjetasToCreate);
    step++; setBar(step);
    logLine(`✅ ${data.tarjetas.length} tarjetas importadas`);

    // 3. MSI (resolve tarjetaId by card name)
    logLine('⏳ Importando MSI...');
    const cardList = await getAll('tarjetas');
    const cardByNombre = Object.fromEntries(cardList.map(c => [c.nombre, c.id]));
    const msiToCreate = data.msi.map(({ _cardNombre, ...m }) => ({
      ...m,
      tarjetaId: cardByNombre[_cardNombre?.split(' ').pop()] || null,
    }));
    await batchCreate('msi', msiToCreate);
    step++; setBar(step);
    logLine(`✅ ${data.msi.length} compras MSI importadas`);

    // 4. Gastos Fijos
    logLine('⏳ Importando gastos fijos...');
    await batchCreate('gastosFijos', data.gastosFijos);
    step++; setBar(step);
    logLine(`✅ ${data.gastosFijos.length} gastos fijos importados`);

    // 5. Impacto mensual
    logLine('⏳ Importando impacto mensual...');
    for (const mes of data.impactoMeses) {
      await upsert('impactoMensual', mes.yyyymm, {
        nomina: mes.nomina, registros: mes.registros, pagosDebito: mes.pagosDebito,
        total: mes.registros.reduce((s, r) => s + r.aPagar, 0),
      });
    }
    step++; setBar(step);
    logLine(`✅ ${data.impactoMeses.length} meses importados`);

    // 6. Eventos
    logLine('⏳ Importando eventos...');
    await batchCreate('eventos', data.eventos);
    step++; setBar(step);
    logLine(`✅ ${data.eventos.length} eventos importados`);

    bar.classList.remove('progress-bar-animated', 'progress-bar-striped');
    bar.classList.add('bg-success');
    logLine('🎉 ¡Importación completada con éxito!');
    toast('¡Datos importados correctamente!', 'success');
  } catch (e) {
    logLine(`❌ Error: ${e.message}`);
    toast('Error durante la importación: ' + e.message, 'danger');
  }
}
