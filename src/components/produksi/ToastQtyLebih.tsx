'use client';

import React, { useEffect } from 'react';
import { X, Info } from 'lucide-react';

interface ToastQtyLebihProps {
  show: boolean;
  onClose: () => void;
}

export default function ToastQtyLebih({ show, onClose }: ToastQtyLebihProps) {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onClose();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-right duration-500">
      <div className="bg-[#1A1D1F] border border-[#e5c17b]/30 rounded-2xl p-4 shadow-2xl max-w-sm flex items-start gap-4 relative overflow-hidden group">
        <div className="absolute top-0 left-0 w-1 h-full bg-[#e5c17b]" />
        
        <div className="p-2 rounded-xl bg-[#e5c17b]/10 text-[#e5c17b] shrink-0">
          <Info size={20} />
        </div>

        <div className="flex-1 pr-6">
          <h4 className="text-sm font-bold text-[#e8eaed] mb-1">QTY Melebihi Target</h4>
          <p className="text-xs text-[#9aa0a6] leading-relaxed">
            Request approval telah dikirim ke owner untuk ditinjau. 
            Proses akan berlanjut setelah disetujui.
          </p>
        </div>

        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-1 rounded-lg text-[#5f6368] hover:text-[#e8eaed] hover:bg-[#2A2D31] transition-all"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
