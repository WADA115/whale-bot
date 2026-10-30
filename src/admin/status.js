// 控制台状态视图：区分 agent 最小视图与操作者完整视图。
export function createAdminStatus({
  getCfg, getMode, getClosedAgentPreset, readRoleState, isDshReady,
  isPaused, getInitiativeStats, getSnowlumaSnapshot, readActivityTail
} = {}) {
  function agentView() {
    const rs = readRoleState();
    return {
      mode: getMode(),
      role: rs.role ?? null,
      roleMode: rs.mode ?? 'active',
      dshReady: isDshReady(),
      socialV2Paused: isPaused()
    };
  }

  function adminView() {
    const cfg = getCfg();
    const rs = readRoleState();
    return {
      mode: getMode(),
      closedAgentPreset: getClosedAgentPreset(),
      role: rs.role ?? null,
      roleMode: rs.mode ?? 'active',
      dshReady: isDshReady(),
      ownerQQ: cfg.ownerQQ ?? null,
      allowGroups: cfg.allow?.groups ?? [],
      allowPrivate: cfg.allow?.private ?? [],
      socialV2Paused: isPaused(),
      initiative: getInitiativeStats(),
      snowluma: getSnowlumaSnapshot(),
      activity: readActivityTail(100)
    };
  }

  return { agentView, adminView };
}
