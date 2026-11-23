import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

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
  const escolaNome = options.escola_nome || 'Escola Adventista de Ibiúna';
  const tituloRelatorio = options.titulo_relatorio || 'CARÔMETRO GERAL - 2026 - ANO LETIVO';
  const usuarioRodape = options.usuario_rodape || '';
  const dataImpressao = options.data_impressao || formatTodayBR();

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

  // Measure & paginate (up to 7 cards per page, dynamic expansion if address/phones wrap)
  function computeCard(emp) {
    const addrLines = wrapLines(`Endereço: ${emp.endereco || ''}`, fontReg, 8.95, 468);
    const telLines = wrapLines(`Telefones: ${emp.telefones || ''}`, fontReg, 8.95, 468);
    const extraAddr = Math.max(0, (addrLines.length - 1) * 11.4);
    const extraTel = Math.max(0, (telLines.length - 1) * 11.4);
    const cardHeight = Math.max(96, 86 + extraAddr + extraTel);
    return { emp, addrLines, telLines, extraAddr, extraTel, cardHeight };
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
      const { emp, addrLines, telLines, cardTop, extraAddr } = item;

      // Top horizontal separator line
      page.drawLine({
        start: { x: 18, y: PAGE_H - cardTop },
        end: { x: 577.5, y: PAGE_H - cardTop },
        thickness: 0.5,
        color: black,
      });

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

      // Row 1: Código, Nome, CPF
      const codeStr = emp.codigo ? String(emp.codigo) : '';
      const codeW = codeStr ? fontBold.widthOfTextAtSize(codeStr, 8.75) : 0;
      if (codeStr) {
        page.drawText(codeStr, {
          x: 18,
          y: PAGE_H - (cardTop + 12.75),
          size: 8.75,
          font: fontBold,
          color: black,
        });
      }

      const nomeX = codeStr ? Math.max(47.25, 18 + codeW + 6) : 18;
      const nomeMaxW = 402 - nomeX;
      const nomeFit = fitSingleLine(emp.nome || '', fontBold, 7.8, nomeMaxW);
      page.drawText(nomeFit, {
        x: nomeX,
        y: PAGE_H - (cardTop + 11.9),
        size: 7.8,
        font: fontBold,
        color: black,
      });

      page.drawText(`CPF: ${emp.cpf || ''}`, {
        x: 408,
        y: PAGE_H - (cardTop + 12.4),
        size: 8.95,
        font: fontReg,
        color: black,
      });

      // Row 2: Endereço
      addrLines.forEach((line, i) => {
        page.drawText(line, {
          x: 18,
          y: PAGE_H - (cardTop + 23.4 + i * 11.4),
          size: 8.95,
          font: fontReg,
          color: black,
        });
      });

      const row3Base = cardTop + 34.8 + extraAddr;
      const row4Base = row3Base + 11.0;
      const row5Base = row4Base + 11.0;
      const row6Base = row5Base + 12.2;

      // Row 3: Data de Nascimento, Sexo, E-mail
      page.drawText(`Data de Nascimento: ${emp.data_nascimento || ''}`, {
        x: 18,
        y: PAGE_H - row3Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });
      page.drawText(`Sexo: ${emp.sexo || ''}`, {
        x: 192,
        y: PAGE_H - row3Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });
      const emailFit = fitSingleLine(`E-mail: ${emp.email || ''}`, fontReg, 8.95, 212);
      page.drawText(emailFit, {
        x: 285,
        y: PAGE_H - row3Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });

      // Row 4: RG, Emitido por, Data emissão
      page.drawText(`RG: ${emp.rg || ''}`, {
        x: 18,
        y: PAGE_H - row4Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });
      page.drawText(`Emitido por: ${emp.emitido_por || ''}`, {
        x: 192,
        y: PAGE_H - row4Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });
      page.drawText(`Data emissão: ${emp.data_emissao || ''}`, {
        x: 360,
        y: PAGE_H - row4Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });

      // Row 5: Data de contratação, Data de demissão, Tem assinatura digitalizada
      page.drawText(`Data de contratação: ${emp.data_contratacao || ''}`, {
        x: 18,
        y: PAGE_H - row5Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });
      page.drawText(`Data de demissão: ${emp.data_demissao || ''}`, {
        x: 192,
        y: PAGE_H - row5Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });
      page.drawText('Tem assinatura digitalizada:', {
        x: 360,
        y: PAGE_H - row5Base,
        size: 8.95,
        font: fontReg,
        color: black,
      });

      if (emp.tem_assinatura_digitalizada && checkImg) {
        page.drawImage(checkImg, {
          x: 474,
          y: PAGE_H - (row5Base + 2.9),
          width: 14.25,
          height: 11.8,
        });
      }

      // Row 6: Telefones
      telLines.forEach((line, i) => {
        page.drawText(line, {
          x: 18,
          y: PAGE_H - (row6Base + i * 11.4),
          size: 8.95,
          font: fontReg,
          color: black,
        });
      });
    }

    // Footer
    const footerY = PAGE_H - 821.5;
    page.drawText(dataImpressao, {
      x: 18,
      y: footerY,
      size: 8.95,
      font: fontReg,
      color: black,
    });

    const userText = `Usuário:${usuarioRodape}`;
    const userW = fontReg.widthOfTextAtSize(userText, 8.95);
    page.drawText(userText, {
      x: (PAGE_W - userW) / 2,
      y: footerY,
      size: 8.95,
      font: fontReg,
      color: black,
    });

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
