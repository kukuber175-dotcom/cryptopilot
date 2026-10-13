import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts'
import './App.css'

const API = 'https://api.coingecko.com/api/v3'

function App() {
  const [coins, setCoins] = useState([])
  const [selected, setSelected] = useState('bitcoin')
  const [history, setHistory] = useState([])
  const [days, setDays] = useState('7')
  const [loading, setLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load coins')
        return res.json()
      })
      .then(setCoins)
      .catch(() => setError('Market data unavailable. Please try again later.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let active = true
    setChartLoading(true)

    fetch(`${API}/coins/${selected}/market_chart?vs_currency=usd&days=${days}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load chart')
        return res.json()
      })
      .then(data => {
        if (!active) return
        setHistory((data.prices || []).map(([time, price]) => ({
          time,
          date: new Date(time).toLocaleDateString(),
          price,
        })))
      })
      .catch(() => {
        if (active) setHistory([])
      })
      .finally(() => {
        if (active) setChartLoading(false)
      })

    return () => { active = false }
  }, [selected, days])

  const coin = coins.find(item => item.id === selected)
  const money = value => value == null
    ? '—'
    : '$' + Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 })

  return (
    <main className="dashboard">
      <header className="topbar">
        <h2>₿ Crypto<span>Pulse</span></h2>
        <span className="status">● Market Analytics</span>
      </header>

      <section className="hero">
        <p className="eyebrow">CRYPTO MARKET OVERVIEW</p>
        <h1>Understand the market.</h1>
        <p>Explore cryptocurrency prices and historical charts.</p>
      </section>

      <section className="market">
        <h2>Market Overview</h2>
        {loading && <p>Loading market data...</p>}
        {error && <p className="error">{error}</p>}

        <div className="coin-list">
          {coins.map(item => (
            <button
              type="button"
              key={item.id}
              className={`coin ${selected === item.id ? 'selected' : ''}`}
              onClick={() => setSelected(item.id)}
            >
              <div className="coin-name">
                <img src={item.image} alt="" width="36" height="36" />
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.symbol.toUpperCase()}</small>
                </div>
              </div>
              <strong>{money(item.current_price)}</strong>
              <span className={(item.price_change_percentage_24h ?? 0) >= 0 ? 'positive' : 'negative'}>
                {item.price_change_percentage_24h == null
                  ? 'N/A'
                  : `${item.price_change_percentage_24h.toFixed(2)}%`}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="market analytics">
        <div className="market-heading">
          <div>
            <p className="eyebrow">PRICE HISTORY</p>
            <h2>{coin?.name || selected} Analytics</h2>
            <h3>{money(coin?.current_price)}</h3>
          </div>
          <select value={days} onChange={event => setDays(event.target.value)}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </div>

        {chartLoading && <p>Loading chart...</p>}
        {!chartLoading && history.length > 0 && (
          <div className="chart">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={history}>
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={value => money(value)} />
                <Line type="monotone" dataKey="price" name="Price" stroke="#65a8ff" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {!chartLoading && history.length === 0 && <p>Chart data unavailable. Try again later.</p>}

        <p className="note">
          Data provided by CoinGecko. For educational purposes only; not financial advice.
        </p>
      </section>
    </main>
  )
}

export default App

