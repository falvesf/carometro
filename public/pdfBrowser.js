import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';
import { buildPackedCardLayout, loadPrintFieldsConfig } from './printLayout.js?v=20261125-1';

const PAGE_W = 595;
const PAGE_H = 842;

function formatTodayBR() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function dataUrlToBytes(dataUrl) {
  const parts = String(dataUrl).split(',');
  const header = parts[0] || '';
  const b64 = parts[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  const isPng = /image\/png/i.test(header);
  const isJpg = /image\/jpe?g/i.test(header);
  return { bytes, isPng, isJpg };
}

async function convertDataUrlToPngBytes(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width || 300;
      canvas.height = img.height || 350;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async (blob) => {
        if (!blob) return reject(new Error('Falha ao converter foto'));
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function wrapLines(text, font, size, maxWidth) {
  const raw = String(text ?? '').trim();
  if (!raw) return [''];
  const words = raw.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
      } else {
        // Hard-break very long token
        let slice = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(slice + ch, size) <= maxWidth) {
            slice += ch;
          } else {
            if (slice) lines.push(slice);
            slice = ch;
          }
        }
        current = slice;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function fitSingleLine(text, font, size, maxWidth) {
  const str = String(text ?? '');
  if (font.widthOfTextAtSize(str, size) <= maxWidth) return str;
  let out = str;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

export async function generateCarometroPdfBlob(employees, options = {}) {
  const escolaNome = options.escola_nome || 'Colégio Adventista de Ibiúna';
  const tituloRelatorio = options.titulo_relatorio || 'CARÔMETRO GERAL - 2026 - ANO LETIVO';
  const usuarioRodape = options.usuario_rodape !== undefined ? String(options.usuario_rodape).trim() : '';
  const dataImpressao = options.data_impressao !== undefined ? String(options.data_impressao).trim() : formatTodayBR();
  const showCargo = options.show_cargo !== false;
  const fieldsConfig = options.fields_config || loadPrintFieldsConfig();

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`${escolaNome} - ${tituloRelatorio}`);
  pdfDoc.setAuthor(usuarioRodape || 'Carômetro Geral');

  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Load UI logo & checkmark from relative ./assets/
  let logoImg = null;
  let checkImg = null;
  try {
    const logoBytes = new Uint8Array(await (await fetch('./assets/logo.png')).arrayBuffer());
    logoImg = await pdfDoc.embedPng(logoBytes);
  } catch {
    // ignore missing logo
  }
  try {
    const checkBytes = new Uint8Array(await (await fetch('./assets/checkmark.png')).arrayBuffer());
    checkImg = await pdfDoc.embedPng(checkBytes);
  } catch {
    // ignore missing checkmark
  }

  // Measure & paginate dynamically based on active fields & wrapping
  function computeCard(emp) {
    const layout = buildPackedCardLayout(fieldsConfig, emp, { showCargo });
    const measuredRows = layout.rows.map((row) => {
      if (row.length === 1 && row[0].type === 'full') {
        const cell = row[0];
        const fnt = cell.bold ? fontBold : fontReg;
        const lines = wrapLines(cell.text, fnt, 8.95, cell.widthPt);
        return { isFull: true, cell, lines, height: lines.length * 11.4 };
      }
      return { isFull: false, cells: row, height: 11.4 };
    });

    const textHeight = measuredRows.reduce((acc, r) => acc + r.height, 0);
    const minCardH = layout.showPhoto ? 96 : 36;
    const cardHeight = Math.max(minCardH, 16 + textHeight);
    return { emp, layout, measuredRows, cardHeight };
  }

  const pages = [];
  let currentPage = [];
  let currentY = 78.3;
  const MAX_Y = 768;

  for (const emp of employees) {
    const item = computeCard(emp);
    if (currentPage.length >= 7 || (currentPage.length > 0 && currentY + item.cardHeight > MAX_Y)) {
      pages.push(currentPage);
      currentPage = [];
      currentY = 78.3;
    }
    currentPage.push({ ...item, cardTop: currentY });
    currentY += item.cardHeight;
  }
  if (currentPage.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  const totalPages = pages.length;
  const black = rgb(0, 0, 0);
  const frameGray = rgb(0.753, 0.753, 0.753);
  const bgPlaceholder = rgb(0.953, 0.957, 0.965);
  const textMuted = rgb(0.612, 0.639, 0.686);

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    const cards = pages[pageIdx];

    // Header logo
    if (logoImg) {
      page.drawImage(logoImg, {
        x: 18,
        y: PAGE_H - 24 - 47.85,
        width: 132.1,
        height: 47.85,
      });
    }

    // Header school & title centered
    const schoolW = fontReg.widthOfTextAtSize(escolaNome, 9.85);
    page.drawText(escolaNome, {
      x: (PAGE_W - schoolW) / 2,
      y: PAGE_H - 33.95,
      size: 9.85,
      font: fontReg,
      color: black,
    });

    const titleW = fontBold.widthOfTextAtSize(tituloRelatorio, 10.5);
    page.drawText(tituloRelatorio, {
      x: (PAGE_W - titleW) / 2,
      y: PAGE_H - 47.85,
      size: 10.5,
      font: fontBold,
      color: black,
    });

    for (const item of cards) {
      const { emp, layout, measuredRows, cardTop } = item;

      // Top horizontal separator line
      page.drawLine({
        start: { x: 18, y: PAGE_H - cardTop },
        end: { x: 577.5, y: PAGE_H - cardTop },
        thickness: 0.5,
        color: black,
      });

      if (layout.showPhoto) {
        // Photo frame (75x87)
        page.drawRectangle({
          x: 502.5,
          y: PAGE_H - (cardTop + 3.0) - 87,
          width: 75,
          height: 87,
          borderWidth: 1,
          borderColor: frameGray,
        });

        // Photo image (72x84)
        let drewPhoto = false;
        const photoSrc = emp.foto_data || emp.previewPhotoSrc || '';
        if (photoSrc && photoSrc.startsWith('data:image/')) {
          try {
            const { bytes, isPng, isJpg } = dataUrlToBytes(photoSrc);
            let embedded;
            if (isPng) embedded = await pdfDoc.embedPng(bytes);
            else if (isJpg) embedded = await pdfDoc.embedJpg(bytes);
            else embedded = await pdfDoc.embedPng(await convertDataUrlToPngBytes(photoSrc));

            page.drawImage(embedded, {
              x: 504,
              y: PAGE_H - (cardTop + 4.5) - 84,
              width: 72,
              height: 84,
            });
            drewPhoto = true;
          } catch {
            drewPhoto = false;
          }
        }

        if (!drewPhoto) {
          page.drawRectangle({
            x: 504,
            y: PAGE_H - (cardTop + 4.5) - 84,
            width: 72,
            height: 84,
            color: bgPlaceholder,
          });
          const label = 'Sem foto';
          const lw = fontReg.widthOfTextAtSize(label, 7);
          page.drawText(label, {
            x: 504 + (72 - lw) / 2,
            y: PAGE_H - (cardTop + 48),
            size: 7,
            font: fontReg,
            color: textMuted,
          });
        }
      }

      // Draw dynamic ordered rows
      let cursorBase = cardTop + 12.6;
      for (const row of measuredRows) {
        if (row.isFull) {
          const fnt = row.cell.bold ? fontBold : fontReg;
          row.lines.forEach((line, li) => {
            page.drawText(line, {
              x: 18 + row.cell.xPt,
              y: PAGE_H - (cursorBase + li * 11.4),
              size: 8.95,
              font: fnt,
              color: black,
            });
          });
          cursorBase += row.height;
          continue;
        }

        for (const cell of row.cells) {
          if (cell.type === 'code_name_pair') {
            const codeFnt = cell.codigoBold ? fontBold : fontReg;
            const nomeFnt = cell.nomeBold ? fontBold : fontReg;
            const codeStr = cell.codigo || '';
            const codeW = codeStr ? codeFnt.widthOfTextAtSize(codeStr, 9.2) : 0;
            if (codeStr) {
              page.drawText(codeStr, {
                x: 18 + cell.xPt,
                y: PAGE_H - cursorBase,
                size: 9.2,
                font: codeFnt,
                color: black,
              });
            }
            const nomeX = codeStr ? Math.max(18 + cell.xPt + 30.5, 18 + cell.xPt + codeW + 6) : 18 + cell.xPt;
            const nomeMaxW = 18 + cell.xPt + cell.widthPt - nomeX - 4;
            const nomeFit = fitSingleLine(cell.nome || '', nomeFnt, 9.2, Math.max(40, nomeMaxW));
            page.drawText(nomeFit, {
              x: nomeX,
              y: PAGE_H - cursorBase,
              size: 9.2,
              font: nomeFnt,
              color: black,
            });
          } else if (cell.type === 'checkmark') {
            const fnt = cell.bold ? fontBold : fontReg;
            const txt = fitSingleLine(cell.text, fnt, 8.95, cell.widthPt - 18);
            const drawX = 18 + cell.xPt;
            page.drawText(txt, {
              x: drawX,
              y: PAGE_H - cursorBase,
              size: 8.95,
              font: fnt,
              color: black,
            });
            if (cell.checked && checkImg) {
              const txtW = fnt.widthOfTextAtSize(txt, 8.95);
              page.drawImage(checkImg, {
                x: Math.min(575 - 14.25, drawX + txtW + 4),
                y: PAGE_H - (cursorBase + 2.9),
                width: 14.25,
                height: 11.8,
              });
            }
          } else {
            const fnt = cell.bold ? fontBold : fontReg;
            const size = cell.isHeaderName ? 9.2 : 8.95;
            const txt = fitSingleLine(cell.text, fnt, size, Math.max(20, cell.widthPt - 4));
            page.drawText(txt, {
              x: 18 + cell.xPt,
              y: PAGE_H - cursorBase,
              size,
              font: fnt,
              color: black,
            });
          }
        }
        cursorBase += row.height;
      }
    }

    // Footer
    const footerY = PAGE_H - 821.5;
    if (dataImpressao) {
      page.drawText(dataImpressao, {
        x: 18,
        y: footerY,
        size: 8.95,
        font: fontReg,
        color: black,
      });
    }

    if (usuarioRodape) {
      const userText = `Usuário:${usuarioRodape}`;
      const userW = fontReg.widthOfTextAtSize(userText, 8.95);
      page.drawText(userText, {
        x: (PAGE_W - userW) / 2,
        y: footerY,
        size: 8.95,
        font: fontReg,
        color: black,
      });
    }

    const pageLabel = `${pageIdx + 1}/${totalPages}`;
    const pageW = fontReg.widthOfTextAtSize(pageLabel, 8.95);
    page.drawText(pageLabel, {
      x: 577 - pageW,
      y: footerY,
      size: 8.95,
      font: fontReg,
      color: black,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}
