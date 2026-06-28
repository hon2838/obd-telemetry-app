import Head from 'next/head'
import TelemetryChart from '../components/TelemetryChart'

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
      <Head>
        <title>Axia OS | Telemetry Dashboard</title>
        <meta name="description" content="Advanced Telemetry Dashboard for Perodua Axia" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main style={{ flex: 1, maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        <TelemetryChart />
      </main>
    </div>
  )
}
