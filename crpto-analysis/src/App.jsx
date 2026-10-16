import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	createChart,
	CandlestickSeries,
	LineSeries,
	createSeriesMarkers
} from 'lightweight-charts';

const SPOT_API = 'https://data-api.binance.vision/api/v3';
const FUTURES_API = 'https://fapi.binance.com/fapi/v1';
const STORAGE_KEY = 'cryptopilot-settings-v3';

const INTERVALS = [
	'1m', '3m', '5m', '15m', '30m',
	'1h', '2h', '4h', '6h', '12h', '1d', '1w'
];

const DEFAULTS = {
	market: 'spot',
	symbol: 'BTCUSDT',
	interval: '15m',
	limit: 500,
	strategy: 'advanced',
	threshold: 65,
	useEMA: true,
	useRSI: true,
	useMACD: true,
	useVolume: true,
	useATR: true,
	useADX: true,
	useSR: true,
	usePatterns: true,
	emaFast: 9,
	emaMid: 21,
	emaTrend: 50,
	emaLong: 200,
	rsiPeriod: 14,
	rsiLow: 30,
	rsiHigh: 70,
	atrPeriod: 14,
	atrMultiplier: 1.5,
	adxPeriod: 14,
	volumePeriod: 20,
	rr1: 1.5,
	rr2: 2
};

const clamp = (n, min, max) =>
	Math.max(min, Math.min(max, n));

const average = a =>
	a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

const fmt = n =>
	Number.isFinite(n)
		? n.toLocaleString('en-US', {
				maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 8
			})
		: '—';

const fmtCompact = n =>
	Number.isFinite(n)
		? Intl.NumberFormat('en-US', {
				notation: 'compact',
				maximumFractionDigits: 2
			}).format(n)
		: '—';

const fmtDate = t =>
	Number.isFinite(t)
		? new Date(t * 1000).toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			})
		: '—';

const ema = (values, p) => {
	const out = Array(values.length).fill(null);
	p = Math.max(1, Math.floor(+p || 1));

	if (values.length < p) return out;

	let v = average(values.slice(0, p));
	const k = 2 / (p + 1);

	out[p - 1] = v;

	for (let i = p; i < values.length; i++) {
		v = values[i] * k + v * (1 - k);
		out[i] = v;
	}

	return out;
};

function calcRSI(values, p = 14) {
	const out = Array(values.length).fill(null);

	if (values.length <= p) return out;

	let g = 0;
	let l = 0;

	for (let i = 1; i <= p; i++) {
		const d = values[i] - values[i - 1];
		g += Math.max(0, d);
		l += Math.max(0, -d);
	}

	let ag = g / p;
	let al = l / p;

	out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);

	for (let i = p + 1; i < values.length; i++) {
		const d = values[i] - values[i - 1];

		ag = (ag * (p - 1) + Math.max(d, 0)) / p;
		al = (al * (p - 1) + Math.max(-d, 0)) / p;

		out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
	}

	return out;
}

function calcATR(cs, p = 14) {
	const tr = cs.map((c, i) =>
		i === 0
			? c.high - c.low
			: Math.max(
					c.high - c.low,
					Math.abs(c.high - cs[i - 1].close),
					Math.abs(c.low - cs[i - 1].close)
				)
	);

	const out = Array(cs.length).fill(null);

	if (tr.length < p) return out;

	let v = average(tr.slice(0, p));
	out[p - 1] = v;

	for (let i = p; i < tr.length; i++) {
		v = (v * (p - 1) + tr[i]) / p;
		out[i] = v;
	}

	return out;
}

function calcADX(cs, p = 14) {
	const n = cs.length;
	const out = Array(n).fill(null);

	if (n < 2 * p + 1) return out;

	const tr = Array(n).fill(0);
	const plus = Array(n).fill(0);
	const minus = Array(n).fill(0);

	for (let i = 1; i < n; i++) {
		const up = cs[i].high - cs[i - 1].high;
		const down = cs[i - 1].low - cs[i].low;

		plus[i] = up > down && up > 0 ? up : 0;
		minus[i] = down > up && down > 0 ? down : 0;

		tr[i] = Math.max(
			cs[i].high - cs[i].low,
			Math.abs(cs[i].high - cs[i - 1].close),
			Math.abs(cs[i].low - cs[i - 1].close)
		);
	}

	const dx = Array(n).fill(null);

	let st = 0;
	let sp = 0;
	let sm = 0;

	for (let i = 1; i <= p; i++) {
		st += tr[i];
		sp += plus[i];
		sm += minus[i];
	}

	for (let i = p; i < n; i++) {
		if (i > p) {
			st = st - st / p + tr[i];
			sp = sp - sp / p + plus[i];
			sm = sm - sm / p + minus[i];
		}

		const pd = st ? (100 * sp) / st : 0;
		const md = st ? (100 * sm) / st : 0;

		dx[i] = pd + md
			? (100 * Math.abs(pd - md)) / (pd + md)
			: 0;
	}

	const seed = dx.slice(p, 2 * p).filter(Number.isFinite);

	if (seed.length) {
		out[2 * p - 1] = average(seed);

		for (let i = 2 * p; i < n; i++) {
			out[i] =
				((out[i - 1] ?? average(seed)) * (p - 1) +
					(dx[i] ?? 0)) / p;
		}
	}

	return out;
}

function candlePattern(cs, i) {
	const c = cs[i];
	const p = cs[i - 1];

	if (!c || !p) return '';

	const body = Math.abs(c.close - c.open);
	const range = Math.max(c.high - c.low, 1e-12);
	const upper = c.high - Math.max(c.open, c.close);
	const lower = Math.min(c.open, c.close) - c.low;
	const prev = Math.abs(p.close - p.open);

	if (
		p.close < p.open &&
		c.close > c.open &&
		c.open <= p.close &&
		c.close >= p.open &&
		body >= prev * 0.8
	) return 'Bullish Engulfing';

	if (
		p.close > p.open &&
		c.close < c.open &&
		c.open >= p.close &&
		c.close <= p.open &&
		body >= prev * 0.8
	) return 'Bearish Engulfing';

	if (lower >= body * 2 && upper <= body * 0.8 && c.close > c.open)
		return 'Hammer';

	if (upper >= body * 2 && lower <= body * 0.8 && c.close < p.open)
		return 'Shooting Star';

	if (body / range < 0.1) return 'Doji';

	return '';
}

function calculate(candles, s) {
	const closes = candles.map(c => c.close);
	const vols = candles.map(c => c.volume);

	const ef = ema(closes, s.emaFast);
	const em = ema(closes, s.emaMid);
	const et = ema(closes, s.emaTrend);
	const el = ema(closes, s.emaLong);

	const rsi = calcRSI(closes, s.rsiPeriod);
	const atr = calcATR(candles, s.atrPeriod);
	const adx = calcADX(candles, s.adxPeriod);

	const mf = ema(closes, 12);
	const ms = ema(closes, 26);

	const ml = closes.map((_, i) =>
		mf[i] != null && ms[i] != null ? mf[i] - ms[i] : null
	);

	const mSig = ema(ml.map(x => x ?? 0), 9);
	const vAvg = ema(vols, s.volumePeriod);

	return candles.map((c, i) => {
		const pattern = candlePattern(candles, i);
		const hist = candles.slice(Math.max(0, i - 30), i);

		const support = hist.length
			? Math.min(...hist.map(x => x.low))
			: c.low;

		const resistance = hist.length
			? Math.max(...hist.map(x => x.high))
			: c.high;

		let bull = 0;
		let bear = 0;
		let total = 0;

		const add = (b, se, w = 1) => {
			bull += b * w;
			bear += se * w;
			total += w;
		};

		if (s.useEMA) {
			add(
				ef[i] != null && em[i] != null && et[i] != null &&
				c.close > et[i] && ef[i] > em[i] ? 1 : 0,
				ef[i] != null && em[i] != null && et[i] != null &&
				c.close < et[i] && ef[i] < em[i] ? 1 : 0,
				2
			);

			if (el[i] != null) {
				add(c.close > el[i] ? 1 : 0, c.close < el[i] ? 1 : 0, 1);
			}
		}

		if (s.useRSI && rsi[i] != null) {
			add(
				rsi[i] >= 50 && rsi[i] < s.rsiHigh ? 1 : 0,
				rsi[i] < 50 && rsi[i] > s.rsiLow ? 1 : 0
			);
		}

		if (s.useMACD && ml[i] != null && mSig[i] != null) {
			add(
				ml[i] > mSig[i] && ml[i] > 0 ? 1 : 0,
				ml[i] < mSig[i] && ml[i] < 0 ? 1 : 0,
				1.5
			);
		}

		if (s.useVolume && vAvg[i] != null && c.volume > vAvg[i]) {
			add(c.close > c.open ? 1 : 0, c.close < c.open ? 1 : 0);
		}

		if (s.useADX && adx[i] != null && adx[i] >= 20) {
			add(
				ef[i] != null && em[i] != null && ef[i] > em[i] ? 1 : 0,
				ef[i] != null && em[i] != null && ef[i] < em[i] ? 1 : 0,
				0.75
			);
		}

		if (s.useSR) {
			const pad = (atr[i] ?? c.close * 0.005) * 0.6;

			add(
				Math.abs(c.close - support) <= pad ||
					(c.close > resistance && c.close > c.open) ? 1 : 0,
				Math.abs(resistance - c.close) <= pad ||
					(c.close < support && c.close < c.open) ? 1 : 0
			);
		}

		if (s.usePatterns) {
			add(
				['Bullish Engulfing', 'Hammer'].includes(pattern) ? 1 : 0,
				['Bearish Engulfing', 'Shooting Star'].includes(pattern) ? 1 : 0
			);
		}

		const bullScore = total ? (bull / total) * 100 : 0;
		const bearScore = total ? (bear / total) * 100 : 0;

		let signal = 'WAIT';

		const enough =
			i >= Math.max(s.emaLong, s.rsiPeriod, s.atrPeriod, s.adxPeriod * 2) + 3;

		if (enough) {
			if (s.strategy === 'priceAction') {
				if (
					['Bullish Engulfing', 'Hammer'].includes(pattern) &&
					c.close > c.open
				) signal = 'BUY';

				if (
					['Bearish Engulfing', 'Shooting Star'].includes(pattern) &&
					c.close < c.open
				) signal = 'SELL';
			} else {
				if (bullScore >= s.threshold && bullScore > bearScore + 8)
					signal = 'BUY';
				else if (bearScore >= s.threshold && bearScore > bullScore + 8)
					signal = 'SELL';
			}
		}

		return {
			...c,
			emaFast: ef[i],
			emaMid: em[i],
			emaTrend: et[i],
			emaLong: el[i],
			rsi: rsi[i],
			atr: atr[i],
			adx: adx[i],
			macd: ml[i],
			macdSignal: mSig[i],
			volumeAvg: vAvg[i],
			pattern,
			support,
			resistance,
			bullScore,
			bearScore,
			signal
		};
	});
}

const parseKlines = raw =>
	raw.map(k => ({
		time: Math.floor(k[0] / 1000),
		open: +k[1],
		high: +k[2],
		low: +k[3],
		close: +k[4],
		volume: +k[5]
	}));

const intervalSeconds = value => ({
	'1m': 60,
	'3m': 180,
	'5m': 300,
	'15m': 900,
	'30m': 1800,
	'1h': 3600,
	'2h': 7200,
	'4h': 14400,
	'6h': 21600,
	'12h': 43200,
	'1d': 86400,
	'1w': 604800
}[value] || 900);

function makeForecast(rows, interval, steps = 12) {
	if (rows.length < 30) {
		return { bull: [], bear: [], bias: 'WAIT', confidence: 0 };
	}

	const last = rows[rows.length - 1];
	const prev = rows[Math.max(0, rows.length - 6)];

	const atr = Math.max(
		last.atr || last.close * 0.005,
		last.close * 0.001
	);

	const slope =
		((last.emaMid ?? last.close) - (prev.emaMid ?? prev.close)) / 5;

	const momentum =
		((last.close - prev.close) / Math.max(prev.close, 1e-12)) / 5;

	const bullScore = last.bullScore ?? 50;
	const bearScore = last.bearScore ?? 50;

	const bias =
		bullScore >= bearScore + 6
			? 'BUY'
			: bearScore >= bullScore + 6
				? 'SELL'
				: 'WAIT';

	const confidence = Math.round(Math.max(bullScore, bearScore));

	const step = intervalSeconds(interval);
	const start = last.time;

	const bull = [];
	const bear = [];

	for (let k = 1; k <= steps; k++) {
		const decay = 1 / (1 + k * 0.18);
		const drift = (slope * 0.55 + momentum * last.close * 0.45) * k * decay;
		const spread = atr * 0.22 * Math.sqrt(k);

		bull.push({
			time: start + step * k,
			value: Math.max(1, last.close + drift + spread)
		});

		bear.push({
			time: start + step * k,
			value: Math.max(1, last.close + drift - spread)
		});
	}

	return { bull, bear, bias, confidence, atr };
}

function findSmartMoney(rows) {
	const out = [];

	if (rows.length < 4) return out;

	const from = Math.max(2, rows.length - 80);

	for (let i = from; i < rows.length; i++) {
		const c = rows[i];
		const a = rows[i - 2];

		if (c.low > a.high) {
			out.push({
				time: rows[i - 1].time,
				position: 'belowBar',
				color: '#38bdf8',
				shape: 'circle',
				text: 'Bull FVG'
			});
		}

		if (c.high < a.low) {
			out.push({
				time: rows[i - 1].time,
				position: 'aboveBar',
				color: '#a78bfa',
				shape: 'circle',
				text: 'Bear FVG'
			});
		}

		const recent = rows.slice(Math.max(0, i - 20), i);

		const priorHigh = recent.length
			? Math.max(...recent.map(x => x.high))
			: c.high;

		const priorLow = recent.length
			? Math.min(...recent.map(x => x.low))
			: c.low;

		if (c.high > priorHigh && c.close < priorHigh) {
			out.push({
				time: c.time,
				position: 'aboveBar',
				color: '#f97316',
				shape: 'arrowDown',
				text: 'Liquidity sweep'
			});
		} else if (c.low < priorLow && c.close > priorLow) {
			out.push({
				time: c.time,
				position: 'belowBar',
				color: '#f97316',
				shape: 'arrowUp',
				text: 'Liquidity sweep'
			});
		}
	}

	return out;
}

export default function App() {
	const [settings, setSettings] = useState(() => {
		try {
			return {
				...DEFAULTS,
				...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
			};
		} catch {
			return DEFAULTS;
		}
	});

	const [pairs, setPairs] = useState([]);
	const [search, setSearch] = useState('');
	const [candles, setCandles] = useState([]);
	const [yearCandles, setYearCandles] = useState([]);
	const [ticker, setTicker] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [updated, setUpdated] = useState(null);

	const host = useRef(null);
	const chartRef = useRef(null);
	const candleRef = useRef(null);
	const ema1Ref = useRef(null);
	const ema2Ref = useRef(null);
	const ema3Ref = useRef(null);
	const forecastBullRef = useRef(null);
	const forecastBearRef = useRef(null);
	const markersRef = useRef(null);
	const priceLinesRef = useRef([]);
	const firstDataRef = useRef(true);

	const symbol = settings.symbol || 'BTCUSDT';

	const update = useCallback((key, value) => {
		setSettings(prev => {
			const next = { ...prev, [key]: value };

			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			} catch {}

			return next;
		});
	}, []);

	const signals = useMemo(
		() => candles.length ? calculate(candles, settings) : [],
		[candles, settings]
	);

	const closed = signals.length > 1 ? signals.slice(0, -1) : signals;
	const latest = closed[closed.length - 1];

	const forecast = useMemo(
		() => makeForecast(closed, settings.interval, 12),
		[closed, settings.interval]
	);

	const smartMarkers = useMemo(
		() => findSmartMoney(closed),
		[closed]
	);

	const activeLevels = useMemo(() => {
		if (
			!latest ||
			!['BUY', 'SELL'].includes(latest.signal) ||
			!Number.isFinite(latest.atr)
		) return null;

		const buy = latest.signal === 'BUY';
		const entry = latest.close;
		const risk = Math.max(
			latest.atr * settings.atrMultiplier,
			entry * 0.001
		);

		return {
			entry,
			stop: buy ? entry - risk : entry + risk,
			tp1: buy ? entry + risk * settings.rr1 : entry - risk * settings.rr1,
			tp2: buy ? entry + risk * settings.rr2 : entry - risk * settings.rr2,
			tp3: buy ? entry + risk * 3 : entry - risk * 3
		};
	}, [latest, settings.atrMultiplier, settings.rr1, settings.rr2]);

	const visiblePairs = useMemo(() => {
		const q = search.trim().toUpperCase();

		return pairs.filter(p =>
			!q ||
			p.symbol.includes(q) ||
			p.baseAsset.includes(q) ||
			p.quoteAsset.includes(q)
		).slice(0, 500);
	}, [pairs, search]);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			try {
				const url = settings.market === 'futures'
					? `${FUTURES_API}/exchangeInfo`
					: `${SPOT_API}/exchangeInfo?permissions=SPOT`;

				const r = await fetch(url);

				if (!r.ok) throw Error(`HTTP ${r.status}`);

				const j = await r.json();

				const list = (j.symbols || [])
					.filter(p =>
						p.status === 'TRADING' &&
						(
							settings.market === 'spot'
								? p.isSpotTradingAllowed !== false
								: p.contractType === 'PERPETUAL' && p.quoteAsset === 'USDT'
						)
					)
					.map(p => ({
						symbol: p.symbol,
						baseAsset: p.baseAsset,
						quoteAsset: p.quoteAsset
					}))
					.sort((a, b) => a.symbol.localeCompare(b.symbol));

				if (!cancelled) {
					setPairs(list);

					if (list.length && !list.some(p => p.symbol === symbol)) {
						const next = list.find(p => p.symbol === 'BTCUSDT') || list[0];

						setSettings(prev => ({ ...prev, symbol: next.symbol }));
					}
				}
			} catch (e) {
				if (!cancelled) {
					setError(`Could not load Binance markets: ${e.message}`);
				}
			}
		}

		load();

		const id = setInterval(load, 300000);

		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [settings.market]);

	useEffect(() => {
		let cancelled = false;
		let id;

		async function load() {
			try {
				const endpoint = settings.market === 'futures'
					? `${FUTURES_API}/klines`
					: `${SPOT_API}/klines`;

				const r = await fetch(
					`${endpoint}?symbol=${encodeURIComponent(symbol)}&interval=${settings.interval}&limit=${settings.limit}`
				);

				if (!r.ok) throw Error(`HTTP ${r.status}`);

				const data = parseKlines(await r.json());

				if (!cancelled) {
					setCandles(data);
					setUpdated(new Date());
					setError('');
					setLoading(false);
				}
			} catch (e) {
				if (!cancelled) {
					setError(`Market data unavailable: ${e.message}`);
					setLoading(false);
				}
			}
		}

		setLoading(true);
		load();

		id = setInterval(load, 15000);

		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [settings.market, settings.interval, settings.limit, symbol]);

	useEffect(() => {
		let cancelled = false;
		let id;

		async function loadHistory() {
			try {
				const base = settings.market === 'futures' ? FUTURES_API : SPOT_API;

				const [historyResponse, tickerResponse] = await Promise.all([
					fetch(`${base}/klines?symbol=${encodeURIComponent(symbol)}&interval=1d&limit=365`),
					fetch(`${base}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`)
				]);

				if (!historyResponse.ok) {
					throw Error(`History HTTP ${historyResponse.status}`);
				}

				const history = parseKlines(await historyResponse.json());
				const tickerData = tickerResponse.ok ? await tickerResponse.json() : null;

				if (!cancelled) {
					setYearCandles(history);
					setTicker(tickerData);
				}
			} catch {
				if (!cancelled) {
					setYearCandles([]);
					setTicker(null);
				}
			}
		}

		loadHistory();

		id = setInterval(loadHistory, 300000);

		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [settings.market, symbol]);

	const yearStats = useMemo(() => {
		if (!yearCandles.length) return null;

		const first = yearCandles[0];
		const last = yearCandles[yearCandles.length - 1];

		const high = Math.max(...yearCandles.map(c => c.high));
		const low = Math.min(...yearCandles.map(c => c.low));
		const volume = yearCandles.reduce((sum, c) => sum + c.volume, 0);

		const change = first.open
			? ((last.close - first.open) / first.open) * 100
			: null;

		return {
			firstPrice: first.open,
			lastPrice: last.close,
			high,
			low,
			volume,
			change,
			days: yearCandles.length,
			from: first.time,
			to: last.time
		};
	}, [yearCandles]);

	useEffect(() => {
		if (!host.current) return;

		const chart = createChart(host.current, {
			autoSize: true,
			layout: {
				background: { color: '#0b1220' },
				textColor: '#a9b7ca',
				fontFamily: 'Inter,system-ui,sans-serif'
			},
			grid: {
				vertLines: { color: '#182338' },
				horzLines: { color: '#182338' }
			},
			rightPriceScale: { borderColor: '#26334a' },
			timeScale: {
				borderColor: '#26334a',
				timeVisible: true,
				secondsVisible: false,
				rightOffset: 5
			},
			crosshair: { mode: 1 },
			handleScroll: {
				mouseWheel: false,
				pressedMouseMove: true,
				horzTouchDrag: true,
				vertTouchDrag: false
			},
			handleScale: {
				mouseWheel: true,
				pinch: true,
				axisPressedMouseMove: true,
				axisDoubleClickReset: true
			},
			localization: {
				priceFormatter: p =>
					Number(p).toLocaleString('en-US', {
						maximumFractionDigits: p >= 100 ? 2 : p >= 1 ? 4 : 8
					})
			}
		});

		const cs = chart.addSeries(CandlestickSeries, {
			upColor: '#22c55e',
			downColor: '#ef4444',
			borderUpColor: '#22c55e',
			borderDownColor: '#ef4444',
			wickUpColor: '#22c55e',
			wickDownColor: '#ef4444'
		});

		const e1 = chart.addSeries(LineSeries, {
			color: '#facc15',
			lineWidth: 1,
			title: 'EMA Fast',
			lastValueVisible: false,
			priceLineVisible: false
		});

		const e2 = chart.addSeries(LineSeries, {
			color: '#60a5fa',
			lineWidth: 1,
			title: 'EMA Mid',
			lastValueVisible: false,
			priceLineVisible: false
		});

		const e3 = chart.addSeries(LineSeries, {
			color: '#c084fc',
			lineWidth: 1,
			title: 'EMA Trend',
			lastValueVisible: false,
			priceLineVisible: false
		});

		const fb = chart.addSeries(LineSeries, {
			color: '#22c55e',
			lineWidth: 2,
			lineStyle: 2,
			title: 'Bullish Forecast',
			lastValueVisible: false,
			priceLineVisible: false
		});

		const fs = chart.addSeries(LineSeries, {
			color: '#ef4444',
			lineWidth: 2,
			lineStyle: 2,
			title: 'Bearish Forecast',
			lastValueVisible: false,
			priceLineVisible: false
		});

		chartRef.current = chart;
		candleRef.current = cs;
		ema1Ref.current = e1;
		ema2Ref.current = e2;
		ema3Ref.current = e3;
		forecastBullRef.current = fb;
		forecastBearRef.current = fs;

		markersRef.current = createSeriesMarkers(cs, []);
		firstDataRef.current = true;

		const key =
			`cryptopilot-range-${settings.market}-${symbol}-${settings.interval}`;

		try {
			const saved = JSON.parse(localStorage.getItem(key) || 'null');

			if (saved?.from != null && saved?.to != null) {
				chart.timeScale().setVisibleRange(saved);
			}
		} catch {}

		const save = range => {
			if (range) {
				try {
					localStorage.setItem(key, JSON.stringify(range));
				} catch {}
			}
		};

		chart.timeScale().subscribeVisibleTimeRangeChange(save);

		return () => {
			chart.timeScale().unsubscribeVisibleTimeRangeChange(save);
			chart.remove();

			chartRef.current = null;
			candleRef.current = null;
			ema1Ref.current = null;
			ema2Ref.current = null;
			ema3Ref.current = null;
			forecastBullRef.current = null;
			forecastBearRef.current = null;
			markersRef.current = null;
			priceLinesRef.current = [];
		};
	}, [settings.market, symbol, settings.interval]);

	useEffect(() => {
		const chart = chartRef.current;
		const cs = candleRef.current;

		if (!chart || !cs || !signals.length) return;

		cs.setData(signals.map(c => ({
			time: c.time,
			open: c.open,
			high: c.high,
			low: c.low,
			close: c.close
		})));

		ema1Ref.current?.setData(
			signals.filter(c => c.emaFast != null).map(c => ({
				time: c.time,
				value: c.emaFast
			}))
		);

		ema2Ref.current?.setData(
			signals.filter(c => c.emaMid != null).map(c => ({
				time: c.time,
				value: c.emaMid
			}))
		);

		ema3Ref.current?.setData(
			signals.filter(c => c.emaTrend != null).map(c => ({
				time: c.time,
				value: c.emaTrend
			}))
		);

		const signalMarkers = closed
			.filter(c => c.signal === 'BUY' || c.signal === 'SELL')
			.map(c => ({
				time: c.time,
				position: c.signal === 'BUY' ? 'belowBar' : 'aboveBar',
				color: c.signal === 'BUY' ? '#22c55e' : '#ef4444',
				shape: c.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
				text: c.signal
			}));

		markersRef.current?.setMarkers(
			[...signalMarkers, ...smartMarkers].sort((a, b) => a.time - b.time)
		);

		const lastClosed = closed[closed.length - 1];

		forecastBullRef.current?.setData(
			forecast.bull.length && lastClosed
				? [
						{ time: lastClosed.time, value: lastClosed.close },
						...forecast.bull
					]
				: []
		);

		forecastBearRef.current?.setData(
			forecast.bear.length && lastClosed
				? [
						{ time: lastClosed.time, value: lastClosed.close },
						...forecast.bear
					]
				: []
		);

		priceLinesRef.current.forEach(line => {
			try {
				cs.removePriceLine(line);
			} catch {}
		});

		priceLinesRef.current = [];

		if (activeLevels) {
			const add = (price, title, color) => {
				priceLinesRef.current.push(
					cs.createPriceLine({
						price,
						title,
						color,
						lineWidth: 2,
						lineStyle: 2,
						axisLabelVisible: true,
						lineVisible: true
					})
				);
			};

			add(activeLevels.entry, 'ENTRY', '#facc15');
			add(activeLevels.stop, 'STOP-LOSS', '#ef4444');
			add(activeLevels.tp1, 'TP1', '#22c55e');
			add(activeLevels.tp2, 'TP2', '#38bdf8');
			add(activeLevels.tp3, 'TP3', '#a78bfa');
		}

		if (firstDataRef.current) {
			const key =
				`cryptopilot-range-${settings.market}-${symbol}-${settings.interval}`;

			try {
				const saved = JSON.parse(localStorage.getItem(key) || 'null');

				if (saved?.from != null && saved?.to != null) {
					chart.timeScale().setVisibleRange(saved);
				} else {
					chart.timeScale().fitContent();
				}
			} catch {
				chart.timeScale().fitContent();
			}

			firstDataRef.current = false;
		}
	}, [
		signals,
		closed,
		activeLevels,
		settings.market,
		settings.interval,
		symbol,
		forecast,
		smartMarkers
	]);

	const reset = () => {
		setSettings(DEFAULTS);

		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULTS));
		} catch {}
	};

	const signal = latest?.signal || 'WAIT';
	const score = latest
		? Math.max(latest.bullScore, latest.bearScore)
		: null;

	const zoomChart = direction => {
		const scale = chartRef.current?.timeScale();

		if (!scale) return;

		const range = scale.getVisibleLogicalRange();

		if (!range) return;

		const center = (range.from + range.to) / 2;
		const span = Math.max(10, range.to - range.from);

		const nextSpan = direction === 'in'
			? Math.max(10, span * 0.75)
			: Math.min(
					Math.max(candles.length, span + 1),
					span / 0.75
				);

		scale.setVisibleLogicalRange({
			from: center - nextSpan / 2,
			to: center + nextSpan / 2
		});
	};

	const resetChartView = () =>
		chartRef.current?.timeScale().fitContent();

	return (
		<div className="cp-root">
			<style>{`
				*{box-sizing:border-box}
				body{margin:0;background:#070c16}
				.cp-root{min-height:100vh;background:#070c16;color:#e5edf8;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px}
				.cp-shell{max-width:1600px;margin:auto}
				.cp-header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px}
				.cp-brand{display:flex;align-items:center;gap:12px}
				.cp-logo{width:44px;height:44px;border-radius:13px;background:linear-gradient(135deg,#2563eb,#22c55e);display:grid;place-items:center;font-weight:900;font-size:22px}
				.cp-title{font-size:24px;font-weight:850}
				.cp-sub,.cp-muted{font-size:12px;color:#8292ab}
				.cp-actions,.cp-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
				.cp-btn,.cp-select,.cp-input{background:#111a2b;border:1px solid #26344b;color:#dbe7f7;border-radius:9px;padding:10px 12px;font-size:13px;outline:none}
				.cp-btn{cursor:pointer}
				.cp-select,.cp-input{width:100%}
				.cp-grid{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:16px;align-items:start}
				.cp-panel{background:#0c1423;border:1px solid #1b2940;border-radius:15px;overflow:hidden}
				.cp-panel-head{padding:14px 16px;border-bottom:1px solid #1b2940;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
				.cp-panel-title{font-size:14px;font-weight:750}
				.cp-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
				.cp-stat{background:#0c1423;border:1px solid #1b2940;border-radius:13px;padding:13px;min-width:0}
				.cp-stat-label,.cp-level-label{color:#8292ab;font-size:10px;text-transform:uppercase;letter-spacing:.6px}
				.cp-stat-value{font-size:20px;font-weight:800;margin-top:8px;overflow-wrap:anywhere}
				.cp-stat-note{color:#8292ab;font-size:11px;margin-top:5px}
				.cp-chart{height:490px;width:100%}
				.cp-legend{display:flex;gap:14px;flex-wrap:wrap;padding:10px 16px;color:#9eacc0;font-size:11px;border-top:1px solid #1b2940}
				.cp-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}
				.cp-section{padding:15px 16px;border-bottom:1px solid #1b2940}
				.cp-section:last-child{border-bottom:0}
				.cp-section h3{font-size:13px;margin:0 0 12px}
				.cp-field{display:grid;gap:6px;margin-bottom:11px}
				.cp-label{font-size:11px;color:#93a4bb;display:flex;justify-content:space-between;gap:8px}
				.cp-row{display:grid;grid-template-columns:1fr 1fr;gap:9px}
				.cp-checks{display:grid;grid-template-columns:1fr 1fr;gap:10px}
				.cp-check{display:flex;gap:7px;align-items:center;font-size:12px;color:#c6d2e2}
				.cp-check input{accent-color:#3b82f6}
				.cp-pill{border-radius:7px;padding:5px 8px;font-size:11px;font-weight:800;display:inline-flex}
				.cp-buy{background:#123827;color:#4ade80}
				.cp-sell{background:#401b27;color:#fb7185}
				.cp-wait{background:#3c2b12;color:#fbbf24}
				.cp-levels{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px;padding:13px 16px}
				.cp-level{background:#111a2b;border:1px solid #26344b;border-radius:9px;padding:10px;min-width:0}
				.cp-level-value{font-size:14px;font-weight:800;margin-top:6px;overflow-wrap:anywhere}
				.cp-error{background:#401b27;color:#fecdd3;border:1px solid #7f1d1d;border-radius:9px;padding:10px 12px;font-size:12px;margin-bottom:12px}
				.cp-footer{color:#71819a;font-size:11px;line-height:1.5;margin-top:14px}
				@media(max-width:1050px){.cp-grid{grid-template-columns:1fr}.cp-chart{height:420px}}
				@media(max-width:650px){.cp-root{padding:10px}.cp-title{font-size:20px}.cp-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-stat-value{font-size:17px}.cp-chart{height:360px}.cp-levels{grid-template-columns:repeat(2,minmax(0,1fr))}.cp-controls{width:100%}.cp-controls .cp-select{flex:1;min-width:0}}
			`}</style>

			<div className="cp-shell">
				<header className="cp-header">
					<div className="cp-brand">
						<div className="cp-logo">C</div>
						<div>
							<div className="cp-title">
								CryptoPilot <span style={{ color: '#60a5fa' }}>AI</span>
							</div>
							<div className="cp-sub">
								Live Binance markets · 1-year history · Spot & USDT-M Futures
							</div>
						</div>
					</div>

					<div className="cp-actions">
						<span className="cp-muted">
							{updated ? `Updated ${updated.toLocaleTimeString()}` : 'Connecting to Binance…'}
						</span>
						<button className="cp-btn" onClick={() => window.location.reload()}>
							↻ Refresh
						</button>
					</div>
				</header>

				{error && (
					<div className="cp-error">
						{error}. Binance API access can vary by network or region.
						This app does not place trades.
					</div>
				)}

				<div className="cp-stat-grid">
					<div className="cp-stat">
						<div className="cp-stat-label">Selected Market</div>
						<div className="cp-stat-value">{symbol}</div>
						<div className="cp-stat-note">
							{settings.market === 'spot' ? 'Binance Spot' : 'USDT-M Perpetual Futures'}
						</div>
					</div>

					<div className="cp-stat">
						<div className="cp-stat-label">Last Closed Price</div>
						<div className="cp-stat-value">{fmt(latest?.close)}</div>
						<div className="cp-stat-note">
							{settings.interval} · candles refresh every 15s
						</div>
					</div>

					<div className="cp-stat">
						<div className="cp-stat-label">Current Signal</div>
						<div className="cp-stat-value">
							<span className={`cp-pill ${signal === 'BUY' ? 'cp-buy' : signal === 'SELL' ? 'cp-sell' : 'cp-wait'}`}>
								{signal === 'BUY' ? '▲ BUY' : signal === 'SELL' ? '▼ SELL' : '● WAIT'}
							</span>
						</div>
						<div className="cp-stat-note">Latest completed candle</div>
					</div>

					<div className="cp-stat">
						<div className="cp-stat-label">Confluence Score</div>
						<div className="cp-stat-value">
							{score == null ? '—' : `${score.toFixed(0)}%`}
						</div>
						<div className="cp-stat-note">Agreement score, not win probability</div>
					</div>
				</div>

				<div className="cp-grid">
					<main>
						<section className="cp-panel">
							<div className="cp-panel-head">
								<div>
									<div className="cp-panel-title">
										{symbol} <span className="cp-muted">· {settings.interval}</span>
									</div>
									<div className="cp-muted" style={{ marginTop: 5 }}>
										{loading ? 'Loading candles…' : `${candles.length} candles loaded`}
										{' · '}
										{settings.market === 'spot' ? 'Spot market' : 'USDT-M perpetual'}
									</div>
								</div>

								<div className="cp-controls">
									<select
										className="cp-select"
										style={{ width: 110 }}
										value={settings.market}
										onChange={e => {
											const market = e.target.value;
											setSettings(p => ({ ...p, market, symbol: 'BTCUSDT' }));
										}}
									>
										<option value="spot">Spot</option>
										<option value="futures">Futures</option>
									</select>

									<select
										className="cp-select"
										style={{ width: 90 }}
										value={settings.interval}
										onChange={e => update('interval', e.target.value)}
									>
										{INTERVALS.map(x => <option key={x}>{x}</option>)}
									</select>
								</div>
							</div>

							<div className="cp-panel-head">
								<div className="cp-controls" style={{ flex: 1 }}>
									<input
										className="cp-input"
										style={{ maxWidth: 210 }}
										value={search}
										onChange={e => setSearch(e.target.value)}
										placeholder="Search Binance pairs…"
									/>

									<select
										className="cp-select"
										style={{ maxWidth: 250 }}
										value={symbol}
										onChange={e => update('symbol', e.target.value)}
									>
										{!pairs.some(p => p.symbol === symbol) && (
											<option value={symbol}>{symbol}</option>
										)}
										{visiblePairs.map(p => (
											<option key={p.symbol} value={p.symbol}>{p.symbol}</option>
										))}
									</select>

									<span className="cp-muted">
										{pairs.length.toLocaleString()} trading pairs · list refresh 5m
									</span>
								</div>
							</div>

							<div className="cp-panel-head cp-chart-tools">
								<span className="cp-muted">Zoom chart · Drag to move</span>

								<div className="cp-controls">
									<button className="cp-btn" type="button" onClick={() => zoomChart('in')}>
										＋ Zoom In
									</button>
									<button className="cp-btn" type="button" onClick={() => zoomChart('out')}>
										－ Zoom Out
									</button>
									<button className="cp-btn" type="button" onClick={resetChartView}>
										Fit All
									</button>
								</div>
							</div>

							<div ref={host} className="cp-chart" />

							<div className="cp-legend">
								<span><i className="cp-dot" style={{ background: '#facc15' }} />EMA {settings.emaFast}</span>
								<span><i className="cp-dot" style={{ background: '#60a5fa' }} />EMA {settings.emaMid}</span>
								<span><i className="cp-dot" style={{ background: '#c084fc' }} />EMA {settings.emaTrend}</span>
								<span style={{ color: '#4ade80' }}>▲ BUY</span>
								<span style={{ color: '#fb7185' }}>▼ SELL</span>
								<span style={{ color: '#22c55e' }}>╌ Bullish forecast</span>
								<span style={{ color: '#ef4444' }}>╌ Bearish forecast</span>
								<span style={{ color: '#38bdf8' }}>● FVG</span>
								<span style={{ color: '#f97316' }}>↑↓ Liquidity sweep</span>
							</div>

							<div className="cp-levels">
								{[
									['ENTRY', activeLevels?.entry, '#facc15'],
									['STOP-LOSS', activeLevels?.stop, '#fb7185'],
									['TAKE-PROFIT 1', activeLevels?.tp1, '#4ade80'],
									['TAKE-PROFIT 2', activeLevels?.tp2, '#60a5fa'],
									['TAKE-PROFIT 3', activeLevels?.tp3, '#a78bfa']
								].map(([label, value, color]) => (
									<div className="cp-level" key={label}>
										<div className="cp-level-label">{label}</div>
										<div className="cp-level-value" style={{ color }}>{fmt(value)}</div>
									</div>
								))}
							</div>
						</section>

						<section className="cp-panel" style={{ marginTop: 16 }}>
							<div className="cp-panel-head">
								<div>
									<div className="cp-panel-title">Prediction & Smart Money</div>
									<div className="cp-muted" style={{ marginTop: 4 }}>
										12 future steps · heuristic scenarios
									</div>
								</div>
								<span className={`cp-pill ${forecast.bias === 'BUY' ? 'cp-buy' : forecast.bias === 'SELL' ? 'cp-sell' : 'cp-wait'}`}>
									{forecast.bias === 'BUY' ? '▲ Bullish bias' : forecast.bias === 'SELL' ? '▼ Bearish bias' : '● Mixed / WAIT'}
								</span>
							</div>

							<div className="cp-levels">
								{[
									['Forecast bias', forecast.bias, forecast.bias === 'BUY' ? '#4ade80' : forecast.bias === 'SELL' ? '#fb7185' : '#fbbf24'],
									['Confluence score', `${forecast.confidence || 0}%`, '#60a5fa'],
									['Bull path endpoint', fmt(forecast.bull.at(-1)?.value), '#4ade80'],
									['Bear path endpoint', fmt(forecast.bear.at(-1)?.value), '#fb7185']
								].map(([l, v, c]) => (
									<div className="cp-level" key={l}>
										<div className="cp-level-label">{l}</div>
										<div className="cp-level-value" style={{ color: c, fontSize: 13 }}>{v}</div>
									</div>
								))}
							</div>

							<div className="cp-section">
								<div className="cp-muted">
									Green dashed line = bullish scenario; red dashed line = bearish scenario.
									Blue markers identify possible Fair Value Gaps; orange arrows identify
									possible liquidity sweeps. These are heuristic detections and require
									manual confirmation. Forecast score measures indicator agreement, not
									probability of profit.
								</div>
							</div>
						</section>

						<section className="cp-panel" style={{ marginTop: 16 }}>
							<div className="cp-panel-head">
								<div className="cp-panel-title">Market Analysis</div>
								<span className="cp-muted">Latest completed candle</span>
							</div>

							<div className="cp-levels">
								{[
									['RSI', fmt(latest?.rsi), `Period ${settings.rsiPeriod}`],
									['ADX', fmt(latest?.adx), latest?.adx >= 25 ? 'Trend stronger' : 'Weak / ranging'],
									['ATR', fmt(latest?.atr), 'Volatility measure'],
									['Candle Pattern', latest?.pattern || 'None detected', 'Pattern confirmation']
								].map(([l, v, n]) => (
									<div className="cp-level" key={l}>
										<div className="cp-level-label">{l}</div>
										<div className="cp-level-value" style={{ fontSize: l === 'Candle Pattern' ? 12 : 14 }}>{v}</div>
										<div className="cp-muted">{n}</div>
									</div>
								))}
							</div>

							<div className="cp-section">
								<div className="cp-row">
									<div>
										<div className="cp-muted">Support · 30 candles</div>
										<strong>{fmt(latest?.support)}</strong>
									</div>
									<div>
										<div className="cp-muted">Resistance · 30 candles</div>
										<strong>{fmt(latest?.resistance)}</strong>
									</div>
								</div>
							</div>
						</section>

						<section className="cp-panel" style={{ marginTop: 16 }}>
							<div className="cp-panel-head">
								<div>
									<div className="cp-panel-title">1-Year Coin Details</div>
									<div className="cp-muted" style={{ marginTop: 4 }}>
										Daily candles · refreshed every 5 minutes
									</div>
								</div>
								<span className="cp-muted">
									{yearStats ? `${yearStats.days} daily candles` : 'Loading history…'}
								</span>
							</div>

							<div className="cp-levels">
								{[
									['24H CHANGE', ticker?.priceChangePercent != null ? `${(+ticker.priceChangePercent).toFixed(2)}%` : '—', (+ticker?.priceChangePercent || 0) >= 0 ? '#4ade80' : '#fb7185'],
									['24H HIGH', ticker ? fmt(+ticker.highPrice) : '—', '#dbe7f7'],
									['24H LOW', ticker ? fmt(+ticker.lowPrice) : '—', '#dbe7f7'],
									['24H QUOTE VOLUME', ticker ? fmtCompact(+ticker.quoteVolume) : '—', '#dbe7f7'],
									['PRICE ~1 YEAR AGO', yearStats ? fmt(yearStats.firstPrice) : '—', '#facc15'],
									['1Y CHANGE', yearStats && yearStats.change != null ? `${yearStats.change >= 0 ? '+' : ''}${yearStats.change.toFixed(2)}%` : '—', yearStats?.change >= 0 ? '#4ade80' : '#fb7185'],
									['1Y HIGH', yearStats ? fmt(yearStats.high) : '—', '#4ade80'],
									['1Y LOW', yearStats ? fmt(yearStats.low) : '—', '#fb7185']
								].map(([l, v, c]) => (
									<div className="cp-level" key={l}>
										<div className="cp-level-label">{l}</div>
										<div className="cp-level-value" style={{ color: c, fontSize: 13 }}>{v}</div>
										{l === 'PRICE ~1 YEAR AGO' && yearStats && <div className="cp-muted">From {fmtDate(yearStats.from)}</div>}
										{l === '1Y CHANGE' && yearStats && <div className="cp-muted">To {fmtDate(yearStats.to)}</div>}
										{l === '1Y HIGH' && yearStats && <div className="cp-muted">Daily high</div>}
										{l === '1Y LOW' && yearStats && <div className="cp-muted">Daily low</div>}
									</div>
								))}
							</div>

							<div className="cp-section">
								<div className="cp-row">
									<div>
										<div className="cp-muted">Total base-asset volume across loaded daily candles</div>
										<strong>{yearStats ? fmtCompact(yearStats.volume) : '—'}</strong>
									</div>
									<div>
										<div className="cp-muted">History coverage</div>
										<strong>{yearStats ? `${fmtDate(yearStats.from)} – ${fmtDate(yearStats.to)}` : 'Waiting for Binance data'}</strong>
									</div>
								</div>
								<div className="cp-muted" style={{ marginTop: 9 }}>
									“Price ~1 year ago” uses the first daily candle returned by Binance.
									New listings may have less than one year of history; the displayed
									change covers available data only.
								</div>
							</div>
						</section>
					</main>

					<aside className="cp-panel">
						<div className="cp-panel-head">
							<div>
								<div className="cp-panel-title">Strategy Settings</div>
								<div className="cp-muted" style={{ marginTop: 4 }}>
									Auto-saved in this browser
								</div>
							</div>
							<button className="cp-btn" onClick={reset}>Reset</button>
						</div>

						<div className="cp-section">
							<h3>01 · Signal Strategy</h3>
							<div className="cp-field">
								<label className="cp-label">Strategy mode</label>
								<select
									className="cp-select"
									value={settings.strategy}
									onChange={e => update('strategy', e.target.value)}
								>
									<option value="advanced">Advanced Smart Confluence</option>
									<option value="smart">Smart Indicators</option>
									<option value="priceAction">Price Action + Patterns</option>
								</select>
							</div>

							<div className="cp-field">
								<label className="cp-label">
									Minimum confirmation <b>{settings.threshold}%</b>
								</label>
								<input
									type="range"
									min="40"
									max="90"
									step="5"
									value={settings.threshold}
									onChange={e => update('threshold', +e.target.value)}
									style={{ width: '100%', accentColor: '#60a5fa' }}
								/>
							</div>
							<div className="cp-muted">
								Threshold is an indicator agreement score, not probability of profit.
							</div>
						</div>

						<div className="cp-section">
							<h3>02 · Enable / Disable Indicators</h3>
							<div className="cp-checks">
								{[
									['useEMA', 'EMA trend'],
									['useRSI', 'RSI'],
									['useMACD', 'MACD'],
									['useVolume', 'Volume'],
									['useATR', 'ATR levels'],
									['useADX', 'ADX'],
									['useSR', 'Support / Resistance'],
									['usePatterns', 'Candle patterns']
								].map(([key, label]) => (
									<label className="cp-check" key={key}>
										<input
											type="checkbox"
											checked={!!settings[key]}
											onChange={e => update(key, e.target.checked)}
										/>
										{label}
									</label>
								))}
							</div>
						</div>

						<div className="cp-section">
							<h3>03 · Indicator Parameters</h3>

							<div className="cp-row">
								{[
									['emaFast', 'EMA Fast', 2, 100],
									['emaMid', 'EMA Mid', 3, 200],
									['emaTrend', 'EMA Trend', 5, 300],
									['emaLong', 'EMA Long', 20, 500],
									['rsiPeriod', 'RSI Period', 2, 50],
									['rsiLow', 'RSI Low', 5, 45],
									['rsiHigh', 'RSI High', 55, 95],
									['volumePeriod', 'Volume MA', 2, 100],
									['atrPeriod', 'ATR Period', 2, 50],
									['adxPeriod', 'ADX Period', 2, 50]
								].map(([key, label, min, max]) => (
									<div className="cp-field" key={key}>
										<label className="cp-label">{label}</label>
										<input
											className="cp-input"
											type="number"
											min={min}
											max={max}
											value={settings[key]}
											onChange={e => update(
												key,
												clamp(+e.target.value || DEFAULTS[key], min, max)
											)}
										/>
									</div>
								))}
							</div>

							<div className="cp-field">
								<label className="cp-label">
									ATR Stop-Loss multiplier <b>{settings.atrMultiplier}×</b>
								</label>
								<input
									type="range"
									min="0.5"
									max="4"
									step="0.25"
									value={settings.atrMultiplier}
									onChange={e => update('atrMultiplier', +e.target.value)}
									style={{ width: '100%', accentColor: '#fb7185' }}
								/>
							</div>
						</div>

						<div className="cp-section">
							<h3>04 · Risk / Reward</h3>

							<div className="cp-row">
								<div className="cp-field">
									<label className="cp-label">TP1 ratio</label>
									<select
										className="cp-select"
										value={settings.rr1}
										onChange={e => update('rr1', +e.target.value)}
									>
										<option value="1">1:1</option>
										<option value="1.5">1:1.5</option>
										<option value="2">1:2</option>
									</select>
								</div>

								<div className="cp-field">
									<label className="cp-label">TP2 ratio</label>
									<select
										className="cp-select"
										value={settings.rr2}
										onChange={e => update('rr2', +e.target.value)}
									>
										<option value="2">1:2</option>
										<option value="2.5">1:2.5</option>
										<option value="3">1:3</option>
										<option value="4">1:4</option>
									</select>
								</div>
							</div>

							<div className="cp-muted">
								ENTRY, STOP-LOSS and TP levels are drawn when the latest
								completed candle has a BUY/SELL signal. Spot SELL means
								bearish/exit analysis, not short-selling.
							</div>
						</div>
					</aside>
				</div>

				<div className="cp-footer">
					CryptoPilot AI uses public Binance market data for analysis only and does not
					place orders. Spot lists available trading pairs; Futures lists USDT perpetual
					contracts. One-year statistics use up to 365 daily candles and may cover less
					history for newly listed assets. Market data and API access may vary. Dashed
					future paths are heuristic scenarios, not machine-learning guarantees. FVG and
					liquidity-sweep markers are simplified pattern detections. Signals can be
					wrong; backtest and paper-trade before risking money.
				</div>
			</div>
		</div>
	);
}
