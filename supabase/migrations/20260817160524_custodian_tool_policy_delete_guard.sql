alter table public.agent_runs
  drop constraint agent_runs_policy_fk;

alter table public.agent_runs
  add constraint agent_runs_policy_fk
  foreign key (owner_id, tool_policy_id)
  references public.tool_policies (owner_id, id)
  on delete restrict;
