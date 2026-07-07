import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import {
  Navigation, Gauge, Clock, ArrowLeft, Fuel, TrendingUp, Trophy, Calendar, Zap
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar
} from 'recharts';

interface DriveSession {
  id: number;
  startTime: number;
  endTime: number;
  label: string;
  summary: {
    durationMin: number;
    maxRpm: number;
    maxSpeed: number;
    fuelUsedPercent: number;
    pointCount: number;
    distanceKm: number;
    avgSpeed: number;
    startLocation: { lat: number; lon: number } | null;
    endLocation: { lat: number; lon: number } | null;
    fuelEfficiencyKmL: number | null;
    driverScore?: number;
    harshEvents?: { accel: number; brake: number };
  };
}

interface LeaderboardData {
  best_efficiency: DriveSession[];
  longest_distance: DriveSession[];
  highest_speed: DriveSession[];
  longest_duration: DriveSession[];
}

export default function TripsDashboard() {
  const [drives, setDrives] = useState<DriveSession[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData>({
    best_efficiency: [],
    longest_distance: [],
    highest_speed: [],
    longest_duration: []
  });
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState<'efficiency' | 'distance' | 'speed' | 'duration'>('efficiency');

  const API_HOST = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? window.location.protocol + '//' + window.location.hostname + ':3000' : 'http://127.0.0.1:3000');

  const fetchData = async () => {
    try {
      const drivesRes = await fetch(`${API_HOST}/api/drives`);
      const drivesData = await drivesRes.json();
      setDrives(drivesData);

      const lbRes = await fetch(`${API_HOST}/api/trips/leaderboard`);
      const lbData = await lbRes.json();
      setLeaderboard(lbData);
    } catch (err) {
      console.error('Error fetching trips/drives data:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Compute overall stats
  const totalTrips = drives.length;
  const totalDistance = drives.reduce((acc, d) => acc + d.summary.distanceKm, 0);
  const efficiencies = drives.map(d => d.summary.fuelEfficiencyKmL).filter((e): e is number => e !== null && e > 0);
  const bestEfficiency = efficiencies.length > 0 ? Math.max(...efficiencies) : 0;
  const longestTrip = drives.length > 0 ? Math.max(...drives.map(d => d.summary.distanceKm)) : 0;

  // Chart data sorted chronologically
  const chartData = [...drives]
    .reverse()
    .map(d => ({
      date: new Date(d.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      distance: d.summary.distanceKm,
      efficiency: d.summary.fuelEfficiencyKmL || 0,
      id: d.id
    }));

  const getLeaderboardList = () => {
    switch (activeLeaderboardTab) {
      case 'efficiency': return leaderboard.best_efficiency;
      case 'distance': return leaderboard.longest_distance;
      case 'speed': return leaderboard.highest_speed;
      case 'duration': return leaderboard.longest_duration;
    }
  };

  const getLeaderboardValue = (d: DriveSession) => {
    switch (activeLeaderboardTab) {
      case 'efficiency': return `${d.summary.fuelEfficiencyKmL?.toFixed(2) || 'N/A'} km/L`;
      case 'distance': return `${d.summary.distanceKm.toFixed(2)} km`;
      case 'speed': return `${d.summary.maxSpeed} km/h`;
      case 'duration': return `${d.summary.durationMin} mins`;
    }
  };

  return (
    <div style={styles.container}>
      <Head>
        <title>Axia OS | Trips & Drives</title>
      </Head>

      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => window.location.href = '/'} style={styles.backBtn}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={styles.title}>Trips & Drives Log</h1>
            <p style={styles.subtitle}>Historical analytics and trip leaderboards</p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={styles.statsRow}>
        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Total Trips</span>
            <Calendar size={20} style={{ color: 'var(--accent-blue)' }} />
          </div>
          <span style={styles.statsCardValue}>{totalTrips}</span>
          <span style={styles.statsCardSubtext}>Segmented drive sessions</span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Total Distance</span>
            <Navigation size={20} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <span style={styles.statsCardValue}>{totalDistance.toFixed(1)} <span style={{ fontSize: '16px' }}>km</span></span>
          <span style={styles.statsCardSubtext}>Across all recorded drives</span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Best Trip Economy</span>
            <Fuel size={20} style={{ color: 'var(--accent-green)' }} />
          </div>
          <span style={styles.statsCardValue}>{bestEfficiency > 0 ? bestEfficiency.toFixed(1) : 'N/A'} <span style={{ fontSize: '16px' }}>km/L</span></span>
          <span style={styles.statsCardSubtext}>Personal best fuel efficiency</span>
        </div>

        <div className="glass-panel-static" style={styles.statsCard}>
          <div style={styles.statsCardHeader}>
            <span style={styles.statsCardTitle}>Longest Trip</span>
            <TrendingUp size={20} style={{ color: 'var(--accent-purple)' }} />
          </div>
          <span style={styles.statsCardValue}>{longestTrip.toFixed(1)} <span style={{ fontSize: '16px' }}>km</span></span>
          <span style={styles.statsCardSubtext}>Single longest drive session</span>
        </div>
      </div>

      {/* Main Grid */}
      <div style={styles.grid}>
        
        {/* Left Column: Leaderboard */}
        <div className="glass-panel-static" style={{ ...styles.card, display: 'flex', flexDirection: 'column' }}>
          <div style={styles.cardHeader}>
            <Trophy size={20} style={{ color: 'var(--accent-amber)' }} />
            <h2 style={styles.cardTitle}>Trip Leaderboard</h2>
          </div>
          
          {/* Leaderboard Tabs */}
          <div style={styles.lbTabs}>
            <button 
              onClick={() => setActiveLeaderboardTab('efficiency')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'efficiency' ? styles.lbTabActive : {}) }}
            >
              Fuel Efficiency
            </button>
            <button 
              onClick={() => setActiveLeaderboardTab('distance')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'distance' ? styles.lbTabActive : {}) }}
            >
              Distance
            </button>
            <button 
              onClick={() => setActiveLeaderboardTab('speed')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'speed' ? styles.lbTabActive : {}) }}
            >
              Top Speed
            </button>
            <button 
              onClick={() => setActiveLeaderboardTab('duration')}
              style={{ ...styles.lbTab, ...(activeLeaderboardTab === 'duration' ? styles.lbTabActive : {}) }}
            >
              Duration
            </button>
          </div>

          {/* Leaderboard Entries */}
          <div style={styles.lbList}>
            {getLeaderboardList().length === 0 ? (
              <div style={styles.noData}>No drives with valid metrics found</div>
            ) : (
              getLeaderboardList().map((drive, index) => {
                const medals = ['🥇', '🥈', '🥉', '4th', '5th'];
                const startStr = new Date(drive.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={drive.id} style={styles.lbItem}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: index < 3 ? '20px' : '13px', fontWeight: 700, width: '28px', textAlign: 'center' }}>
                        {medals[index]}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
                          Drive #{drive.id}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {startStr}
                        </div>
                      </div>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--accent-amber)' }}>
                      {getLeaderboardValue(drive)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Distance & Economy Trends */}
        <div className="glass-panel-static" style={styles.card}>
          <div style={styles.cardHeader}>
            <TrendingUp size={20} style={{ color: 'var(--accent-blue)' }} />
            <h2 style={styles.cardTitle}>Trip History Trend</h2>
          </div>
          {chartData.length === 0 ? (
            <div style={styles.noData}>Log telemetry data to view trip trends</div>
          ) : (
            <div style={{ height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorDist" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0.0}/>
                    </linearGradient>
                    <linearGradient id="colorEff" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent-green)" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="var(--accent-green)" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis yAxisId="left" stroke="var(--accent-blue)" fontSize={11} unit=" km" />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--accent-green)" fontSize={11} unit=" km/L" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(20,20,25,0.9)', borderRadius: '8px', border: '1px solid var(--border)' }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
                  />
                  <Legend />
                  <Area yAxisId="left" type="monotone" dataKey="distance" name="Distance (km)" stroke="var(--accent-blue)" fillOpacity={1} fill="url(#colorDist)" />
                  <Area yAxisId="right" type="monotone" dataKey="efficiency" name="Efficiency (km/L)" stroke="var(--accent-green)" fillOpacity={1} fill="url(#colorEff)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* History table */}
      <div className="glass-panel-static" style={{ ...styles.card, marginTop: '32px' }}>
        <div style={styles.cardHeader}>
          <Clock size={20} style={{ color: 'var(--accent-cyan)' }} />
          <h2 style={styles.cardTitle}>Complete Trip History</h2>
        </div>
        
        {drives.length === 0 ? (
          <div style={styles.noData}>No trip sessions recorded yet</div>
        ) : (
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.trHead}>
                  <th style={styles.th}>Trip ID</th>
                  <th style={styles.th}>Date & Time</th>
                  <th style={styles.th}>Duration</th>
                  <th style={styles.th}>Distance</th>
                  <th style={styles.th}>Avg Speed</th>
                  <th style={styles.th}>Max Speed</th>
                  <th style={styles.th}>Fuel Used</th>
                  <th style={styles.th}>Fuel Economy</th>
                  <th style={styles.th}>Safety Score</th>
                </tr>
              </thead>
              <tbody>
                {drives.map(drive => {
                  const startStr = new Date(drive.startTime).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  });
                  return (
                    <tr key={drive.id} style={styles.trRow}>
                      <td style={styles.td}><strong>Drive #{drive.id}</strong></td>
                      <td style={styles.td}>{startStr}</td>
                      <td style={styles.td}>{drive.summary.durationMin} mins</td>
                      <td style={styles.td}>{drive.summary.distanceKm.toFixed(2)} km</td>
                      <td style={styles.td}>{drive.summary.avgSpeed.toFixed(1)} km/h</td>
                      <td style={styles.td}>{drive.summary.maxSpeed} km/h</td>
                      <td style={styles.td}>{drive.summary.fuelUsedPercent}%</td>
                      <td style={styles.td}>
                        {drive.summary.fuelEfficiencyKmL ? (
                          <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>
                            {drive.summary.fuelEfficiencyKmL.toFixed(2)} km/L
                          </span>
                        ) : 'N/A'}
                      </td>
                      <td style={styles.td}>
                        {drive.summary.driverScore !== undefined ? (
                          <span style={{ 
                            color: drive.summary.driverScore >= 90 ? 'var(--accent-green)' : (drive.summary.driverScore >= 70 ? 'var(--accent-amber)' : '#ef4444'),
                            fontWeight: 700 
                          }}>
                            {drive.summary.driverScore}/100
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              ({drive.summary.harshEvents?.brake || 0} brake, {drive.summary.harshEvents?.accel || 0} accel)
                            </div>
                          </span>
                        ) : 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '32px',
    maxWidth: '1400px',
    margin: '0 auto',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  header: {
    marginBottom: '8px'
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  title: {
    fontSize: '24px',
    fontWeight: 800,
    color: 'var(--text-primary)'
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-secondary)'
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px'
  },
  statsCard: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  statsCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statsCardTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  statsCardValue: {
    fontSize: '36px',
    fontWeight: 800,
    color: 'var(--text-primary)',
    lineHeight: '1'
  },
  statsCardSubtext: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))',
    gap: '32px',
    marginTop: '16px'
  },
  card: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text-primary)'
  },
  noData: {
    padding: '40px 0',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '14px'
  },
  lbTabs: {
    display: 'flex',
    gap: '8px',
    borderBottom: '1px solid var(--border)',
    paddingBottom: '12px'
  },
  lbTab: {
    padding: '8px 12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-muted)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  lbTabActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: 'var(--accent-amber)',
    border: '1px solid rgba(245, 158, 11, 0.3)'
  },
  lbList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    flex: 1,
    overflowY: 'auto',
    maxHeight: '300px'
  },
  lbItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.02)'
  },
  tableContainer: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px'
  },
  trHead: {
    borderBottom: '1px solid var(--border)'
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    fontWeight: 700,
    color: 'var(--text-secondary)',
    fontSize: '11px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  trRow: {
    borderBottom: '1px solid rgba(255,255,255,0.02)',
    transition: 'background-color 0.2s'
  },
  td: {
    padding: '12px',
    color: 'var(--text-primary)'
  }
};
