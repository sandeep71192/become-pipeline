// Deal stages, in board order. `pipeline` decides which board a stage appears on.
export const STATUSES = [
  { key: 'deal_generated',   label: 'Deal generated',     pipeline: 'sales' },
  { key: 'discovery_1',      label: 'Discovery call 1',   pipeline: 'sales' },
  { key: 'discovery_2',      label: 'Discovery call 2',   pipeline: 'sales' },
  { key: 'proposal_1',       label: 'Proposal 1',         pipeline: 'sales' },
  { key: 'proposal_2',       label: 'Proposal 2',         pipeline: 'sales' },
  { key: 'follow_up_1',      label: 'Follow-up 1',        pipeline: 'sales' },
  { key: 'follow_up_2',      label: 'Follow-up 2',        pipeline: 'sales' },
  { key: 'follow_up_3',      label: 'Follow-up 3',        pipeline: 'sales' },
  { key: 'finalising_terms', label: 'Finalising terms',   pipeline: 'sales' },
  { key: 'sow_msa',          label: 'SoW & MSA',          pipeline: 'sales' },
  { key: 'on_hold',          label: 'On-hold',            pipeline: 'sales' },
  { key: 'closed_lost',      label: 'Closed / Lost',      pipeline: 'sales' },
  { key: 'active_project',   label: 'Active project',     pipeline: 'projects' },
  { key: 'project_on_hold',  label: 'Project on hold',    pipeline: 'projects' },
  { key: 'completed_project',label: 'Completed project',  pipeline: 'projects' },
  { key: 'payment_follow_up',label: 'Payment follow-up',  pipeline: 'projects' },
];

export const DEFAULT_STATUS = 'deal_generated';
export const STATUS_KEYS = new Set(STATUSES.map((s) => s.key));
export const statusLabel = (key) => STATUSES.find((s) => s.key === key)?.label ?? key;
