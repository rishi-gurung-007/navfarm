/**
 * The department a team row shows: the Cost Centre (type DEPARTMENT) name
 * resolved from `department_id`, falling back to the legacy free-text
 * `department` only when no id is set.
 */
export function departmentLabel(row: { department_id?: string | null; department_name?: string | null; department?: string | null }): string {
  if (row.department_id) return row.department_name || row.department || "";
  return row.department || "";
}
