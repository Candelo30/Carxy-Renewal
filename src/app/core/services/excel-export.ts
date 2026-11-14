import { Injectable, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import ExcelJS from 'exceljs';
import { absoluteAppUrl } from '../utils/share';

/**
 * Exportación profesional de hojas de cálculo (.xlsx) para el panel de
 * administración: logo de CARXY, cabecera con marca, fila de títulos con
 * auto-filtro, filas alternadas y pie con origen/fecha.
 *
 * Las entradas son datos ya formateados como cadenas/números/booleanos; la
 * presentación (color, anchos, logo) vive aquí para que todas las
 * exportaciones luzcan idénticas.
 */

export interface ExcelColumn {
  header: string;
  key: string;
  width: number;
}

export interface StyledSheetSpec {
  /** Nombre base del archivo, sin extensión. */
  filename: string;
  /** Título del documento (también recorta como nombre de hoja). */
  title: string;
  /** Línea secundaria: "Usuarios registrados · 14 nov 2026". */
  subtitle: string;
  columns: ExcelColumn[];
  rows: (string | number | boolean | null | undefined)[][];
}

const ACCENT = 'FF8B5CF6';
const ACCENT_DARK = 'FF6D28D9';
const LIGHT_ROW = 'FFF5F3FF';
const TEXT_MUTED = 'FF7A7699';
const BORDER_LIGHT = 'FFE4E0F4';
const TITLE_TEXT = 'FF1F1B3A';
const WHITE_HEADER = 'FFFFFFFF';
const HEADER_ROW = 5;

function columnLetter(index: number): string {
  let letter = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    current = Math.floor((current - 1) / 26);
  }
  return letter;
}

@Injectable({ providedIn: 'root' })
export class ExcelExportService {
  private readonly document = inject(DOCUMENT);

  async downloadStyledSheet(spec: StyledSheetSpec): Promise<void> {
    if (typeof document === 'undefined') return;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'CARXY 3D Studio';
    workbook.company = 'CARXY 3D Studio';
    workbook.created = new Date();
    workbook.title = spec.title;

    const sheetName = spec.title.slice(0, 31) || 'CARXY';
    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ showGridLines: false, state: 'frozen', ySplit: HEADER_ROW }],
      properties: { tabColor: { argb: ACCENT } },
    });

    sheet.columns = spec.columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));

    const lastColumn = columnLetter(spec.columns.length - 1);

    // Logo de marca (si el activo está disponible, no es fatal si falta).
    try {
      const response = await fetch(absoluteAppUrl('assets/brand/carxy-logo.png', this.document.baseURI));
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        const imageId = workbook.addImage({ buffer, extension: 'png' });
        sheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 132, height: 44 } });
      }
    } catch {
      // Sin logo: el documento sigue siendo profesional.
    }

    // Marca + título + subtítulo + fecha de generación.
    sheet.mergeCells(`C1:${lastColumn}1`);
    const titleCell = sheet.getCell('C1');
    titleCell.value = 'CARXY 3D Studio';
    titleCell.font = { name: 'Calibri', size: 17, bold: true, color: { argb: ACCENT_DARK } };
    titleCell.alignment = { vertical: 'middle' };
    sheet.getRow(1).height = 34;

    sheet.mergeCells(`C2:${lastColumn}2`);
    const subtitleCell = sheet.getCell('C2');
    subtitleCell.value = spec.subtitle;
    subtitleCell.font = { name: 'Calibri', size: 10, color: { argb: TITLE_TEXT } };
    subtitleCell.alignment = { vertical: 'middle' };
    sheet.getRow(2).height = 18;

    sheet.mergeCells(`C3:${lastColumn}3`);
    const generatedCell = sheet.getCell('C3');
    generatedCell.value = `Generado: ${new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' })}`;
    generatedCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: TEXT_MUTED } };
    generatedCell.alignment = { vertical: 'middle' };
    sheet.getRow(3).height = 16;

    // Separador bajo el branding.
    sheet.getRow(4).height = 6;

    // Fila de encabezados (congelada + autofiltro).
    const headerRow = sheet.getRow(HEADER_ROW);
    headerRow.values = spec.columns.map((column) => column.header);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: WHITE_HEADER } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: ACCENT_DARK } },
        bottom: { style: 'medium', color: { argb: ACCENT_DARK } },
      };
    });

    // Datos con filas alternadas y borde inferior suave.
    spec.rows.forEach((row, rowIndex) => {
      const excelRow = sheet.getRow(HEADER_ROW + 1 + rowIndex);
      excelRow.height = 18;
      spec.columns.forEach((column, columnIndex) => {
        const cell = excelRow.getCell(columnIndex + 1);
        const value = row[columnIndex];
        cell.value = value === undefined || value === null ? '' : value === false ? 'No' : value === true ? 'Sí' : value;
        cell.font = { name: 'Calibri', size: 10, color: { argb: TITLE_TEXT } };
        cell.alignment = { vertical: 'middle', wrapText: false };
        if (rowIndex % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_ROW } };
        }
        cell.border = { bottom: { style: 'thin', color: { argb: BORDER_LIGHT } } };
      });
    });

    // Auto-filtro sobre la tabla completa.
    const lastDataRow = HEADER_ROW + spec.rows.length;
    sheet.autoFilter = `A${HEADER_ROW}:${lastColumn}${lastDataRow}`;

    // Pie de origen.
    const footerRowIndex = lastDataRow + 2;
    sheet.mergeCells(`A${footerRowIndex}:${lastColumn}${footerRowIndex}`);
    const footerCell = sheet.getCell(footerRowIndex, 1);
    footerCell.value = 'CARXY 3D Studio · Panel de administración · candelo30.github.io/Carxy-Renewal';
    footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: TEXT_MUTED } };
    footerCell.alignment = { vertical: 'middle' };
    sheet.getRow(footerRowIndex).height = 18;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = `${spec.filename}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
