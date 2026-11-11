export interface WorkflowFilterSelection<TFilter extends string> {
  filter: TFilter;
  photoIds: Set<number>;
}

/** A batch selection belongs to one workflow lane; changing lanes starts a fresh batch. */
export function switchWorkflowFilter<TFilter extends string>(
  current: WorkflowFilterSelection<TFilter>,
  nextFilter: TFilter,
): WorkflowFilterSelection<TFilter> {
  if (current.filter === nextFilter) return current;
  return { filter: nextFilter, photoIds: new Set<number>() };
}
