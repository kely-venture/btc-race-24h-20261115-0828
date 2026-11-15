// Anchored-VWAP-gated deep-dip mean reversion for cbBTC (CBBTC/USDC, 1-minute bars).
//
// Strategy — "Anchored-VWAP Deep-Dip Reversion":
//   * An anchor is kept from the very first bar of the window: the cumulative
//     mean of every close so far (the session VWAP; there is no volume in the
//     bars, so each close is weighted equally). It is the slow, window-level
//     reference: in a falling window it sits above the price, in a rising one
//     below it.
//   * A fast reference is the trailing 60-bar mean of closes.
//   * BUY (full cash, long only) when the close is a deep flush below the fast
//     mean — at least 150 bps under it — AND below the anchored VWAP, so the
//     buy only fires after a sharp dip inside a session that is already weak
//     relative to its own anchor. A 10-bar cooldown after every trade keeps
//     the round-trip fee (~26 bps) from being paid on noise.
//   * SELL the whole position when the close reaches the filled entry price
//     plus 150 bps (take profit) or falls to the entry price minus 250 bps
//     (hard stop). The entry price is read back from the filled position's
//     cost basis, so the targets are measured against the price actually paid,
//     not the price seen at decision time.
//   * Nothing is ever sold short, no leverage, at most one open position.
//     Orders that would fill on the last batch are simply rejected by the
//     harness (after_end) and cost nothing.
//
// This is structurally different from a Donchian range fade (no trailing
// high/low is ever used) and from the EMA/RSI/Bollinger baselines (no EMA,
// no RSI, no sigma band: the entry is a fixed-basis-point deviation from a
// trailing mean, gated by a cumulative anchor, and exits are entry-relative).
//
// All decisions use exact bigint integer math on the raw price units. No
// floats, no wall clock, no network, no files, no randomness: two runs on
// the same bars produce byte-identical orders.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;
const TRAIL_BARS = 60;
const WARMUP_BARS = 120;
const DIP_BPS = 150n;
const TAKE_PROFIT_BPS = 150n;
const STOP_BPS = 250n;
const COOLDOWN_BARS = 10;
const MAX_SLIPPAGE_BPS = 300;
const MIN_NOTIONAL = 1_000_000n; // 1 USDC in quote units.

// History, all exact bigints on raw price units (price_scale 8).
const trailCloses: bigint[] = [];
let trailSum = 0n;
let anchorSum = 0n;
let anchorCount = 0n;
let barsSeen = 0;
let lastOrderBar = -1_000_000;
let lastTradeBar = -1_000_000;
let entryPrice: bigint | null = null;

// The average price actually paid for the open position, recovered from the
// position's cost basis (fees included) and the symbol's scales.
function impliedEntryPrice(state: BarsState): bigint | null {
  const pos = state.positions.get(SYMBOL);
  if (pos === undefined || pos.qty === 0n) return null;
  const sym = state.symbols.get(SYMBOL);
  if (sym === undefined) return null;
  const numerator = pos.cost * 10n ** BigInt(sym.qty_scale + sym.price_scale);
  const denominator = pos.qty * 10n ** BigInt(state.hello.capital.quote_scale);
  if (denominator === 0n) return null;
  return numerator / denominator;
}

await runBars({
  onBatch(state: BarsState) {
    const close = state.close(SYMBOL);
    if (close === null || state.warmingUp) return [];

    // Fold this bar into the trailing mean and the anchored mean.
    trailCloses.push(close);
    trailSum += close;
    if (trailCloses.length > TRAIL_BARS) {
      const dropped = trailCloses.shift();
      if (dropped !== undefined) trailSum -= dropped;
    }
    anchorSum += close;
    anchorCount += 1n;
    barsSeen += 1;

    const pos = state.positions.get(SYMBOL);
    const heldQty = pos === undefined ? 0n : pos.qty;

    // Keep the entry price in step with the filled position.
    if (heldQty > 0n && entryPrice === null) entryPrice = impliedEntryPrice(state);
    if (heldQty === 0n) entryPrice = null;

    // One quiet bar after any order, so the fill lands and the account is
    // current before the next decision (never double-send a buy or a sell).
    if (barsSeen - lastOrderBar <= 1) return [];
    if (barsSeen < WARMUP_BARS || trailCloses.length < TRAIL_BARS) return [];

    const trailMean = trailSum / BigInt(TRAIL_BARS);
    const anchor = anchorSum / anchorCount;

    if (heldQty === 0n) {
      if (barsSeen - lastTradeBar < COOLDOWN_BARS) return [];
      // Deep flush below the fast mean, and below the session anchor.
      const dipBps = ((trailMean - close) * BPS) / trailMean;
      if (dipBps >= DIP_BPS && close < anchor && state.cash >= MIN_NOTIONAL) {
        lastOrderBar = barsSeen;
        lastTradeBar = barsSeen;
        return [
          {
            side: 'buy',
            symbol: SYMBOL,
            notional_quote_units: state.cash,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    // Holding: exit the whole position on take-profit or hard stop.
    if (entryPrice === null) return [];
    const takeProfitPrice = (entryPrice * (BPS + TAKE_PROFIT_BPS)) / BPS;
    const stopPrice = (entryPrice * (BPS - STOP_BPS)) / BPS;
    if (close >= takeProfitPrice || close <= stopPrice) {
      lastOrderBar = barsSeen;
      lastTradeBar = barsSeen;
      entryPrice = null;
      return [
        {
          side: 'sell',
          symbol: SYMBOL,
          qty: heldQty,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  },
});
