import type { Action, ActionId } from "./types";

export const ACTIONS: Record<ActionId, Action> = {
  restart_service: {
    id: "restart_service",
    label: "Restart service",
    verb: "restart the service",
    past: "restarted",
    gerund: "restarting",
    keywords: /\b(restart\w*|bounc\w*|reboot\w*|recycl\w*)\b/i,
  },
  rollback_deploy: {
    id: "rollback_deploy",
    label: "Roll back deployment",
    verb: "roll back",
    past: "rolled back",
    gerund: "rolling back",
    keywords: /\b(roll(ed|ing)?\s*back|rollback|revert\w*)\b/i,
  },
  scale_out: {
    id: "scale_out",
    label: "Scale out",
    verb: "scale out",
    past: "scaled out",
    gerund: "scaling out",
    keywords: /\b(scal(e|ed|ing)\s+(out|up)|add\s+(more\s+)?(pods|instances|capacity))\b/i,
  },
  failover_db: {
    id: "failover_db",
    label: "Fail over database",
    verb: "fail over the database",
    past: "failed over the database",
    gerund: "failing over the database",
    keywords: /\b(fail(ed|ing)?\s*over|failover)\b/i,
  },
  investigate: {
    id: "investigate",
    label: "Hold and investigate",
    verb: "hold and investigate",
    past: "held to investigate",
    gerund: "investigating",
    keywords:
      /\b(investigat\w*|look\s+into|dig\s+(in|into)|check\s+(the\s+)?(logs|traces|dashboards?)|hold\s+off|wait\s+and\s+see)\b/i,
  },
};

export const ACTION_ORDER: ActionId[] = [
  "restart_service",
  "rollback_deploy",
  "scale_out",
  "failover_db",
  "investigate",
];

export function actionLabel(id: ActionId): string {
  return ACTIONS[id].label;
}
