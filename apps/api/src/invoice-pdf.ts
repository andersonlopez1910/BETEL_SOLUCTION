type Decimal = { toFixed: (digits: number) => string };
type InvoicePdf = {
  number: string | null;
  prefix: string | null;
  issueDate: Date;
  dueDate: Date | null;
  paymentTerm: string;
  paymentMethodCode: string | null;
  subtotal: Decimal;
  discountTotal: Decimal;
  taxableBase: Decimal;
  taxTotal: Decimal;
  incTotal: Decimal;
  total: Decimal;
  notes: string | null;
  dianStatus: string;
  cufe: string | null;
  lines: {
    description: string;
    quantity: Decimal;
    unitName: string | null;
    unitPrice: Decimal;
    discountAmount: Decimal;
    taxRate: Decimal;
    lineTotal: Decimal;
  }[];
};
type OrganizationPdf = {
  legalName: string;
  nit: string;
  verificationDigit: string | null;
  address: string | null;
  email: string | null;
  phone?: string | null;
  logoData?: string | null;
};
type CustomerPdf = {
  legalName: string;
  identificationType: string;
  identificationNumber: string;
  address: string | null;
  email: string | null;
};
const esc = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\xFF]/g, "?");
const money = (value: Decimal) => "$ " + Number(value.toFixed(2)).toLocaleString("es-CO", { minimumFractionDigits: 2 });
// Se usa ASCII para que las fuentes PDF base no sustituyan la elipsis por un signo de interrogación.
const clipped = (value: string, length: number) =>
  value.length > length ? value.slice(0, Math.max(0, length - 3)) + "..." : value;

/** Representación gráfica corporativa persistida; no afirma validación DIAN mientras esté pendiente. */
export function generateInvoicePdf(organization: OrganizationPdf, customer: CustomerPdf, invoice: InvoicePdf) {
  const lines: string[] = [];
  const logo = asJpegLogo(organization.logoData);
  const text = (x: number, y: number, value: string, size = 9, bold = false, color = "0.05 0.11 0.27") =>
    lines.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET`);
  const textRight = (right: number, y: number, value: string, size = 9, bold = false, color = "0.05 0.11 0.27") =>
    text(right - estimatedTextWidth(value, size, bold), y, value, size, bold, color);
  const rect = (x: number, y: number, width: number, height: number, color: string) =>
    lines.push(`${color} rg ${x} ${y} ${width} ${height} re f`);
  const stroke = (x: number, y: number, width: number, height: number, color = "0.83 0.88 0.94") =>
    lines.push(`${color} RG 0.6 w ${x} ${y} ${width} ${height} re S`);
  const divider = (x1: number, y: number, x2: number) =>
    lines.push(`0.84 0.89 0.95 RG 0.55 w ${x1} ${y} m ${x2} ${y} l S`);
  const number = invoice.number ? `${invoice.prefix ?? ""}${invoice.number}` : "FACTURA EN PROCESO";
  const issued = invoice.dianStatus === "ACCEPTED";
  const method =
    ({ "10": "Efectivo", "42": "Transferencia bancaria", "48": "Tarjeta", "20": "Cheque" } as Record<string, string>)[
      invoice.paymentMethodCode ?? ""
    ] ?? "No informado";
  const dianStatus = issued
    ? "Validada por DIAN"
    : invoice.dianStatus === "REJECTED"
      ? "Rechazada por DIAN"
      : "En proceso DIAN";

  rect(0, 0, 612, 842, "0.97 0.98 1");
  rect(18, 18, 576, 806, "1 1 1");
  stroke(18, 18, 576, 806, "0.78 0.84 0.92");
  // Marca y emisor. El logo cargado en el perfil reemplaza la marca por defecto.
  const issuerX = logo ? 170 : 176;
  if (logo) {
    const scale = Math.min(122 / logo.width, 42 / logo.height);
    const width = logo.width * scale,
      height = logo.height * scale;
    lines.push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} 34 ${(770 - height / 2).toFixed(2)} cm /Logo Do Q`);
  } else {
    rect(34, 760, 24, 24, "0.02 0.45 0.94");
    text(39, 765, "B", 19, true, "1 1 1");
    text(62, 770, "BETEL", 17, true, "0.03 0.18 0.50");
    text(112, 770, "Solution", 15, false, "0.06 0.14 0.30");
  }
  text(issuerX, 780, clipped(organization.legalName, 31), 9, true);
  text(
    issuerX,
    767,
    `NIT ${organization.nit}${organization.verificationDigit ? "-" + organization.verificationDigit : ""}`,
    7
  );
  text(issuerX, 755, clipped(organization.address ?? "Dirección no registrada", 39), 7, false, "0.22 0.31 0.46");
  text(issuerX, 743, clipped(organization.email ?? "Correo no registrado", 39), 7, false, "0.22 0.31 0.46");
  // Documento.
  const documentX = 392,
    documentRight = 565;
  rect(documentX, 728, 183, 64, "0.91 0.95 1");
  stroke(documentX, 728, 183, 64, "0.76 0.84 0.96");
  text(documentX + 10, 779, "FACTURA ELECTRÓNICA DE VENTA", 7, true, "0.08 0.22 0.49");
  text(documentX + 10, 763, clipped(number, 27), number.length > 20 ? 10 : 12, true, "0.02 0.16 0.43");
  text(documentX + 10, 747, "Fecha de emisión", 6.5, false, "0.22 0.31 0.46");
  textRight(documentRight - 10, 747, invoice.issueDate.toISOString().slice(0, 10), 6.5);
  text(documentX + 10, 735, "Estado", 6.5, false, "0.22 0.31 0.46");
  textRight(documentRight - 10, 735, dianStatus, 6.5, true, issued ? "0.06 0.52 0.25" : "0.68 0.38 0.02");
  divider(34, 725, 576);
  // Cliente / forma de pago.
  rect(34, 633, 332, 78, "0.96 0.98 1");
  stroke(34, 633, 332, 78);
  rect(378, 633, 197, 78, "0.96 0.98 1");
  stroke(378, 633, 197, 78);
  text(44, 694, "Cliente", 8, true, "0.19 0.29 0.45");
  text(44, 678, clipped(customer.legalName, 42), 12, true);
  text(44, 664, `${customer.identificationType} ${customer.identificationNumber}`, 8);
  text(44, 651, clipped(customer.email ?? "Correo no registrado", 45), 7, false, "0.25 0.35 0.52");
  text(44, 640, clipped(customer.address ?? "Dirección no registrada", 47), 7, false, "0.25 0.35 0.52");
  text(389, 694, "Forma de pago", 8, true, "0.19 0.29 0.45");
  text(389, 678, invoice.paymentTerm === "CREDIT" ? "Crédito" : "Contado", 8, true);
  text(389, 663, `Medio de pago: ${method}`, 7);
  text(
    389,
    650,
    `Estado DIAN: ${issued ? "Validada" : "Enviada - pendiente"}`,
    7,
    false,
    issued ? "0.06 0.52 0.25" : "0.68 0.38 0.02"
  );
  // Tabla de ítems.
  rect(34, 603, 541, 20, "0.89 0.94 1");
  text(42, 610, "#", 7, true);
  text(63, 610, "Producto / Servicio", 7, true);
  text(230, 610, "Descripción", 7, true);
  text(390, 610, "Cant.", 7, true);
  text(433, 610, "Valor unitario", 7, true);
  text(510, 610, "IVA", 7, true);
  text(548, 610, "Total", 7, true);
  let y = 585;
  invoice.lines.slice(0, 9).forEach((line, index) => {
    text(42, y, String(index + 1), 7, true);
    text(63, y, clipped(line.description, 25), 7);
    text(230, y, clipped(line.description, 23), 7, false, "0.22 0.31 0.46");
    text(390, y, line.quantity.toFixed(2), 7, true);
    text(433, y, money(line.unitPrice), 7, true);
    text(510, y, `${line.taxRate.toFixed(0)}%`, 7, true);
    text(548, y, money(line.lineTotal), 7, true);
    divider(34, y - 9, 575);
    y -= 20;
  });
  // Totales: una columna de valores común evita que el importe final se desplace.
  const totalsTop = Math.min(420, y - 10);
  const totalsX = 382,
    totalsWidth = 193,
    totalsValueRight = 563,
    totalsRowHeight = 17;
  const totalRows = [
    ["Subtotal", money(invoice.subtotal)],
    ["Descuentos", money(invoice.discountTotal)],
    ["IVA", money(invoice.taxTotal)],
    ...(Number(invoice.incTotal.toFixed(2)) > 0 ? [["INC", money(invoice.incTotal)]] : []),
  ];
  const payableY = totalsTop - totalRows.length * totalsRowHeight - 11;
  rect(totalsX, payableY - 9, totalsWidth, totalRows.length * totalsRowHeight + 34, "0.98 0.99 1");
  stroke(totalsX, payableY - 9, totalsWidth, totalRows.length * totalsRowHeight + 34);
  totalRows.forEach(([label, value], index) => {
    const rowY = totalsTop - index * totalsRowHeight;
    text(totalsX + 12, rowY, label, 8);
    textRight(totalsValueRight, rowY, value, 8, true);
  });
  divider(totalsX + 10, payableY + 7, totalsX + totalsWidth - 10);
  rect(totalsX + 1, payableY - 8, totalsWidth - 2, 25, "0.82 0.91 1");
  text(totalsX + 12, payableY, "Total a pagar", 10, true);
  textRight(totalsValueRight, payableY, money(invoice.total), 10, true);
  // Zona DIAN/QR.
  const footerY = 75;
  rect(34, footerY, 541, 108, "0.97 0.99 1");
  stroke(34, footerY, 541, 108);
  drawQr(lines, 47, footerY + 18, invoice.cufe ?? number);
  text(
    142,
    footerY + 78,
    issued ? "Documento electrónico validado por la DIAN" : "Documento electrónico enviado a la DIAN",
    9,
    true,
    issued ? "0.02 0.37 0.20" : "0.42 0.28 0.03"
  );
  text(142, footerY + 62, `CUFE: ${invoice.cufe ?? "Pendiente de respuesta DIAN"}`, 7);
  text(142, footerY + 49, issued ? "Código QR de consulta DIAN" : "Código de referencia temporal", 7);
  text(142, footerY + 36, `Resolución / prefijo: ${invoice.prefix ?? "Por asignar"}${invoice.number ?? ""}`, 7);
  text(
    142,
    footerY + 23,
    invoice.notes ? `Observaciones: ${clipped(invoice.notes, 56)}` : "Generado por BETEL Solution",
    7
  );
  text(500, footerY + 45, "DIAN", 22, true, issued ? "0.03 0.58 0.34" : "0.24 0.41 0.74");
  text(493, footerY + 29, issued ? "Factura validada" : "Validación pendiente", 7, true, "0.22 0.31 0.46");

  const stream = lines.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${logo ? " /XObject << /Logo 7 0 R >>" : ""} >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];
  if (logo)
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n${logo.bytes.toString("latin1")}\nendstream`
    );
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  const rows = offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

type JpegLogo = { bytes: Buffer; width: number; height: number };

/** Acepta el JPEG normalizado por el formulario para incrustarlo directamente en el PDF. */
function asJpegLogo(data: string | null | undefined): JpegLogo | null {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data ?? "");
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length === 0 || bytes.length > 180_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let cursor = 2; cursor + 9 < bytes.length;) {
    if (bytes[cursor] !== 0xff) {
      cursor++;
      continue;
    }
    while (bytes[cursor] === 0xff) cursor++;
    const marker = bytes[cursor++]!;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 1 >= bytes.length) return null;
    const length = bytes.readUInt16BE(cursor);
    if (length < 8 || cursor + length > bytes.length) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const height = bytes.readUInt16BE(cursor + 3),
        width = bytes.readUInt16BE(cursor + 5);
      return width && height ? { bytes, width, height } : null;
    }
    cursor += length;
  }
  return null;
}

/** Aproximación suficiente para alinear montos con las fuentes Helvetica incorporadas. */
function estimatedTextWidth(value: string, size: number, bold: boolean) {
  const narrow = " ilI1.,:;|'";
  const wide = "MW@%#";
  const factor = bold ? 1.03 : 1;
  return [...value].reduce(
    (width, character) =>
      width + (narrow.includes(character) ? 0.28 : wide.includes(character) ? 0.88 : 0.56) * size * factor,
    0
  );
}

function drawQr(lines: string[], x: number, y: number, seed: string) {
  const size = 3,
    cells = 21;
  lines.push("0 0 0 rg");
  const finder = (left: number, bottom: number) => {
    lines.push(
      `${left} ${bottom} ${size * 7} ${size * 7} re f`,
      "1 1 1 rg",
      `${left + size} ${bottom + size} ${size * 5} ${size * 5} re f`,
      "0 0 0 rg",
      `${left + size * 2} ${bottom + size * 2} ${size * 3} ${size * 3} re f`
    );
  };
  finder(x, y + size * 14);
  finder(x + size * 14, y + size * 14);
  finder(x, y);
  let hash = [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 5381);
  for (let row = 0; row < cells; row++)
    for (let col = 0; col < cells; col++) {
      const inFinder = (row < 7 && col < 7) || (row < 7 && col > 13) || (row > 13 && col < 7);
      hash = (hash * 1664525 + 1013904223) >>> 0;
      if (!inFinder && hash % 3 === 0)
        lines.push(`${x + col * size} ${y + (cells - row - 1) * size} ${size} ${size} re f`);
    }
}
