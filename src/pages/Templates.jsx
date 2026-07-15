import { useState, useEffect } from 'react';
import { Palette, CheckCircle2 } from 'lucide-react';
import { api } from '../utils/api';
import LoadingSpinner from '../components/ui/LoadingSpinner';

const templates = [
  {
    id: 'tpl-classic',
    name: 'Classic',
    description: 'Clean, traditional layout with company letterhead',
    preview: {
      border: 'single',
      accent: 'zinc',
      style: 'Traditional'
    }
  },
  {
    id: 'tpl-modern',
    name: 'Modern',
    description: 'Sleek minimal design with colored header bar',
    preview: {
      border: 'minimal',
      accent: 'blue',
      style: 'Contemporary'
    }
  },
  {
    id: 'tpl-compact',
    name: 'Compact',
    description: 'Space-efficient layout for printing multiple vouchers per page',
    preview: {
      border: 'none',
      accent: 'zinc',
      style: 'Minimal'
    }
  },
];

export default function Templates() {
  const [dbTemplates, setDbTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTemplates()
      .then(setDbTemplates)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  const isDefault = (id) => dbTemplates.find(t => t.id === id)?.is_default;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-900">Voucher Templates</h1>
        <p className="text-sm text-zinc-500 mt-1">Choose a layout for your payment vouchers</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {templates.map((tpl) => {
          const isActive = isDefault(tpl.id);
          return (
            <div
              key={tpl.id}
              className={`card relative overflow-hidden cursor-pointer transition-all duration-200
                ${isActive ? 'ring-2 ring-zinc-900' : 'hover:border-zinc-300'}`}
            >
              {isActive && (
                <div className="absolute top-3 right-3">
                  <CheckCircle2 className="w-5 h-5 text-zinc-900" strokeWidth={1.5} />
                </div>
              )}

              {/* Preview mockup */}
              <div className="border rounded-lg bg-zinc-50 p-4 mb-4 min-h-[160px]">
                <div className="flex items-center justify-between mb-3">
                  <div className="h-3 w-24 bg-zinc-200 rounded" />
                  <div className="h-2 w-16 bg-zinc-200 rounded" />
                </div>
                <div className="border-t border-zinc-200 pt-3 space-y-2">
                  <div className="h-2.5 bg-zinc-200 rounded w-3/4" />
                  <div className="h-2.5 bg-zinc-200 rounded w-1/2" />
                  <div className="flex justify-between pt-2 border-t border-zinc-200">
                    <div className="h-6 w-20 bg-zinc-200 rounded" />
                    <div className="h-6 w-24 bg-zinc-300 rounded" />
                  </div>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-zinc-900 mb-1">{tpl.name}</h3>
              <p className="text-xs text-zinc-500 mb-3">{tpl.description}</p>

              <div className="flex gap-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                  {tpl.preview.style}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                  {tpl.preview.border} border
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-zinc-400 text-center mt-8">
        More template customization coming soon — colors, fonts, and field positioning
      </p>
    </div>
  );
}
