import { AlertTriangle } from 'lucide-react';

export default function ConfirmModal({ open, title, message, confirmLabel, variant = 'default', onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-4">
          <div className={`p-2 rounded-full shrink-0 ${
            variant === 'danger' ? 'bg-red-100' : 'bg-zinc-100'
          }`}>
            <AlertTriangle className={`w-5 h-5 ${
              variant === 'danger' ? 'text-red-600' : 'text-zinc-600'
            }`} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
            <p className="mt-1 text-sm text-zinc-500">{message}</p>
            <div className="flex justify-end gap-2 mt-6">
              <button className="btn-secondary" onClick={onCancel}>Cancel</button>
              <button
                className={variant === 'danger' ? 'btn-danger' : 'btn-primary'}
                onClick={onConfirm}
              >
                {confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
