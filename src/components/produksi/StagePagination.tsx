import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  page: number;
  totalPages: number;
  onPageChange: (newPage: number) => void;
}

export default function StagePagination({ page, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const renderPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;
    
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, start + maxVisible - 1);
    
    if (end === totalPages) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
        pages.push(
          <button
            key={i}
            onClick={() => onPageChange(i)}
            className={`
              w-8 h-8 rounded-lg text-xs font-bold transition-all border
              ${page === i 
                ? 'bg-[#e5c17b] text-[#0D0E10] border-[#e5c17b]' 
                : 'bg-[#1A1D1F] text-[#9aa0a6] border-[#2A2D31] hover:border-[#9aa0a6] hover:text-[#e8eaed]'}
            `}
          >
            {i}
          </button>
        );
    }
    return pages;
  };

  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1A1D1F] border border-[#2A2D31] text-[#9aa0a6] hover:border-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-20 disabled:cursor-not-allowed transition-all"
      >
        <ChevronLeft size={14} />
      </button>

      <div className="flex items-center gap-1">
        {renderPageNumbers()}
      </div>

      <button
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#1A1D1F] border border-[#2A2D31] text-[#9aa0a6] hover:border-[#9aa0a6] hover:text-[#e8eaed] disabled:opacity-20 disabled:cursor-not-allowed transition-all"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
