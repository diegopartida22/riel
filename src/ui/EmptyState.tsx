export interface EmptyStateProps {
  message: string;
  /** Texto del botón. Sin acción, el estado vacío es solo la frase. */
  action?: string;
  onAction?: () => void;
}

/**
 * Una invitación a actuar, no un dibujo: sin ilustración y sin frase motivacional (spec 3.7).
 * La frase dice qué pasa y el botón de texto — no un botón relleno — dice qué hacer.
 */
export function EmptyState({ message, action, onAction }: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty__message">{message}</p>
      {action && (
        <button type="button" className="empty__action" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}
