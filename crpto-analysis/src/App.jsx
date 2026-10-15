
import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';

const API = 'https://data-api.binance.vision/api/v3/klines';

const PAIRS = [
  { label: 'BTC / USDT', value: 'BTCUSDT' },
  { label: 'ETH / USDT', value: 'ETHUSDT' },
  { label: 'SOL / USDT', value: 'SOLUSDT' },
  { label: 'BNB / USDT', value: 'BNBUSDT' },
  { label: 'XRP / USDT', value: 'XRPUSDT' },
  { label: 'DOGE / USDT', value: 'DOGEUSDT' },
  { label: 'ADA / USDT', value: 'ADAUSDT' },
  { label: 'LINK / USDT', value: 'LINKUSDT' },
  { label: 'AVAX / USDT', value: 'AVAXUSDT' },
  { label: 'LTC / USDT', value: 'LTCUSDT' },
];

const FRAMES = [
  { label: '1 Minute', value: '1m' },
  { label: '5 Minutes', value: '5m' },
  { label: '15 Minutes', value: '15m' },
  { label: '30 Minutes', value: '30m' },
  { label: '1 Hour', value: '1h' },
  { label: '4 Hours', value: '4h' },
  { label: '12 Hours', value: '12h' },
  { label: '1 Day', value: '1d' },
];

function calculateEMA(candles, period) {
  if (!candles.length) return [];

  const multiplier = 2 / (period + 1);
  let ema = candles[0].close;

  return candles.map((candle, index) => {
    if (index > 0) {
      ema =
        candle.close * multiplier +
        ema * (1 - multiplier);
    }

    return {
      time: candle.time,
      value: ema,
    };
  });
}

function calculateRSI(candles, period = 14) {
  if (candles.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change =
      candles[i].close - candles[i - 1].close;

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < candles.length; i++) {
    const change =
      candles[i].close - candles[i - 1].close;

    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    avgGain =
      (avgGain * (period - 1) + gain) / period;

    avgLoss =
      (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function price(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return '—';
  }

  return Number(value).toLocaleString('en-US', {
    maximumSignificantDigits: 8,
  });
}

function App() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setIntervalValue] = useState('1m');
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const chartContainer = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const ema9Ref = useRef(null);
  const ema21Ref = useRef(null);

  // Create chart
  useEffect(() => {
    const container = chartContainer.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: 390,
      layout: {
        background: { color: '#0b1220' },
        textColor: '#cbd5e1',
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: '#334155',
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: '#64748b' },
        horzLine: { color: '#64748b' },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const ema9Series = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 2,
      title: 'EMA 9',
    });

    const ema21Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      title: 'EMA 21',
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    ema9Ref.current = ema9Series;
    ema21Ref.current = ema21Series;

    const observer = new ResizeObserver(() => {
      if (chartContainer.current) {
        chart.applyOptions({
          width: chartContainer.current.clientWidth || 600,
        });
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();

      chartRef.current = null;
      candleRef.current = null;
      ema9Ref.current = null;
      ema21Ref.current = null;
    };
  }, []);

  // Load Binance public Spot market data
  useEffect(() => {
    let active = true;

    async function loadCandles() {
      try {
        setError('');

        const url =
          `${API}?symbol=${symbol}` +
          `&interval=${interval}&limit=500`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            'Market data unavailable. Please try again.'
          );
        }

        const data = await response.json();

        const parsed = data.map((item) => ({
          time: Math.floor(Number(item[0]) / 1000),
          open: Number(item[1]),
          high: Number(item[2]),
          low: Number(item[3]),
          close: Number(item[4]),
        }));

        if (!active) return;

        if (!parsed.length) {
          throw new Error('No market data received.');
        }

        setCandles(parsed);
        setLastUpdated(new Date());
      } catch (err) {
        if (active) {
          setError(
            err.message || 'Unable to load market data.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    setLoading(true);
    loadCandles();

    const timer = setInterval(loadCandles, 15000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [symbol, interval]);

  // Update chart when market data changes
  useEffect(() => {
    if (
      !candles.length ||
      !candleRef.current ||
      !ema9Ref.current ||
      !ema21Ref.current
    ) {
      return;
    }

    candleRef.current.setData(candles);
    ema9Ref.current.setData(calculateEMA(candles, 9));
    ema21Ref.current.setData(calculateEMA(candles, 21));

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const current = candles[candles.length - 1];
  const rsi = calculateRSI(candles);
  const ema9 = calculateEMA(candles, 9);
  const ema21 = calculateEMA(candles, 21);

  const fastEMA = ema9[ema9.length - 1]?.value;
  const slowEMA = ema21[ema21.length - 1]?.value;

  let signal = 'NEUTRAL';
  let signalClass = 'neutral';

  if (fastEMA != null && slowEMA != null && rsi != null) {
    if (fastEMA > slowEMA && rsi >= 50 && rsi < 70) {
      signal = 'BULLISH';
      signalClass = 'bullish';
    } else if (
      fastEMA < slowEMA &&
      rsi > 30 &&
      rsi <= 50
    ) {
      signal = 'BEARISH';
      signalClass = 'bearish';
    }
  }

  const changePercent =
    current && current.open !== 0
      ? ((current.close - current.open) / current.open) * 100
      : null;

  return (
    <div className="app-shell">
      <style>{`
        * { box-sizing: border-box; }

        body {
          margin: 0;
          background: #070b14;
          color: #e5edf8;
          font-family: Inter, Arial, sans-serif;
        }

        button, select { font: inherit; }

        .app-shell {
          min-height: 100vh;
          background:
            radial-gradient(ellipse at top left, #13233d 0, transparent 38%),
            #070b14;
          padding: 24px;
        }

        .dashboard {
          max-width: 1440px;
          margin: 0 auto;
        }

        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 26px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #22d3ee, #6366f1);
          color: #06101d;
          font-size: 24px;
          font-weight: 900;
        }

        .brand h1 {
          margin: 0;
          font-size: 25px;
          letter-spacing: -0.8px;
        }

        .brand p {
          margin: 5px 0 0;
          color: #8494ad;
          font-size: 12px;
        }

        .market-status {
          border: 1px solid #214b40;
          border-radius: 999px;
          padding: 9px 13px;
          color: #86efac;
          background: #0b211b;
          font-size: 12px;
        }

        .page-title {
          margin: 0 0 8px;
          font-size: clamp(25px, 4vw, 35px);
          letter-spacing: -1px;
        }

        .subtitle {
          margin: 0 0 24px;
          color: #91a0b7;
          line-height: 1.6;
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 18px;
        }

        .card {
          min-width: 0;
          background: rgba(15, 23, 42, 0.88);
          border: 1px solid #243149;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 12px 35px rgba(0,0,0,0.12);
        }

        .stat-label {
          color: #8d9cb3;
          font-size: 12px;
          margin-bottom: 12px;
        }

        .stat-value {
          font-size: clamp(19px, 2vw, 27px);
          font-weight: 750;
          overflow-wrap: anywhere;
        }

        .stat-sub {
          color: #91a0b7;
          font-size: 12px;
          margin-top: 8px;
        }

        .positive { color: #4ade80; }
        .negative { color: #fb7185; }
        .blue { color: #38bdf8; }
        .amber { color: #fbbf24; }

        .main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 300px;
          gap: 18px;
          align-items: start;
        }

        .panel-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }

        .panel-heading h2 {
          margin: 0 0 7px;
          font-size: 19px;
        }

        .muted {
          color: #91a0b7;
          font-size: 12px;
          line-height: 1.6;
        }

        .controls {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .controls label {
          display: flex;
          flex-direction: column;
          gap: 7px;
          color: #9eacc1;
          font-size: 11px;
        }

        select {
          background: #0a1220;
          color: #e5edf8;
          border: 1px solid #334155;
          border-radius: 9px;
          padding: 10px 12px;
          min-width: 135px;
          outline: none;
        }

        select:focus { border-color: #38bdf8; }

        .chart-wrap {
          width: 100%;
          min-width: 0;
          overflow: hidden;
          border-radius: 10px;
        }

        .chart {
          width: 100%;
          height: 390px;
        }

        .chart-legend {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 12px;
          color: #a8b5c8;
          font-size: 12px;
        }

        .legend-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }

        .signal-card {
          text-align: center;
          padding: 25px 18px;
          border: 1px solid #2a394f;
          background: #0a1220;
          border-radius: 14px;
          margin: 16px 0;
        }

        .signal-card .signal-label {
          color: #91a0b7;
          font-size: 12px;
          margin-bottom: 12px;
        }

        .signal-value {
          font-size: 25px;
          font-weight: 850;
          letter-spacing: 1px;
        }

        .bullish { color: #4ade80; }
        .bearish { color: #fb7185; }
        .neutral { color: #fbbf24; }

        .indicator-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 14px 0;
          border-bottom: 1px solid #243149;
          font-size: 13px;
        }

        .indicator-row:last-child { border-bottom: 0; }
        .indicator-name { color: #9eacc1; }
        .indicator-value { font-weight: 700; }

        .error {
          color: #fda4af;
          background: #30131d;
          border: 1px solid #6b2335;
          border-radius: 10px;
          padding: 12px;
          margin: 12px 0;
          font-size: 13px;
        }

        .loading {
          color: #7dd3fc;
          font-size: 13px;
          padding: 10px 0;
        }

        .disclaimer {
          margin-top: 18px;
          color: #77869e;
          font-size: 11px;
          line-height: 1.7;
        }

        .footer {
          text-align: center;
          margin-top: 28px;
          color: #65758d;
          font-size: 11px;
        }

        @media (max-width: 1000px) {
          .main-grid { grid-template-columns: 1fr; }
          .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        @media (max-width: 600px) {
          .app-shell { padding: 14px; }
          .stats-grid { gap: 10px; }
          .card { padding: 15px; }
          .chart { height: 320px; }
          .controls { width: 100%; }
          .controls label { flex: 1; min-width: 120px; }
          .controls select { width: 100%; min-width: 0; }
        }
      `}</style>

      <main className="dashboard">
        <header className="topbar">
          <div className="brand">
            <div className="brand-icon">₿</div>
            <div>
              <h1>CryptoPilot <span className="blue">AI</span></h1>
              <p>CRYPTO MARKET INTELLIGENCE</p>
            </div>
          </div>
          <div className="market-status">● Binance public market data</div>
        </header>

        <h2 className="page-title">Market Analysis Dashboard</h2>
        <p className="subtitle">
          Technical indicators and price action for your selected crypto market.
        </p>

        <section className="stats-grid">
          <div className="card">
            <div className="stat-label">Selected Market</div>
            <div className="stat-value">{symbol}</div>
            <div className="stat-sub">Binance Spot</div>
          </div>

          <div className="card">
            <div className="stat-label">Latest Close</div>
            <div className="stat-value">
              {current ? `${price(current.close)}` : '—'}
            </div>
            <div className="stat-sub">USDT</div>
          </div>

          <div className="card">
            <div className="stat-label">Current Candle Change</div>
            <div className={`stat-value ${
              changePercent == null
                ? ''
                : changePercent >= 0 ? 'positive' : 'negative'
            }`}>
              {changePercent == null
                ? '—'
                : `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`}
            </div>
            <div className="stat-sub">Open versus close</div>
          </div>

          <div className="card">
            <div className="stat-label">RSI (14)</div>
            <div className={`stat-value ${
              rsi == null ? '' : rsi >= 70 ? 'negative' : rsi <= 30 ? 'positive' : 'blue'
            }`}>
              {rsi == null ? '—' : rsi.toFixed(2)}
            </div>
            <div className="stat-sub">Momentum indicator</div>
          </div>
        </section>

        <section className="main-grid">
          <div className="card">
            <div className="panel-heading">
              <div>
                <h2>{symbol} Price Chart</h2>
                <div className="muted">
                  Candlesticks with EMA 9 and EMA 21
                </div>
              </div>

              <div className="controls">
                <label>
                  Trading Pair
                  <select
                    value={symbol}
                    onChange={(event) => setSymbol(event.target.value)}
                  >
                    {PAIRS.map((pair) => (
                      <option key={pair.value} value={pair.value}>
                        {pair.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Timeframe
                  <select
                    value={interval}
                    onChange={(event) => setIntervalValue(event.target.value)}
                  >
                    {FRAMES.map((frame) => (
                      <option key={frame.value} value={frame.value}>
                        {frame.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {error && <div className="error">{error}</div>}
            {loading && <div className="loading">Loading market data…</div>}

            <div className="chart-wrap">
              <div className="chart" ref={chartContainer} />
            </div>

            <div className="chart-legend">
              <span><i className="legend-dot" style={{ background: '#22c55e' }} /> Bullish candle</span>
              <span><i className="legend-dot" style={{ background: '#ef4444' }} /> Bearish candle</span>
              <span><i className="legend-dot" style={{ background: '#38bdf8' }} /> EMA 9</span>
              <span><i className="legend-dot" style={{ background: '#f59e0b' }} /> EMA 21</span>
            </div>

            <p className="muted">
              {lastUpdated
                ? `Last refreshed: ${lastUpdated.toLocaleTimeString()} · Auto refresh every 15 seconds`
                : 'Waiting for market data…'}
            </p>
          </div>

          <aside>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 19 }}>Signal Summary</h2>
              <p className="muted">
                Based on EMA 9, EMA 21 and RSI 14.
              </p>

              <div className="signal-card">
                <div className="signal-label">CURRENT INDICATOR SIGNAL</div>
                <div className={`signal-value ${signalClass}`}>
                  {signal}
                </div>
              </div>

              <div className="indicator-row">
                <span className="indicator-name">EMA 9</span>
                <span className="indicator-value blue">
                  {price(fastEMA)}
                </span>
              </div>

              <div className="indicator-row">
                <span className="indicator-name">EMA 21</span>
                <span className="indicator-value amber">
                  {price(slowEMA)}
                </span>
              </div>

              <div className="indicator-row">
                <span className="indicator-name">RSI 14</span>
                <span className="indicator-value">
                  {rsi == null ? '—' : rsi.toFixed(2)}
                </span>
              </div>

              <div className="indicator-row">
                <span className="indicator-name">Trend</span>
                <span className={`indicator-value ${
                  fastEMA > slowEMA ? 'positive' :
                  fastEMA < slowEMA ? 'negative' : 'neutral'
                }`}>
                  {fastEMA == null || slowEMA == null
                    ? 'Waiting'
                    : fastEMA > slowEMA
                      ? 'Uptrend'
                      : fastEMA < slowEMA
                        ? 'Downtrend'
                        : 'Sideways'}
                </span>
              </div>

              <p className="disclaimer">
                This is a basic indicator rule, not an AI prediction.
                It does not guarantee profitable trades.
              </p>
            </div>

            <div className="card" style={{ marginTop: 18 }}>
              <h2 style={{ marginTop: 0, fontSize: 17 }}>How to read this</h2>
              <p className="muted">
                <span className="positive">BULLISH:</span> EMA 9 is above EMA 21
                and RSI is between 50 and 70.
              </p>
              <p className="muted">
                <span className="negative">BEARISH:</span> EMA 9 is below EMA 21
                and RSI is above 30 and at or below 50.
              </p>
              <p className="muted">
                <span className="neutral">NEUTRAL:</span> The conditions above
                are not currently satisfied.
              </p>
            </div>
          </aside>
        </section>

        <p className="disclaimer">
          Educational market analysis only. Signals are not guaranteed trading
          recommendations. Crypto markets are risky. This dashboard uses public
          Binance Spot data and does not place orders or access your account.
        </p>

        <footer className="footer">
          CryptoPilot AI · Market data may be delayed or temporarily unavailable.
        </footer>
      </main>
    </div>
  );
}

export default App;
