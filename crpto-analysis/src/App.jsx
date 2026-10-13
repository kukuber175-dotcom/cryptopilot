
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
];

const TIMEFRAMES = [
  { label: '1 Minute', value: '1m' },
  { label: '5 Minutes', value: '5m' },
  { label: '15 Minutes', value: '15m' },
  { label: '30 Minutes', value: '30m' },
  { label: '1 Hour', value: '1h' },
  { label: '4 Hours', value: '4h' },
  { label: '12 Hours', value: '12h' },
  { label: '24 Hours', value: '1d' },
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

  for (
    let i = candles.length - period;
    i < candles.length;
    i++
  ) {
    const change = candles[i].close - candles[i - 1].close;

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const rs = averageGain / averageLoss;

  return 100 - 100 / (1 + rs);
}

function formatPrice(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return '—';
  }

  return Number(value).toLocaleString('en-US', {
    maximumSignificantDigits: 8,
  });
}

export default function Scalping() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setIntervalValue] = useState('1m');
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const ema9SeriesRef = useRef(null);
  const ema21SeriesRef = useRef(null);

  // Create chart once and resize it with the panel
  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: 360,
      layout: {
        background: { color: '#0b1220' },
        textColor: '#cbd5e1',
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
    candleSeriesRef.current = candleSeries;
    ema9SeriesRef.current = ema9Series;
    ema21SeriesRef.current = ema21Series;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth || 600,
        });
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();

      chartRef.current = null;
      candleSeriesRef.current = null;
      ema9SeriesRef.current = null;
      ema21SeriesRef.current = null;
    };
  }, []);

  // Load Binance candles and refresh every 15 seconds
  useEffect(() => {
    let active = true;

    async function loadCandles() {
      try {
        setLoading(true);
        setError('');

        const url =
          `${API}?symbol=${symbol}&interval=${interval}&limit=500`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(
            'Market data unavailable. Please try another pair.'
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
          throw new Error('No candle data received.');
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

    loadCandles();

    const timer = setInterval(loadCandles, 15000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [symbol, interval]);

  // Update chart and indicator lines
  useEffect(() => {
    if (
      !candles.length ||
      !candleSeriesRef.current ||
      !ema9SeriesRef.current ||
      !ema21SeriesRef.current
    ) {
      return;
    }

    candleSeriesRef.current.setData(candles);
    ema9SeriesRef.current.setData(calculateEMA(candles, 9));
    ema21SeriesRef.current.setData(calculateEMA(candles, 21));

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const current = candles[candles.length - 1];
  const rsi = calculateRSI(candles);
  const ema9 = calculateEMA(candles, 9);
  const ema21 = calculateEMA(candles, 21);

  const fastEMA = ema9[ema9.length - 1]?.value;
  const slowEMA = ema21[ema21.length - 1]?.value;

  let signal = 'NEUTRAL';
  let signalClass = 'scalp-neutral';

  if (
    fastEMA != null &&
    slowEMA != null &&
    rsi != null
  ) {
    if (fastEMA > slowEMA && rsi >= 50 && rsi < 70) {
      signal = 'BULLISH';
      signalClass = 'scalp-bullish';
    } else if (
      fastEMA < slowEMA &&
      rsi > 30 &&
      rsi <= 50
    ) {
      signal = 'BEARISH';
      signalClass = 'scalp-bearish';
    }
  }

  return (
    <section className="scalp-panel">
      <div className="scalp-heading">
        <div>
          <p className="eyebrow">BINANCE SPOT MARKET</p>
          <h2>Scalping Analysis</h2>
          <p className="scalp-muted">
            Candlesticks · EMA 9 · EMA 21 · RSI 14
          </p>
        </div>

        <span className="scalp-live">
          ● Public market data
        </span>
      </div>

      <div className="scalp-controls">
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
            onChange={(event) =>
              setIntervalValue(event.target.value)
            }
          >
            {TIMEFRAMES.map((frame) => (
              <option key={frame.value} value={frame.value}>
                {frame.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="scalp-error">{error}</p>}

      {loading && (
        <p className="scalp-muted">Loading candles...</p>
      )}

      {current && (
        <div className="scalp-stats">
          <div>
            <span>Latest Close</span>
            <strong>{formatPrice(current.close)} USDT</strong>
          </div>

          <div>
            <span>RSI (14)</span>
            <strong>{rsi == null ? '—' : rsi.toFixed(2)}</strong>
          </div>

          <div>
            <span>EMA 9</span>
            <strong>{formatPrice(fastEMA)}</strong>
          </div>

          <div>
            <span>EMA 21</span>
            <strong>{formatPrice(slowEMA)}</strong>
          </div>
        </div>
      )}

      <div className="scalp-chart" ref={containerRef} />

      <div className="scalp-signal">
        <span>Indicator Summary</span>
        <strong className={signalClass}>{signal}</strong>
      </div>

      <p className="scalp-muted scalp-footnote">
        {lastUpdated
          ? `Last refreshed: ${lastUpdated.toLocaleTimeString()} · Refreshes every 15 seconds`
          : 'Waiting for market data...'}
      </p>

      <p className="scalp-disclaimer">
        Educational indicators only. Signals are not guaranteed
        trading recommendations. No orders are placed.
      </p>
    </section>
  );
}
