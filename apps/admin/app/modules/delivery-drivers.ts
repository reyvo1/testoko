export type AssignedDriver = { effectiveFrom: string; effectiveTo?: string | null; employee?: { id: string; employeeNumber: string; fullName: string; isActive?: boolean } };
// The fleet endpoint already limits this projection to drivers assigned in the active branch.
export function activeAssignedDrivers(assignments: AssignedDriver[], now = Date.now()) {
  const drivers = new Map<string, NonNullable<AssignedDriver['employee']>>();
  for (const assignment of assignments) {
    const start = Date.parse(assignment.effectiveFrom);
    const end = assignment.effectiveTo ? Date.parse(assignment.effectiveTo) : Infinity;
    if (!Number.isFinite(start) || start > now || end <= now || Number.isNaN(end) || assignment.employee?.isActive === false || !assignment.employee) continue;
    drivers.set(assignment.employee.id, assignment.employee);
  }
  return [...drivers.values()];
}
