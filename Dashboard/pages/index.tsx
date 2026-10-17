import Head from 'next/head';
import TelemetryChart from '../components/TelemetryChart';

export default function Home() {
  return (
    <>
      <Head>
        <title>Readings | OBD Telemetry</title>
        <meta name="description" content="Live vehicle telemetry, synchronized performance charts, and signal inspection." />
      </Head>
      <TelemetryChart />
    </>
  );
}
