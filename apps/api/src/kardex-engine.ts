/**
 * Motor del kárdex valorizado (costeo automático o permanente). Funciones puras, sin base de datos.
 *
 * Recorre los movimientos de UN producto en orden (fecha y secuencia) y calcula, para cada uno, el costo de la salida
 * y el saldo resultante:
 *   - Promedio ponderado (WEIGHTED_AVERAGE, y también SPECIFIC_IDENTIFICATION mientras no haya lotes por venta):
 *       cada entrada recalcula el promedio = (saldo en pesos + cantidad × costo de entrada) / (saldo en unidades +
 *       cantidad); las salidas salen al promedio vigente y no lo cambian.
 *   - PEPS (FIFO): cada entrada es una capa con su costo; las salidas consumen primero las capas más antiguas.
 * Salida sin existencias suficientes: el faltante sale al último costo conocido (promedio o última capa).
 * Las salidas de ajuste conservan el costo con que se registraron (fixedCost), como su asiento contable.
 */

export type KardexMethod = "WEIGHTED_AVERAGE" | "FIFO" | "SPECIFIC_IDENTIFICATION";
export type KardexMovement = {
  date: string; // AAAA-MM-DD
  order: number; // desempate dentro del mismo día (entradas antes que salidas)
  kind: "INITIAL" | "PURCHASE" | "ADJUST_IN" | "ADJUST_OUT" | "SALE";
  document: string;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string;
  quantity: number;
  /** Costo unitario de las entradas (o de un ajuste de salida con costo fijo). */
  unitCost?: number;
};
export type KardexEntry = KardexMovement & {
  qtyIn: number;
  qtyOut: number;
  unitCost: number;
  totalCost: number;
  balanceQty: number;
  balanceValue: number;
  averageCost: number;
  shortage: number; // unidades que salieron sin existencias
};

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round((value + Math.sign(value) * Number.EPSILON) * factor) / factor;
};
const q4 = (value: number) => round(value, 4);
const m2 = (value: number) => round(value, 2);
const isIn = (kind: KardexMovement["kind"]) => kind === "INITIAL" || kind === "PURCHASE" || kind === "ADJUST_IN";

export function computeKardex(movements: KardexMovement[], method: KardexMethod): KardexEntry[] {
  const ordered = [...movements].sort(
    (a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.document.localeCompare(b.document)
  );
  let qty = 0;
  let value = 0;
  let lastCost = 0;
  const layers: { qty: number; cost: number }[] = [];
  return ordered.map(move => {
    if (isIn(move.kind)) {
      const cost = move.unitCost ?? 0;
      const total = m2(move.quantity * cost);
      if (method === "FIFO") {
        // Una existencia negativa se cubre primero con la entrada nueva.
        let incoming = move.quantity;
        if (qty < 0) {
          const cover = Math.min(incoming, -qty);
          incoming -= cover;
        }
        if (incoming > 0) layers.push({ qty: incoming, cost });
      }
      qty = q4(qty + move.quantity);
      value = m2(value + total);
      if (method === "FIFO") value = m2(layers.reduce((sum, layer) => sum + layer.qty * layer.cost, 0));
      lastCost = cost;
      const average = qty > 0 ? q4(value / qty) : cost;
      if (method !== "FIFO" && qty <= 0) value = m2(qty * average);
      return {
        ...move,
        qtyIn: move.quantity,
        qtyOut: 0,
        unitCost: cost,
        totalCost: total,
        balanceQty: qty,
        balanceValue: value,
        averageCost: average,
        shortage: 0,
      };
    }
    // Salida (venta o ajuste de salida).
    const available = Math.max(0, qty);
    const shortage = q4(Math.max(0, move.quantity - available));
    let totalCost: number;
    if (move.kind === "ADJUST_OUT" && move.unitCost !== undefined) {
      totalCost = m2(move.quantity * move.unitCost);
      if (method === "FIFO") consume(layers, move.quantity);
    } else if (method === "FIFO") {
      const consumed = consume(layers, move.quantity);
      totalCost = m2(consumed.cost + consumed.missing * (layers.at(-1)?.cost ?? lastCost));
    } else {
      const average = qty > 0 ? value / qty : lastCost;
      totalCost = m2(move.quantity * average);
    }
    qty = q4(qty - move.quantity);
    value =
      method === "FIFO" ? m2(layers.reduce((sum, layer) => sum + layer.qty * layer.cost, 0)) : m2(value - totalCost);
    if (qty <= 0 && method !== "FIFO") value = qty === 0 ? 0 : m2(qty * lastCost);
    const unitCost = move.quantity ? q4(totalCost / move.quantity) : 0;
    if (unitCost) lastCost = method === "FIFO" ? lastCost : unitCost;
    return {
      ...move,
      qtyIn: 0,
      qtyOut: move.quantity,
      unitCost,
      totalCost,
      balanceQty: qty,
      balanceValue: value,
      averageCost: qty > 0 ? q4(value / qty) : lastCost,
      shortage,
    };
  });
}

/** Consume capas PEPS; devuelve el costo consumido y las unidades que faltaron. */
function consume(layers: { qty: number; cost: number }[], quantity: number) {
  let pending = quantity;
  let cost = 0;
  while (pending > 0 && layers.length) {
    const layer = layers[0]!;
    const take = Math.min(layer.qty, pending);
    cost += take * layer.cost;
    layer.qty = q4(layer.qty - take);
    pending = q4(pending - take);
    if (layer.qty <= 0) layers.shift();
  }
  return { cost, missing: pending };
}
