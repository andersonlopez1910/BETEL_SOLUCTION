/**
 * Lectura de archivos de Excel (.xlsx) y CSV en el navegador para las importaciones (productos, documentos de
 * inventario) y descarga de plantillas CSV. exceljs se carga solo al leer un .xlsx.
 */

/** Lee la primera hoja de un .xlsx o un .csv (separado por coma o punto y coma) como filas con encabezados. */
export async function readSpreadsheet(file: File): Promise<Record<string, unknown>[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, column) => (headers[column] = cell.text.trim()));
    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const item: Record<string, unknown> = {};
      row.eachCell((cell, column) => {
        if (headers[column]) item[headers[column]!] = cell.text;
      });
      if (Object.values(item).some(value => String(value).trim())) rows.push(item);
    });
    return rows;
  }
  const text = (await file.text()).replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const separator = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  // CSV con comillas: "a;b" y "" dentro de comillas.
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header = [], ...data] = records;
  return data
    .filter(values => values.some(value => value.trim()))
    .map(values => Object.fromEntries(header.map((name, index) => [name.trim(), values[index] ?? ""])));
}

/** Descarga un texto como archivo (p. ej. una plantilla CSV). Agrega BOM para que Excel lea las tildes. */
export function downloadText(fileName: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
