/** 0 baja, 1 media, 2 alta. En la fila, la baja no dibuja nada (spec 3.5). */
export type Priority = 0 | 1 | 2;

export interface Project {
  id: string;
  name: string;
  /** Hex `#RRGGBB`. */
  color: string;
  position: number;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  projectId: string | null;
  parentId: string | null;
  /** ISO 8601 local, sin zona. Si `hasTime` es falso, la hora no significa nada. */
  dueAt: string | null;
  hasTime: boolean;
  priority: Priority;
  completedAt: string | null;
  position: number;
  createdAt: string;
}

/** Una tarea raíz con su único nivel de hijas. */
export interface TaskTree extends Task {
  subtasks: Task[];
}

/** Lo que hace falta para crear una tarea. Todo lo demás tiene valor por omisión. */
export interface NewTask {
  title: string;
  notes?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  dueAt?: string | null;
  hasTime?: boolean;
  priority?: Priority;
}

/** Los campos que se pueden editar después. `undefined` es «no tocar». */
export interface TaskPatch {
  title?: string;
  notes?: string | null;
  projectId?: string | null;
  dueAt?: string | null;
  hasTime?: boolean;
  priority?: Priority;
}

/**
 * Dónde cae algo al reordenar: entre el vecino de arriba y el de abajo. `null` en cualquiera
 * de los dos significa que ese lado es el borde de la lista.
 */
export interface Between {
  after: string | null;
  before: string | null;
}

/**
 * Qué se completó de una sola vez. Completar una padre arrastra a sus hijas, así que
 * deshacer necesita saber exactamente cuáles estaban pendientes antes — descompletarlas
 * todas revolvería las que ya estaban tachadas.
 */
export interface Completion {
  ids: string[];
  at: string;
}
