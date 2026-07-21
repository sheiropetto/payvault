import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

export default function Select({ value, onChange, options, className, buttonClassName, placeholder = 'Select...', searchable = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    if (!open) {
      setSearch('');
    }
  }, [open, searchable]);

  const selectedOption = options.find(opt => opt.value === value);

  const filteredOptions = searchable && search
    ? options.filter(opt => opt.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className={`relative ${className || ''}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between rounded-lg border border-zinc-300 bg-white text-zinc-900 shadow-sm transition-all duration-150 hover:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-900 ${buttonClassName || 'px-3 py-2 text-sm'}`}
      >
        <span className={`truncate ${selectedOption ? 'text-zinc-900' : 'text-zinc-400'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 rounded-lg border border-zinc-200 bg-white shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-100">
          {searchable && (
            <div className="relative px-2 pt-2 pb-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" strokeWidth={1.5} />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Type to search..."
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-zinc-200 rounded-md focus:outline-none focus:border-zinc-400 bg-zinc-50 placeholder-zinc-400"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-zinc-400 text-center">No results</div>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors hover:bg-zinc-50
                    ${opt.value === value ? 'bg-zinc-50 text-zinc-900 font-medium' : 'text-zinc-600'}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.value === value && <Check className="w-3.5 h-3.5 text-zinc-900 shrink-0" strokeWidth={2} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
