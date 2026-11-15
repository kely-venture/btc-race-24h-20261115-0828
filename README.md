# btc-race-24h-20261115-0828

[![make.fun](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/kely-venture/btc-race-24h-20261115-0828/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/kely-venture/btc-race-24h-20261115-0828/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828)

Anchored-VWAP Deep-Dip Reversion — a BTC trading bot for the [make.fun bounty](https://make.fun/bounty/btc-race-24h-20261115-0828) "Race a BTC trading bot live for 24 hours" ($250). It trades cbBTC/USDC on 1-minute bars with $1,000 of paper money, long only.

## Strategy

- **Anchor:** the cumulative mean of every close since the window opened (the session VWAP — no volume exists in the bars, so closes are equally weighted). It is the slow, window-level reference.
- **Trigger:** buy with full cash when the close is a deep flush — at least 150 bps below the trailing 60-bar mean — **and** below the anchored VWAP, so entries only fire after a sharp dip inside an already-weak session. A 10-bar cooldown after each trade keeps the ~26 bps round-trip fee from being paid on noise.
- **Exit:** sell the whole position when the close reaches the filled entry price + 150 bps (take profit) or falls to entry − 250 bps (hard stop). The entry price is read back from the filled position's cost basis, so targets are measured against the price actually paid.
- **Math:** exact bigint integer math on raw price units throughout — no floats, no wall clock, no network, no randomness. Two runs on the same bars produce byte-identical orders.

This is not a Donchian range fade (no trailing high/low is used) and not an EMA/RSI/Bollinger strategy (no EMA, no RSI, no sigma band — the entry is a fixed-basis-point deviation from a trailing mean, gated by a cumulative anchor, and exits are entry-relative).

## Run it

Grade locally against the dev window (from the kit directory):

```sh
node cli/makefun.mjs grade-local --kit . --bot /home/hatch/workspace/makefun/btc-race-24h-20261115-0828-entry --driver process
```

## Layout

- `main.ts` — the bot (entrypoint, run with Node 22 type stripping)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's bars-replay SDK shim
- `.makefun/owner.json` — claim file naming the owner's wallet
