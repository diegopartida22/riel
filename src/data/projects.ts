import { execute, select } from "./db";
import { STEP, between, needsRenumber } from "./position";
import { localIso } from "./time";
import type { Between, Project } from "./types";

interface Row {
  id: string;
  name: string;
  color: string;
  position: number;
  created_at: string;
}

const COLUMNS = "id, name, color, position, created_at";

const toProject = (row: Row): Project => ({
  id: row.id,
  name: row.name,
  color: row.color,
  position: row.position,
  createdAt: row.created_at,
});

export async function listProjects(): Promise<Project[]> {
  const rows = await select<Row>(`SELECT ${COLUMNS} FROM projects ORDER BY position, created_at`);
  return rows.map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  const rows = await select<Row>(`SELECT ${COLUMNS} FROM projects WHERE id = $1`, [id]);
  return rows.length ? toProject(rows[0]) : null;
}

/**
 * El proyecto nuevo va al final del riel. La posición se calcula dentro del propio INSERT
 * para no leer el máximo y escribirlo en dos viajes.
 */
export async function createProject(name: string, color: string): Promise<Project> {
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    color,
    position: 0, // lo fija el INSERT; se relee abajo
    createdAt: localIso(),
  };

  await execute(
    `INSERT INTO projects (id, name, color, position, created_at)
     VALUES ($1, $2, $3, COALESCE((SELECT MAX(position) FROM projects), 0) + ${STEP}, $4)`,
    [project.id, project.name, project.color, project.createdAt],
  );

  return (await getProject(project.id)) ?? project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await execute(`UPDATE projects SET name = $1 WHERE id = $2`, [name, id]);
}

export async function setProjectColor(id: string, color: string): Promise<void> {
  await execute(`UPDATE projects SET color = $1 WHERE id = $2`, [color, id]);
}

/**
 * Borrar un proyecto **no** borra sus tareas: la clave foránea las deja con `project_id`
 * nulo, que es lo que pide el spec. El diálogo de confirmación es cosa de la UI; aquí ya se
 * da por dicho que sí.
 */
export async function deleteProject(id: string): Promise<void> {
  await execute(`DELETE FROM projects WHERE id = $1`, [id]);
}

export async function moveProject(id: string, { after, before }: Between): Promise<void> {
  const neighbours = await positionsOf([after, before]);
  const a = after === null ? null : neighbours.get(after) ?? null;
  const b = before === null ? null : neighbours.get(before) ?? null;

  if (needsRenumber(a, b)) {
    await renumberProjects();
    return moveProject(id, { after, before });
  }

  await execute(`UPDATE projects SET position = $1 WHERE id = $2`, [between(a, b), id]);
}

async function positionsOf(ids: (string | null)[]): Promise<Map<string, number>> {
  const wanted = ids.filter((id): id is string => id !== null);
  if (!wanted.length) return new Map();

  const rows = await select<{ id: string; position: number }>(
    `SELECT id, position FROM projects WHERE id IN (${wanted.map((_, i) => `$${i + 1}`).join(", ")})`,
    wanted,
  );
  return new Map(rows.map((row) => [row.id, row.position]));
}

/**
 * Reparte las posiciones de nuevo, respetando el orden que ya se ve. Una sola sentencia para
 * que no exista un instante con la lista a medio numerar.
 */
async function renumberProjects(): Promise<void> {
  await execute(
    `UPDATE projects SET position = (
       SELECT ordenado.fila * ${STEP}.0
         FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at, id) AS fila
                 FROM projects) AS ordenado
        WHERE ordenado.id = projects.id
     )`,
  );
}
