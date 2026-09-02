import type { AppProps } from 'next/app'
import { Outfit } from 'next/font/google'
import '../styles/globals.css'
import Layout from '../components/Layout'
import { VehicleProvider } from '../context/VehicleContext'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })

export default function App({ Component, pageProps }: AppProps) {
  return (
    <main className={`${outfit.variable} font-sans`}>
      <VehicleProvider>
        <Layout>
          <Component {...pageProps} />
        </Layout>
      </VehicleProvider>
    </main>
  )
}
