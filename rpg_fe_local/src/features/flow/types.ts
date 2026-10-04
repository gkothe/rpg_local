export type FlowView = 'journey' | 'payload' | 'tools' | 'storage';
export interface FlowItem {
  id: string;
  label: string;
  summary: string;
  timing: string;
  input: string;
  output: string;
  storage: string;
  section: string;
  sources: string[];
  detail?: string;
}
export interface FlowEdge extends FlowItem {
  from: string;
  to: string;
}
export interface FlowStep {
  id: string;
  label: string;
  node: string;
  data: string;
}
export interface FlowTool extends FlowItem {
  bookOnly: boolean;
  args: unknown;
  result: unknown;
}
