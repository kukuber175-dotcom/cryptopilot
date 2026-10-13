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
	{ label: '1m', value: '1m' },
	{ label: '5m', value: '5m' },
	{ label: '15m', value: '15m' },
	{ label: '30m', value: '30m' },
	{ label: '1H', value: '1h' },
	{ label: '4H', value: '4h' },
	{ label: '12H', value: '12h' },
	{ label: '24H', value: '1d' },
];

function calculateEMA(candles, period) {
	const multiplier = 2 / (period + 1);
	let ema = null;

	return candles.map((candle, index) => {
		ema =
			index === 0
				? candle.close
				: candle.close * multiplier + ema * (1 - multiplier);

		return {
			time: candle.time,
			value: ema,
		};
	});
}

function calculateRSI(candles, period = 14) {
	if (candles.length <= period) return null;

	const changes = [];

	for (let i = 1; i < candles.length; i++) {
		changes.push(candles[i].close - candles[i - 1].close);
	}

	const recent = changes.slice(-period);
	const gains = recent.reduce(
		(sum, change) => sum + Math.max(change, 0),
		0
	);
	const losses = recent.reduce(
		(sum, change) => sum + Math.max(-change, 0),
		0
	);

	if (losses === 0) return gains === 0 ? 50 : 100;

	const relativeStrength = gains / losses;
	return 100 - 100 / (1 + relativeStrength);
}

function formatPrice(value) {
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

	useEffect(() => {
		if (!containerRef.current) return;

		const chart = createChart(containerRef.current, {
			width: containerRef.current.clientWidth,
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

		const ema9 = chart.addSeries(LineSeries, {
			color: '#38bdf8',
			lineWidth: 2,
			title: 'EMA 9',
		});

		const ema21 = chart.addSeries(LineSeries, {
			color: '#f59e0b',
			lineWidth: 2,
			title: 'EMA 21',
		});

		chartRef.current = chart;
		candleSeriesRef.current = candleSeries;
		ema9SeriesRef.current = ema9;
		ema21SeriesRef.current = ema21;

		const resizeObserver = new ResizeObserver(() => {
			if (containerRef.current) {
				chart.applyOptions({
					width: containerRef.current.clientWidth,
				});
			}
		});

		resizeObserver.observe(containerRef.current);

		return () => {
			resizeObserver.disconnect();
			chart.remove();
			chartRef.current = null;
			candleSeriesRef.current = null;
			ema9SeriesRef.current = null;
			ema21SeriesRef.current = null;
		};
	}, []);

	useEffect(() => {
		let active = true;
		setLoading(true);
		setError('');
		setCandles([]);

		async function loadCandles() {
			try {
				const url =
					`${API}?symbol=${symbol}&interval=${interval}&limit=500`;

				const response = await fetch(url);

				if (!response.ok) {
					throw new Error(
						'Market data unavailable. Check the pair or try again.'
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

				if (parsed.length === 0) {
					throw new Error('No candle data received.');
				}

				setCandles(parsed);
				setLastUpdated(new Date());
				setError('');
			} catch (err) {
				if (active) {
					setError(err.message || 'Unable to load market data.');
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

	useEffect(() => {
		if (!candles.length || !candleSeriesRef.current) return;

		candleSeriesRef.current.setData(candles);
		ema9SeriesRef.current?.setData(calculateEMA(candles, 9));
		ema21SeriesRef.current?.setData(calculateEMA(candles, 21));

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

	if (fastEMA != null && slowEMA != null && rsi != null) {
		if (fastEMA > slowEMA && rsi >= 50 && rsi < 70) {
			signal = 'BULLISH';
			signalClass = 'scalp-bullish';
		} else if (fastEMA < slowEMA && rsi > 30 && rsi <= 50) {
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
				<span className="scalp-live">● Public market data</span>
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
						onChange={(event) => setIntervalValue(event.target.value)}
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
			{loading && <p className="scalp-muted">Loading candles...</p>}

			{current && (
				<div className="scalp-stats">
					<div>
						<span>Latest close</span>
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
				<span>Indicator summary</span>
				<strong className={signalClass}>{signal}</strong>
			</div>

			<p className="scalp-muted scalp-footnote">
				{lastUpdated
					? `Last refreshed: ${lastUpdated.toLocaleTimeString()} · Auto-refresh every 15 seconds`
					: 'Waiting for market data...'}
			</p>

			<p className="scalp-disclaimer">
				Educational technical indicators only. This is not a guaranteed
				trading signal or financial advice. No orders are placed.
			</p>
		</section>
	);
}
