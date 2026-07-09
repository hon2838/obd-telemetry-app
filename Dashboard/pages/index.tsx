import Head from 'next/head'
import TelemetryChart from '../components/TelemetryChart'

export default function Home() {
  return (
    <>
      <Head>
        <title>Axia OS | Telemetry Dashboard</title>
        <meta name="description" content="Advanced Telemetry Dashboard for Perodua Axia" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <TelemetryChart />
    </>
  )
}
