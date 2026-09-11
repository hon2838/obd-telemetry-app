import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { Outfit } from 'next/font/google';
import '../styles/globals.css';
import Layout from '../components/Layout';
import { VehicleProvider } from '../context/VehicleContext';
import { AuthProvider } from '../context/AuthContext';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isLogin = router.pathname === '/login';
  return <main className={`${outfit.variable} font-sans`}>
    <AuthProvider>
      {isLogin ? <Component {...pageProps} /> : <VehicleProvider><Layout><Component {...pageProps} /></Layout></VehicleProvider>}
    </AuthProvider>
  </main>;
}
