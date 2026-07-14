'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  BarChart3,
  Package,
  CheckCircle2,
  AlertTriangle,
  History,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MonitoringStats, PoGrouped, ArtikelRow } from '@/lib/actions/produksi/monitoring.actions';

const MonitoringStatusPO = dynamic(() => import('./MonitoringStatusPO'), {
  loading: () => <div className="animate-pulse bg-[#0D0E10] rounded-xl h-64 w-full" />,
});
const MonitoringPerArtikel = dynamic(() => import('./MonitoringPerArtikel'), {
  loading: () => <div className="animate-pulse bg-[#0D0E10] rounded-xl h-64 w-full" />,
});
const MonitoringWarnings = dynamic(() => import('./MonitoringWarnings'), {
  loading: () => <div className="animate-pulse bg-[#0D0E10] rounded-xl h-64 w-full" />,
});

interface Props {
  stats: MonitoringStats;
  klienList: { id: string; nama: string }[];
  poGrouped: PoGrouped;
  artikelData: ArtikelRow[];
  poList: { id: string; no_po: string }[];
  role: string;
}

type TabType = 'status' | 'artikel' | 'warning';

const KPI_CONFIG = [
  { label: 'PO AKTIF', key: 'po_aktif', color: '#3b82f6', icon: BarChart3 },
  { label: 'TOTAL BUNDEL', key: 'total_bundle', color: '#22d3ee', icon: Package },
  { label: 'BUNDEL SELESAI', key: 'bundle_selesai', color: '#22c55e', icon: CheckCircle2 },
  { label: 'BERMASALAH', key: 'bermasalah', color: '#ef4444', icon: AlertTriangle },
];

export default function MonitoringClient({ stats, klienList, poGrouped, artikelData, poList, role }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('status');
  const [stuckThresholdHours, setStuckThresholdHours] = useState(24);
  const [dynamicWarningCount, setDynamicWarningCount] = useState(stats.bermasalah);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* 1. Settings Row */}
      <div className="flex justify-end">
        <div className="flex items-center gap-3 bg-[#1A1D1F] border border-[#2A2D31] px-4 py-2 rounded-xl">
          <label className="text-xs font-bold text-[#9aa0a6] uppercase whitespace-nowrap">
            Ambang Mandek (Jam):
          </label>
          <Input 
            type="number"
            min={1}
            max={168}
            value={stuckThresholdHours}
            onChange={(e) => setStuckThresholdHours(parseInt(e.target.value) || 24)}
            className="w-16 h-8 bg-[#0D0E10] border-[#2A2D31] text-[#e5c17b] text-center font-bold px-1"
          />
        </div>
      </div>

      {/* 2. KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CONFIG.map((kpi) => {
          const Icon = kpi.icon;
          const value = kpi.key === 'bermasalah' ? dynamicWarningCount : stats[kpi.key as keyof MonitoringStats];
          // Special logic for Bermasalah color (green if 0)
          const color = (kpi.key === 'bermasalah' && value === 0) ? '#22c55e' : kpi.color;
          
          return (
            <div key={kpi.label} className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 relative overflow-hidden group hover:border-[#2A2D31]/80 transition-all">
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <Icon size={48} color={color} />
              </div>
              <p className="text-xs text-[#9aa0a6] uppercase font-bold mb-2 tracking-wider">{kpi.label}</p>
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-bold transition-all" style={{ color }}>{value}</p>
                {kpi.label === 'BERMASALAH' && value > 0 && <AlertCircle size={16} color={color} className="animate-pulse" />}
              </div>
              <div className="mt-4 h-1 w-full bg-[#0D0E10] rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-1000" 
                  style={{ 
                    backgroundColor: color, 
                    width: kpi.key === 'bundle_selesai' ? `${(stats.bundle_selesai / (stats.total_bundle || 1)) * 100}%` : '40%' 
                  }} 
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Tab Navigation */}
      <div className="flex gap-2 p-1 bg-[#1A1D1F] border border-[#2A2D31] rounded-xl w-full md:w-max">
        <TabButton 
          active={activeTab === 'status'} 
          onClick={() => setActiveTab('status')}
          icon={<History size={16} />}
          label="Status Produksi" 
        />
        <TabButton 
          active={activeTab === 'artikel'} 
          onClick={() => setActiveTab('artikel')}
          icon={<Package size={16} />}
          label="Monitor Artikel" 
        />
        <TabButton 
          active={activeTab === 'warning'} 
          onClick={() => setActiveTab('warning')}
          icon={<AlertTriangle size={16} />}
          label="Warning Proses" 
        />
      </div>

      {/* 4. Tab Content */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl min-h-[400px] p-6 shadow-sm">
        {activeTab === 'status' ? (
          <MonitoringStatusPO initialData={poGrouped} role={role} />
        ) : activeTab === 'artikel' ? (
          <MonitoringPerArtikel data={artikelData} poList={poList} />
        ) : (
          <MonitoringWarnings 
            thresholdHours={stuckThresholdHours} 
            onWarningCountUpdate={setDynamicWarningCount} 
          />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
        ${active 
          ? 'bg-[#2A2D31] text-[#e5c17b] shadow-inner' 
          : 'text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2A2D31]/50'}
      `}
    >
      {icon}
      {label}
    </button>
  );
}
