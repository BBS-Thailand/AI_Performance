/* FN-01 Screen output — export the current screen as a downloaded file (README §6.2).
 *
 *   PDF   — a picture of the whole screen. html2canvas renders a clone, and the clone is what gets
 *           un-scrolled, widened and given the export header; the live page is never touched.
 *   Excel — the data of every table on the screen, one sheet per table, numbers as real numbers.
 *
 * Libraries load on first use.
 */
(function (root) {
  'use strict';
  const A = root.App;
  const { t, esc, state } = A;

  const VENDOR = { html2canvas: 'js/vendor/html2canvas.min.js', jspdf: 'js/vendor/jspdf.umd.min.js', xlsx: 'js/vendor/xlsx.mini.min.js' };
  const EXPORT_WIDTH = 1280;          // CSS px the screen is laid out at, whatever the window size
  const PAGE = { w: 841.89, h: 595.28, margin: 24, footer: 14 };   // A4 landscape, pt
  const MAX_CANVAS_PIXELS = 60e6;     // stay under browser canvas limits on very long screens

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve;
        s.onerror = () => { delete loaded[src]; reject(new Error('Cannot load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  const pad = (n) => String(n).padStart(2, '0');
  function fileName(now, ext) {
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return [A.SCREEN_ID[state.screen], state.orgId, state.periodId, stamp].join('_').replace(/[^\w.-]+/g, '-') + '.' + ext;
  }

  /** README §6.2: fiscal period, organization, screen name, export timestamp and exporting user. */
  function exportInfo(now) {
    const when = new Intl.DateTimeFormat(I18N.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(now);
    return [
      [t('exp_screen'), `${A.SCREEN_ID[state.screen]} ${t('scr_' + state.screen)}`],
      [t('period'), A.ytdLabel()],
      [t('org'), A.orgName(state.orgId)],
      [t('exp_by'), A.user().display_name],
      [t('exp_at'), when],
    ];
  }
  function headerHtml(now) {
    return `<div class="export-title">${esc(t('app_title'))}</div>
      <div class="export-meta">${exportInfo(now).map(([label, value]) => `<span><b>${esc(label)}:</b> ${esc(value)}</span>`).join('')}</div>`;
  }

  /** Runs inside html2canvas' cloned document: lay the screen out for paper and note safe page breaks. */
  function prepareClone(doc, main, now, breaks) {
    doc.documentElement.classList.add('exporting');
    const head = doc.createElement('div');
    head.className = 'export-head';
    head.innerHTML = headerHtml(now);
    main.insertBefore(head, main.firstChild);
    main.querySelectorAll('[data-reset]').forEach((el) => el.remove());

    // A table wider than the page would be cut off on the right: widen the whole screen to fit it
    // (the PDF scales the result down to the page width).
    if (main.scrollWidth > main.clientWidth) main.style.width = main.scrollWidth + 'px';

    // html2canvas stamps every cloned <svg> with the pixel size it has in the live window, so a
    // responsive chart would overflow its card at the export width. Drop that size from charts
    // that had none of their own, let CSS lay them out again, then pin the result for drawing.
    const originals = A.$$('main svg');
    main.querySelectorAll('svg').forEach((svg, i) => {
      if (originals[i] && !originals[i].hasAttribute('width')) {
        svg.removeAttribute('width'); svg.removeAttribute('height');
        ['width', 'height', 'inline-size', 'block-size'].forEach((p) => svg.style.removeProperty(p));
      }
    });
    main.querySelectorAll('svg').forEach((svg) => {
      const r = svg.getBoundingClientRect();
      if (r.width && r.height) { svg.setAttribute('width', r.width); svg.setAttribute('height', r.height); }
    });

    // A page may end after any card, table row or top-level block — never through one.
    const top = main.getBoundingClientRect().top;
    const set = new Set();
    main.querySelectorAll(':scope > *, .card, tr').forEach((el) => {
      const y = Math.round(el.getBoundingClientRect().bottom - top);
      if (y > 0) set.add(y);
    });
    breaks.push(...[...set].sort((a, b) => a - b));
  }

  /** Split [0, total] into page ranges of at most `max`, ending on a safe break when one is near enough. */
  function paginate(total, max, breaks) {
    const pages = [];
    let start = 0;
    while (total - start > max) {
      const limit = start + max;
      let end = limit;
      for (const b of breaks) { if (b > limit) break; if (b > start + max * 0.4) end = b; }
      pages.push([start, end]);
      start = end;
    }
    if (total - start > 1) pages.push([start, total]);
    return pages;
  }

  async function buildPdf(now) {
    await Promise.all([loadScript(VENDOR.html2canvas), loadScript(VENDOR.jspdf)]);
    const main = A.$('main');
    const breaks = [];
    const area = EXPORT_WIDTH * main.scrollHeight;
    const scale = Math.min(2, Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / area)));
    const canvas = await root.html2canvas(main, {
      scale, backgroundColor: '#ffffff', logging: false, windowWidth: EXPORT_WIDTH,
      onclone: (doc, el) => prepareClone(doc, el, now, breaks),
    });

    const pdf = new root.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    const boxW = PAGE.w - PAGE.margin * 2;
    const boxH = PAGE.h - PAGE.margin * 2 - PAGE.footer;
    const cssW = canvas.width / scale;
    const ptPerCss = boxW / cssW;
    const pages = paginate(canvas.height / scale, boxH / ptPerCss, breaks);

    const slice = document.createElement('canvas');
    const ctx = slice.getContext('2d');
    pages.forEach(([from, to], i) => {
      const sy = Math.round(from * scale);
      const sh = Math.max(1, Math.round(to * scale) - sy);
      slice.width = canvas.width; slice.height = sh;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, slice.width, sh);
      ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
      if (i) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', PAGE.margin, PAGE.margin, boxW, (sh / scale) * ptPerCss, undefined, 'FAST');
      pdf.setFontSize(8); pdf.setTextColor(130);
      pdf.text(`${i + 1} / ${pages.length}`, PAGE.w - PAGE.margin, PAGE.h - PAGE.margin + 4, { align: 'right' });
    });
    return pdf;
  }

  /* ------------------------------------------------------------------ Excel */

  /** Reads numbers the way the screen writes them ("1,250", "−14.4", "+2.3", "±0", "−4.2 %"). */
  function numberParser() {
    const parts = new Intl.NumberFormat(I18N.locale()).formatToParts(12345.6);
    const group = (parts.find((p) => p.type === 'group') || {}).value;
    const decimal = (parts.find((p) => p.type === 'decimal') || {}).value || '.';
    return (text) => {
      // Only a sign or a % may stand apart from the digits: "1 250" is two values, not a number.
      let s = text.trim().replace(/−/g, '-').replace(/^([+-])\s+/, '$1').replace(/\s+%$/, '%');
      if (s === '±0') return { v: 0 };
      const pct = s.endsWith('%');
      if (pct) s = s.slice(0, -1);
      if (group) s = s.split(group).join('');
      s = s.replace(decimal, '.');
      if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
      return pct ? { v: Number((Number(s) / 100).toPrecision(12)), z: '0.0%' } : { v: Number(s) };
    };
  }

  const plainText = (s) => s.replace(/\s+/g, ' ').replace(/^\s*[▸▾▶▼►◄]\s*/, '').trim();

  /**
   * A detached copy of a table holding only what should reach the sheet: hidden rows are dropped
   * and form controls are replaced by the value they currently show.
   */
  function tableForSheet(table) {
    const copy = table.cloneNode(true);
    const live = [table, ...table.querySelectorAll('*')];
    const mirror = [copy, ...copy.querySelectorAll('*')];
    const drop = [];
    live.forEach((el, i) => {
      const c = mirror[i];
      const tag = el.tagName.toLowerCase();
      // Not data: hidden parts, pictures, switched-off chips and icon-only buttons (edit, chat).
      const iconButton = tag === 'button' && !/\p{L}/u.test(el.textContent);
      if (tag === 'svg' || iconButton || getComputedStyle(el).display === 'none' || el.matches('.org-chip:not(.on)')) drop.push(c);
      else if (tag === 'select') c.replaceWith(el.selectedOptions[0] ? el.selectedOptions[0].textContent : '');
      else if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) c.replaceWith(el.checked ? '✓' : '');
      else if (tag === 'input' || tag === 'textarea') c.replaceWith(el.value);
    });
    drop.forEach((c) => c.remove());
    // Badges, chips and stacked lines sit side by side with no space in the markup: keep them apart.
    // Each cell is then reduced to its plain text, without expand/collapse markers.
    copy.querySelectorAll('td *, th *').forEach((c) => { c.before(' '); c.after(' '); });
    copy.querySelectorAll('td, th').forEach((c) => { c.textContent = plainText(c.textContent); });
    return copy;
  }

  /**
   * Heading that introduces a table: the nearest h1–h3 / section title before it inside its card,
   * else the table's own first header cell.
   */
  function tableTitle(table, main) {
    const sel = 'h1, h2, h3, .section-title';
    const clean = plainText;
    const stop = table.closest('.card') || main;
    for (let el = table; el && el !== stop; el = el.parentElement) {
      for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
        const h = p.matches(sel) ? p : [...p.querySelectorAll(sel)].pop();
        if (!h) continue;
        // The heading's own words, without the badges, hints and buttons that sit inside it.
        const own = clean([...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
        const text = own || clean(h.textContent);
        if (text) return text;
      }
    }
    const th = table.querySelector('th');
    return th ? clean(th.textContent) : '';
  }

  /** Excel sheet names: at most 31 characters, none of []:*?/\ and unique within the workbook. */
  function sheetName(title, used) {
    const base = title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).trim() || 'Sheet';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 30 - String(n).length).trim()} ${n}`;
    used.add(name.toLowerCase());
    return name;
  }

  function fitColumns(XLSX, ws) {
    if (!ws['!ref']) return;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const widths = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      let w = 6;
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v != null) w = Math.max(w, String(cell.v).length + 2);
      }
      widths.push({ wch: Math.min(w, 60) });
    }
    ws['!cols'] = widths;
  }

  /** Workbook with an info sheet and one sheet per visible table; null when the screen has no table. */
  async function buildXlsx(now) {
    const main = A.$('main');
    const tables = A.$$('table', main).filter((tb) => tb.getClientRects().length && tb.rows.length);
    if (!tables.length) return null;
    await loadScript(VENDOR.xlsx);
    const XLSX = root.XLSX;
    const parse = numberParser();
    const wb = XLSX.utils.book_new();
    const used = new Set();

    const info = XLSX.utils.aoa_to_sheet([[t('app_title')], [], ...exportInfo(now)]);
    fitColumns(XLSX, info);
    XLSX.utils.book_append_sheet(wb, info, sheetName(t('exp_info'), used));

    tables.forEach((table, i) => {
      const ws = XLSX.utils.table_to_sheet(tableForSheet(table), { raw: true });
      Object.keys(ws).forEach((addr) => {
        const cell = ws[addr];
        if (addr[0] === '!' || cell.t !== 's') return;
        const num = parse(cell.v);
        if (num) { cell.t = 'n'; cell.v = num.v; if (num.z) cell.z = num.z; }
      });
      fitColumns(XLSX, ws);
      XLSX.utils.book_append_sheet(wb, ws, sheetName(`${i + 1} ${tableTitle(table, main)}`, used));
    });
    return wb;
  }

  /* ----------------------------------------------------------------- action */

  const FORMATS = {
    pdf: {
      ext: 'pdf', working: 'exp_working',
      async run(now, name) { (await buildPdf(now)).save(name); return true; },
    },
    xlsx: {
      ext: 'xlsx', working: 'exp_working_xlsx',
      async run(now, name) {
        const wb = await buildXlsx(now);
        if (!wb) { A.toast(t('exp_no_tables'), true); return false; }
        root.XLSX.writeFile(wb, name, { compression: true });
        return true;
      },
    },
  };

  let busy = false;
  /** Export the current screen as 'pdf' or 'xlsx'. Resolves to the file name, or null when nothing was exported. */
  async function exportScreen(format = 'pdf') {
    const fmt = FORMATS[format];
    if (busy || !fmt) return null;
    busy = true;
    document.documentElement.classList.add('export-busy');
    const btn = A.$('[data-fn="FN01"]');
    if (btn) { btn.disabled = true; btn.textContent = t(fmt.working); }
    try {
      const now = new Date();
      const name = fileName(now, fmt.ext);
      // Let the "Creating…" label paint before the heavy work starts.
      await new Promise((r) => setTimeout(r, 30));
      if (!(await fmt.run(now, name))) return null;
      A.toast(t('exp_done', { file: name }));
      return name;
    } catch (err) {
      console.error('FN-01 export failed', err);
      A.toast(t('exp_failed'), true);
      return null;
    } finally {
      busy = false;
      document.documentElement.classList.remove('export-busy');
      // The shell may have re-rendered meanwhile, so look the button up again.
      const b = A.$('[data-fn="FN01"]');
      if (b) { b.disabled = false; b.textContent = t('screen_output'); }
    }
  }

  /** Format chooser under the Screen output button. Clicking the button again, outside, or Esc closes it. */
  let closeMenu = null;
  function openExportMenu(btn) {
    if (closeMenu) { closeMenu(); return; }
    if (busy) return;
    const menu = document.createElement('div');
    menu.className = 'export-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = [['pdf', 'PDF', 'exp_pdf_hint'], ['xlsx', 'Excel', 'exp_xlsx_hint']].map(([f, label, hint]) =>
      `<button type="button" role="menuitem" data-export="${f}"><b>${label}</b><span>${esc(t(hint))}</span></button>`).join('');
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;

    const onDown = (e) => { if (!menu.contains(e.target) && !e.target.closest('[data-fn="FN01"]')) close(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); const b = A.$('[data-fn="FN01"]'); if (b) b.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...menu.children];
      const next = items.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
      items[(next + items.length) % items.length].focus();
      e.preventDefault();
    };
    function close() {
      menu.remove(); closeMenu = null;
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
    }
    closeMenu = close;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-export]');
      if (!item) return;
      close();
      exportScreen(item.dataset.export);
    });
    menu.firstElementChild.focus();
  }

  A.exportScreen = exportScreen;
  A.openExportMenu = openExportMenu;
  A.Export = { buildPdf, buildXlsx, paginate };
})(window);
