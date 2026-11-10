// JARVIS project-planning register.
// Only the generic starter template is in source control. User edits and task
// completion are stored in their current browser, never in the public GitHub repo.
// No services are connected to this register until separately verified.
export type Phase = 'review' | 'active' | 'on-hold';
export type Priority = 'high' | 'normal';
export type ProjectTask = {
  id: string;
  text: string;
  priority: Priority;
  done: boolean;
};
export type ProjectRecord = {
  id: string;
  name: string;
  focus: string;
  phase: Phase;
  notes: string;
  tasks: ProjectTask[];
  url?: string;
};
export const PORTFOLIO_KEY = 'oj-project-command-centre-v1';

const initial = [
  {
    id: 'inkberry', name: 'Inkberry Lane',
    focus: 'Colouring books, Etsy artwork and marketing',
    url: 'https://www.etsy.com/uk/shop/InkberrylaneStore',
    tasks: [
      'Review full-colour covers and black-and-white page previews',
      'Check every book has the agreed ten printable pages',
      'Review Etsy listing images, descriptions and search terms',
    ],
  },
  {
    id: 'planprint', name: 'PlanPrint Studio',
    focus: 'Digital planners and printables',
    tasks: [
      'Check the dedicated PlanPrint section in the existing Etsy shop',
      'Review printable product quality and listing galleries',
      'Prepare the next planner concept for approval',
    ],
  },
  {
    id: 'promptpulse', name: 'PromptPulseXPro',
    focus: 'Prompt library, subscriptions and promotion',
    url: 'https://promptpulsexpro.com',
    tasks: [
      'Verify free-trial signup and paid checkout end to end',
      'Review conversion tracking and website analytics',
      'Check social scheduling and prepare branded campaign assets',
    ],
  },
  {
    id: 'expenses', name: 'ExpensesHub',
    focus: 'Expense platform, finance checks and commercial version',
    url: 'https://expenseshub.co.uk',
    tasks: [
      'Complete finance exports and paid-status acceptance tests',
      'Review administrator permissions and disaster recovery',
      'Keep the separate commercial product isolated from Chemence',
    ],
  },
  {
    id: 'reception', name: 'LeadReception AI',
    focus: 'AI receptionist and customer onboarding',
    tasks: [
      'Test signup, payments and account activation',
      'Review business onboarding and calling instructions',
      'Verify renewals, cancellations and mobile experience',
    ],
  },
  {
    id: 'pawhaven', name: 'PawHaven',
    focus: 'Dog-bed prototype with integrated water station',
    tasks: [
      'Finalize prototype specifications and bowl locking design',
      'Research materials and manufacturer quotations',
      'Validate washability, safety and pricing assumptions',
    ],
  },
] as const;

export const PROJECT_TEMPLATES: ProjectRecord[] = initial.map((item) => ({
  id: item.id,
  name: item.name,
  focus: item.focus,
  phase: 'review',
  notes: '',
  ...('url' in item && item.url ? { url: item.url } : {}),
  tasks: item.tasks.map((text, index) => ({
    id: item.id + '-' + index,
    text,
    priority: index === 0 ? 'high' : 'normal',
    done: false,
  })),
}));

const phases = new Set<Phase>(['review', 'active', 'on-hold']);
const priorities = new Set<Priority>(['high', 'normal']);

export function loadPortfolio(): ProjectRecord[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return PROJECT_TEMPLATES;
    const json: unknown = JSON.parse(raw);
    return normalizePortfolio(json);
  } catch {
    return PROJECT_TEMPLATES;
  }
}

export function normalizePortfolio(input: unknown): ProjectRecord[] {
  const value = input && typeof input === 'object' && 'projects' in input
    ? (input as { projects: unknown }).projects
    : input;
  if (!Array.isArray(value)) throw new Error('Invalid project backup');
  return PROJECT_TEMPLATES.map((template) => {
    const candidate = value.find((p) => p && typeof p === 'object' && p.id === template.id) as Partial<ProjectRecord> | undefined;
    if (!candidate) return template;
    const tasks = Array.isArray(candidate.tasks)
      ? candidate.tasks.filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string' && t.text.trim())
        .slice(0, 100).map((t) => ({
          id: t.id.slice(0, 80),
          text: t.text.slice(0, 240),
          done: t.done === true,
          priority: priorities.has(t.priority) ? t.priority : 'normal' as const,
        }))
      : template.tasks;
    return {
      ...template,
      phase: phases.has(candidate.phase as Phase) ? candidate.phase as Phase : 'review',
      notes: typeof candidate.notes === 'string' ? candidate.notes.slice(0, 4000) : '',
      tasks,
    };
  });
}
