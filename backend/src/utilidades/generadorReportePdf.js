/**
 * Dibuja en PDF el "documento" de un reporte (ver vistasReporte.js): portada
 * con título y período, indicadores, hallazgos, gráficos (columnas, líneas,
 * barras, dona) y tablas con encabezado repetido, filas alternadas y totales.
 * Se transmite directamente sobre la respuesta HTTP, sin guardar en disco.
 *
 * Solo se usan las fuentes estándar del PDF (Helvetica), que no tienen
 * algunos símbolos (−, →): `limpiar()` los cambia por equivalentes.
 */
const PDFDocument = require('pdfkit');
const F = require('./formatos');

const M = 40; // margen lateral
const W = 532; // ancho útil (LETTER = 612)
const ALTO_PAGINA = 792;
const LIMITE_Y = ALTO_PAGINA - 55;

const TINTAS = { ok: '#047857', mal: '#b91c1c', aviso: '#b45309', destacado: '#0369a1' };
const BORDES = { ok: '#10b981', mal: '#ef4444', aviso: '#f59e0b', destacado: '#0077b6' };
const AZUL_OSCURO = '#0b3a5b';
const AZUL = '#0077b6';
const GRIS = '#64748b';
const TEXTO = '#0f172a';

function limpiar(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/[−–]/g, '-')
    .replace(/→/g, '>')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

/** Cada celda de tabla es un texto o {t, tono}. */
const textoCelda = (c) => (c && typeof c === 'object' ? c.t : c);
const tonoCelda = (c) => (c && typeof c === 'object' ? c.tono : undefined);

class Lienzo {
  constructor(doc, vista) {
    this.doc = doc;
    this.vista = vista;
    this.y = 0;
    this.primeraPagina = true;
    doc.on('pageAdded', () => {
      if (this.primeraPagina) return;
      this.encabezadoPaginaInterna();
    });
  }

  encabezadoPaginaInterna() {
    const d = this.doc;
    d.save();
    d.rect(0, 0, 612, 6).fill(AZUL_OSCURO);
    d.font('Helvetica-Bold').fontSize(8).fillColor(GRIS)
      .text(`CarWash Pro  |  ${limpiar(this.vista.titulo)}`, M, 20, { width: W, lineBreak: false });
    d.moveTo(M, 34).lineTo(M + W, 34).lineWidth(0.5).strokeColor('#e2e8f0').stroke();
    d.restore();
    this.y = 48;
  }

  espacio(alto) {
    if (this.y + alto > LIMITE_Y) {
      this.doc.addPage();
    }
  }

  // ----- Portada ---------------------------------------------------------
  portada() {
    const d = this.doc;
    const v = this.vista;
    d.rect(0, 0, 612, 108).fill(AZUL_OSCURO);
    d.rect(0, 108, 612, 4).fill('#00b4d8');
    d.font('Helvetica-Bold').fontSize(10).fillColor('#7dd3fc').text('CARWASH PRO', M, 24, { characterSpacing: 2, lineBreak: false });
    d.font('Helvetica-Bold').fontSize(21).fillColor('#ffffff').text(limpiar(v.titulo), M, 40, { width: W, lineBreak: false });
    const periodo = v.periodo
      ? (v.periodo.inicio ? `Período: ${limpiar(v.periodo.etiqueta)}   (${v.periodo.inicio} a ${v.periodo.fin})` : limpiar(v.periodo.etiqueta))
      : '';
    d.font('Helvetica').fontSize(10).fillColor('#e0f2fe').text(periodo, M, 72, { width: W, lineBreak: false });
    d.font('Helvetica').fontSize(8).fillColor('#93c5fd').text(`Generado el ${new Date().toLocaleString('es-CO')}`, M, 88, { width: W, lineBreak: false });
    this.primeraPagina = false;
    this.y = 126;

    if (v.descripcion) {
      d.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS);
      const h = d.heightOfString(limpiar(v.descripcion), { width: W });
      d.text(limpiar(v.descripcion), M, this.y, { width: W });
      this.y += h + 12;
    }
  }

  // ----- Indicadores -----------------------------------------------------
  kpis(lista) {
    if (!lista.length) return;
    const d = this.doc;
    const columnas = 3;
    const gap = 10;
    const ancho = (W - gap * (columnas - 1)) / columnas;
    const alto = 62;
    lista.forEach((k, i) => {
      const col = i % columnas;
      if (col === 0) this.espacio(alto + 10);
      const x = M + col * (ancho + gap);
      const y = this.y;
      const tono = k.tono || 'neutro';
      d.roundedRect(x, y, ancho, alto, 6).fillAndStroke('#f8fafc', '#e2e8f0');
      d.rect(x, y + 6, 3, alto - 12).fill(BORDES[tono] || '#94a3b8');
      d.font('Helvetica-Bold').fontSize(7).fillColor(GRIS).text(limpiar(k.titulo).toUpperCase(), x + 12, y + 8, { width: ancho - 20, lineBreak: false, ellipsis: true });
      let tam = 15;
      d.font('Helvetica-Bold').fontSize(tam);
      while (d.widthOfString(limpiar(k.valor)) > ancho - 24 && tam > 9) { tam -= 1; d.fontSize(tam); }
      d.fillColor(TINTAS[tono] || TEXTO).text(limpiar(k.valor), x + 12, y + 19, { width: ancho - 20, lineBreak: false });
      if (k.variacion !== null && k.variacion !== undefined) {
        const mejor = k.mejorSiSube === false ? k.variacion < 0 : k.variacion > 0;
        const colorVar = k.variacion === 0 ? GRIS : (mejor ? TINTAS.ok : TINTAS.mal);
        d.font('Helvetica-Bold').fontSize(7.5).fillColor(colorVar)
          .text(`${k.variacion > 0 ? '+' : ''}${F.porcentaje(k.variacion)} vs. anterior`, x + 12, y + 38, { width: ancho - 20, lineBreak: false });
      }
      if (k.detalle) {
        d.font('Helvetica').fontSize(7).fillColor(GRIS)
          .text(limpiar(k.detalle), x + 12, y + (k.variacion !== null && k.variacion !== undefined ? 49 : 42), { width: ancho - 20, height: 18, ellipsis: true });
      }
      if (col === columnas - 1 || i === lista.length - 1) this.y += alto + 10;
    });
    this.y += 4;
  }

  // ----- Hallazgos ---------------------------------------------------------
  hallazgos(lista) {
    if (!lista.length) return;
    const d = this.doc;
    this.espacio(60);
    d.font('Helvetica-Bold').fontSize(12).fillColor(AZUL_OSCURO).text('Lo más importante de este reporte', M, this.y, { width: W });
    this.y += 20;
    lista.forEach((texto) => {
      d.font('Helvetica').fontSize(9);
      const h = d.heightOfString(limpiar(texto), { width: W - 30 }) + 10;
      this.espacio(h);
      d.rect(M, this.y, W, h).fill('#eff8fd');
      d.rect(M, this.y, 3, h).fill(AZUL);
      d.circle(M + 14, this.y + h / 2, 2.2).fill(AZUL);
      d.font('Helvetica').fontSize(9).fillColor(TEXTO).text(limpiar(texto), M + 24, this.y + 5, { width: W - 34 });
      this.y += h + 2;
    });
    this.y += 12;
  }

  // ----- Sección: título + explicación ------------------------------------
  encabezadoSeccion(titulo, explicacion, alturaMinima = 60) {
    const d = this.doc;
    let hExp = 0;
    if (explicacion) {
      d.font('Helvetica-Oblique').fontSize(8.5);
      hExp = d.heightOfString(limpiar(explicacion), { width: W }) + 4;
    }
    this.espacio(22 + hExp + alturaMinima);
    d.rect(M, this.y + 1, 4, 14).fill(AZUL);
    d.font('Helvetica-Bold').fontSize(12).fillColor(AZUL_OSCURO).text(limpiar(titulo), M + 10, this.y, { width: W - 10, lineBreak: false, ellipsis: true });
    this.y += 20;
    if (explicacion) {
      d.font('Helvetica-Oblique').fontSize(8.5).fillColor(GRIS).text(limpiar(explicacion), M, this.y, { width: W });
      this.y += hExp;
    }
    this.y += 4;
  }

  // ----- Fórmula de ganancia ----------------------------------------------
  formula(s) {
    this.encabezadoSeccion(s.titulo, s.explicacion, 70);
    const d = this.doc;
    const n = s.pasos.length;
    const anchoOp = 16;
    const ancho = (W - anchoOp * (n - 1)) / n;
    const alto = 56;
    let x = M;
    s.pasos.forEach((p, i) => {
      if (i > 0) {
        d.font('Helvetica-Bold').fontSize(15).fillColor(GRIS).text(limpiar(p.operador || ''), x, this.y + 18, { width: anchoOp, align: 'center', lineBreak: false });
        x += anchoOp;
      }
      const destacado = p.tono === 'destacado';
      d.roundedRect(x, this.y, ancho, alto, 6).fillAndStroke(destacado ? '#e0f2fe' : '#f8fafc', destacado ? '#0077b6' : '#e2e8f0');
      d.font('Helvetica-Bold').fontSize(6.5).fillColor(GRIS).text(limpiar(p.etiqueta).toUpperCase(), x + 6, this.y + 8, { width: ancho - 12, align: 'center', lineBreak: false, ellipsis: true });
      let tam = 12;
      d.font('Helvetica-Bold').fontSize(tam);
      while (d.widthOfString(limpiar(p.valor)) > ancho - 10 && tam > 8) { tam -= 1; d.fontSize(tam); }
      d.fillColor(TINTAS[p.tono] || TEXTO).text(limpiar(p.valor), x + 5, this.y + 22, { width: ancho - 10, align: 'center', lineBreak: false });
      if (p.detalle) d.font('Helvetica').fontSize(7).fillColor(GRIS).text(limpiar(p.detalle), x + 5, this.y + 40, { width: ancho - 10, align: 'center', lineBreak: false });
      x += ancho;
    });
    this.y += alto + 16;
  }

  // ----- Texto libre -------------------------------------------------------
  texto(s) {
    this.encabezadoSeccion(s.titulo, null, 20);
    this.doc.font('Helvetica').fontSize(9).fillColor(TEXTO);
    const h = this.doc.heightOfString(limpiar(s.texto), { width: W });
    this.doc.text(limpiar(s.texto), M, this.y, { width: W });
    this.y += h + 14;
  }

  // ----- Barras horizontales ----------------------------------------------
  barras(s) {
    this.encabezadoSeccion(s.titulo, s.explicacion, 40);
    const d = this.doc;
    if (!s.items.length || s.items.every(i => !i.valor)) {
      d.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS).text('Sin datos en el período.', M, this.y);
      this.y += 22;
      return;
    }
    const max = Math.max(...s.items.map(i => i.valor), 1);
    const total = s.items.reduce((a, i) => a + i.valor, 0) || 1;
    const anchoEtiqueta = 140;
    const anchoPista = 160;
    const anchoTexto = W - anchoEtiqueta - anchoPista - 16;
    s.items.forEach((it) => {
      this.espacio(20);
      d.font('Helvetica').fontSize(8.5).fillColor(TEXTO).text(limpiar(it.etiqueta), M, this.y + 2, { width: anchoEtiqueta, lineBreak: false, ellipsis: true });
      const xp = M + anchoEtiqueta + 8;
      d.roundedRect(xp, this.y + 3, anchoPista, 9, 4.5).fill('#e5e7eb');
      const ancho = Math.max(it.valor > 0 ? 3 : 0, (it.valor / max) * anchoPista);
      if (ancho > 0) d.roundedRect(xp, this.y + 3, ancho, 9, 4.5).fill(it.color);
      d.font('Helvetica-Bold').fontSize(8).fillColor(TEXTO)
        .text(`${limpiar(it.texto)}`, xp + anchoPista + 8, this.y + 2, { width: anchoTexto, lineBreak: false, ellipsis: true });
      this.y += 18;
    });
    this.y += 10;
    void total;
  }

  // ----- Dona --------------------------------------------------------------
  dona(s) {
    const d = this.doc;
    const items = s.items.filter(i => i.valor > 0);
    const total = items.reduce((a, i) => a + i.valor, 0);
    const alto = Math.max(130, items.length * 17 + 14);
    this.encabezadoSeccion(s.titulo, s.explicacion, alto);
    if (!total) {
      d.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS).text('Sin datos en el período.', M, this.y);
      this.y += 22;
      return;
    }
    const cx = M + 62;
    const cy = this.y + 62;
    const r = 56;
    let angulo = -Math.PI / 2;
    if (items.length === 1) {
      d.circle(cx, cy, r).fill(items[0].color);
    } else {
      items.forEach((it) => {
        const barrido = (it.valor / total) * Math.PI * 2;
        const a0 = angulo;
        const a1 = angulo + barrido;
        const x1 = cx + r * Math.cos(a0);
        const y1 = cy + r * Math.sin(a0);
        const x2 = cx + r * Math.cos(a1);
        const y2 = cy + r * Math.sin(a1);
        d.path(`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${barrido > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`).fill(it.color);
        angulo = a1;
      });
    }
    d.circle(cx, cy, 30).fill('#ffffff');
    d.font('Helvetica-Bold').fontSize(9).fillColor(TEXTO).text('Total', cx - 30, cy - 9, { width: 60, align: 'center', lineBreak: false });
    d.font('Helvetica').fontSize(7).fillColor(GRIS).text(items.length > 0 ? `${items.length} grupos` : '', cx - 30, cy + 2, { width: 60, align: 'center', lineBreak: false });

    let yl = this.y + 4;
    const xl = M + 140;
    items.forEach((it) => {
      d.rect(xl, yl + 2, 9, 9).fill(it.color);
      d.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXTO).text(limpiar(it.etiqueta), xl + 15, yl + 1, { width: 150, lineBreak: false, ellipsis: true });
      d.font('Helvetica').fontSize(8.5).fillColor(TEXTO).text(`${limpiar(it.texto)}  (${F.porcentaje((it.valor / total) * 100, 0)})`, xl + 170, yl + 1, { width: W - 170 - 140 + 10, lineBreak: false, ellipsis: true });
      yl += 17;
    });
    this.y += alto;
  }

  // ----- Serie: columnas o líneas -----------------------------------------
  serie(s) {
    const alto = 200;
    this.encabezadoSeccion(s.titulo, s.explicacion, alto);
    const d = this.doc;
    const todos = s.series.flatMap(x => x.valores);
    if (!todos.some(v => v > 0)) {
      d.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS).text('Sin datos en el período.', M, this.y);
      this.y += 22;
      return;
    }
    const fmt = s.formato === 'dinero' ? F.monedaCorta : (v) => F.decimal(v, Number.isInteger(v) ? 0 : 1);
    const maxReal = Math.max(...todos, 1);
    const pot = Math.pow(10, Math.floor(Math.log10(maxReal)));
    const norm = maxReal / pot;
    const maxEje = ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(p => norm <= p + 1e-9) || 10) * pot;

    const x0 = M + 46;
    const anchoPlot = W - 46 - 4;
    const yTop = this.y + (s.series.length > 1 ? 16 : 6);
    const altoPlot = 130;
    const yBase = yTop + altoPlot;

    // leyenda (si hay más de una serie)
    if (s.series.length > 1) {
      let xl = x0;
      s.series.forEach((se) => {
        d.rect(xl, this.y + 2, 8, 8).fill(se.color);
        d.font('Helvetica').fontSize(8).fillColor(TEXTO).text(limpiar(se.nombre), xl + 12, this.y + 1, { lineBreak: false });
        xl += 24 + d.widthOfString(limpiar(se.nombre)) + 10;
      });
    }

    // cuadrícula y eje Y
    for (let i = 0; i <= 4; i++) {
      const yy = yBase - (altoPlot * i) / 4;
      d.moveTo(x0, yy).lineTo(x0 + anchoPlot, yy).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
      d.font('Helvetica').fontSize(7).fillColor(GRIS).text(fmt((maxEje * i) / 4), M, yy - 3, { width: 42, align: 'right', lineBreak: false });
    }

    const n = s.etiquetas.length;
    const anchoGrupo = anchoPlot / n;
    const k = s.series.length;

    if (s.estilo === 'lineas' && n > 1) {
      s.series.forEach((se) => {
        const px = (i) => x0 + anchoGrupo * i + anchoGrupo / 2;
        const py = (v) => yBase - (v / maxEje) * altoPlot;
        d.moveTo(px(0), py(se.valores[0]));
        se.valores.forEach((v, i) => { if (i > 0) d.lineTo(px(i), py(v)); });
        d.lineWidth(1.6).strokeColor(se.color).stroke();
        if (n <= 40) se.valores.forEach((v, i) => d.circle(px(i), py(v), 1.8).fill(se.color));
      });
    } else {
      const anchoBarra = Math.max(1.5, Math.min(26, (anchoGrupo * 0.72) / k));
      s.series.forEach((se, si) => {
        se.valores.forEach((v, i) => {
          if (v <= 0) return;
          const h = (v / maxEje) * altoPlot;
          const xb = x0 + anchoGrupo * i + (anchoGrupo - anchoBarra * k) / 2 + anchoBarra * si;
          d.rect(xb, yBase - h, anchoBarra, h).fill(se.color);
          if (n <= 12 && k === 1) {
            d.font('Helvetica-Bold').fontSize(6.5).fillColor(TEXTO).text(fmt(v), xb - 12, yBase - h - 9, { width: anchoBarra + 24, align: 'center', lineBreak: false });
          }
        });
      });
    }

    // etiquetas del eje X
    const maxEtiquetas = 14;
    const paso = Math.max(1, Math.ceil(n / maxEtiquetas));
    s.etiquetas.forEach((e, i) => {
      if (i % paso !== 0) return;
      d.font('Helvetica').fontSize(7).fillColor(GRIS).text(limpiar(e), x0 + anchoGrupo * i - 8, yBase + 4, { width: anchoGrupo * paso + 16, align: 'center', lineBreak: false, ellipsis: true });
    });
    d.moveTo(x0, yBase).lineTo(x0 + anchoPlot, yBase).lineWidth(0.8).strokeColor('#94a3b8').stroke();

    this.y = yBase + 26;
  }

  // ----- Tabla -------------------------------------------------------------
  tabla(s) {
    const d = this.doc;
    this.encabezadoSeccion(s.titulo, s.explicacion, 60);
    if (!s.filas.length) {
      d.font('Helvetica-Oblique').fontSize(9).fillColor(GRIS).text(limpiar(s.vacio || 'Sin datos en el período.'), M, this.y);
      this.y += 24;
      return;
    }

    const n = s.columnas.length;
    const tamFuente = n <= 5 ? 8.5 : n <= 8 ? 7.5 : 6.5;
    const pad = n <= 8 ? 4 : 3;
    // Ancho de cada columna según lo que realmente mide su contenido: las
    // columnas cortas (números, fechas) conservan su ancho natural y las de
    // texto largo se reparten el resto, así los valores nunca se parten.
    const medir = (texto, negrita) => { d.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamFuente); return d.widthOfString(limpiar(texto)); };
    const naturales = s.columnas.map((c, ci) => {
      let mayor = Math.max(...String(c.titulo).split(/\s+/).map(p => medir(p, true)));
      s.filas.slice(0, 120).forEach(f => { mayor = Math.max(mayor, medir(textoCelda(f[ci]), !!tonoCelda(f[ci]))); });
      if (s.totales) mayor = Math.max(mayor, medir(textoCelda(s.totales[ci]), true));
      return mayor + pad * 2 + 2;
    });
    const TOPE_TEXTO = 130;
    let anchos = naturales.map(a => Math.min(a, TOPE_TEXTO));
    const suma = anchos.reduce((a, b) => a + b, 0);
    if (suma > W) {
      const cortas = anchos.map(a => a <= 52);
      const fijo = anchos.reduce((a, v, i) => a + (cortas[i] ? v : 0), 0);
      const flexibleTotal = anchos.reduce((a, v, i) => a + (cortas[i] ? 0 : v), 0);
      const factor = flexibleTotal > 0 ? Math.max(0.25, (W - fijo) / flexibleTotal) : 1;
      anchos = anchos.map((a, i) => (cortas[i] ? a : a * factor));
      const nueva = anchos.reduce((a, b) => a + b, 0);
      if (nueva > W) anchos = anchos.map(a => (a / nueva) * W);
    } else {
      // sobra espacio: se reparte en proporción, favoreciendo a las columnas de texto
      const extra = W - suma;
      const base = anchos.reduce((a, v) => a + v, 0);
      anchos = anchos.map(a => a + (a / base) * extra);
    }
    const xs = anchos.reduce((acc, a, i) => { acc.push(i === 0 ? M : acc[i - 1] + anchos[i - 1]); return acc; }, []);
    const altoLinea = tamFuente + 3;

    const dibujarEncabezado = () => {
      d.font('Helvetica-Bold').fontSize(tamFuente);
      let alto = altoLinea;
      s.columnas.forEach((c, i) => { alto = Math.max(alto, d.heightOfString(limpiar(c.titulo), { width: anchos[i] - pad * 2 }) + 2); });
      alto += pad;
      d.rect(M, this.y, W, alto).fill(AZUL_OSCURO);
      s.columnas.forEach((c, i) => {
        d.font('Helvetica-Bold').fontSize(tamFuente).fillColor('#ffffff')
          .text(limpiar(c.titulo), xs[i] + pad, this.y + pad / 2 + 1, { width: anchos[i] - pad * 2, align: c.alinear === 'der' ? 'right' : 'left' });
      });
      this.y += alto;
    };

    const alturaFila = (fila, negrita) => {
      d.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamFuente);
      let h = altoLinea;
      fila.forEach((c, i) => {
        h = Math.max(h, Math.min(altoLinea * 3, d.heightOfString(limpiar(textoCelda(c)), { width: anchos[i] - pad * 2 })));
      });
      return h + pad;
    };

    const dibujarFila = (fila, indice, negrita, fondo) => {
      const alto = alturaFila(fila, negrita);
      if (this.y + alto > LIMITE_Y) {
        d.addPage();
        dibujarEncabezado();
      }
      if (fondo) d.rect(M, this.y, W, alto).fill(fondo);
      else if (indice % 2 === 1) d.rect(M, this.y, W, alto).fill('#f8fafc');
      fila.forEach((c, i) => {
        const tono = tonoCelda(c);
        d.font(negrita || tono ? 'Helvetica-Bold' : 'Helvetica').fontSize(tamFuente).fillColor(tono ? TINTAS[tono] : TEXTO)
          .text(limpiar(textoCelda(c)), xs[i] + pad, this.y + pad / 2 + 0.5, {
            width: anchos[i] - pad * 2, height: altoLinea * 3, ellipsis: true, align: s.columnas[i].alinear === 'der' ? 'right' : 'left'
          });
      });
      d.moveTo(M, this.y + alto).lineTo(M + W, this.y + alto).lineWidth(0.3).strokeColor('#e2e8f0').stroke();
      this.y += alto;
    };

    // El encabezado nunca queda solo al final de la página.
    this.espacio(alturaFila(s.filas[0], false) + 30);
    dibujarEncabezado();
    s.filas.forEach((fila, i) => dibujarFila(fila, i, false, null));
    if (s.totales) dibujarFila(s.totales, 0, true, '#dbeafe');

    this.y += 6;
    if (s.nota) {
      d.font('Helvetica-Oblique').fontSize(7.5).fillColor(GRIS);
      const h = d.heightOfString(limpiar(s.nota), { width: W });
      this.espacio(h + 4);
      d.text(limpiar(s.nota), M, this.y, { width: W });
      this.y += h + 4;
    }
    this.y += 14;
  }
}

/** Número de página en el pie de todas las hojas. */
function dibujarPies(doc, vista) {
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // permite escribir en el borde inferior sin crear otra hoja
    doc.moveTo(M, ALTO_PAGINA - 38).lineTo(M + W, ALTO_PAGINA - 38).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
      .text(`CarWash Pro  |  ${limpiar(vista.titulo)}`, M, ALTO_PAGINA - 30, { width: W / 2, lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
      .text(`Página ${i - rango.start + 1} de ${rango.count}`, M + W / 2, ALTO_PAGINA - 30, { width: W / 2, align: 'right', lineBreak: false });
  }
}

/**
 * @param {import('express').Response} res
 * @param {object} vista - documento armado por vistasReporte.js
 * @param {string} nombreArchivo
 */
function generarPdfDocumento(res, vista, nombreArchivo) {
  const doc = new PDFDocument({ margin: M, size: 'LETTER', bufferPages: true, info: { Title: limpiar(vista.titulo), Author: 'CarWash Pro' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  doc.pipe(res);

  const lienzo = new Lienzo(doc, vista);
  lienzo.portada();
  lienzo.kpis(vista.kpis);
  lienzo.hallazgos(vista.hallazgos);
  vista.secciones.forEach((s) => {
    const dibujar = lienzo[s.tipo];
    if (dibujar) dibujar.call(lienzo, s);
  });

  dibujarPies(doc, vista);
  doc.end();
}

// Se conserva este nombre porque otros módulos (comprobantes de nómina) lo importan.
const formatearMoneda = F.moneda;

module.exports = { generarPdfDocumento, formatearMoneda };
