import type { CSSProperties } from "react";

export const LOW_STOCK_THRESHOLD = 5;

export type StockTone = "red" | "yellow" | "green";

/** <5 red, 5–9 yellow, ≥10 green. */
export function stockTone(qty: number): StockTone {
  if (qty < LOW_STOCK_THRESHOLD) return "red";
  if (qty <= 9) return "yellow";
  return "green";
}

export function stockBadgeStyle(qty: number): CSSProperties {
  const tone = stockTone(qty);
  if (tone === "red") {
    return {
      display: "inline-block",
      minWidth: "2rem",
      padding: "0.15rem 0.45rem",
      borderRadius: 6,
      fontWeight: 700,
      textAlign: "center",
      background: "#fee2e2",
      color: "#991b1b",
      border: "1px solid #fecaca",
    };
  }
  if (tone === "yellow") {
    return {
      display: "inline-block",
      minWidth: "2rem",
      padding: "0.15rem 0.45rem",
      borderRadius: 6,
      fontWeight: 700,
      textAlign: "center",
      background: "#fef9c3",
      color: "#854d0e",
      border: "1px solid #fde047",
    };
  }
  return {
    display: "inline-block",
    minWidth: "2rem",
    padding: "0.15rem 0.45rem",
    borderRadius: 6,
    fontWeight: 700,
    textAlign: "center",
    background: "#dcfce7",
    color: "#166534",
    border: "1px solid #86efac",
  };
}
