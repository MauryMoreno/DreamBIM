

export type Args = Record<string, unknown>;

export interface Command {
  name: string;
  args: string;
  description: string;
  run(a: Args): unknown | Promise<unknown>;
  /** Dry run for the approval card; what it returns is shown as is. */
  preview?(a: Args): unknown | Promise<unknown>;
}
