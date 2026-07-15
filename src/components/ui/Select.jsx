import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function Select({ value, onChange, options, className, buttonClassName, placeholder = 'Select...' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div className={`relative ${className || ''}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between rounded-lg border border-zinc-300 bg-white text-zinc-900 shadow-sm transition-all duration-150 hover:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-900 ${buttonClassName || 'px-3 py-2 text-sm'}`}
      >
        <span className={selectedOption ? 'text-zinc-900' : 'text-zinc-400'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg z-50 animate-in fade-in slide-in-from-top-1 duration-100">
          {options.map((opt) => (
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
              <span>{opt.label}</span>
              {opt.value === value && <Check className="w-3.5 h-3.5 text-zinc-900" strokeWidth={2} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
