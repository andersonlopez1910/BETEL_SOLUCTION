/**
 * Plan Único de Cuentas (PUC, Decreto 2650 de 1993) — estructura base del árbol de "Cuentas contables".
 *
 * Niveles por longitud del código: clase (1 dígito), grupo (2), cuenta (4), subcuenta (6) y auxiliar (8).
 * Aquí están las clases, los grupos y las cuentas de 4 dígitos más usadas (y todas las que usan los comprobantes
 * automáticos de Betel). Las subcuentas y auxiliares son de cada organización (tabla Account): las crea Betel al
 * contabilizar (accounting.ts, ensureDefaultAccounts; nómina) o el usuario en Contabilidad › Cuentas contables.
 * Una cuenta de 4 dígitos que no esté aquí la puede crear el usuario bajo su grupo.
 */

export type Nature = "DEBIT" | "CREDIT";

export const PUC_CLASSES: Record<string, string> = {
  "1": "Activo",
  "2": "Pasivo",
  "3": "Patrimonio",
  "4": "Ingresos",
  "5": "Gastos",
  "6": "Costos de venta",
  "7": "Costos de producción",
  "8": "Cuentas de orden deudoras",
  "9": "Cuentas de orden acreedoras",
};

export const PUC_GROUPS: Record<string, string> = {
  "11": "Disponible",
  "12": "Inversiones",
  "13": "Deudores",
  "14": "Inventarios",
  "15": "Propiedades, planta y equipo",
  "16": "Intangibles",
  "17": "Diferidos",
  "18": "Otros activos",
  "19": "Valorizaciones",
  "21": "Obligaciones financieras",
  "22": "Proveedores",
  "23": "Cuentas por pagar",
  "24": "Impuestos, gravámenes y tasas",
  "25": "Obligaciones laborales",
  "26": "Pasivos estimados y provisiones",
  "27": "Diferidos",
  "28": "Otros pasivos",
  "29": "Bonos y papeles comerciales",
  "31": "Capital social",
  "32": "Superávit de capital",
  "33": "Reservas",
  "34": "Revalorización del patrimonio",
  "36": "Resultados del ejercicio",
  "37": "Resultados de ejercicios anteriores",
  "38": "Superávit por valorizaciones",
  "41": "Operacionales",
  "42": "No operacionales",
  "51": "Operacionales de administración",
  "52": "Operacionales de ventas",
  "53": "No operacionales",
  "54": "Impuesto de renta y complementarios",
  "59": "Ganancias y pérdidas",
  "61": "Costo de ventas y de prestación de servicios",
  "62": "Compras",
  "71": "Materia prima",
  "72": "Mano de obra directa",
  "73": "Costos indirectos",
  "74": "Contratos de servicios",
  "81": "Derechos contingentes",
  "82": "Deudoras fiscales",
  "83": "Deudoras de control",
  "84": "Derechos contingentes por contra (Cr)",
  "85": "Deudoras fiscales por contra (Cr)",
  "86": "Deudoras de control por contra (Cr)",
  "91": "Responsabilidades contingentes",
  "92": "Acreedoras fiscales",
  "93": "Acreedoras de control",
  "94": "Responsabilidades contingentes por contra (Db)",
  "95": "Acreedoras fiscales por contra (Db)",
  "96": "Acreedoras de control por contra (Db)",
};

export const PUC_ACCOUNTS: Record<string, string> = {
  "1105": "Caja",
  "1110": "Bancos",
  "1120": "Cuentas de ahorro",
  "1305": "Clientes",
  "1330": "Anticipos y avances",
  "1355": "Anticipo de impuestos y contribuciones o saldos a favor",
  "1365": "Cuentas por cobrar a trabajadores",
  "1380": "Deudores varios",
  "1399": "Provisiones",
  "1435": "Mercancías no fabricadas por la empresa",
  "1504": "Terrenos",
  "1516": "Construcciones y edificaciones",
  "1524": "Equipo de oficina",
  "1528": "Equipo de computación y comunicación",
  "1540": "Flota y equipo de transporte",
  "1592": "Depreciación acumulada",
  "2105": "Bancos nacionales",
  "2205": "Nacionales",
  "2335": "Costos y gastos por pagar",
  "2365": "Retención en la fuente",
  "2367": "Impuesto a las ventas retenido",
  "2368": "Impuesto de industria y comercio retenido",
  "2370": "Retenciones y aportes de nómina",
  "2380": "Acreedores varios",
  "2404": "De renta y complementarios",
  "2408": "Impuesto sobre las ventas por pagar",
  "2412": "De industria y comercio",
  "2505": "Salarios por pagar",
  "2510": "Cesantías consolidadas",
  "2515": "Intereses sobre cesantías",
  "2520": "Prima de servicios",
  "2525": "Vacaciones consolidadas",
  "2610": "Para obligaciones laborales",
  "3105": "Capital suscrito y pagado",
  "3115": "Aportes sociales",
  "3305": "Reservas obligatorias",
  "3605": "Utilidad del ejercicio",
  "3610": "Pérdida del ejercicio",
  "3705": "Utilidades acumuladas",
  "3710": "Pérdidas acumuladas",
  "4135": "Comercio al por mayor y al por menor",
  "4155": "Actividades inmobiliarias, empresariales y de alquiler",
  "4175": "Devoluciones en ventas (Db)",
  "4210": "Financieros",
  "4250": "Recuperaciones",
  "4295": "Diversos",
  "5105": "Gastos de personal",
  "5110": "Honorarios",
  "5115": "Impuestos",
  "5120": "Arrendamientos",
  "5130": "Seguros",
  "5135": "Servicios",
  "5140": "Gastos legales",
  "5145": "Mantenimiento y reparaciones",
  "5160": "Depreciaciones",
  "5195": "Diversos",
  "5205": "Gastos de personal",
  "5235": "Servicios",
  "5305": "Financieros",
  "5395": "Gastos diversos",
  "5405": "Impuesto de renta y complementarios",
  "6135": "Comercio al por mayor y al por menor",
  "6205": "De mercancías",
};

/** Nivel según la longitud del código. */
export function accountLevel(code: string) {
  const length = code.length;
  if (length === 1) return "CLASS";
  if (length === 2) return "GROUP";
  if (length === 4) return "ACCOUNT";
  if (length === 6) return "SUBACCOUNT";
  return "AUXILIARY";
}

/** Código del padre: 1105 → 11, 110505 → 1105, 11050501 → 110505, 11 → 1. */
export function parentCode(code: string) {
  if (code.length <= 1) return null;
  if (code.length === 2) return code.slice(0, 1);
  return code.slice(0, code.length - 2);
}

/** Naturaleza por clase: débito (1, 5, 6, 7, 8) o crédito (2, 3, 4, 9). Las cuentas "por contra" se ignoran. */
export const accountNature = (code: string): Nature =>
  ["1", "5", "6", "7", "8"].includes(code[0]!) ? "DEBIT" : "CREDIT";

/** Tipo usado en Account.accountType según la clase. */
export function accountTypeFor(code: string) {
  return (
    {
      "1": "ASSET",
      "2": "LIABILITY",
      "3": "EQUITY",
      "4": "INCOME",
      "5": "EXPENSE",
      "6": "COST",
      "7": "COST",
      "8": "MEMO",
      "9": "MEMO",
    }[code[0]!] ?? "ASSET"
  );
}

/** Nombre de una cuenta de la estructura base (clase, grupo o cuenta de 4 dígitos), si existe. */
export const catalogName = (code: string) => PUC_CLASSES[code] ?? PUC_GROUPS[code] ?? PUC_ACCOUNTS[code] ?? null;

/** Estructura base completa como lista de { code, name }. */
export const catalogNodes = () =>
  [...Object.entries(PUC_CLASSES), ...Object.entries(PUC_GROUPS), ...Object.entries(PUC_ACCOUNTS)].map(
    ([code, name]) => ({ code, name })
  );

/**
 * Código de una cuenta nueva bajo `parent` con el sufijo indicado: bajo un grupo 2 dígitos, bajo una cuenta o
 * subcuenta 2 dígitos. Devuelve null si no es válido (las clases y grupos son fijos del PUC).
 */
export function childCode(parent: string, suffix: string) {
  if (!/^\d{2}$/.test(suffix) || suffix === "00") return null;
  if (![2, 4, 6].includes(parent.length)) return null;
  return parent + suffix;
}
