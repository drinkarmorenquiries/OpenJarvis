import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight, CheckCircle2, ClipboardList, Download, ExternalLink,
  FileUp, FolderKanban, LockKeyhole, Plus, ShieldAlert, Trash2,
} from 'lucide-react';
import {
  PORTFOLIO_KEY, PROJECT_TEMPLATES, loadPortfolio, normalizePortfolio,
  type Phase, type Priority, type ProjectRecord, type ProjectTask,
} from '../lib/project-portfolio';
import { useAppStore } from '../lib/store';

const phaseLabels: Record<Phase, string> = {
  review: 'Needs review',
  active: 'In progress',
  'on-hold': 'On hold',
};
const phaseTone: Record<Phase, string> = {
  review: '#eab308',
  active: '#06b6d4',
  'on-hold': '#a1a1aa',
};

const panelStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
};
const fieldStyle = {
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
};
const taskCount = (project: ProjectRecord) =>
  project.tasks.filter((task) => !task.done).length;
const highCount = (project: ProjectRecord) =>
  project.tasks.filter((task) => !task.done && task.priority === 'high').length;

export function ProjectsPage() {
  const navigate = useNavigate();
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const [projects, setProjects] = useState<ProjectRecord[]>(loadPortfolio);
  const [selectedId, setSelectedId] = useState('inkberry');
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('all');
  const [newTask, setNewTask] = useState('');
  const [newPriority, setNewPriority] = useState<Priority>('normal');
  const [notice, setNotice] = useState('');
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({ version: 1, projects }));
    } catch {
      setNotice('This browser could not save changes. Export a backup instead.');
    }
  }, [projects]);

  const selected = projects.find((project) => project.id === selectedId) || projects[0];
  const openCount = projects.reduce((total, project) => total + taskCount(project), 0);
  const urgentCount = projects.reduce((total, project) => total + highCount(project), 0);
  const doneCount = projects.reduce((total, project) =>
    total + project.tasks.filter((task) => task.done).length, 0);

  const modify = (id: string, updater: (project: ProjectRecord) => ProjectRecord) => {
    setProjects((current) => current.map((project) =>
      project.id === id ? updater(project) : project));
  };
  const updateTask = (taskId: string, updater: (task: ProjectTask) => ProjectTask) => {
    modify(selected.id, (project) => ({
      ...project,
      tasks: project.tasks.map((task) => task.id === taskId ? updater(task) : task),
    }));
  };
  const addTask = () => {
    const title = newTask.trim();
    if (!title) return;
    modify(selected.id, (project) => ({
      ...project,
      tasks: [...project.tasks, {
        id: crypto.randomUUID(),
        text: title.slice(0, 240),
        priority: newPriority,
        done: false,
      }].slice(0, 100),
    }));
    setNewTask('');
    setNewPriority('normal');
  };

  const askJarvis = () => {
    // User controls exactly what information goes to the model.
    // This fills the chat composer, but never automatically sends it.
    const openTasks = selected.tasks.filter((task) => !task.done)
      .slice(0, 25).map((task) =>
        (task.priority === 'high' ? '[High] ' : '') + task.text);
    const prompt = [
      'Act as my project coordinator for ' + selected.name + '.',
      'Focus: ' + selected.focus,
      'Current self-reported status: ' + phaseLabels[selected.phase],
      'Open actions:\n' + (openTasks.map((task) => '- ' + task).join('\n') || 'None recorded'),
      selected.notes.trim() ? 'My notes:\n' + selected.notes.trim().slice(0, 2000) : '',
      'Please organise the top three next actions, identify blockers, and distinguish my notes from live verified facts.',
      'Do not claim you have checked or changed Etsy, Stripe, GitHub, Render, or other systems unless a connector actually performed that check.',
    ].filter(Boolean).join('\n\n');
    try {
      sessionStorage.setItem('oj-project-chat-draft', prompt);
      setSidebarOpen(false);
      navigate('/');
    } catch {
      setNotice('Unable to prepare the chat draft in this browser.');
    }
  };

  const downloadBackup = () => {
    const content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), projects }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jarvis-projects-backup.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setNotice('Backup exported. Keep this JSON file somewhere safe.');
  };
  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 100000) throw new Error('Backup is too large (100 KB maximum).');
      const imported = normalizePortfolio(JSON.parse(await file.text()));
      setProjects(imported);
      setNotice('Backup restored on this browser. The six projects remain separate.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not read the backup.');
    } finally {
      event.target.value = '';
    }
  };

  const visibleTasks = selected.tasks.filter((task) =>
    filter === 'all' || (filter === 'open' ? !task.done : task.done));

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-7 md:py-8"
         style={{ background: 'var(--color-bg)' }}>
      <div className="mx-auto max-w-6xl space-y-5 pb-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider"
                 style={{ color: 'var(--color-accent)' }}>
                <FolderKanban size={15} /> JARVIS · PROJECT COMMAND CENTRE
              </p>
              <h1 className="mt-1 text-xl md:text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>My Projects</h1>
              <p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Six separate business workspaces. Your progress is editable, not guessed.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={downloadBackup}
                      className="rounded-lg px-3 py-2 text-xs font-medium inline-flex items-center gap-2"
                      style={panelStyle}>
                <Download size={15} /> Export backup
              </button>
              <button type="button" onClick={() => importInput.current?.click()}
                      className="rounded-lg px-3 py-2 text-xs font-medium inline-flex items-center gap-2"
                      style={panelStyle}>
                <FileUp size={15} /> Import
              </button>
              <input ref={importInput} type="file" accept=".json,application/json"
                     onChange={importBackup} className="hidden" aria-label="Import portfolio JSON" />
            </div>
          </div>
          <div className="rounded-xl p-3 flex items-start gap-2 text-xs"
               style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            <LockKeyhole size={17} className="shrink-0 mt-0.5" />
            <span>
              <strong>Private to this browser:</strong> tasks and notes are saved locally on this device, not to GitHub, Render or another account.
              They will not synchronise to other devices. Export a backup before clearing Safari data. Do not enter customer or staff personal data, passwords or API keys.
            </span>
          </div>
        </header>

        <div className="grid grid-cols-3 gap-2 md:gap-3">
          {[
            ['Projects', String(projects.length), FolderKanban],
            ['Open actions', String(openCount), ClipboardList],
            ['High priority', String(urgentCount), ShieldAlert],
          ].map(([label, count, Icon]) => {
            const StatIcon = Icon as typeof FolderKanban;
            return (
              <div key={label as string} className="rounded-xl p-3 md:p-4" style={panelStyle}>
                <StatIcon size={16} style={{ color: 'var(--color-accent)' }} />
                <div className="text-xl md:text-2xl mt-1 font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{count as string}</div>
                <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label as string}</div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)] gap-4 items-start">
          <section className="rounded-2xl p-3 space-y-1" style={panelStyle} aria-label="Business list">
            <h2 className="text-xs uppercase tracking-wide font-semibold px-2 py-2"
                style={{ color: 'var(--color-text-tertiary)' }}>Business workspaces</h2>
            {projects.map((project) => {
              const active = selected.id === project.id;
              return (
                <button type="button" key={project.id} onClick={() => { setSelectedId(project.id); setFilter('all'); }}
                        className="w-full rounded-xl px-3 py-3 flex items-center justify-between gap-2 text-left"
                        style={{ background: active ? 'var(--color-accent-subtle)' : 'transparent', border: active ? '1px solid var(--color-accent)' : '1px solid transparent' }}
                        aria-pressed={active}>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{project.name}</span>
                    <span className="block text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>{taskCount(project)} open · {highCount(project)} high priority</span>
                  </span>
                  <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: phaseTone[project.phase] }} />
                </button>
              );
            })}
          </section>

          <section className="rounded-2xl p-4 md:p-5 min-w-0 space-y-5" style={panelStyle} aria-label="Selected project">
            <div className="flex flex-wrap gap-3 items-start justify-between">
              <div className="min-w-0">
                <h2 className="text-lg md:text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{selected.name}</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>{selected.focus}</p>
              </div>
              <select aria-label="Project status" value={selected.phase}
                      onChange={(e) => modify(selected.id, (p) => ({ ...p, phase: e.target.value as Phase }))}
                      className="rounded-lg px-3 py-2 text-xs" style={fieldStyle}>
                {Object.entries(phaseLabels).map(([key, label]) =>
                  <option value={key} key={key}>{label}</option>)}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={askJarvis}
                      className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
                      style={{ background: 'var(--color-accent)', color: 'white' }}>
                Ask JARVIS <ArrowRight size={16} />
              </button>
              {selected.url && (
                <a href={selected.url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
                   style={fieldStyle}>Project website <ExternalLink size={14}/></a>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Action list</h3>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{doneCount} completed across the portfolio · changes saved locally</p>
                </div>
                <div className="flex gap-1 text-xs">
                  {(['all', 'open', 'completed'] as const).map((tab) =>
                    <button type="button" key={tab} onClick={() => setFilter(tab)}
                            className="px-2 py-1.5 rounded-md capitalize"
                            style={{ background: tab === filter ? 'var(--color-accent-subtle)' : 'transparent', color: 'var(--color-text)' }}>{tab}</button>)}
                </div>
              </div>
              <div className="space-y-2">
                {visibleTasks.length === 0 &&
                  <p className="rounded-lg p-3 text-sm" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    No actions in this view.
                  </p>}
                {visibleTasks.map((task) =>
                  <div key={task.id} className="flex items-center gap-2 rounded-xl px-3 py-3"
                       style={{ background: 'var(--color-bg-secondary)' }}>
                    <input type="checkbox" checked={task.done} aria-label={'Complete ' + task.text}
                           onChange={(e) => updateTask(task.id, (t) => ({ ...t, done: e.target.checked }))}
                           className="h-5 w-5 shrink-0 accent-cyan-600" />
                    <span className="min-w-0 flex-1 text-sm break-words" style={{
                      color: task.done ? 'var(--color-text-tertiary)' : 'var(--color-text)',
                      textDecoration: task.done ? 'line-through' : 'none',
                    }}>{task.text}</span>
                    <button type="button" onClick={() => updateTask(task.id, (t) => ({
                      ...t, priority: t.priority === 'high' ? 'normal' : 'high',
                    }))} aria-label="Toggle task priority"
                            className="text-[10px] rounded px-2 py-1 shrink-0"
                            style={{
                              color: task.priority === 'high' ? '#ef4444' : 'var(--color-text-secondary)',
                              border: '1px solid var(--color-border)',
                            }}>{task.priority === 'high' ? 'High' : 'Normal'}</button>
                    <button type="button" aria-label={'Remove ' + task.text}
                            onClick={() => modify(selected.id, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== task.id) }))}
                            className="p-1 shrink-0" style={{ color: 'var(--color-text-tertiary)' }}><Trash2 size={15}/></button>
                  </div>)}
              </div>
              <form onSubmit={(e) => { e.preventDefault(); addTask(); }}
                    className="flex flex-wrap gap-2 items-center">
                <input value={newTask} onChange={(e) => setNewTask(e.target.value)}
                       placeholder="Add an action..." maxLength={240}
                       className="flex-[1_1_160px] min-w-0 rounded-lg px-3 py-2.5 text-sm" style={fieldStyle}/>
                <select value={newPriority} aria-label="New task priority"
                        onChange={(e) => setNewPriority(e.target.value as Priority)}
                        className="rounded-lg px-2 py-2.5 text-xs" style={fieldStyle}>
                  <option value="normal">Normal</option><option value="high">High</option>
                </select>
                <button type="submit" disabled={!newTask.trim()}
                        className="rounded-lg px-3 py-2.5 inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
                        style={{ background: 'var(--color-accent)', color: 'white' }}>
                  <Plus size={15}/> Add
                </button>
              </form>
            </div>

            <div className="space-y-2">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Project notes</h3>
              <textarea rows={4} maxLength={4000} value={selected.notes}
                        onChange={(e) => modify(selected.id, (p) => ({ ...p, notes: e.target.value }))}
                        placeholder="Notes, decisions, blockers... (local to this browser)"
                        className="w-full min-w-0 rounded-xl p-3 text-sm outline-none resize-y" style={fieldStyle}/>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Notes aren't sent to the AI unless you press Ask JARVIS and then send the prepared message.
              </p>
            </div>
          </section>
        </div>
        {notice && <p role="status" className="rounded-lg px-3 py-2 text-sm"
                      style={{ background: 'var(--color-accent-subtle)', color: 'var(--color-text)' }}>
          <CheckCircle2 size={15} className="inline mr-2"/>{notice}
        </p>}
        <footer className="text-xs py-2" style={{ color: 'var(--color-text-tertiary)' }}>
          Project starter lists are planning checklists, not live Etsy, payment, GitHub or sales reports.
          Data is kept separately by project. This first version does not run unattended or synchronise between devices.
        </footer>
      </div>
    </div>
  );
}
