import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { Outfit } from 'next/font/google';
import '../styles/globals.css';
import Layout from '../components/Layout';
import { VehicleProvider } from '../context/VehicleContext';
import { AuthProvider } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isLogin = router.pathname === '/login';
  return (
    <ThemeProvider>
      <Head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </Head>
      <div className={`${outfit.variable} ${outfit.className} font-sans`} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AuthProvider>
          {isLogin ? <Component {...pageProps} /> : <VehicleProvider><Layout><Component {...pageProps} /></Layout></VehicleProvider>}
        </AuthProvider>
      </div>
    </ThemeProvider>
  );
}
