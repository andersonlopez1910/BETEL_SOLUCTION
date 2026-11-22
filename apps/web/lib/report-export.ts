/**
 * Exportación de reportes a CSV, Excel (XLSX) y PDF, en el navegador.
 *
 * Las tres salidas usan el mismo `ReportDocument`: encabezado (empresa, reporte, fecha de
 * generación, período y filtros aplicados), detalle y totales. Las filas vienen del endpoint
 * `/export` de la API, que respeta los filtros y no pagina.
 *
 *   await exportReport("xlsx", { company, title, period, filters, columns, rows, totals, fileName });
 *
 * - CSV: separador coma, UTF-8 con BOM (Excel muestra bien las tildes), decimales con punto.
 * - XLSX: exceljs se carga solo al exportar, para no aumentar el peso inicial de la página.
 * - PDF: se arma un documento imprimible en un iframe oculto y se abre el diálogo de impresión
 *   del navegador ("Guardar como PDF"). No requiere servidor.
 */
export type ReportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Montos: se exportan como número con 2 decimales y se alinean a la derecha. */
  money?: boolean;
};

export type ReportDocument<T> = {
  company: string;
  title: string;
  period: { from: string | null; to: string | null };
  filters: [label: string, value: string][];
  columns: ReportColumn<T>[];
  rows: T[];
  totals: [label: string, value: string][];
  fileName: string;
};

export type ExportFormat = "csv" | "xlsx" | "pdf";

const moneyText = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2 });

function headerLines<T>(doc: ReportDocument<T>): [string, string][] {
  return [
    ["Empresa", doc.company],
    ["Reporte", doc.title],
    ["Generado", new Date().toLocaleString("es-CO")],
    ["Período", `${doc.period.from ?? "—"} a ${doc.period.to ?? "—"}`],
    ["Filtros", doc.filters.length ? doc.filters.map(([label, value]) => `${label}: ${value}`).join(" · ") : "Ninguno"],
  ];
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv<T>(doc: ReportDocument<T>) {
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const line = (values: unknown[]) => values.map(cell).join(",");
  return [
    ...headerLines(doc).map(line),
    "",
    line(doc.columns.map(column => column.header)),
    ...doc.rows.map(row => line(doc.columns.map(column => column.value(row)))),
    "",
    ...doc.totals.map(line),
  ].join("\r\n");
}

async function toXlsx<T>(doc: ReportDocument<T>) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(doc.title.slice(0, 31)); // Excel limita el nombre a 31 caracteres
  for (const [label, value] of headerLines(doc)) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow([]);
  const header = sheet.addRow(doc.columns.map(column => column.header));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF162A46" } };
  });
  for (const item of doc.rows) {
    const row = sheet.addRow(
      doc.columns.map(column => {
        const value = column.value(item);
        return column.money && value !== null && value !== undefined ? Number(value) : (value ?? "");
      })
    );
    doc.columns.forEach((column, index) => {
      if (column.money) row.getCell(index + 1).numFmt = "#,##0.00";
    });
  }
  sheet.addRow([]);
  for (const [label, value] of doc.totals) sheet.addRow([label, value]).getCell(1).font = { bold: true };
  sheet.columns.forEach((column, index) => {
    column.width = Math.max(14, Math.min(40, (doc.columns[index]?.header.length ?? 10) + 6));
  });
  return new Blob([await workbook.xlsx.writeBuffer()], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function toPrintableHtml<T>(doc: ReportDocument<T>) {
  const esc = (value: unknown) =>
    String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
  const show = (column: ReportColumn<T>, row: T) => {
    const value = column.value(row);
    return column.money && value !== null && value !== undefined && value !== ""
      ? moneyText.format(Number(value))
      : value;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>
    @page { size: landscape; margin: 14mm; }
    body { font: 10px "DM Sans", Arial, sans-serif; color: #1d2d44; }
    h1 { font-size: 16px; margin: 0 0 2px; } h2 { font-size: 12px; margin: 0 0 10px; color: #087fc9; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0 0 12px; }
    dt { font-weight: 700; } dd { margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #162a46; color: white; text-align: left; padding: 5px; }
    td { border-bottom: 1px solid #dfe7ef; padding: 4px 5px; }
    .num { text-align: right; white-space: nowrap; }
    tr { break-inside: avoid; } thead { display: table-header-group; }
    .totals { margin-top: 12px; }
  </style></head><body>
    <h1>${esc(doc.company)}</h1><h2>${esc(doc.title)}</h2>
    <dl>${headerLines(doc)
      .slice(2)
      .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`)
      .join("")}</dl>
    <table><thead><tr>${doc.columns.map(c => `<th class="${c.money ? "num" : ""}">${esc(c.header)}</th>`).join("")}</tr></thead>
    <tbody>${doc.rows
      .map(
        row =>
          `<tr>${doc.columns.map(c => `<td class="${c.money ? "num" : ""}">${esc(show(c, row))}</td>`).join("")}</tr>`
      )
      .join("")}</tbody></table>
    <dl class="totals">${doc.totals.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}</dl>
  </body></html>`;
}

function printHtml(html: string) {
  const frame = Object.assign(document.createElement("iframe"), { title: "Reporte para imprimir" });
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  document.body.append(frame);
  const frameWindow = frame.contentWindow!;
  frameWindow.document.open();
  frameWindow.document.write(html);
  frameWindow.document.close();
  frameWindow.addEventListener("afterprint", () => frame.remove());
  // Pequeña espera para que el navegador termine de maquetar antes de imprimir.
  setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 50);
}

export async function exportReport<T>(format: ExportFormat, doc: ReportDocument<T>) {
  if (format === "csv")
    download(new Blob(["﻿", toCsv(doc)], { type: "text/csv;charset=utf-8" }), `${doc.fileName}.csv`);
  else if (format === "xlsx") download(await toXlsx(doc), `${doc.fileName}.xlsx`);
  else printHtml(toPrintableHtml(doc));
}
