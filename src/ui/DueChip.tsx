import { formatDue } from "./dueDate";

/**
 * La fecha de la fila, en mono y con `tabular-nums` para que las columnas no bailen al pasar
 * de `mié 12` a `vie 14`. El color lo decide el vencimiento (spec 3.5).
 */
export function DueChip({
  dueAt,
  hasTime,
  today,
}: {
  dueAt: string;
  hasTime: boolean;
  today?: string;
}) {
  const { text, tone } = formatDue(dueAt, hasTime, today);
  return (
    <time className={`due-chip due-chip--${tone}`} dateTime={dueAt}>
      {text}
    </time>
  );
}
