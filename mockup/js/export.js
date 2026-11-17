/* FN-01 Screen output — one click turns the current screen into a downloaded PDF (README §6.2).
 *
 * The live page is never touched: html2canvas renders a clone, and the clone is what gets
 * un-scrolled, widened and given the export header. Libraries load on first use.
 */
(function (root) {
  'use strict';
  const A = root.App;
  const { t, esc, state } = A;

  const VENDOR = { html2canvas: 'js/vendor/html2canvas.min.js', jspdf: 'js/vendor/jspdf.umd.min.js' };
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
  function fileName(now) {
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    return [A.SCREEN_ID[state.screen], state.orgId, state.periodId, stamp].join('_').replace(/[^\w.-]+/g, '-') + '.pdf';
  }

  /** README §6.2: fiscal period, organization, screen name, export timestamp and exporting user. */
  function headerHtml(now) {
    const when = new Intl.DateTimeFormat(I18N.locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(now);
    const item = (label, value) => `<span><b>${esc(label)}:</b> ${esc(value)}</span>`;
    return `<div class="export-title">${esc(t('app_title'))}</div>
      <div class="export-meta">
        ${item(t('exp_screen'), `${A.SCREEN_ID[state.screen]} ${t('scr_' + state.screen)}`)}
        ${item(t('period'), A.ytdLabel())}
        ${item(t('org'), A.orgName(state.orgId))}
        ${item(t('exp_by'), A.user().display_name)}
        ${item(t('exp_at'), when)}
      </div>`;
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

  let busy = false;
  /** Export the current screen. Resolves to the file name, or null when the export failed. */
  async function exportScreen() {
    if (busy) return null;
    busy = true;
    document.documentElement.classList.add('export-busy');
    const btn = A.$('[data-fn="FN01"]');
    if (btn) { btn.disabled = true; btn.textContent = t('exp_working'); }
    try {
      const now = new Date();
      const name = fileName(now);
      // Let the "Creating PDF…" label paint before the heavy work starts.
      await new Promise((r) => setTimeout(r, 30));
      const pdf = await buildPdf(now);
      pdf.save(name);
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

  A.exportScreen = exportScreen;
  A.Export = { buildPdf, paginate };
})(window);
