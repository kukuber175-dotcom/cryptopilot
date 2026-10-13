
import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import './App.css';

const API = 'https://api.coingecko.com/api/v3';

function App() {
  const [coins, setCoins] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('bitcoin');
  const [history, setHistory] = useState([]);
  const [days, setDays] = useState('7');
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    fetch(
      `${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1`
    )
      .then((response) => {
        if (!response.ok) throw new Error('Market request failed');
        return response.json();
      })
      .then((data) => {
        if (active) {
          setCoins(data);
          setError('');
        }
      })
      .catch(() => {
        if (active) {
          setError('Unable to load coins. Please try again later.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    setChartLoading(true);
    setHistory([]);

    fetch(
      `${API}/coins/${selected}/market_chart?vs_currency=usd&days=${days}`
    )
      .then((response) => {
        if (!response.ok) throw new Error('Chart request failed');
        return response.json();
      })
      .then((data) => {
        if (!active) return;

        setHistory(
          (data.prices || []).map(([time, price]) => ({
            time,
            date: new Date(time).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: days === '1' ? '2-digit' : undefined,
              minute: days === '1' ? '2-digit' : undefined,
            }),
            price,
          }))
        );
      })
      .catch(() => {
        if (active) setHistory([]);
      })
      .finally(() => {
        if (active) setChartLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selected, days]);

  const filteredCoins = coins.filter((coin) => {
    const query = search.trim().toLowerCase();

    return (
      coin.name.toLowerCase().includes(query) ||
      coin.symbol.toLowerCase().includes(query) ||
      coin.id.toLowerCase().includes(query)
    );
  });

  const selectedCoin = coins.find((coin) => coin.id === selected);

  const money = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return '—';

    return (
      '$' +
      Number(value).toLocaleString('en-US', {
        maximumSignificantDigits: 8,
      })
    );
  };

  return (
    <main className="dashboard">
      <header className="topbar">
        <h2>
          ₿ Crypto<span>Pulse</span>
        </h2>
        <span className="status">● Market Analytics</span>
      </header>

      <section className="hero">
        <p className="eyebrow">CRYPTO MARKET OVERVIEW</p>
        <h1>Find Your Coin.</h1>
        <p>Search crypto by name or symbol and explore price history.</p>
      </section>

      <section className="market">
        <h2>Search Coins</h2>

        <input
          className="coin-search"
          type="search"
          placeholder="Search Bitcoin, BTC, Ethereum, ETH..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search cryptocurrencies by name or symbol"
        />

        {loading && <p>Loading market data...</p>}
        {error && <p className="error">{error}</p>}

        {!loading && !error && (
          <p className="note">
            {filteredCoins.length} coins found
          </p>
        )}

        <div className="coin-list">
          {filteredCoins.map((coin) => (
            <button
              type="button"
              key={coin.id}
              className={`coin ${
                selected === coin.id ? 'selected' : ''
              }`}
              onClick={() => setSelected(coin.id)}
            >
              <div className="coin-name">
                <img
                  src={coin.image}
                  alt=""
                  width="36"
                  height="36"
                  loading="lazy"
                />
                <div>
                  <strong>{coin.name}</strong>
                  <small>{coin.symbol.toUpperCase()}</small>
                </div>
              </div>

              <strong>{money(coin.current_price)}</strong>

              <span
                className={
                  (coin.price_change_percentage_24h ?? 0) >= 0
                    ? 'positive'
                    : 'negative'
                }
              >
                {coin.price_change_percentage_24h == null
                  ? 'N/A'
                  : `${coin.price_change_percentage_24h.toFixed(2)}%`}
              </span>
            </button>
          ))}

          {!loading && !error && filteredCoins.length === 0 && (
            <p>No coins found. Try another name or symbol.</p>
          )}
        </div>

        <p className="note">
          Market data by CoinGecko. Search results include up to
          250 market-ranked coins from this request.
        </p>
      </section>

      <section className="market analytics">
        <div className="market-heading">
          <div>
            <p className="eyebrow">PRICE HISTORY</p>
            <h2>{selectedCoin?.name || selected} Analytics</h2>
            <h3>{money(selectedCoin?.current_price)}</h3>
          </div>

          <select
            value={days}
            onChange={(event) => setDays(event.target.value)}
            aria-label="Chart time range"
          >
            <option value="1">24 hours</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </div>

        {chartLoading && <p>Loading price chart...</p>}

        {!chartLoading && history.length > 0 && (
          <div className="chart">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  minTickGap={25}
                />
                <YAxis
                  width={85}
                  tickFormatter={(value) =>
                    '$' + Number(value).toLocaleString('en-US')
                  }
                />
                <Tooltip
                  formatter={(value) => [money(value), 'Price']}
                  labelFormatter={(label) => label}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  name="Price"
                  stroke="#65a8ff"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {!chartLoading && history.length === 0 && (
          <p>Chart data unavailable. Try again later.</p>
        )}

        <p className="note">
          For educational purposes only. Not financial advice.
        </p>
      </section>
    </main>
  );
}

export default App;
