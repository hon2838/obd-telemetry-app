import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  itemLabel = 'items'
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  if (totalItems <= 0) {
    return null;
  }

  const startItem = (safePage - 1) * pageSize + 1;
  const endItem = Math.min(safePage * pageSize, totalItems);

  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      if (safePage > 3) {
        pages.push('...');
      }
      const start = Math.max(2, safePage - 1);
      const end = Math.min(totalPages - 1, safePage + 1);
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      if (safePage < totalPages - 2) {
        pages.push('...');
      }
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div style={styles.container}>
      <div style={styles.summary}>
        Showing <span style={styles.highlight}>{startItem}</span> to <span style={styles.highlight}>{endItem}</span> of <span style={styles.highlight}>{totalItems}</span> {itemLabel}
      </div>

      <div style={styles.controls}>
        {onPageSizeChange && pageSizeOptions.length > 0 && (
          <div style={styles.pageSizeContainer}>
            <label htmlFor="pagination-page-size" style={styles.pageSizeLabel}>Per page:</label>
            <select
              id="pagination-page-size"
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              style={styles.select}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt} style={styles.option}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={styles.buttonGroup}>
          <button
            type="button"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
            style={{
              ...styles.navBtn,
              ...(safePage <= 1 ? styles.disabledBtn : {})
            }}
            aria-label="Previous Page"
          >
            <ChevronLeft size={16} />
          </button>

          {getPageNumbers().map((p, idx) => {
            if (p === '...') {
              return (
                <span key={`ellipsis-${idx}`} style={styles.ellipsis}>
                  ...
                </span>
              );
            }
            const pageNum = p as number;
            const isActive = pageNum === safePage;
            return (
              <button
                key={pageNum}
                type="button"
                onClick={() => onPageChange(pageNum)}
                style={{
                  ...styles.pageBtn,
                  ...(isActive ? styles.activePageBtn : {})
                }}
              >
                {pageNum}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
            style={{
              ...styles.navBtn,
              ...(safePage >= totalPages ? styles.disabledBtn : {})
            }}
            aria-label="Next Page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '14px',
    padding: '14px 18px',
    borderTop: '1px solid var(--border)',
    backgroundColor: 'rgba(7, 11, 15, 0.45)',
    borderBottomLeftRadius: 'var(--radius-lg)',
    borderBottomRightRadius: 'var(--radius-lg)'
  },
  summary: {
    fontSize: '13px',
    color: 'var(--text-secondary)'
  },
  highlight: {
    color: 'var(--text-primary)',
    fontWeight: 600
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap'
  },
  pageSizeContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  pageSizeLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  select: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '12px',
    padding: '4px 8px',
    cursor: 'pointer',
    outline: 'none'
  },
  option: {
    backgroundColor: '#151a21',
    color: '#f3f5f4'
  },
  buttonGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  navBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'all 0.15s ease'
  },
  pageBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '32px',
    height: '32px',
    padding: '0 8px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid transparent',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease'
  },
  activePageBtn: {
    backgroundColor: 'rgba(94, 215, 208, 0.15)',
    borderColor: 'var(--accent-cyan)',
    color: 'var(--accent-cyan)',
    fontWeight: 700
  },
  disabledBtn: {
    opacity: 0.35,
    cursor: 'not-allowed',
    pointerEvents: 'none'
  },
  ellipsis: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    color: 'var(--text-muted)',
    fontSize: '13px',
    userSelect: 'none'
  }
};
