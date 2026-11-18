import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { ROOT_DIR, UPLOADS_DIR } from './db.js';

const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const LOGO_PATH = path.join(ASSETS_DIR, 'logo.png');
const CHECKMARK_PATH = path.join(ASSETS_DIR, 'checkmark.png');

function resolveFontPath(filename, windowsFallback) {
  const localPath = path.join(ASSETS_DIR, 'fonts', filename);
  if (fs.existsSync(localPath)) return localPath;
  if (fs.existsSync(windowsFallback)) return windowsFallback;
  return '';
}

const FONT_REGULAR = resolveFontPath('arial.ttf', 'C:\\Windows\\Fonts\\arial.ttf');
const FONT_BOLD = resolveFontPath('arialbd.ttf', 'C:\\Windows\\Fonts\\arialbd.ttf');

function formatTodayBR() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Generates an A4 PDF matching carometro.pdf layout and returns a Buffer.
 */
export async function generateCarometroPDF(employees, options = {}) {
  const escolaNome = options.escola_nome || 'Escola Adventista de Ibiúna';
  const tituloRelatorio = options.titulo_relatorio || 'CARÔMETRO GERAL - 2026 - ANO LETIVO';
  const usuarioRodape = options.usuario_rodape || 'daniele.moraes@adm.educadventista.org';
  const dataImpressao = options.data_impressao || formatTodayBR();

  const useCustomFonts = fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD);
  const fontReg = useCustomFonts ? 'Arial' : 'Helvetica';
  const fontBold = useCustomFonts ? 'Arial-Bold' : 'Helvetica-Bold';

  // Measure and paginate cards (7 per page normally, dynamic height if extra wrapping occurs)
  const measureDoc = new PDFDocument({ size: [595, 842], margin: 0, autoFirstPage: false });
  if (useCustomFonts) {
    measureDoc.registerFont('Arial', FONT_REGULAR);
    measureDoc.registerFont('Arial-Bold', FONT_BOLD);
  }

  function computeCardMetrics(emp) {
    measureDoc.font(fontReg).fontSize(8.95);
    const addrText = `Endereço: ${emp.endereco || ''}`;
    const addrHeight = measureDoc.heightOfString(addrText, { width: 468, lineGap: 2.0 });
    const addrLines = Math.max(1, Math.round(addrHeight / 11.4));
    const extraAddr = Math.max(0, (addrLines - 1) * 11.4);

    const telText = `Telefones: ${emp.telefones || ''}`;
    const telHeight = measureDoc.heightOfString(telText, { width: 468, lineGap: 2.0 });
    const telLines = Math.max(1, Math.round(telHeight / 11.4));
    const extraTel = Math.max(0, (telLines - 1) * 11.4);

    const cardHeight = Math.max(96, 86 + extraAddr + extraTel);
    return { cardHeight, extraAddr, extraTel };
  }

  const pages = [];
  let currentPage = [];
  let currentY = 78.3;
  const MAX_Y = 768;

  for (const emp of employees) {
    const metrics = computeCardMetrics(emp);
    if (currentPage.length >= 7 || (currentPage.length > 0 && currentY + metrics.cardHeight > MAX_Y)) {
      pages.push(currentPage);
      currentPage = [];
      currentY = 78.3;
    }
    currentPage.push({ emp, y: currentY, ...metrics });
    currentY += metrics.cardHeight;
  }
  if (currentPage.length > 0 || pages.length === 0) {
    pages.push(currentPage);
  }

  const totalPages = pages.length;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [595, 842],
      margin: 0,
      autoFirstPage: false,
      info: {
        Title: `${escolaNome} - ${tituloRelatorio}`,
        Author: usuarioRodape,
      },
    });

    if (useCustomFonts) {
      doc.registerFont('Arial', FONT_REGULAR);
      doc.registerFont('Arial-Bold', FONT_BOLD);
    }

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const hasLogo = fs.existsSync(LOGO_PATH);
    const hasCheck = fs.existsSync(CHECKMARK_PATH);

    pages.forEach((cards, pageIdx) => {
      doc.addPage({ size: [595, 842], margin: 0 });

      // Header Logo
      if (hasLogo) {
        doc.image(LOGO_PATH, 18, 24, { width: 132.1, height: 47.85 });
      }

      // Header Titles
      doc
        .fillColor('#000000')
        .font(fontReg)
        .fontSize(9.85)
        .text(escolaNome, 0, 24.8, { width: 595, align: 'center', lineBreak: false });

      doc
        .font(fontBold)
        .fontSize(10.5)
        .text(tituloRelatorio, 0, 38.0, { width: 595, align: 'center', lineBreak: false });

      // Cards
      for (const item of cards) {
        const { emp, y: cardTop, extraAddr } = item;

        // Top separator rule
        doc
          .save()
          .lineWidth(0.5)
          .strokeColor('#000000')
          .moveTo(18, cardTop)
          .lineTo(577.5, cardTop)
          .stroke()
          .restore();

        // Photo frame (75x87) + Photo (72x84)
        doc
          .save()
          .lineWidth(1)
          .strokeColor('#C0C0C0')
          .rect(502.5, cardTop + 3.0, 75, 87)
          .stroke()
          .restore();

        if (emp.foto_path) {
          const fullPhotoPath = path.join(UPLOADS_DIR, path.basename(emp.foto_path));
          if (fs.existsSync(fullPhotoPath)) {
            try {
              doc.image(fullPhotoPath, 504, cardTop + 4.5, {
                width: 72,
                height: 84,
              });
            } catch {
              // Draw subtle fallback if unsupported/corrupt image
              drawPhotoPlaceholder(doc, fontReg, cardTop);
            }
          } else {
            drawPhotoPlaceholder(doc, fontReg, cardTop);
          }
        } else {
          drawPhotoPlaceholder(doc, fontReg, cardTop);
        }

        // Row 1: Código, Nome, CPF
        doc.fillColor('#000000').font(fontBold).fontSize(8.75);
        const codeStr = emp.codigo ? String(emp.codigo) : '';
        const codeW = codeStr ? doc.widthOfString(codeStr) : 0;
        if (codeStr) {
          doc.text(codeStr, 18, cardTop + 4.5, { lineBreak: false });
        }

        const nomeX = codeStr ? Math.max(47.25, 18 + codeW + 6) : 18;
        doc
          .font(fontBold)
          .fontSize(7.8)
          .text(emp.nome || '', nomeX, cardTop + 4.2, { width: 356 - (nomeX - 47.25), ellipsis: true, lineBreak: false });

        doc
          .font(fontReg)
          .fontSize(8.95)
          .text(`CPF: ${emp.cpf || ''}`, 408, cardTop + 3.8, { lineBreak: false });

        // Row 2: Endereço (may wrap cleanly)
        doc
          .font(fontReg)
          .fontSize(8.95)
          .text(`Endereço: ${emp.endereco || ''}`, 18, cardTop + 14.7, {
            width: 468,
            lineGap: 2.0,
          });

        const row3Y = cardTop + 26.2 + extraAddr;
        const row4Y = row3Y + 11.0;
        const row5Y = row4Y + 11.0;
        const row6Y = row5Y + 12.2;

        // Row 3: Data de Nascimento, Sexo, E-mail
        doc.text(`Data de Nascimento: ${emp.data_nascimento || ''}`, 18, row3Y, { lineBreak: false });
        doc.text(`Sexo: ${emp.sexo || ''}`, 192, row3Y, { lineBreak: false });
        doc.text(`E-mail: ${emp.email || ''}`, 285, row3Y, { width: 212, ellipsis: true, lineBreak: false });

        // Row 4: RG, Emitido por, Data emissão
        doc.text(`RG: ${emp.rg || ''}`, 18, row4Y, { lineBreak: false });
        doc.text(`Emitido por: ${emp.emitido_por || ''}`, 192, row4Y, { lineBreak: false });
        doc.text(`Data emissão: ${emp.data_emissao || ''}`, 360, row4Y, { lineBreak: false });

        // Row 5: Data de contratação, Data de demissão, Tem assinatura digitalizada
        doc.text(`Data de contratação: ${emp.data_contratacao || ''}`, 18, row5Y, { lineBreak: false });
        doc.text(`Data de demissão: ${emp.data_demissao || ''}`, 192, row5Y, { lineBreak: false });
        doc.text('Tem assinatura digitalizada:', 360, row5Y, { lineBreak: false });

        if (emp.tem_assinatura_digitalizada && hasCheck) {
          doc.image(CHECKMARK_PATH, 474, row5Y - 1.2, { width: 14.25, height: 11.8 });
        }

        // Row 6: Telefones
        doc.text(`Telefones: ${emp.telefones || ''}`, 18, row6Y, { width: 468, lineGap: 2.0 });
      }

      // Footer
      doc.fillColor('#000000').font(fontReg).fontSize(8.95);
      doc.text(dataImpressao, 18, 813, { lineBreak: false });
      doc.text(`Usuário:${usuarioRodape}`, 0, 813, { width: 595, align: 'center', lineBreak: false });
      doc.text(`${pageIdx + 1}/${totalPages}`, 18, 813, { width: 559, align: 'right', lineBreak: false });
    });

    doc.end();
  });
}

function drawPhotoPlaceholder(doc, fontReg, cardTop) {
  doc
    .save()
    .fillColor('#F3F4F6')
    .rect(504, cardTop + 4.5, 72, 84)
    .fill()
    .fillColor('#9CA3AF')
    .font(fontReg)
    .fontSize(7)
    .text('Sem foto', 504, cardTop + 42, { width: 72, align: 'center', lineBreak: false })
    .restore();
}
