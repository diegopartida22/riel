import type { Project, Task, TaskTree } from "../data";
import { EmptyState } from "../ui/EmptyState";
import { GroupHeader } from "../ui/GroupHeader";
import { TaskRow } from "../ui/TaskRow";

export interface SearchResultsProps {
  query: string;
  results: TaskTree[];
  projectsById: Map<string, Project>;
  today: string;
  loading: boolean;
  error: string | null;
  leaving: ReadonlySet<string>;
  toggle: (task: Task, checked: boolean) => void;
  onOpen: (id: string) => void;
}

/**
 * Los resultados de la búsqueda. Sustituyen a la lista de la vista en curso mientras haya
 * algo escrito, y el riel se queda como estaba: la búsqueda no cambia dónde estás, solo tapa
 * la lista un momento.
 *
 * Aquí no se arrastra ni se agrupa por vista. El orden lo manda la puntuación de la
 * coincidencia, así que una manija prometería guardar un orden que en cuanto cambie una letra
 * de la consulta deja de existir.
 *
 * Las subtareas salen como filas de pleno derecho —sin sangrar y con su propia fecha— porque
 * una coincidencia puede estar en la hija y no en la madre, y sangrarla bajo una madre que no
 * casa daría a entender que la madre también salió.
 */
export function SearchResults({
  query,
  results,
  projectsById,
  today,
  loading,
  error,
  leaving,
  toggle,
  onOpen,
}: SearchResultsProps) {
  // Mientras la consulta viaja, lo que hay en `results` sigue siendo lo de la vista anterior.
  // Pintarlo sería anunciar como resultados unas filas que nadie buscó.
  if (loading) return <div className="view" />;

  if (results.length === 0) {
    return (
      <div className="view">
        {error && <p className="notice notice--error">{error}</p>}
        <EmptyState message={`Sin resultados para «${query.trim()}».`} />
      </div>
    );
  }

  return (
    <div className="view">
      {error && <p className="notice notice--error">{error}</p>}

      <GroupHeader>
        {results.length === 1 ? "1 resultado" : `${results.length} resultados`}
      </GroupHeader>

      <ul className="task-list">
        {results.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            project={task.projectId ? projectsById.get(task.projectId) : null}
            subtasks={task.subtasks}
            today={today}
            leaving={leaving}
            onToggle={toggle}
            onOpen={() => onOpen(task.id)}
          />
        ))}
      </ul>
    </div>
  );
}
