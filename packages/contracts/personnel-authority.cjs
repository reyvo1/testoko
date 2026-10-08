// Legacy EMPLOYEE read grants must never turn personal self-service into branch payroll access.
exports.isPersonnelSelfOnly = function isPersonnelSelfOnly(identity) {
  const roles = identity?.roles || [];
  const permissions = identity?.permissions || [];
  return (roles.includes('EMPLOYEE') || permissions.includes('employee.self') || permissions.includes('attendance.record'))
    && !roles.some(role => ['SUPER_ADMIN','OWNER','ADMIN','HR','PAYROLL','FINANCE','MANAGER','AUDITOR'].includes(role))
    && !permissions.some(permission => ['employee.view','payroll.manage','attendance.manage','leave.approve','overtime.approve'].includes(permission));
};
