//! Deterministic in-process provider for tests and offline demos.

use crate::{Candle, DataError, DataSource, Payload, Quote};
use async_trait::async_trait;
use serde_json::json;

pub struct StubDataSource;

#[async_trait]
impl DataSource for StubDataSource {
    fn name(&self) -> &'static str {
        "stub"
    }

    async fn quote(&self, symbol: &str) -> Result<Quote, DataError> {
        let s = symbol.to_ascii_uppercase();
        let last = price_for(&s);
        Ok(Quote {
            symbol: s,
            last,
            change_pct: 0.42,
            bid: Some(last - 0.05),
            ask: Some(last + 0.05),
            timestamp: "2026-05-10T15:04:05.000Z".into(),
        })
    }

    async fn ohlcv(&self, symbol: &str, _range: &str) -> Result<Vec<Candle>, DataError> {
        let base = price_for(&symbol.to_ascii_uppercase());
        let mut out = Vec::with_capacity(30);
        for i in 0..30 {
            let drift = (i as f64) * 0.1;
            out.push(Candle {
                t: 1_700_000_000 + (i as i64) * 86_400,
                o: base + drift,
                h: base + drift + 1.0,
                l: base + drift - 1.0,
                c: base + drift + 0.5,
                v: 1_000_000.0,
            });
        }
        Ok(out)
    }

    async fn news(&self, symbol: Option<&str>) -> Result<Payload, DataError> {
        let scope = symbol.map(|s| s.to_ascii_uppercase());
        let scope_label = scope.as_deref().unwrap_or("GLOBAL");
        Ok(json!({
            "scope": scope_label,
            "headlines": [
                {"title": format!("{scope_label}: guidance update"), "source": "wire-1", "ts": "2026-05-10T13:00:00Z"},
                {"title": format!("{scope_label}: sector rotation note"), "source": "wire-2", "ts": "2026-05-10T11:30:00Z"},
                {"title": format!("{scope_label}: research highlights"), "source": "wire-3", "ts": "2026-05-10T09:15:00Z"},
            ]
        }))
    }

    async fn macro_indicators(&self) -> Result<Payload, DataError> {
        Ok(json!([
            {"name": "CPI YoY", "value": 2.6, "as_of": "2026-04-30"},
            {"name": "Unemployment", "value": 3.9, "as_of": "2026-04-30"},
            {"name": "GDP QoQ Annualised", "value": 2.1, "as_of": "2026-03-31"},
            {"name": "Fed Funds Target", "value": 4.25, "as_of": "2026-05-01"},
            {"name": "ISM Manufacturing", "value": 49.5, "as_of": "2026-04-30"},
        ]))
    }

    async fn yield_curve(&self) -> Result<Payload, DataError> {
        Ok(json!([
            {"tenor": "1M",  "yield_pct": 4.42},
            {"tenor": "3M",  "yield_pct": 4.41},
            {"tenor": "6M",  "yield_pct": 4.36},
            {"tenor": "1Y",  "yield_pct": 4.18},
            {"tenor": "2Y",  "yield_pct": 3.92},
            {"tenor": "5Y",  "yield_pct": 3.85},
            {"tenor": "10Y", "yield_pct": 4.05},
            {"tenor": "30Y", "yield_pct": 4.41},
        ]))
    }

    async fn fx_rates(&self, base: Option<&str>) -> Result<Payload, DataError> {
        let base = base.unwrap_or("USD").to_ascii_uppercase();
        Ok(json!({
            "base": base,
            "rates": [
                {"pair": "EURUSD", "rate": 1.0853, "change_pct": -0.12},
                {"pair": "USDJPY", "rate": 152.31, "change_pct": 0.34},
                {"pair": "GBPUSD", "rate": 1.2614, "change_pct": -0.08},
                {"pair": "USDCHF", "rate": 0.8924, "change_pct": 0.05},
                {"pair": "AUDUSD", "rate": 0.6582, "change_pct": -0.21},
                {"pair": "USDCAD", "rate": 1.3712, "change_pct": 0.11},
            ]
        }))
    }

    async fn options_chain(&self, symbol: &str) -> Result<Payload, DataError> {
        let s = symbol.to_ascii_uppercase();
        let last = price_for(&s);
        let strikes: Vec<_> = (0..7)
            .map(|i| {
                let strike = ((last - 15.0) + (i as f64) * 5.0).round();
                json!({
                    "strike": strike,
                    "call_iv": 0.28 + (i as f64) * 0.005,
                    "put_iv": 0.30 + (i as f64) * 0.004,
                    "call_oi": 1200 + i * 80,
                    "put_oi": 1100 + i * 70,
                })
            })
            .collect();
        Ok(json!({
            "symbol": s,
            "underlying_last": last,
            "expiry": "2026-06-19",
            "rows": strikes,
        }))
    }

    async fn insider_trades(&self, symbol: &str) -> Result<Payload, DataError> {
        let s = symbol.to_ascii_uppercase();
        Ok(json!({
            "symbol": s,
            "trades": [
                {"name": "C. Ackerman", "role": "CFO",      "shares": -12_000, "filed_at": "2026-05-08"},
                {"name": "B. Niven",    "role": "Director", "shares":   5_000, "filed_at": "2026-05-05"},
                {"name": "A. Pham",     "role": "CEO",      "shares":  -8_500, "filed_at": "2026-04-30"},
            ]
        }))
    }

    async fn financials(&self, symbol: &str) -> Result<Payload, DataError> {
        let s = symbol.to_ascii_uppercase();
        let scale = price_for(&s);
        Ok(json!({
            "symbol": s,
            "income_ttm": {
                "revenue": 8.0e10 + scale * 1.0e8,
                "gross_profit": 3.4e10 + scale * 4.0e7,
                "operating_income": 2.5e10 + scale * 2.0e7,
                "net_income": 2.0e10 + scale * 1.5e7,
            },
            "balance_mrq": {
                "total_assets": 3.5e11,
                "total_liabilities": 2.6e11,
                "total_equity": 9.0e10,
                "cash": 4.0e10,
            },
            "cashflow_ttm": {
                "operating": 3.0e10,
                "investing": -1.2e10,
                "financing": -1.5e10,
                "free_cashflow": 2.4e10,
            }
        }))
    }

    async fn crypto_quote(&self, symbol: &str) -> Result<Payload, DataError> {
        let s = symbol.to_ascii_uppercase();
        let last = price_for(&s) * 100.0;
        Ok(json!({
            "symbol": s,
            "last": last,
            "change_24h_pct": 1.84,
            "vol_24h": 2.4e10,
            "market_cap": last * 1.95e7,
            "dominance_pct": if s == "BTC" { 51.2 } else { 0.0 },
            "timestamp": "2026-05-10T15:04:05.000Z",
        }))
    }

    async fn risk_metrics(&self, symbols: &[String]) -> Result<Payload, DataError> {
        let rows: Vec<_> = symbols
            .iter()
            .map(|s| {
                let s = s.to_ascii_uppercase();
                let p = price_for(&s);
                json!({
                    "symbol": s,
                    "beta": 0.85 + ((p as i64 % 60) as f64) / 200.0,
                    "vol_annualised": 0.22 + ((p as i64 % 30) as f64) / 500.0,
                    "var_1d_95": -p * 0.018,
                })
            })
            .collect();
        Ok(json!({
            "as_of": "2026-05-10",
            "rows": rows,
        }))
    }

    async fn corp_actions(&self, symbol: &str) -> Result<Payload, DataError> {
        let s = symbol.to_ascii_uppercase();
        Ok(json!({
            "symbol": s,
            "events": [
                {"type": "dividend", "ex_date": "2026-05-12", "amount": 0.24, "currency": "USD"},
                {"type": "split",    "ex_date": "2025-08-31", "ratio": "4-for-1"},
                {"type": "earnings", "date":     "2026-07-25"},
            ]
        }))
    }
}

fn price_for(symbol: &str) -> f64 {
    let mut acc: u64 = 0;
    for b in symbol.bytes() {
        acc = acc.wrapping_mul(31).wrapping_add(b as u64);
    }
    100.0 + ((acc % 4_000) as f64) / 10.0
}
